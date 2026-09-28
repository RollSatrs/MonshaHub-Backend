import { pgEnum } from 'drizzle-orm/pg-core';

export const rolesEnum = pgEnum('role', [
  'admin',
  'teacher',
  'student',
  'schoolkid',
]);
