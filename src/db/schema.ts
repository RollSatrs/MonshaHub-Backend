import {
  pgEnum,
  integer,
  pgTable,
  varchar,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';

export const rolesEnum = pgEnum('role', [
  'admin',
  'teacher',
  'student',
  'schoolkid',
]);

export const usersTable = pgTable('users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  fullname: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: rolesEnum().default('student').notNull(),
  avatar: varchar({ length: 255 }),
});

export const passwordResetTokensTable = pgTable('password_reset_tokens', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  token: varchar({ length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean().default(false).notNull(),
});
