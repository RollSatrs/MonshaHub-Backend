import { HttpStatus, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  bookingsTable,
  organizationsTable,
  paymentsTable,
  productsTable,
  roomCleaningsTable,
  roomsTable,
  servicesTable,
  tariffsTable,
  visitItemsTable,
  visitsTable,
} from 'src/db/schema';
import { exclusionViolation, uniqueViolation } from 'src/common/db-errors';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import {
  compareMoney,
  moneyToMinor,
  minorToMoney,
  multiplyMoney,
  proratePerHour,
  subtractMoney,
} from 'src/common/money';
import { applyStockMovement, DbExecutor } from 'src/products/stock';
import type { AuthUser } from 'src/types/express';

/**
 * Все операции над посещениями. Вызываются внутри транзакции (tx).
 *
 * Порядок блокировок (во избежание дедлоков): ROOM → VISIT → PRODUCT.
 * Операции с интервалами времени (старт, продление, бронь) сначала блокируют помещение —
 * это сериализует их между собой. Операции с позициями/оплатой блокируют только посещение.
 */
export type Tx = DbExecutor;

export const MAX_DURATION_MINUTES = 24 * 60;

type RoomRow = typeof roomsTable.$inferSelect;
type VisitRow = typeof visitsTable.$inferSelect;
type BookingRow = typeof bookingsTable.$inferSelect;
type GuestCategory = 'ADULT' | 'CHILD';

// ─── ошибки ───────────────────────────────────────────────────────────────

const conflict = (
  code: ErrorCode,
  message: string,
  meta?: Record<string, unknown>,
) => new AppException(code, message, HttpStatus.CONFLICT, undefined, meta);

const invalid = (message: string) =>
  new AppException(
    ErrorCode.VALIDATION_ERROR,
    'Ошибка валидации',
    HttpStatus.BAD_REQUEST,
    [message],
  );

const roomNotAvailable = (message: string) =>
  conflict(ErrorCode.ROOM_NOT_AVAILABLE, message);

export function bookingConflictError(
  booking: Pick<BookingRow, 'id' | 'startsAt' | 'endsAt'>,
  now: Date,
  message = 'Помещение занято бронью на это время',
) {
  return conflict(ErrorCode.BOOKING_CONFLICT, message, {
    bookingId: booking.id,
    conflictStartsAt: booking.startsAt.toISOString(),
    conflictEndsAt: booking.endsAt.toISOString(),
    availableMinutes: Math.max(
      0,
      Math.floor((booking.startsAt.getTime() - now.getTime()) / 60_000),
    ),
  });
}

/** Ошибки БД, которые означают гонку за помещение/бронь, → доменные ошибки. Вызывать снаружи транзакции. */
export function mapVisitDbError(err: unknown): unknown {
  const unique = uniqueViolation(err);
  if (unique === 'visits_active_private_room_unique') {
    return roomNotAvailable('В помещении уже идёт посещение');
  }
  if (unique === 'room_cleanings_open_room_unique') {
    return roomNotAvailable('Помещение на уборке');
  }
  if (unique === 'visits_booking_unique') {
    return conflict(
      ErrorCode.BOOKING_NOT_ACTIVE,
      'По этой брони посещение уже начато',
    );
  }
  if (exclusionViolation(err) === 'bookings_no_overlap') {
    return conflict(
      ErrorCode.BOOKING_CONFLICT,
      'Помещение занято бронью на это время',
    );
  }
  return err;
}

// ─── блокировки и общие запросы ───────────────────────────────────────────

