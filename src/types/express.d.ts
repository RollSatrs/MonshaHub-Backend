import type { Role } from 'shared/constants/roles';

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  organizationId: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
