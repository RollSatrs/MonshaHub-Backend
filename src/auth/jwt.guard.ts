import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import type { AuthUser } from 'src/types/express';
import { IS_PUBLIC_KEY } from 'src/common/decorators/auth.decorators';

/** Глобальный guard: всё закрыто, кроме эндпоинтов с @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[
      'access_token'
    ];
    if (!token) throw new UnauthorizedException('Нет токена');
    try {
      req.user = this.jwtService.verify<AuthUser>(token);
      return true;
    } catch {
      throw new UnauthorizedException('Токен недействителен');
    }
  }
}
