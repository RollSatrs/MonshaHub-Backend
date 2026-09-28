import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  AuthUserResponseDto,
  MessageResponseDto,
  UserResponseDto,
} from './dto/user-response.dto';
import { CurrentUser, Public } from 'src/common/decorators/auth.decorators';
import { AUTH_COOKIE } from 'shared/constants/auth';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

@ApiTags('auth')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiCreatedResponse({
    type: AuthUserResponseDto,
    description: 'Создаёт организацию и её владельца (OWNER)',
  })
  register(@Body() params: RegisterDto) {
    return this.authService.register(params);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({
    type: AuthUserResponseDto,
    description: 'Устанавливает httpOnly cookie сессии',
  })
  async login(
    @Body() params: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user, message } = await this.authService.login(params);
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
    });
    return { message, user };
  }

  @Get('me')
  @ApiCookieAuth('access_token')
  @ApiOkResponse({ type: UserResponseDto })
  me(@CurrentUser() user: AuthUser) {
    return this.authService.getMe(user.id);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOkResponse({
    type: MessageResponseDto,
    description:
      'Идемпотентно очищает cookie сессии (работает и с просроченным/недействительным токеном — иначе клиент не смог бы выйти из «застрявшей» сессии)',
  })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    return { message: 'Выход выполнен' };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOkResponse({ type: MessageResponseDto })
  forgotPassword(@Body() params: ForgotPasswordDto) {
    return this.authService.forgotPassword(params);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  @ApiOkResponse({ type: MessageResponseDto })
  resetPassword(@Body() params: ResetPasswordDto) {
    return this.authService.resetPassword(params);
  }
}
