import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from 'shared/constants/roles';
import type { AuthUser } from 'src/types/express';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Эндпоинт доступен без аутентификации (по умолчанию все эндпоинты закрыты). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Ограничивает эндпоинт указанными ролями. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Текущий пользователь из JWT. organizationId берём только отсюда, не из body/query. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest<Request>().user!;
  },
);
