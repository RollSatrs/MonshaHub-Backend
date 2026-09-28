import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { db } from 'src';
import { usersTable } from 'src/db/schema';
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

    try {
      const [created] = await db
        .insert(usersTable)
        .values({
          organizationId,
          fullname: dto.fullname.trim(),
          email,
          passwordHash: await hashFunction(dto.password),
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

    const [updated] = await db
      .update(usersTable)
      .set({ active: dto.active })
      .where(eq(usersTable.id, target.id))
      .returning();
    return toMember(updated);
  }

  private emailTaken() {
    return new AppException(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Пользователь с таким email уже существует',
      HttpStatus.CONFLICT,
    );
  }
}
