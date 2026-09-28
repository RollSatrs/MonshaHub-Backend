import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { Request } from 'express';
import { db } from 'src';
import { usersTable } from 'src/db/schema';
import type { AuthUser } from 'src/types/express';
import { AUTH_COOKIE } from 'shared/constants/auth';
import { IS_PUBLIC_KEY } from 'src/common/decorators/auth.decorators';

/**
 * Глобальный guard: всё закрыто, кроме эндпоинтов с @Public().
 * После проверки подписи JWT пользователь перечитывается из БД: роль и организация
 * берутся оттуда (источник истины), а деактивированный пользователь теряет доступ сразу.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[
      AUTH_COOKIE
    ];
    if (!token) throw new UnauthorizedException('Нет токена');

    let payload: AuthUser;
    try {
      payload = this.jwtService.verify<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Токен недействителен');
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        role: usersTable.role,
        organizationId: usersTable.organizationId,
        active: usersTable.active,
      })
      .from(usersTable)
      .where(eq(usersTable.id, payload.id))
      .limit(1);
    if (!user || !user.active) {
      throw new UnauthorizedException('Пользователь недоступен');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };
    return true;
  }
}
