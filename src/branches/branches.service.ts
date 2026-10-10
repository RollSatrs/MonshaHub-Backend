import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { db } from 'src';
import { branchesTable } from 'src/db/schema';
import { uniqueViolation } from 'src/common/db-errors';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import type { AuthUser } from 'src/types/express';
import { requireBranchId } from 'src/common/access';

const notFound = () => new NotFoundException('Филиал не найден');
const duplicate = () =>
  new AppException(
    ErrorCode.DUPLICATE_NAME,
    'Филиал с таким названием уже существует',
    HttpStatus.CONFLICT,
  );

@Injectable()
export class BranchesService {
  current(user: AuthUser) {
    return this.get(user.organizationId, requireBranchId(user));
  }

  list(organizationId: number) {
    return db
      .select()
      .from(branchesTable)
      .where(eq(branchesTable.organizationId, organizationId))
      .orderBy(asc(branchesTable.id));
  }

  async create(organizationId: number, dto: CreateBranchDto) {
    try {
      const [branch] = await db
        .insert(branchesTable)
        .values({
          organizationId,
          name: dto.name.trim(),
          address: dto.address?.trim() || null,
          phone: dto.phone?.trim() || null,
          timezone: dto.timezone?.trim() || 'Asia/Almaty',
        })
        .returning();
      return branch;
    } catch (error) {
      if (uniqueViolation(error) !== undefined) throw duplicate();
      throw error;
    }
  }

  async update(organizationId: number, id: number, dto: UpdateBranchDto) {
    const set: Partial<typeof branchesTable.$inferInsert> = {};
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.address !== undefined) set.address = dto.address.trim() || null;
    if (dto.phone !== undefined) set.phone = dto.phone.trim() || null;
    if (dto.timezone !== undefined) set.timezone = dto.timezone.trim();
    if (dto.active !== undefined) set.active = dto.active;
    if (!Object.keys(set).length) return this.get(organizationId, id);

    try {
      const [branch] = await db
        .update(branchesTable)
        .set(set)
        .where(
          and(
            eq(branchesTable.id, id),
            eq(branchesTable.organizationId, organizationId),
          ),
        )
        .returning();
      if (!branch) throw notFound();
      return branch;
    } catch (error) {
      if (uniqueViolation(error) !== undefined) throw duplicate();
      throw error;
    }
  }

  async get(organizationId: number, id: number) {
    const [branch] = await db
      .select()
      .from(branchesTable)
      .where(
        and(
          eq(branchesTable.id, id),
          eq(branchesTable.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!branch) throw notFound();
    return branch;
  }
}
