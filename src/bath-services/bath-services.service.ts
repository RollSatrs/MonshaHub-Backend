import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { db } from 'src';
import { servicesTable } from 'src/db/schema';
import { canSeeInactive, requireBranchId } from 'src/common/access';
import { isForeignKeyViolation, uniqueViolation } from 'src/common/db-errors';
import { ListQueryDto } from 'src/common/dto/list-query.dto';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import { normalizeMoney } from 'src/common/money';
import type { AuthUser } from 'src/types/express';
import {
  BathServiceResponseDto,
  CreateBathServiceDto,
  UpdateBathServiceDto,
} from './dto/bath-service.dto';

const notFound = () => new NotFoundException('Услуга не найдена');

const duplicateName = () =>
  new AppException(
    ErrorCode.DUPLICATE_NAME,
    'Услуга с таким названием уже существует (возможно, в архиве)',
    HttpStatus.CONFLICT,
  );

const toResponse = (
  s: typeof servicesTable.$inferSelect,
): BathServiceResponseDto => ({
  id: s.id,
  name: s.name,
  price: s.price,
  active: s.active,
});

@Injectable()
export class BathServicesService {
  async list(user: AuthUser, query: ListQueryDto) {
    const branchId = requireBranchId(user);
    const conditions = [
      eq(servicesTable.organizationId, user.organizationId),
      eq(servicesTable.branchId, branchId),
    ];
    if (!canSeeInactive(user, query))
      conditions.push(eq(servicesTable.active, true));
    const rows = await db
      .select()
      .from(servicesTable)
      .where(and(...conditions))
      .orderBy(asc(servicesTable.name), asc(servicesTable.id));
    return rows.map(toResponse);
  }

  async get(user: AuthUser, id: number) {
    const branchId = requireBranchId(user);
    const [row] = await db
      .select()
      .from(servicesTable)
      .where(
        and(
          eq(servicesTable.id, id),
          eq(servicesTable.organizationId, user.organizationId),
          eq(servicesTable.branchId, branchId),
        ),
      )
      .limit(1);
    if (!row || (!row.active && user.role !== 'OWNER')) throw notFound();
    return toResponse(row);
  }

  async create(user: AuthUser, dto: CreateBathServiceDto) {
    const branchId = requireBranchId(user);
    try {
      const [row] = await db
        .insert(servicesTable)
        .values({
          organizationId: user.organizationId,
          branchId,
          name: dto.name.trim(),
          price: normalizeMoney(dto.price),
        })
        .returning();
      return toResponse(row);
    } catch (err) {
      if (uniqueViolation(err) !== undefined) throw duplicateName();
      throw err;
    }
  }

  async update(user: AuthUser, id: number, dto: UpdateBathServiceDto) {
    const branchId = requireBranchId(user);
    const set: Partial<typeof servicesTable.$inferInsert> = {};
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.price !== undefined) set.price = normalizeMoney(dto.price);
    if (dto.active !== undefined) set.active = dto.active;
    if (!Object.keys(set).length) return this.get(user, id);

    try {
      const [row] = await db
        .update(servicesTable)
        .set(set)
        .where(
          and(
            eq(servicesTable.id, id),
            eq(servicesTable.organizationId, user.organizationId),
            eq(servicesTable.branchId, branchId),
          ),
        )
        .returning();
      if (!row) throw notFound();
      return toResponse(row);
    } catch (err) {
      if (uniqueViolation(err) !== undefined) throw duplicateName();
      throw err;
    }
  }

  /** Техническая операция: только для услуги, которая никогда не использовалась. Основной путь — архивация. */
  async remove(user: AuthUser, id: number) {
    const branchId = requireBranchId(user);
    try {
      const deleted = await db
        .delete(servicesTable)
        .where(
          and(
            eq(servicesTable.id, id),
            eq(servicesTable.organizationId, user.organizationId),
            eq(servicesTable.branchId, branchId),
          ),
        )
        .returning({ id: servicesTable.id });
      if (!deleted.length) throw notFound();
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new AppException(
          ErrorCode.ENTITY_IN_USE,
          'Услуга уже использовалась. Архивируйте её вместо удаления.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}
