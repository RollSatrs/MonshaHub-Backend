import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from 'src';
import { branchesTable, usersTable } from 'src/db/schema';
import { hashFunction } from 'shared/tools/tools';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import { toUserResponse } from 'src/auth/dto/user-response.dto';
import type { AuthUser } from 'src/types/express';
import { CreateCashierDto } from './dto/create-cashier.dto';
import { StaffMemberResponseDto, UpdateStaffDto } from './dto/staff-member.dto';

const toMember = (
  u: typeof usersTable.$inferSelect,
): StaffMemberResponseDto => ({
  ...toUserResponse(u),
  active: u.active,
});

/** Все методы принимают organizationId из JWT — данные чужой организации недоступны. */
@Injectable()
export class StaffService {
  async list(organizationId: number) {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.organizationId, organizationId))
      .orderBy(usersTable.id);
    return rows.map(toMember);
  }

  async createCashier(organizationId: number, dto: CreateCashierDto) {
    const email = dto.email.trim().toLowerCase();
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (existing) throw this.emailTaken();
    const branchId = dto.branchId ?? (await this.defaultBranch(organizationId));
    await this.ensureBranch(organizationId, branchId);

    try {
      const [created] = await db
        .insert(usersTable)
        .values({
          organizationId,
          branchId,
          fullname: dto.fullname.trim(),
          email,
          // Новые кассиры входят по PIN. Случайный пароль сохраняет
          // совместимость с общей схемой пользователей, но никому не выдаётся.
          passwordHash: await hashFunction(
            dto.password ?? randomBytes(32).toString('base64url'),
          ),
          pinHash: dto.pin ? await hashFunction(dto.pin) : null,
          role: 'CASHIER',
        })
        .returning();
      return toMember(created);
    } catch (err) {
      if ((err as { cause?: { code?: string } })?.cause?.code === '23505') {
        throw this.emailTaken();
      }
      throw err;
    }
  }

  /** Деактивация/активация кассира. Физически сотрудников не удаляем. */
  async setActive(actor: AuthUser, id: number, dto: UpdateStaffDto) {
    const [target] = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, id),
          eq(usersTable.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!target) throw new NotFoundException('Сотрудник не найден');

    if (target.id === actor.id) {
      throw new AppException(
        ErrorCode.CANNOT_DEACTIVATE_SELF,
        'Нельзя изменить собственный статус',
        HttpStatus.CONFLICT,
      );
    }
    if (target.role !== 'CASHIER') {
      throw new ForbiddenException('Можно изменять только кассиров');
    }

    if (dto.branchId !== undefined) {
      await this.ensureBranch(actor.organizationId, dto.branchId);
    }

    const set: Partial<typeof usersTable.$inferInsert> = {};
    if (dto.active !== undefined) set.active = dto.active;
    if (dto.branchId !== undefined) set.branchId = dto.branchId;
    if (dto.pin !== undefined) set.pinHash = await hashFunction(dto.pin);
    if (!Object.keys(set).length) {
      throw new BadRequestException('Укажите изменения сотрудника');
    }

    const [updated] = await db
      .update(usersTable)
      .set(set)
      .where(eq(usersTable.id, target.id))
      .returning();
    return toMember(updated);
  }

  private async ensureBranch(organizationId: number, branchId: number) {
    const [branch] = await db
      .select({ id: branchesTable.id })
      .from(branchesTable)
      .where(
        and(
          eq(branchesTable.id, branchId),
          eq(branchesTable.organizationId, organizationId),
          eq(branchesTable.active, true),
        ),
      )
      .limit(1);
    if (!branch) throw new NotFoundException('Филиал не найден');
  }

  private async defaultBranch(organizationId: number) {
    const [branch] = await db
      .select({ id: branchesTable.id })
      .from(branchesTable)
      .where(
        and(
          eq(branchesTable.organizationId, organizationId),
          eq(branchesTable.active, true),
        ),
      )
      .orderBy(asc(branchesTable.id))
      .limit(1);
    if (!branch) throw new NotFoundException('Активный филиал не найден');
    return branch.id;
  }

  private emailTaken() {
    return new AppException(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Пользователь с таким email уже существует',
      HttpStatus.CONFLICT,
    );
  }
}
