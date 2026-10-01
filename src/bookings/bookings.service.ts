import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from 'src';
import { Clock } from 'src/common/clock';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import {
  bookingsTable,
  organizationsTable,
  roomsTable,
  usersTable,
} from 'src/db/schema';
import type { AuthUser } from 'src/types/express';
import { loadVisitDetail } from 'src/visits/visit-view';
import {
  assertDuration,
  assertRoomFreeForBooking,
  lockRoom,
  mapVisitDbError,
  startPrivateVisit,
  Tx,
} from 'src/visits/visit-ops';
import {
  BookingResponseDto,
  CloseBookingDto,
  CreateBookingDto,
  ListBookingsQueryDto,
  StartBookingVisitDto,
  UpdateBookingDto,
} from './dto/booking.dto';

/** Бронь можно создать не раньше, чем на 15 минут в прошлом (опоздавшие записи разбираем вручную). */
const PAST_GRACE_MS = 15 * 60_000;

const invalid = (message: string) =>
  new AppException(
    ErrorCode.VALIDATION_ERROR,
    'Ошибка валидации',
    HttpStatus.BAD_REQUEST,
    [message],
  );

const notActive = () =>
  new AppException(
    ErrorCode.BOOKING_NOT_ACTIVE,
    'Бронь уже обработана (начата, отменена или отмечена как неявка)',
    HttpStatus.CONFLICT,
  );

@Injectable()
export class BookingsService {
  constructor(private readonly clock: Clock) {}

  private async run<T>(fn: (tx: Tx, now: Date) => Promise<T>): Promise<T> {
    const now = this.clock.now();
    try {
      return await db.transaction((tx) => fn(tx, now));
    } catch (err) {
      throw mapVisitDbError(err);
    }
  }

  async list(user: AuthUser, query: ListBookingsQueryDto) {
    const now = this.clock.now();
    const from = query.from ? new Date(query.from) : now;
    const conditions = [
      eq(bookingsTable.organizationId, user.organizationId),
      eq(bookingsTable.status, query.status ?? 'BOOKED'),
      gte(bookingsTable.endsAt, from),
    ];
    if (query.to)
      conditions.push(lte(bookingsTable.startsAt, new Date(query.to)));
    if (query.roomId) conditions.push(eq(bookingsTable.roomId, query.roomId));

    const rows = await this.selectBookings(db, and(...conditions), 500);
    return rows.map((r) => this.toResponse(r, now));
  }

