import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from 'src';
import { roomsTable, tariffsTable } from 'src/db/schema';
import { canSeeInactive, requireBranchId } from 'src/common/access';
import { isForeignKeyViolation, uniqueViolation } from 'src/common/db-errors';
import { ListQueryDto } from 'src/common/dto/list-query.dto';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import { toTariffResponse } from 'src/tariffs/dto/tariff.dto';
import type { AuthUser } from 'src/types/express';
import { CreateRoomDto, RoomResponseDto, UpdateRoomDto } from './dto/room.dto';

const notFound = () => new NotFoundException('Помещение не найдено');

const duplicateName = () =>
  new AppException(
    ErrorCode.DUPLICATE_NAME,
    'Помещение с таким названием уже существует (возможно, в архиве)',
    HttpStatus.CONFLICT,
  );

type RoomRow = typeof roomsTable.$inferSelect;

@Injectable()
export class RoomsService {
  async list(user: AuthUser, query: ListQueryDto): Promise<RoomResponseDto[]> {
    const branchId = requireBranchId(user);
    const conditions = [
      eq(roomsTable.organizationId, user.organizationId),
      eq(roomsTable.branchId, branchId),
    ];
    if (!canSeeInactive(user, query))
      conditions.push(eq(roomsTable.active, true));

    const rooms = await db
      .select()
      .from(roomsTable)
      .where(and(...conditions))
      .orderBy(asc(roomsTable.sortOrder), asc(roomsTable.id));
    return this.withTariffs(user, rooms);
  }

  async get(user: AuthUser, id: number): Promise<RoomResponseDto> {
    const branchId = requireBranchId(user);
    const [room] = await db
      .select()
      .from(roomsTable)
      .where(
        and(
          eq(roomsTable.id, id),
          eq(roomsTable.organizationId, user.organizationId),
          eq(roomsTable.branchId, branchId),
        ),
      )
      .limit(1);
    // кассир не видит архивные помещения
    if (!room || (!room.active && user.role !== 'OWNER')) throw notFound();
    return (await this.withTariffs(user, [room]))[0];
  }

  async create(user: AuthUser, dto: CreateRoomDto): Promise<RoomResponseDto> {
    const branchId = requireBranchId(user);
    try {
      const [room] = await db
        .insert(roomsTable)
        .values({
          organizationId: user.organizationId,
          branchId,
          name: dto.name.trim(),
          type: dto.type,
          capacity: dto.capacity,
          sortOrder: dto.sortOrder ?? 0,
        })
        .returning();
      return (await this.withTariffs(user, [room]))[0];
    } catch (err) {
      if (uniqueViolation(err) !== undefined) throw duplicateName();
      throw err;
    }
  }

  async update(
    user: AuthUser,
    id: number,
    dto: UpdateRoomDto,
  ): Promise<RoomResponseDto> {
    const branchId = requireBranchId(user);
    const set: Partial<typeof roomsTable.$inferInsert> = {};
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.capacity !== undefined) set.capacity = dto.capacity;
    if (dto.sortOrder !== undefined) set.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) set.active = dto.active;
    if (!Object.keys(set).length) return this.get(user, id);

    try {
      const [room] = await db
        .update(roomsTable)
        .set(set)
        .where(
          and(
            eq(roomsTable.id, id),
            eq(roomsTable.organizationId, user.organizationId),
            eq(roomsTable.branchId, branchId),
          ),
        )
        .returning();
      if (!room) throw notFound();
      return (await this.withTariffs(user, [room]))[0];
    } catch (err) {
      if (uniqueViolation(err) !== undefined) throw duplicateName();
      throw err;
    }
  }

  /**
   * Техническая операция: только для помещения, которое никогда не использовалось.
   * Тарифы такого помещения удаляются каскадом; если на помещение или его тарифы
   * ссылается история (Visit/Booking) — БД не даёт удалить, отвечаем ENTITY_IN_USE.
   */
  async remove(user: AuthUser, id: number) {
    const branchId = requireBranchId(user);
    try {
      const deleted = await db
        .delete(roomsTable)
        .where(
          and(
            eq(roomsTable.id, id),
            eq(roomsTable.organizationId, user.organizationId),
            eq(roomsTable.branchId, branchId),
          ),
        )
        .returning({ id: roomsTable.id });
      if (!deleted.length) throw notFound();
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new AppException(
          ErrorCode.ENTITY_IN_USE,
          'Помещение уже использовалось. Архивируйте его вместо удаления.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  /** Один дополнительный запрос на все помещения списка (без N+1). */
  private async withTariffs(
    user: AuthUser,
    rooms: RoomRow[],
  ): Promise<RoomResponseDto[]> {
    if (!rooms.length) return [];
    const tariffs = await db
      .select()
      .from(tariffsTable)
      .where(
        and(
          eq(tariffsTable.organizationId, user.organizationId),
          eq(tariffsTable.active, true),
          inArray(
            tariffsTable.roomId,
            rooms.map((r) => r.id),
          ),
        ),
      )
      .orderBy(asc(tariffsTable.id));

    return rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      capacity: r.capacity,
      sortOrder: r.sortOrder,
      active: r.active,
      activeTariffs: tariffs
        .filter((t) => t.roomId === r.id)
        .map(toTariffResponse),
    }));
  }
}