export async function lockRoom(
  tx: Tx,
  organizationId: number,
  roomId: number,
): Promise<RoomRow> {
  const [room] = await tx
    .select()
    .from(roomsTable)
    .where(
      and(
        eq(roomsTable.id, roomId),
        eq(roomsTable.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for('update');
  if (!room) throw new NotFoundException('Помещение не найдено');
  return room;
}

export async function lockVisit(
  tx: Tx,
  organizationId: number,
  visitId: number,
): Promise<VisitRow> {
  const [visit] = await tx
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.id, visitId),
        eq(visitsTable.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for('update');
  if (!visit) throw new NotFoundException('Посещение не найдено');
  return visit;
}

/** roomId посещения без блокировки — чтобы сначала заблокировать помещение (порядок ROOM → VISIT). */
export async function visitRoomId(
  tx: Tx,
  organizationId: number,
  visitId: number,
): Promise<number> {
  const [v] = await tx
    .select({ roomId: visitsTable.roomId })
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.id, visitId),
        eq(visitsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!v) throw new NotFoundException('Посещение не найдено');
  return v.roomId;
}

async function getOrganization(tx: Tx, organizationId: number) {
  const [org] = await tx
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);
  if (!org) throw new NotFoundException('Организация не найдена');
  return org;
}

export function assertActive(visit: VisitRow) {
  if (visit.status === 'COMPLETED') {
    throw conflict(
      ErrorCode.VISIT_ALREADY_COMPLETED,
      'Посещение уже завершено и не может быть изменено',
    );
  }
  if (visit.status === 'CANCELLED') {
    throw conflict(ErrorCode.VISIT_NOT_ACTIVE, 'Посещение отменено');
  }
}

export function assertDuration(minutes: number, step: number) {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw invalid('Длительность должна быть положительным целым числом минут');
  }
  if (minutes > MAX_DURATION_MINUTES) {
    throw invalid('Длительность не может превышать 24 часа');
  }
  if (minutes % step !== 0) {
    throw invalid(`Длительность должна быть кратна ${step} мин`);
  }
}