  create(user: AuthUser, dto: CreateBookingDto) {
    return this.run(async (tx, now) => {
      const startsAt = new Date(dto.startsAt);
      if (startsAt.getTime() < now.getTime() - PAST_GRACE_MS) {
        throw invalid('Время брони уже прошло');
      }
      const room = await lockRoom(tx, user.organizationId, dto.roomId);
      if (!room.active) throw invalid('Помещение в архиве');
      if (room.type !== 'PRIVATE') {
        throw new AppException(
          ErrorCode.ROOM_TYPE_MISMATCH,
          'Бронирование доступно только для приватных помещений',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const step = await this.timeStep(tx, user.organizationId);
      assertDuration(dto.durationMinutes, step);
      const endsAt = new Date(
        startsAt.getTime() + dto.durationMinutes * 60_000,
      );

      await assertRoomFreeForBooking(tx, room.id, startsAt, endsAt, now);

      const [created] = await tx
        .insert(bookingsTable)
        .values({
          organizationId: user.organizationId,
          roomId: room.id,
          customerName: dto.customerName.trim(),
          customerPhone: dto.customerPhone.trim(),
          startsAt,
          endsAt,
          notes: dto.notes?.trim() || null,
          createdBy: user.id,
        })
        .returning({ id: bookingsTable.id });
      return this.getOne(tx, user, created.id, now);
    });
  }

  update(user: AuthUser, id: number, dto: UpdateBookingDto) {
    return this.run(async (tx, now) => {
      const roomId = await this.bookingRoomId(tx, user, id);
      await lockRoom(tx, user.organizationId, roomId);
      const booking = await this.lockBooking(tx, user, id);
      if (booking.status !== 'BOOKED') throw notActive();

      const startsAt = dto.startsAt ? new Date(dto.startsAt) : booking.startsAt;
      const durationMinutes =
        dto.durationMinutes ??
        Math.round(
          (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
        );
      const timeChanged =
        dto.startsAt !== undefined || dto.durationMinutes !== undefined;

      if (timeChanged) {
        if (startsAt.getTime() < now.getTime() - PAST_GRACE_MS) {
          throw invalid('Время брони уже прошло');
        }
        assertDuration(
          durationMinutes,
          await this.timeStep(tx, user.organizationId),
        );
      }
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
      if (timeChanged) {
        await assertRoomFreeForBooking(
          tx,
          roomId,
          startsAt,
          endsAt,
          now,
          booking.id,
        );
      }

      await tx
        .update(bookingsTable)
        .set({
          ...(dto.customerName !== undefined
            ? { customerName: dto.customerName.trim() }
            : {}),
          ...(dto.customerPhone !== undefined
            ? { customerPhone: dto.customerPhone.trim() }
            : {}),
          ...(dto.notes !== undefined
            ? { notes: dto.notes.trim() || null }
            : {}),
          ...(timeChanged ? { startsAt, endsAt } : {}),
        })
        .where(eq(bookingsTable.id, booking.id));
      return this.getOne(tx, user, booking.id, now);
    });
  }

  cancel(user: AuthUser, id: number, dto: CloseBookingDto) {
    return this.close(user, id, 'CANCELLED', dto.reason);
  }

  noShow(user: AuthUser, id: number, dto: CloseBookingDto) {
    return this.close(user, id, 'NO_SHOW', dto.reason);
  }

  private close(
    user: AuthUser,
    id: number,
    status: 'CANCELLED' | 'NO_SHOW',
    reason?: string,
  ) {
    return this.run(async (tx, now) => {
      const roomId = await this.bookingRoomId(tx, user, id);
      await lockRoom(tx, user.organizationId, roomId);
      const booking = await this.lockBooking(tx, user, id);
      if (booking.status !== 'BOOKED') throw notActive();
      await tx
        .update(bookingsTable)
        .set({
          status,
          closedAt: now,
          closedBy: user.id,
          closeReason: reason?.trim() || null,
        })
        .where(eq(bookingsTable.id, booking.id));
      return this.getOne(tx, user, booking.id, now);
    });
  }

  /** Начать посещение по брони: фактическое время старта — «сейчас», длительность — как у брони (или указанная). */
  startVisit(user: AuthUser, id: number, dto: StartBookingVisitDto) {
    return this.run(async (tx, now) => {
      const roomId = await this.bookingRoomId(tx, user, id);
      await lockRoom(tx, user.organizationId, roomId);
      const booking = await this.lockBooking(tx, user, id);
      if (booking.status !== 'BOOKED') throw notActive();

      const bookedMinutes = Math.round(
        (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
      );
      const visitId = await startPrivateVisit(tx, {
        user,
        now,
        roomId,
        durationMinutes: dto.durationMinutes ?? bookedMinutes,
        customerName: booking.customerName,
        customerPhone: booking.customerPhone,
        bookingId: booking.id,
      });
      await tx
        .update(bookingsTable)
        .set({ status: 'STARTED' })
        .where(eq(bookingsTable.id, booking.id));
      return loadVisitDetail(tx, user, visitId, now);
    });
  }

  // ─── внутреннее ─────────────────────────────────────────────────────────

  private async timeStep(tx: Tx, organizationId: number) {
    const [org] = await tx
      .select({ step: organizationsTable.timeStepMinutes })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1);
    return org.step;
  }

  private async bookingRoomId(tx: Tx, user: AuthUser, id: number) {
    const [b] = await tx
      .select({ roomId: bookingsTable.roomId })
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.id, id),
          eq(bookingsTable.organizationId, user.organizationId),
        ),
      )
      .limit(1);
    if (!b) throw new NotFoundException('Бронь не найдена');
    return b.roomId;
  }

  private async lockBooking(tx: Tx, user: AuthUser, id: number) {
    const [b] = await tx
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.id, id),
          eq(bookingsTable.organizationId, user.organizationId),
        ),
      )
      .limit(1)
      .for('update');
    if (!b) throw new NotFoundException('Бронь не найдена');
    return b;
  }

  private async getOne(tx: Tx, user: AuthUser, id: number, now: Date) {
    const [row] = await this.selectBookings(
      tx,
      and(
        eq(bookingsTable.id, id),
        eq(bookingsTable.organizationId, user.organizationId),
      ),
      1,
    );
    if (!row) throw new NotFoundException('Бронь не найдена');
    return this.toResponse(row, now);
  }

  private selectBookings(
    exec: Tx,
    where: ReturnType<typeof and>,
    limit: number,
  ) {
    return exec
      .select({
        b: bookingsTable,
        roomName: roomsTable.name,
        createdByName: usersTable.fullname,
        visitId: sql<
          number | null
        >`(select v.id from visits v where v.booking_id = "bookings"."id" and v.status <> 'CANCELLED' limit 1)`,
      })
      .from(bookingsTable)
      .innerJoin(roomsTable, eq(roomsTable.id, bookingsTable.roomId))
      .leftJoin(usersTable, eq(usersTable.id, bookingsTable.createdBy))
      .where(where)
      .orderBy(asc(bookingsTable.startsAt), asc(bookingsTable.id))
      .limit(limit);
  }

  private toResponse(
    row: Awaited<ReturnType<BookingsService['selectBookings']>>[number],
    now: Date,
  ): BookingResponseDto {
    const { b } = row;
    return {
      id: b.id,
      roomId: b.roomId,
      roomName: row.roomName,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      durationMinutes: Math.round(
        (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000,
      ),
      status: b.status,
      notes: b.notes,
      createdByName: row.createdByName,
      isLate: b.status === 'BOOKED' && b.startsAt.getTime() <= now.getTime(),
      visitId: row.visitId,
      closedAt: b.closedAt?.toISOString() ?? null,
      closeReason: b.closeReason,
    };
  }
}
