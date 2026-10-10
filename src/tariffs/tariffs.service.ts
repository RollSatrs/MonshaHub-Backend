import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { db } from 'src';
import { roomsTable, tariffsTable } from 'src/db/schema';
import { canSeeInactive, requireBranchId } from 'src/common/access';
import { isForeignKeyViolation, uniqueViolation } from 'src/common/db-errors';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import { normalizeMoney } from 'src/common/money';
import type { AuthUser } from 'src/types/express';
import {
  CreateTariffDto,
  ListTariffsQueryDto,
  toTariffResponse,
  UpdateTariffDto,
} from './dto/tariff.dto';

const notFound = () => new NotFoundException('Тариф не найден');

const alreadyExists = () =>
  new AppException(
    ErrorCode.TARIFF_ALREADY_EXISTS,
    'У помещения уже есть активный тариф такого вида. Измените его или архивируйте.',
    HttpStatus.CONFLICT,
  );

@Injectable()
export class TariffsService {
  async list(user: AuthUser, query: ListTariffsQueryDto) {
    const branchId = requireBranchId(user);
    const conditions = [eq(tariffsTable.organizationId, user.organizationId)];
    if (!canSeeInactive(user, query))
      conditions.push(eq(tariffsTable.active, true));
    if (query.roomId) conditions.push(eq(tariffsTable.roomId, query.roomId));

    const rows = await db
      .select()
      .from(tariffsTable)
      .innerJoin(roomsTable, eq(roomsTable.id, tariffsTable.roomId))
      .where(and(...conditions, eq(roomsTable.branchId, branchId)))
      .orderBy(asc(tariffsTable.roomId), asc(tariffsTable.id));
    return rows.map((row) => toTariffResponse(row.tariffs));
  }

  async create(user: AuthUser, dto: CreateTariffDto) {
    const branchId = requireBranchId(user);
    const [room] = await db
      .select()
      .from(roomsTable)
      .where(
        and(
          eq(roomsTable.id, dto.roomId),
          eq(roomsTable.organizationId, user.organizationId),
          eq(roomsTable.branchId, branchId),
        ),
      )
      .limit(1);
    if (!room) throw new NotFoundException('Помещение не найдено');

    // kind определяет backend по типу помещения — клиент его не передаёт
    const kind = room.type === 'PRIVATE' ? 'HOURLY' : 'PER_ENTRY';
    if (kind === 'HOURLY' && dto.guestCategory) {
      throw new AppException(
        ErrorCode.TARIFF_ROOM_TYPE_MISMATCH,
        'Для PRIVATE-помещения категория гостя не указывается',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (kind === 'PER_ENTRY' && !dto.guestCategory) {
      throw new AppException(
        ErrorCode.TARIFF_ROOM_TYPE_MISMATCH,
        'Для PUBLIC-помещения нужна категория гостя (ADULT или CHILD)',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const [created] = await db
        .insert(tariffsTable)
        .values({
          organizationId: user.organizationId,
          roomId: room.id,
          kind,
          guestCategory: kind === 'PER_ENTRY' ? dto.guestCategory! : null,
          name: dto.name.trim(),
          price: normalizeMoney(dto.price),
        })
        .returning();
      return toTariffResponse(created);
    } catch (err) {
      if (uniqueViolation(err) !== undefined) throw alreadyExists();
      throw err;
    }
  }

  async update(user: AuthUser, id: number, dto: UpdateTariffDto) {
    await this.getOne(user, id);
    const set: Partial<typeof tariffsTable.$inferInsert> = {};
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.price !== undefined) set.price = normalizeMoney(dto.price);
    if (dto.active !== undefined) set.active = dto.active;

    if (!Object.keys(set).length) return this.getOne(user, id);

    try {
      const [updated] = await db
        .update(tariffsTable)
        .set(set)
        .where(
          and(
            eq(tariffsTable.id, id),
            eq(tariffsTable.organizationId, user.organizationId),
          ),
        )
        .returning();
      if (!updated) throw notFound();
      return toTariffResponse(updated);
    } catch (err) {
      // повторная активация при уже активном тарифе того же вида
      if (uniqueViolation(err) !== undefined) throw alreadyExists();
      throw err;
    }
  }

  /** Техническая операция: только для тарифа, на который ничего не ссылается. Основной путь — архивация. */
  async remove(user: AuthUser, id: number) {
    await this.getOne(user, id);
    try {
      const deleted = await db
        .delete(tariffsTable)
        .where(
          and(
            eq(tariffsTable.id, id),
            eq(tariffsTable.organizationId, user.organizationId),
          ),
        )
        .returning({ id: tariffsTable.id });
      if (!deleted.length) throw notFound();
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new AppException(
          ErrorCode.ENTITY_IN_USE,
          'Тариф уже использовался. Архивируйте его вместо удаления.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  private async getOne(user: AuthUser, id: number) {
    const [row] = await db
      .select({ tariff: tariffsTable })
      .from(tariffsTable)
      .innerJoin(roomsTable, eq(roomsTable.id, tariffsTable.roomId))
      .where(
        and(
          eq(tariffsTable.id, id),
          eq(tariffsTable.organizationId, user.organizationId),
          eq(roomsTable.branchId, requireBranchId(user)),
        ),
      )
      .limit(1);
    if (!row) throw notFound();
    return toTariffResponse(row.tariff);
  }
}