export async function visitTotals(tx: Tx, visitId: number) {
  const [t] = await tx
    .select({
      total: sql<string>`coalesce(sum(${visitItemsTable.lineTotal}), 0)::numeric(14,2)::text`,
    })
    .from(visitItemsTable)
    .where(
      and(
        eq(visitItemsTable.visitId, visitId),
        isNull(visitItemsTable.voidedAt),
      ),
    );
  const [p] = await tx
    .select({
      paid: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)::numeric(14,2)::text`,
    })
    .from(paymentsTable)
    .where(eq(paymentsTable.visitId, visitId));
  return { total: t.total, paid: p.paid };
}

/** Сколько человек сейчас внутри PUBLIC-помещения: сумма ENTRY-позиций активных посещений. */
export async function insideCount(tx: Tx, roomId: number): Promise<number> {
  const [r] = await tx
    .select({
      n: sql<number>`coalesce(sum(${visitItemsTable.quantity}), 0)::int`,
    })
    .from(visitItemsTable)
    .innerJoin(visitsTable, eq(visitsTable.id, visitItemsTable.visitId))
    .where(
      and(
        eq(visitsTable.roomId, roomId),
        eq(visitsTable.status, 'ACTIVE'),
        eq(visitsTable.kind, 'PUBLIC'),
        eq(visitItemsTable.kind, 'ENTRY'),
        isNull(visitItemsTable.voidedAt),
      ),
    );
  return r.n;
}

/** Первая активная бронь помещения, пересекающая [start, end). */
export async function findBookingConflict(
  tx: Tx,
  roomId: number,
  start: Date,
  end: Date,
  excludeBookingId?: number,
): Promise<BookingRow | undefined> {
  const [b] = await tx
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.roomId, roomId),
        eq(bookingsTable.status, 'BOOKED'),
        lt(bookingsTable.startsAt, end),
        gt(bookingsTable.endsAt, start),
        excludeBookingId ? ne(bookingsTable.id, excludeBookingId) : undefined,
      ),
    )
    .orderBy(asc(bookingsTable.startsAt))
    .limit(1);
  return b;
}

async function activePrivateVisit(tx: Tx, roomId: number) {
  const [v] = await tx
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.roomId, roomId),
        eq(visitsTable.kind, 'PRIVATE'),
        eq(visitsTable.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  return v;
}

async function openCleaning(tx: Tx, roomId: number) {
  const [c] = await tx
    .select()
    .from(roomCleaningsTable)
    .where(
      and(
        eq(roomCleaningsTable.roomId, roomId),
        isNull(roomCleaningsTable.finishedAt),
      ),
    )
    .limit(1);
  return c;
}

/** Бронь на интервал: блокирует активное посещение помещения (его занятость — [start, max(конец, now)]). */
export async function assertRoomFreeForBooking(
  tx: Tx,
  roomId: number,
  start: Date,
  end: Date,
  now: Date,
  excludeBookingId?: number,
) {
  const conflictBooking = await findBookingConflict(
    tx,
    roomId,
    start,
    end,
    excludeBookingId,
  );
  if (conflictBooking) throw bookingConflictError(conflictBooking, now);

  const active = await activePrivateVisit(tx, roomId);
  if (active?.endsAt) {
    const occupiedUntil = new Date(
      Math.max(active.endsAt.getTime(), now.getTime()),
    );
    if (active.startedAt < end && occupiedUntil > start) {
      throw conflict(
        ErrorCode.BOOKING_CONFLICT,
        'В это время в помещении идёт посещение',
        {
          conflictStartsAt: active.startedAt.toISOString(),
          conflictEndsAt: occupiedUntil.toISOString(),
        },
      );
    }
  }
}

async function insertItem(tx: Tx, values: typeof visitItemsTable.$inferInsert) {
  const [row] = await tx.insert(visitItemsTable).values(values).returning();
  return row;
}

// ─── старт посещения ──────────────────────────────────────────────────────

export interface StartPrivateInput {
  user: AuthUser;
  roomId: number;
  now: Date;
  durationMinutes: number;
  customerName?: string | null;
  customerPhone?: string | null;
  guestsCount?: number | null;
  bookingId?: number | null;
}

/**
 * Старт PRIVATE-посещения (walk-in или по брони). Оплаченная длительность фиксируется сразу:
 * позиция ROOM_TIME = часовая ставка × минуты; продление добавляет ещё одну такую позицию.
 */
export async function startPrivateVisit(
  tx: Tx,
  input: StartPrivateInput,
): Promise<number> {
  const { user, now } = input;
  const room = await lockRoom(tx, user.organizationId, input.roomId);
  if (!room.active) throw roomNotAvailable('Помещение в архиве');
  if (room.type !== 'PRIVATE') {
    throw new AppException(
      ErrorCode.ROOM_TYPE_MISMATCH,
      'Это общественное помещение: используйте вход гостей',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  const org = await getOrganization(tx, user.organizationId);
  assertDuration(input.durationMinutes, org.timeStepMinutes);

  if (await activePrivateVisit(tx, room.id)) {
    throw roomNotAvailable('В помещении уже идёт посещение');
  }
  if (await openCleaning(tx, room.id)) {
    throw roomNotAvailable('Помещение на уборке — сначала завершите уборку');
  }

  const [tariff] = await tx
    .select()
    .from(tariffsTable)
    .where(
      and(
        eq(tariffsTable.roomId, room.id),
        eq(tariffsTable.kind, 'HOURLY'),
        eq(tariffsTable.active, true),
      ),
    )
    .limit(1);
  if (!tariff) {
    throw conflict(
      ErrorCode.TARIFF_NOT_CONFIGURED,
      'У помещения не задан почасовой тариф',
    );
  }

  const endsAt = new Date(now.getTime() + input.durationMinutes * 60_000);
  const other = await findBookingConflict(
    tx,
    room.id,
    now,
    endsAt,
    input.bookingId ?? undefined,
  );
  if (other) {
    throw bookingConflictError(
      other,
      now,
      'Время посещения пересекается с бронью',
    );
  }

  const [visit] = await tx
    .insert(visitsTable)
    .values({
      organizationId: user.organizationId,
      roomId: room.id,
      kind: 'PRIVATE',
      status: 'ACTIVE',
      bookingId: input.bookingId ?? null,
      customerName: input.customerName?.trim() || null,
      customerPhone: input.customerPhone?.trim() || null,
      guestsCount: input.guestsCount ?? null,
      startedAt: now,
      endsAt,
      roomName: room.name,
      tariffId: tariff.id,
      tariffName: tariff.name,
      hourlyRate: tariff.price,
      timeStepMinutes: org.timeStepMinutes,
      currency: org.currency,
      createdBy: user.id,
    })
    .returning();

  await insertItem(tx, {
    organizationId: user.organizationId,
    visitId: visit.id,
    kind: 'ROOM_TIME',
    tariffId: tariff.id,
    nameSnapshot: 'Аренда помещения',
    unitPrice: tariff.price,
    quantity: 1,
    minutes: input.durationMinutes,
    lineTotal: proratePerHour(tariff.price, input.durationMinutes),
    createdBy: user.id,
  });

  return visit.id;
}

export interface GuestsInput {
  category: GuestCategory;
  quantity: number;
}

async function addEntryItems(
  tx: Tx,
  user: AuthUser,
  room: RoomRow,
  visitId: number,
  guests: GuestsInput[],
) {
  const merged = new Map<GuestCategory, number>();
  for (const g of guests) {
    merged.set(g.category, (merged.get(g.category) ?? 0) + g.quantity);
  }
  const total = [...merged.values()].reduce((a, b) => a + b, 0);
  if (total < 1) throw invalid('Укажите хотя бы одного гостя');

  const inside = await insideCount(tx, room.id);
  if (inside + total > room.capacity) {
    throw conflict(
      ErrorCode.ROOM_CAPACITY_EXCEEDED,
      `Превышена вместимость зала: внутри ${inside} из ${room.capacity}`,
      { inside, capacity: room.capacity, requested: total },
    );
  }

  for (const [category, quantity] of merged) {
    const [tariff] = await tx
      .select()
      .from(tariffsTable)
      .where(
        and(
          eq(tariffsTable.roomId, room.id),
          eq(tariffsTable.kind, 'PER_ENTRY'),
          eq(tariffsTable.guestCategory, category),
          eq(tariffsTable.active, true),
        ),
      )
      .limit(1);
    if (!tariff) {
      throw conflict(
        ErrorCode.TARIFF_NOT_CONFIGURED,
        `У зала не задан тариф входа: ${category === 'ADULT' ? 'взрослый' : 'детский'}`,
      );
    }
    await insertItem(tx, {
      organizationId: user.organizationId,
      visitId,
      kind: 'ENTRY',
      tariffId: tariff.id,
      guestCategory: category,
      nameSnapshot: tariff.name,
      unitPrice: tariff.price,
      quantity,
      lineTotal: multiplyMoney(tariff.price, quantity),
      createdBy: user.id,
    });
  }
}

export interface StartPublicInput {
  user: AuthUser;
  roomId: number;
  now: Date;
  guests: GuestsInput[];
  customerName?: string | null;
  customerPhone?: string | null;
}

/** PUBLIC: один Visit = один чек человека/группы; вход — позиции ENTRY со snapshot цены. */
export async function startPublicVisit(
  tx: Tx,
  input: StartPublicInput,
): Promise<number> {
  const { user } = input;
  const room = await lockRoom(tx, user.organizationId, input.roomId);
  if (!room.active) throw roomNotAvailable('Помещение в архиве');
  if (room.type !== 'PUBLIC') {
    throw new AppException(
      ErrorCode.ROOM_TYPE_MISMATCH,
      'Это приватное помещение: используйте старт посещения с длительностью',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const org = await getOrganization(tx, user.organizationId);

  const [visit] = await tx
    .insert(visitsTable)
    .values({
      organizationId: user.organizationId,
      roomId: room.id,
      kind: 'PUBLIC',
      status: 'ACTIVE',
      customerName: input.customerName?.trim() || null,
      customerPhone: input.customerPhone?.trim() || null,
      startedAt: input.now,
      roomName: room.name,
      currency: org.currency,
      createdBy: user.id,
    })
    .returning();

  await addEntryItems(tx, user, room, visit.id, input.guests);
  return visit.id;
}

/** Добавить гостей в активный PUBLIC-визит. Вызывать после lockRoom. */
export async function addGuests(
  tx: Tx,
  input: {
    user: AuthUser;
    visitId: number;
    roomId: number;
    guests: GuestsInput[];
  },
) {
  const { user } = input;
  const room = await lockRoom(tx, user.organizationId, input.roomId);
  const visit = await lockVisit(tx, user.organizationId, input.visitId);
  assertActive(visit);
  if (visit.kind !== 'PUBLIC') {
    throw new AppException(
      ErrorCode.ROOM_TYPE_MISMATCH,
      'Гостей можно добавлять только в посещение общественного зала',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  await addEntryItems(tx, user, room, visit.id, input.guests);
}

// ─── позиции ──────────────────────────────────────────────────────────────

/** Товар: позиция + уменьшение остатка + SALE-движение — одной транзакцией; нехватка остатка откатывает всё. */
export async function addProduct(
  tx: Tx,
  input: {
    user: AuthUser;
    visitId: number;
    productId: number;
    quantity: number;
  },
) {
  const { user } = input;
  const visit = await lockVisit(tx, user.organizationId, input.visitId);
  assertActive(visit);

  const [product] = await tx
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.id, input.productId),
        eq(productsTable.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!product) throw new NotFoundException('Товар не найден');
  if (!product.active) {
    throw conflict(ErrorCode.PRODUCT_NOT_AVAILABLE, 'Товар в архиве');
  }

  const [existingItem] = await tx
    .select()
    .from(visitItemsTable)
    .where(
      and(
        eq(visitItemsTable.visitId, visit.id),
        eq(visitItemsTable.kind, 'PRODUCT'),
        eq(visitItemsTable.productId, product.id),
        eq(visitItemsTable.unitPrice, product.price),
        isNull(visitItemsTable.voidedAt),
      ),
    )
    .limit(1);

  const item = existingItem
    ? (
        await tx
          .update(visitItemsTable)
          .set({
            quantity: existingItem.quantity + input.quantity,
            lineTotal: multiplyMoney(
              product.price,
              existingItem.quantity + input.quantity,
            ),
          })
          .where(eq(visitItemsTable.id, existingItem.id))
          .returning()
      )[0]
    : await insertItem(tx, {
        organizationId: user.organizationId,
        visitId: visit.id,
        kind: 'PRODUCT',
        productId: product.id,
        nameSnapshot: product.name,
        unitPrice: product.price,
        quantity: input.quantity,
        lineTotal: multiplyMoney(product.price, input.quantity),
        createdBy: user.id,
      });

  await applyStockMovement(tx, {
    organizationId: user.organizationId,
    productId: product.id,
    type: 'SALE',
    quantityDelta: -input.quantity,
    reason: `Посещение №${visit.id}`,
    visitItemId: item.id,
    userId: user.id,
  });
}

/** Услуга: позиция без складского движения. */
export async function addService(
  tx: Tx,
  input: {
    user: AuthUser;
    visitId: number;
    serviceId: number;
    quantity: number;
  },
) {
  const { user } = input;
  const visit = await lockVisit(tx, user.organizationId, input.visitId);
  assertActive(visit);

  const [service] = await tx
    .select()
    .from(servicesTable)
    .where(
      and(
        eq(servicesTable.id, input.serviceId),
        eq(servicesTable.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!service) throw new NotFoundException('Услуга не найдена');
  if (!service.active) {
    throw conflict(ErrorCode.SERVICE_NOT_AVAILABLE, 'Услуга в архиве');
  }

  const [existingItem] = await tx
    .select()
    .from(visitItemsTable)
    .where(
      and(
        eq(visitItemsTable.visitId, visit.id),
        eq(visitItemsTable.kind, 'SERVICE'),
        eq(visitItemsTable.serviceId, service.id),
        eq(visitItemsTable.unitPrice, service.price),
        isNull(visitItemsTable.voidedAt),
      ),
    )
    .limit(1);

  if (existingItem) {
    const quantity = existingItem.quantity + input.quantity;
    await tx
      .update(visitItemsTable)
      .set({
        quantity,
        lineTotal: multiplyMoney(service.price, quantity),
      })
      .where(eq(visitItemsTable.id, existingItem.id));
  } else {
    await insertItem(tx, {
      organizationId: user.organizationId,
      visitId: visit.id,
      kind: 'SERVICE',
      serviceId: service.id,
      nameSnapshot: service.name,
      unitPrice: service.price,
      quantity: input.quantity,
      lineTotal: multiplyMoney(service.price, input.quantity),
      createdBy: user.id,
    });
  }
}

/** Исправление ошибочной позиции: погашается (кто/когда/почему), товар возвращается на склад (SALE_RETURN). */
export async function voidItem(
  tx: Tx,
  input: {
    user: AuthUser;
    visitId: number;
    itemId: number;
    reason: string;
    now: Date;
  },
) {
  return removeItemQuantity(tx, input);
}

/** Уменьшает количество позиции, сохраняет убранную часть отдельной аудиторской строкой и возвращает товар на склад. */
export async function reduceItem(
  tx: Tx,
  input: {
    user: AuthUser;
    visitId: number;
    itemId: number;
    quantity: number;
    reason: string;
    now: Date;
  },
) {
  return removeItemQuantity(tx, input);
}

async function removeItemQuantity(
  tx: Tx,
  input: {
    user: AuthUser;
    visitId: number;
    itemId: number;
    quantity?: number;
    reason: string;
    now: Date;
  },
) {
  const { user } = input;
  const visit = await lockVisit(tx, user.organizationId, input.visitId);
  assertActive(visit);

  const [item] = await tx
    .select()
    .from(visitItemsTable)
    .where(
      and(
        eq(visitItemsTable.id, input.itemId),
        eq(visitItemsTable.visitId, visit.id),
        eq(visitItemsTable.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!item) throw new NotFoundException('Позиция не найдена');
  if (item.voidedAt) {
    throw conflict(ErrorCode.ITEM_NOT_VOIDABLE, 'Позиция уже убрана');
  }
  if (item.kind === 'ROOM_TIME') {
    throw conflict(
      ErrorCode.ITEM_NOT_VOIDABLE,
      'Время помещения нельзя убрать. Если посещение начато по ошибке — отмените его',
    );
  }

  const removedQuantity = input.quantity ?? item.quantity;
  if (removedQuantity > item.quantity) {
    throw conflict(
      ErrorCode.ITEM_NOT_VOIDABLE,
      'Нельзя убрать больше единиц, чем есть в позиции',
      { availableQuantity: item.quantity },
    );
  }

  const { total, paid } = await visitTotals(tx, visit.id);
  const removedTotal = multiplyMoney(item.unitPrice, removedQuantity);
  const newTotal = subtractMoney(total, removedTotal);
  if (compareMoney(paid, newTotal) > 0) {
    throw conflict(
      ErrorCode.ITEM_ALREADY_PAID,
      'Позиция уже оплачена: после её удаления оплата превысит итог',
      { total, paid, newTotal },
    );
  }

  let movementItemId = item.id;
  if (removedQuantity === item.quantity) {
    await tx
      .update(visitItemsTable)
      .set({
        voidedAt: input.now,
        voidedBy: user.id,
        voidReason: input.reason.trim(),
      })
      .where(eq(visitItemsTable.id, item.id));
  } else {
    const remainingQuantity = item.quantity - removedQuantity;
    await tx
      .update(visitItemsTable)
      .set({
        quantity: remainingQuantity,
        lineTotal: multiplyMoney(item.unitPrice, remainingQuantity),
      })
      .where(eq(visitItemsTable.id, item.id));
    const [removedItem] = await tx
      .insert(visitItemsTable)
      .values({
        organizationId: item.organizationId,
        visitId: item.visitId,
        kind: item.kind,
        productId: item.productId,
        serviceId: item.serviceId,
        tariffId: item.tariffId,
        nameSnapshot: item.nameSnapshot,
        unitPrice: item.unitPrice,
        quantity: removedQuantity,
        minutes: item.minutes,
        guestCategory: item.guestCategory,
        lineTotal: removedTotal,
        createdBy: item.createdBy,
        createdAt: item.createdAt,
        voidedAt: input.now,
        voidedBy: user.id,
        voidReason: input.reason.trim(),
      })
      .returning({ id: visitItemsTable.id });
    movementItemId = removedItem.id;
  }

  if (item.kind === 'PRODUCT' && item.productId) {
    await applyStockMovement(tx, {
      organizationId: user.organizationId,
      productId: item.productId,
      type: 'SALE_RETURN',
      quantityDelta: removedQuantity,
      reason: `Позиция убрана из посещения №${visit.id}: ${input.reason.trim()}`,
      visitItemId: movementItemId,
      userId: user.id,
    });
  }
}

// ─── продление ────────────────────────────────────────────────────────────

/**
 * Продление PRIVATE-посещения целым числом шагов. Продлевает от прежнего конца (в том числе
 * задним числом при просрочке). Проверяет следующие брони. Порядок: lockRoom → lockVisit.
 */
export async function extendVisit(
  tx: Tx,
  input: {
    user: AuthUser;
    visitId: number;
    roomId: number;
    minutes: number;
  },
) {
  const { user } = input;
  await lockRoom(tx, user.organizationId, input.roomId);
  const visit = await lockVisit(tx, user.organizationId, input.visitId);
  assertActive(visit);
  if (visit.kind !== 'PRIVATE' || !visit.endsAt || !visit.hourlyRate) {
    throw new AppException(
      ErrorCode.ROOM_TYPE_MISMATCH,
      'Продлевать можно только приватное посещение',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  assertDuration(input.minutes, visit.timeStepMinutes ?? 60);

  const newEnd = new Date(visit.endsAt.getTime() + input.minutes * 60_000);
  const next = await findBookingConflict(
    tx,
    visit.roomId,
    visit.endsAt,
    newEnd,
    visit.bookingId ?? undefined,
  );
  if (next) {
    throw bookingConflictError(
      next,
      visit.endsAt,
      'Продление пересекается со следующей бронью',
    );
  }

  await insertItem(tx, {
    organizationId: user.organizationId,
    visitId: visit.id,
    kind: 'ROOM_TIME',
    tariffId: visit.tariffId,
    nameSnapshot: 'Продление времени',
    unitPrice: visit.hourlyRate,
    quantity: 1,
    minutes: input.minutes,
    lineTotal: proratePerHour(visit.hourlyRate, input.minutes),
    createdBy: user.id,
  });
  await tx
    .update(visitsTable)
    .set({ endsAt: newEnd })
    .where(eq(visitsTable.id, visit.id));
}

// ─── оплата и завершение ──────────────────────────────────────────────────

export interface PaymentInput {
  method: 'CASH' | 'CARD' | 'KASPI' | 'OTHER';
  amount: string;
}

/** Платёж: сумма не может превышать остаток к оплате. Посещение уже заблокировано и активно. */
async function recordPayment(
  tx: Tx,
  user: AuthUser,
  visit: VisitRow,
  payment: PaymentInput,
) {
  const { total, paid } = await visitTotals(tx, visit.id);
  const balance = subtractMoney(total, paid);
  if (compareMoney(payment.amount, balance) > 0) {
    throw conflict(
      ErrorCode.PAYMENT_EXCEEDS_BALANCE,
      'Сумма платежа больше остатка к оплате',
      { total, paid, balance },
    );
  }
  if (moneyToMinor(payment.amount) <= 0n) {
    throw invalid('Сумма платежа должна быть больше нуля');
  }
  await tx.insert(paymentsTable).values({
    organizationId: user.organizationId,
    visitId: visit.id,
    amount: minorToMoney(moneyToMinor(payment.amount)),
    method: payment.method,
    createdBy: user.id,
  });
}

export async function addPayment(
  tx: Tx,
  input: { user: AuthUser; visitId: number; payment: PaymentInput },
) {
  const visit = await lockVisit(tx, input.user.organizationId, input.visitId);
  assertActive(visit);
  await recordPayment(tx, input.user, visit, input.payment);
}

/**
 * Завершение (выход): требует полной оплаты. Платежи из запроса применяются в той же транзакции —
 * если оплата не покрывает итог, откатывается всё. PRIVATE после завершения уходит на уборку.
 * Порядок: lockRoom → lockVisit.
 */
export async function completeVisit(
  tx: Tx,
  input: {
    user: AuthUser;
    visitId: number;
    roomId: number;
    payments: PaymentInput[];
    now: Date;
  },
) {
  const { user, now } = input;
  await lockRoom(tx, user.organizationId, input.roomId);
  const visit = await lockVisit(tx, user.organizationId, input.visitId);
  assertActive(visit);

  for (const p of input.payments) {
    await recordPayment(tx, user, visit, p);
  }

  const { total, paid } = await visitTotals(tx, visit.id);
  if (compareMoney(paid, total) !== 0) {
    throw conflict(
      ErrorCode.VISIT_NOT_PAID,
      'Посещение нельзя завершить: оплата не покрывает итог',
      { total, paid, balance: subtractMoney(total, paid) },
    );
  }

  await tx
    .update(visitsTable)
    .set({ status: 'COMPLETED', endedAt: now, completedBy: user.id })
    .where(eq(visitsTable.id, visit.id));

  if (visit.kind === 'PRIVATE') {
    await tx.insert(roomCleaningsTable).values({
      organizationId: user.organizationId,
      roomId: visit.roomId,
      visitId: visit.id,
      startedAt: now,
    });
  }
}

/** Отмена посещения, начатого по ошибке: только без платежей; товары возвращаются на склад. */
export async function cancelVisit(
  tx: Tx,
  input: {
    user: AuthUser;
    visitId: number;
    roomId: number;
    reason: string;
    now: Date;
  },
) {
  const { user, now } = input;
  await lockRoom(tx, user.organizationId, input.roomId);
  const visit = await lockVisit(tx, user.organizationId, input.visitId);
  assertActive(visit);

  const [pay] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentsTable)
    .where(eq(paymentsTable.visitId, visit.id));
  if (pay.n > 0) {
    throw conflict(
      ErrorCode.VISIT_HAS_PAYMENTS,
      'По посещению есть платежи — отменить его нельзя (возвраты пока не поддерживаются)',
    );
  }

  const products = await tx
    .select()
    .from(visitItemsTable)
    .where(
      and(
        eq(visitItemsTable.visitId, visit.id),
        eq(visitItemsTable.kind, 'PRODUCT'),
        isNull(visitItemsTable.voidedAt),
      ),
    );
  for (const item of products) {
    if (!item.productId) continue;
    await applyStockMovement(tx, {
      organizationId: user.organizationId,
      productId: item.productId,
      type: 'SALE_RETURN',
      quantityDelta: item.quantity,
      reason: `Отмена посещения №${visit.id}: ${input.reason.trim()}`,
      visitItemId: item.id,
      userId: user.id,
    });
  }

  await tx
    .update(visitsTable)
    .set({
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledBy: user.id,
      cancelReason: input.reason.trim(),
    })
    .where(eq(visitsTable.id, visit.id));

  // бронь возвращается в BOOKED, если её время ещё не прошло и оно свободно
  if (visit.bookingId) {
    const [booking] = await tx
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, visit.bookingId))
      .limit(1);
    if (
      booking &&
      booking.status === 'STARTED' &&
      booking.endsAt > now &&
      !(await findBookingConflict(
        tx,
        booking.roomId,
        booking.startsAt,
        booking.endsAt,
        booking.id,
      ))
    ) {
      await tx
        .update(bookingsTable)
        .set({ status: 'BOOKED' })
        .where(eq(bookingsTable.id, booking.id));
    }
  }
}

/** «Уборка завершена»: помещение снова свободно. */
export async function finishCleaning(
  tx: Tx,
  input: { user: AuthUser; roomId: number; now: Date },
) {
  const { user } = input;
  await lockRoom(tx, user.organizationId, input.roomId);
  const finished = await tx
    .update(roomCleaningsTable)
    .set({ finishedAt: input.now, finishedBy: user.id })
    .where(
      and(
        eq(roomCleaningsTable.roomId, input.roomId),
        eq(roomCleaningsTable.organizationId, user.organizationId),
        isNull(roomCleaningsTable.finishedAt),
      ),
    )
    .returning({ id: roomCleaningsTable.id });
  if (!finished.length) {
    throw conflict(
      ErrorCode.CLEANING_NOT_ACTIVE,
      'Помещение сейчас не на уборке',
    );
  }
}

/** PUBLIC: завершить все активные посещения зала, у которых нет долга (оплачено = итог). */
export async function completeAllPaid(
  tx: Tx,
  input: { user: AuthUser; roomId: number; now: Date },
): Promise<number> {
  const { user } = input;
  const room = await lockRoom(tx, user.organizationId, input.roomId);
  if (room.type !== 'PUBLIC') {
    throw new AppException(
      ErrorCode.ROOM_TYPE_MISMATCH,
      'Массовое завершение доступно только для общественного зала',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const rows = await tx.execute<{ id: number }>(sql`
    select v.id from visits v
    where v.room_id = ${room.id} and v.organization_id = ${user.organizationId}
      and v.status = 'ACTIVE'
      and coalesce((select sum(i.line_total) from visit_items i where i.visit_id = v.id and i.voided_at is null), 0)
        = coalesce((select sum(p.amount) from payments p where p.visit_id = v.id), 0)
    order by v.id
    for update of v
  `);
  const ids = rows.rows.map((r) => r.id);
  if (!ids.length) return 0;
  await tx
    .update(visitsTable)
    .set({ status: 'COMPLETED', endedAt: input.now, completedBy: user.id })
    .where(inArray(visitsTable.id, ids));
  return ids.length;
}
