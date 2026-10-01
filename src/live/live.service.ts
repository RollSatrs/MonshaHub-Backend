import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from 'src';
import { Clock } from 'src/common/clock';
import { subtractMoney } from 'src/common/money';
import {
  organizationsTable,
  roomCleaningsTable,
  roomsTable,
  tariffsTable,
  visitItemsTable,
  visitsTable,
} from 'src/db/schema';
import { paymentStatusOf } from 'src/visits/visit-view';
import type { AuthUser } from 'src/types/express';
import { InsideDto, LiveBoardDto, LiveRoomDto } from './dto/live.dto';
import {
  computePrivateRoomState,
  computePublicRoomState,
  ENDING_SOON_MINUTES,
} from './room-state';

// ВАЖНО: в подзапросах внешняя таблица указана литералом ("visits"."id"). Drizzle при выборке из одной
// таблицы рендерит `${visitsTable.id}` как голое "id", и внутри подзапроса оно бы разрешилось в id вложенной таблицы.
const totalsSql = {
  total: sql<string>`coalesce((select sum(i.line_total) from visit_items i where i.visit_id = "visits"."id" and i.voided_at is null), 0)::numeric(14,2)::text`,
  paid: sql<string>`coalesce((select sum(p.amount) from payments p where p.visit_id = "visits"."id"), 0)::numeric(14,2)::text`,
};

@Injectable()
export class LiveService {
  constructor(private readonly clock: Clock) {}

