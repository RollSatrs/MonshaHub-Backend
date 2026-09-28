import type { AuthUser } from 'src/types/express';
import type { ListQueryDto } from './dto/list-query.dto';

/** Архивные записи видит только OWNER, и только по явному запросу. */
export function canSeeInactive(user: AuthUser, query: ListQueryDto): boolean {
  return user.role === 'OWNER' && query.includeInactive === true;
}
