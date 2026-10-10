import type { AuthUser } from 'src/types/express';
import type { ListQueryDto } from './dto/list-query.dto';
import { BadRequestException } from '@nestjs/common';

/** Архивные записи видит только OWNER, и только по явному запросу. */
export function canSeeInactive(user: AuthUser, query: ListQueryDto): boolean {
  return user.role === 'OWNER' && query.includeInactive === true;
}

/** Филиал уже проверен JwtAuthGuard и не принимается напрямую из body. */
export function requireBranchId(user: AuthUser): number {
  if (!user.branchId) {
    throw new BadRequestException('Сначала выберите активный филиал');
  }
  return user.branchId;
}
