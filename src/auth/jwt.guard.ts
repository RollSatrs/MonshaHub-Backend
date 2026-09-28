import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import type { AuthUser } from 'src/types/express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies['access_token'] as string | undefined;
    if (!token) throw new UnauthorizedException('Нет токена');
    try {
      const payload = this.jwtService.verify<AuthUser>(token);
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Токен недействителен');
    }
  }
}
