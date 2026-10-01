import { NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  paymentsTable,
  usersTable,
  visitItemsTable,
  visitsTable,
} from 'src/db/schema';
import { compareMoney, subtractMoney } from 'src/common/money';
import { computeVisitTimeState } from 'src/live/room-state';
import type { AuthUser } from 'src/types/express';
import {
  ListVisitsQueryDto,
  PaymentStatus,
  VisitDetailDto,
  VisitListDto,
} from './dto/visit.dto';
import { Tx, visitTotals } from './visit-ops';

const DAY_MS = 24 * 60 * 60 * 1000;

export function paymentStatusOf(total: string, paid: string): PaymentStatus {
  if (compareMoney(paid, total) === 0) return 'PAID';
  return compareMoney(paid, '0') === 0 ? 'UNPAID' : 'PARTIAL';
}

async function userNames(tx: Tx, ids: (number | null)[]) {
  const unique = [...new Set(ids.filter((i): i is number => i !== null))];
  if (!unique.length) return new Map<number, string>();
  const rows = await tx
    .select({ id: usersTable.id, fullname: usersTable.fullname })
    .from(usersTable)
    .where(inArray(usersTable.id, unique));
  return new Map(rows.map((r) => [r.id, r.fullname]));
}

/** CASHIER не видит завершённые/отменённые посещения старше 24 часов. */
function hiddenFromCashier(
  user: AuthUser,
  visit: typeof visitsTable.$inferSelect,
  now: Date,
) {
  if (user.role !== 'CASHIER' || visit.status === 'ACTIVE') return false;
  const closedAt = visit.endedAt ?? visit.cancelledAt ?? visit.startedAt;
  return closedAt.getTime() < now.getTime() - DAY_MS;
}

export async function loadVisitDetail(
  tx: Tx,
  user: AuthUser,
  visitId: number,
  now: Date,
): Promise<VisitDetailDto> {
  const [visit] = await tx
    .select()
    .from(visitsTable)
    .where(
      and(
        eq(visitsTable.id, visitId),
        eq(visitsTable.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!visit || hiddenFromCashier(user, visit, now)) {
    throw new NotFoundException('Посещение не найдено');
  }

  const items = await tx
    .select()
    .from(visitItemsTable)
    .where(eq(visitItemsTable.visitId, visit.id))
    .orderBy(asc(visitItemsTable.id));
  const payments = await tx
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.visitId, visit.id))
    .orderBy(asc(paymentsTable.id));
  const { total, paid } = await visitTotals(tx, visit.id);
  const names = await userNames(tx, [
    visit.completedBy,
    visit.cancelledBy,
    ...items.flatMap((i) => [i.createdBy, i.voidedBy]),
    ...payments.map((p) => p.createdBy),
  ]);
  const name = (id: number | null) =>
    id === null ? null : (names.get(id) ?? null);

  const active = visit.status === 'ACTIVE';
  const remainingSeconds =
    active && visit.endsAt
      ? Math.floor((visit.endsAt.getTime() - now.getTime()) / 1000)
      : null;
  const guests =
    visit.kind === 'PUBLIC'
      ? items
          .filter((i) => i.kind === 'ENTRY' && !i.voidedAt)
          .reduce((n, i) => n + i.quantity, 0)
      : null;

  return {
    id: visit.id,
    kind: visit.kind,
    status: visit.status,
    roomId: visit.roomId,
    roomName: visit.roomName,
    bookingId: visit.bookingId,
    customerName: visit.customerName,
    customerPhone: visit.customerPhone,
    guestsCount: visit.guestsCount,
    startedAt: visit.startedAt.toISOString(),
    endsAt: visit.endsAt?.toISOString() ?? null,
    endedAt: visit.endedAt?.toISOString() ?? null,
    currency: visit.currency,
    timeStepMinutes: visit.timeStepMinutes,
    hourlyRate: visit.hourlyRate,
    timeState:
      active && visit.endsAt ? computeVisitTimeState(visit.endsAt, now) : null,
    remainingSeconds,
    items: items.map((i) => ({
      id: i.id,
      kind: i.kind,
      name: i.nameSnapshot,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      minutes: i.minutes,
      guestCategory: i.guestCategory,
      lineTotal: i.lineTotal,
      voided: i.voidedAt !== null,
      voidedAt: i.voidedAt?.toISOString() ?? null,
      voidedByName: name(i.voidedBy),
      voidReason: i.voidReason,
      createdAt: i.createdAt.toISOString(),
      createdByName: name(i.createdBy),
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      createdAt: p.createdAt.toISOString(),
      createdByName: name(p.createdBy),
    })),
    total,
    paid,
    balance: subtractMoney(total, paid),
    paymentStatus: paymentStatusOf(total, paid),
    guests,
    completedByName: name(visit.completedBy),
    cancelledAt: visit.cancelledAt?.toISOString() ?? null,
    cancelledByName: name(visit.cancelledBy),
    cancelReason: visit.cancelReason,
    serverTime: now.toISOString(),
  };
}

