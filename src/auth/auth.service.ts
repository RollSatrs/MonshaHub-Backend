import { HttpStatus, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { db } from 'src';
import {
  organizationsTable,
  passwordResetTokensTable,
  usersTable,
} from 'src/db/schema';
import { hashFunction, unHashFunction } from 'shared/tools/tools';
import { MailService } from 'src/mail/mail.service';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import type { AuthUser } from 'src/types/express';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { toUserResponse } from './dto/user-response.dto';

const INVALID_CREDENTIALS = () =>
  new AppException(
    ErrorCode.INVALID_CREDENTIALS,
    'Неверный email или пароль',
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

    const payload: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };

    return {
      message: 'Успешный вход',
      user: toUserResponse(user),
      token: this.jwtService.sign(payload),
    };
  }

  async getMe(id: number) {
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
    return toUserResponse(user);
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
}
