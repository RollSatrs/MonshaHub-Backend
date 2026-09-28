import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from 'src';
import { usersTable } from 'src/db/schema';
import { hashFunction } from 'shared/tools/tools';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import { toUserResponse } from 'src/auth/dto/user-response.dto';
import { CreateCashierDto } from './dto/create-cashier.dto';

/** Все методы принимают organizationId из JWT — данные чужой организации недоступны. */
@Injectable()
export class StaffService {
  async list(organizationId: number) {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.organizationId, organizationId))
      .orderBy(usersTable.id);
    return rows.map(toUserResponse);
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
      return toUserResponse(created);
    } catch (err) {
      if ((err as { cause?: { code?: string } })?.cause?.code === '23505') {
        throw this.emailTaken();
      }
      throw err;
    }
  }

  private emailTaken() {
    return new AppException(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Пользователь с таким email уже существует',
      HttpStatus.CONFLICT,
    );
  }
}
