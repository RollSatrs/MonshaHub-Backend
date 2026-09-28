import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import { db } from 'src';
import { passwordResetTokensTable, usersTable } from 'src/db/schema';
import { eq } from 'drizzle-orm';
import { hashFunction, unHashFunction } from 'shared/tools/tools';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { MailService } from 'src/mail/mail.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, dto.email))
      .limit(1);
    if (user.length)
      throw new ConflictException('Пользователь с таким email уже существует');
    const hashPassowrd = await hashFunction(dto.password);
    const newUser = await db
      .insert(usersTable)
      .values({
        fullname: dto.fullname,
        email: dto.email,
        passwordHash: hashPassowrd,
        role: dto.role,
      })
      .returning();
    return { message: 'Регистрация прошла успешно', user: newUser };
  }

  async login(dto: LoginDto) {
    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, dto.email))
      .limit(1);

    if (!user.length)
      throw new UnauthorizedException('Неверный email или пароль');

    const isPasswordValid = await unHashFunction(
      dto.password,
      user[0].passwordHash,
    );
    if (!isPasswordValid) throw new UnauthorizedException('Неверный пароль');

    const payload = {
      id: user[0].id,
      email: user[0].email,
      role: user[0].role,
    };

    const token = this.jwtService.sign(payload);

    return {
      message: 'Успешный вход',
      user: {
        id: user[0].id,
        fullname: user[0].fullname,
        email: user[0].email,
        role: user[0].role,
      },
      token,
    };
  }

  async getMe(id: number) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);

    return {
      id: user.id,
      fullname: user.fullname,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, dto.email))
      .limit(1);

    if (!user)
      throw new NotFoundException('Пользователь с таким email не найден');

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час

    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      token,
      expiresAt,
    });

    await this.mailService.sendPasswordReset(user.email, token);

    return { message: 'Если email зарегистрирован, вы получите письмо' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const [resetToken] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.token, dto.token))
      .limit(1);

    if (!resetToken)
      throw new BadRequestException('Неверная или истёкшая ссылка');
    if (resetToken.used)
      throw new BadRequestException('Ссылка уже была использована');
    if (resetToken.expiresAt < new Date())
      throw new BadRequestException('Ссылка истекла');

    const newHash = await hashFunction(dto.password);

    await db
      .update(usersTable)
      .set({ passwordHash: newHash })
      .where(eq(usersTable.id, resetToken.userId));

    await db
      .update(passwordResetTokensTable)
      .set({ used: true })
      .where(eq(passwordResetTokensTable.id, resetToken.id));

    return { message: 'Пароль успешно изменён' };
  }
}