  /** «Баня сейчас»: состояние каждого помещения вычисляется здесь, frontend его не пересчитывает. */
  async board(user: AuthUser): Promise<LiveBoardDto> {
    const now = this.clock.now();
    const orgId = user.organizationId;

    const [org] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .limit(1);
    const rooms = await db
      .select()
      .from(roomsTable)
      .where(
        and(eq(roomsTable.organizationId, orgId), eq(roomsTable.active, true)),
      )
      .orderBy(asc(roomsTable.sortOrder), asc(roomsTable.id));

    const activeVisits = await db
      .select({ visit: visitsTable, ...totalsSql })
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.organizationId, orgId),
          eq(visitsTable.status, 'ACTIVE'),
        ),
      );

    const cleanings = await db
      .select()
      .from(roomCleaningsTable)
      .where(
        and(
          eq(roomCleaningsTable.organizationId, orgId),
          isNull(roomCleaningsTable.finishedAt),
        ),
      );

    const nextBookings = await db.execute<{
      id: number;
      room_id: number;
      customer_name: string;
      starts_at: Date;
      ends_at: Date;
    }>(sql`
      select distinct on (room_id) id, room_id, customer_name, starts_at, ends_at
      from bookings
      where organization_id = ${orgId} and status = 'BOOKED' and ends_at > ${now}
      order by room_id, starts_at
    `);

    const insideRows = await db
      .select({
        roomId: visitsTable.roomId,
        inside: sql<number>`coalesce(sum(${visitItemsTable.quantity}), 0)::int`,
      })
      .from(visitItemsTable)
      .innerJoin(visitsTable, eq(visitsTable.id, visitItemsTable.visitId))
      .where(
        and(
          eq(visitsTable.organizationId, orgId),
          eq(visitsTable.status, 'ACTIVE'),
          eq(visitsTable.kind, 'PUBLIC'),
          eq(visitItemsTable.kind, 'ENTRY'),
          isNull(visitItemsTable.voidedAt),
        ),
      )
      .groupBy(visitsTable.roomId);

    const tariffs = await db
      .select({
        roomId: tariffsTable.roomId,
        kind: tariffsTable.kind,
        guestCategory: tariffsTable.guestCategory,
      })
      .from(tariffsTable)
      .where(
        and(
          eq(tariffsTable.organizationId, orgId),
          eq(tariffsTable.active, true),
        ),
      );

    const visitByRoom = new Map(
      activeVisits
        .filter((v) => v.visit.kind === 'PRIVATE')
        .map((v) => [v.visit.roomId, v]),
    );
    const publicCount = new Map<number, number>();
    for (const v of activeVisits) {
      if (v.visit.kind === 'PUBLIC') {
        publicCount.set(
          v.visit.roomId,
          (publicCount.get(v.visit.roomId) ?? 0) + 1,
        );
      }
    }
    const cleaningByRoom = new Map(cleanings.map((c) => [c.roomId, c]));
    const nextByRoom = new Map(nextBookings.rows.map((b) => [b.room_id, b]));
    const insideByRoom = new Map(insideRows.map((r) => [r.roomId, r.inside]));

    const liveRooms: LiveRoomDto[] = rooms.map((room) => {
      const hasTariff =
        room.type === 'PRIVATE'
          ? tariffs.some((t) => t.roomId === room.id && t.kind === 'HOURLY')
          : tariffs.some(
              (t) => t.roomId === room.id && t.guestCategory === 'ADULT',
            );

      if (room.type === 'PUBLIC') {
        const inside = insideByRoom.get(room.id) ?? 0;
        return {
          id: room.id,
          name: room.name,
          type: room.type,
          capacity: room.capacity,
          state: computePublicRoomState(inside, room.capacity),
          visit: null,
          cleaningStartedAt: null,
          nextBooking: null,
          availableMinutes: null,
          inside,
          activeVisits: publicCount.get(room.id) ?? 0,
          hasTariff,
        };
      }

      const active = visitByRoom.get(room.id);
      const cleaning = cleaningByRoom.get(room.id);
      const state = computePrivateRoomState({
        activeVisitEndsAt: active?.visit.endsAt ?? null,
        hasOpenCleaning: cleaning !== undefined,
        now,
      });
      const next = nextByRoom.get(room.id);
      return {
        id: room.id,
        name: room.name,
        type: room.type,
        capacity: room.capacity,
        state,
        visit: active
          ? {
              id: active.visit.id,
              customerName: active.visit.customerName,
              startedAt: active.visit.startedAt.toISOString(),
              endsAt: active.visit.endsAt?.toISOString() ?? null,
              total: active.total,
              paid: active.paid,
              balance: subtractMoney(active.total, active.paid),
              paymentStatus: paymentStatusOf(active.total, active.paid),
            }
          : null,
        cleaningStartedAt: cleaning?.startedAt.toISOString() ?? null,
        nextBooking: next
          ? {
              id: next.id,
              customerName: next.customer_name,
              startsAt: new Date(next.starts_at).toISOString(),
              endsAt: new Date(next.ends_at).toISOString(),
            }
          : null,
        availableMinutes:
          state === 'AVAILABLE' && next
            ? Math.max(
                0,
                Math.floor(
                  (new Date(next.starts_at).getTime() - now.getTime()) / 60_000,
                ),
              )
            : null,
        inside: null,
        activeVisits: null,
        hasTariff,
      };
    });

    return {
      serverTime: now.toISOString(),
      endingSoonMinutes: ENDING_SOON_MINUTES,
      currency: org.currency,
      timezone: org.timezone,
      timeStepMinutes: org.timeStepMinutes,
      rooms: liveRooms,
    };
  }

  /** «Внутри сейчас» для PUBLIC-зала: активные чеки с числом гостей и временем входа. */
  async inside(user: AuthUser, roomId: number): Promise<InsideDto> {
    const now = this.clock.now();
    const [room] = await db
      .select()
      .from(roomsTable)
      .where(
        and(
          eq(roomsTable.id, roomId),
          eq(roomsTable.organizationId, user.organizationId),
        ),
      )
      .limit(1);
    if (!room || room.type !== 'PUBLIC') {
      throw new NotFoundException('Общественный зал не найден');
    }

    const rows = await db
      .select({
        visit: visitsTable,
        ...totalsSql,
        adults: sql<number>`coalesce((select sum(i.quantity) from visit_items i where i.visit_id = "visits"."id" and i.kind = 'ENTRY' and i.guest_category = 'ADULT' and i.voided_at is null), 0)::int`,
        children: sql<number>`coalesce((select sum(i.quantity) from visit_items i where i.visit_id = "visits"."id" and i.kind = 'ENTRY' and i.guest_category = 'CHILD' and i.voided_at is null), 0)::int`,
      })
      .from(visitsTable)
      .where(
        and(
          eq(visitsTable.roomId, room.id),
          eq(visitsTable.organizationId, user.organizationId),
          eq(visitsTable.status, 'ACTIVE'),
        ),
      )
      .orderBy(asc(visitsTable.startedAt), asc(visitsTable.id));

    const visits = rows.map((r) => ({
      visitId: r.visit.id,
      customerName: r.visit.customerName,
      adults: r.adults,
      children: r.children,
      guests: r.adults + r.children,
      startedAt: r.visit.startedAt.toISOString(),
      total: r.total,
      paid: r.paid,
      balance: subtractMoney(r.total, r.paid),
      paymentStatus: paymentStatusOf(r.total, r.paid),
    }));

    return {
      roomId: room.id,
      roomName: room.name,
      capacity: room.capacity,
      inside: visits.reduce((n, v) => n + v.guests, 0),
      visits,
      serverTime: now.toISOString(),
    };
  }
}
