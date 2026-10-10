import { HttpStatus, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { db } from 'src';
import {
  branchesTable,
  organizationsTable,
  passwordResetTokensTable,
  usersTable,
  workplacesTable,
} from 'src/db/schema';
import { hashFunction, unHashFunction } from 'shared/tools/tools';
import { MailService } from 'src/mail/mail.service';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import type { AuthUser } from 'src/types/express';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { toUserResponse } from './dto/user-response.dto';
import { hashWorkplaceToken } from 'src/workplaces/workplaces.service';

const INVALID_CREDENTIALS = () =>
  new AppException(
    ErrorCode.INVALID_CREDENTIALS,
    'Неверный email или пароль',
    HttpStatus.UNAUTHORIZED,
  );

const INVALID_PIN_CREDENTIALS = () =>
  new AppException(
    ErrorCode.INVALID_CREDENTIALS,
    'Неверный email или PIN',
    HttpStatus.UNAUTHORIZED,
  );

const INVALID_RESET_TOKEN = (message: string) =>
  new AppException(
    ErrorCode.INVALID_RESET_TOKEN,
    message,
    HttpStatus.BAD_REQUEST,
  );

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  /** Создаёт организацию и её владельца (OWNER) в одной транзакции. */
  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (existing) throw this.emailTaken();

    const passwordHash = await hashFunction(dto.password);

    try {
      const user = await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizationsTable)
          .values({ name: dto.organizationName.trim() })
          .returning();
        await tx.insert(branchesTable).values({
          organizationId: org.id,
          name: 'Основной',
          timezone: org.timezone,
        });
        const [created] = await tx
          .insert(usersTable)
          .values({
            organizationId: org.id,
            fullname: dto.fullname.trim(),
            email,
            passwordHash,
            role: 'OWNER',
          })
          .returning();
        return created;
      });
      return {
        message: 'Регистрация прошла успешно',
        user: toUserResponse(user),
      };
    } catch (err) {
      // гонка: параллельная регистрация с тем же email (unique violation)
      if ((err as { cause?: { code?: string } })?.cause?.code === '23505') {
        throw this.emailTaken();
      }
      throw err;
    }
  }

  async login(dto: LoginDto) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, dto.email.trim().toLowerCase()))
      .limit(1);

    // одинаковая ошибка для «нет пользователя» / «неверный пароль» / «неактивен»
    if (!user || !user.active) throw INVALID_CREDENTIALS();
    const isPasswordValid = await unHashFunction(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) throw INVALID_CREDENTIALS();

    return this.createSession(user);
  }

  async loginWithPin(dto: PinLoginDto) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, dto.email.trim().toLowerCase()))
      .limit(1);

    if (!user || !user.active || !user.pinHash) {
      throw INVALID_PIN_CREDENTIALS();
    }
    const isPinValid = await unHashFunction(dto.pin, user.pinHash);
    if (!isPinValid) throw INVALID_PIN_CREDENTIALS();

    let workplace: typeof workplacesTable.$inferSelect | undefined;
    if (dto.workplaceToken) {
      [workplace] = await db
        .select()
        .from(workplacesTable)
        .where(
          and(
            eq(
              workplacesTable.tokenHash,
              hashWorkplaceToken(dto.workplaceToken),
            ),
            eq(workplacesTable.active, true),
          ),
        )
        .limit(1);
    }

    if (user.role === 'CASHIER') {
      const [registeredWorkplace] = await db
        .select({ id: workplacesTable.id })
        .from(workplacesTable)
        .where(
          and(
            eq(workplacesTable.organizationId, user.organizationId),
            eq(workplacesTable.active, true),
          ),
        )
        .limit(1);
      if (
        registeredWorkplace &&
        (!workplace ||
          workplace.organizationId !== user.organizationId ||
          workplace.branchId !== user.branchId)
      ) {
        throw INVALID_PIN_CREDENTIALS();
      }
    }

    if (workplace && workplace.organizationId === user.organizationId) {
      await db
        .update(workplacesTable)
        .set({ lastSeenAt: new Date() })
        .where(eq(workplacesTable.id, workplace.id));
    }

    return this.createSession(user);
  }

  async getMe(id: number, activeBranchId?: number | null) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!user || !user.active) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Пользователь не найден',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return toUserResponse({
      ...user,
      branchId: activeBranchId ?? user.branchId,
    });
  }

  /** Всегда отвечает одинаково — не раскрывает, зарегистрирован ли email. */
  async forgotPassword(dto: ForgotPasswordDto) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.email, dto.email.trim().toLowerCase()),
          eq(usersTable.active, true),
        ),
      )
      .limit(1);

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час
      await db
        .insert(passwordResetTokensTable)
        .values({ userId: user.id, token, expiresAt });
      await this.mailService.sendPasswordReset(user.email, token);
    }

    return { message: 'Если email зарегистрирован, вы получите письмо' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const [resetToken] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.token, dto.token))
      .limit(1);

    if (!resetToken) throw INVALID_RESET_TOKEN('Неверная или истёкшая ссылка');
    if (resetToken.used)
      throw INVALID_RESET_TOKEN('Ссылка уже была использована');
    if (resetToken.expiresAt < new Date())
      throw INVALID_RESET_TOKEN('Ссылка истекла');

    const newHash = await hashFunction(dto.password);

    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ passwordHash: newHash })
        .where(eq(usersTable.id, resetToken.userId));
      await tx
        .update(passwordResetTokensTable)
        .set({ used: true })
        .where(eq(passwordResetTokensTable.id, resetToken.id));
    });

    return { message: 'Пароль успешно изменён' };
  }

  private emailTaken() {
    return new AppException(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Пользователь с таким email уже существует',
      HttpStatus.CONFLICT,
    );
  }

  private createSession(user: typeof usersTable.$inferSelect) {
    const payload: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      branchId: user.branchId,
    };

    return {
      message: 'Успешный вход',
      user: toUserResponse(user),
      token: this.jwtService.sign(payload),
    };
  }
}