/** История посещений (по умолчанию — завершённые и отменённые). CASHIER — только последние 24 часа. */
export async function listVisits(
  tx: Tx,
  user: AuthUser,
  query: ListVisitsQueryDto,
  now: Date,
): Promise<VisitListDto> {
  const limit = query.limit ?? 50;
  const closedAt = sql`coalesce(${visitsTable.endedAt}, ${visitsTable.cancelledAt}, ${visitsTable.startedAt})`;

  const conditions = [eq(visitsTable.organizationId, user.organizationId)];
  if (query.status) {
    conditions.push(eq(visitsTable.status, query.status));
  } else {
    conditions.push(inArray(visitsTable.status, ['COMPLETED', 'CANCELLED']));
  }
  if (query.roomId) conditions.push(eq(visitsTable.roomId, query.roomId));

  let from = query.from ? new Date(query.from) : undefined;
  if (user.role === 'CASHIER') {
    const floor = new Date(now.getTime() - DAY_MS);
    if (!from || from < floor) from = floor;
  }
  // ACTIVE не ограничиваем по времени закрытия
  if (from && query.status !== 'ACTIVE') {
    conditions.push(gte(closedAt as never, from));
  }
  if (query.to && query.status !== 'ACTIVE') {
    conditions.push(lte(closedAt as never, new Date(query.to)));
  }

  const rows = await tx
    .select({
      visit: visitsTable,
      total: sql<string>`coalesce((select sum(i.line_total) from visit_items i where i.visit_id = "visits"."id" and i.voided_at is null), 0)::numeric(14,2)::text`,
      paid: sql<string>`coalesce((select sum(p.amount) from payments p where p.visit_id = "visits"."id"), 0)::numeric(14,2)::text`,
      voided: sql<number>`(select count(*) from visit_items i where i.visit_id = "visits"."id" and i.voided_at is not null)::int`,
      guests: sql<
        number | null
      >`case when "visits"."kind" = 'PUBLIC' then (select coalesce(sum(i.quantity), 0) from visit_items i where i.visit_id = "visits"."id" and i.kind = 'ENTRY' and i.voided_at is null)::int else null end`,
    })
    .from(visitsTable)
    .where(and(...conditions))
    .orderBy(desc(closedAt), desc(visitsTable.id))
    .limit(limit + 1)
    .offset(query.offset ?? 0);

  return {
    hasMore: rows.length > limit,
    items: rows
      .slice(0, limit)
      .map(({ visit, total, paid, voided, guests }) => ({
        id: visit.id,
        kind: visit.kind,
        status: visit.status,
        roomName: visit.roomName,
        customerName: visit.customerName,
        startedAt: visit.startedAt.toISOString(),
        endedAt: visit.endedAt?.toISOString() ?? null,
        cancelledAt: visit.cancelledAt?.toISOString() ?? null,
        total,
        paid,
        voidedItemsCount: voided,
        guests,
        cancelReason: visit.cancelReason,
      })),
  };
}
