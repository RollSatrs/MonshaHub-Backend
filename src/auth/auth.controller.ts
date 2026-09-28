import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './jwt.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() params: RegisterDto) {
    return await this.authService.register(params);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body()
    params: LoginDto,
    @Res({ passthrough: true })
    res: Response,
  ) {
    const { token, user, message } = await this.authService.login(params);
    res.cookie('access_token', token, {
      httpOnly: true, // ❗ JS не может прочитать
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return {
      message,
      user,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: Request) {
    return this.authService.getMe(req.user!.id);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token');
    return { message: 'Выход выполнен' };
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() params: ForgotPasswordDto) {
    return this.authService.forgotPassword(params);
  }

  @Post('reset-password')
  async resetPassword(@Body() params: ResetPasswordDto) {
    return this.authService.resetPassword(params);
  }
}
