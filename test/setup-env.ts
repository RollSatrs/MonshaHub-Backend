import 'dotenv/config';

// e2e работают с реальной PostgreSQL: TEST_DATABASE_URL (или DATABASE_URL), миграции должны быть применены.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.FRONT_URL ??= 'http://localhost:3000';
process.env.SECRET_KEY ??= 'e2e-test-secret-0123456789abcdef0123456789abcdef';
process.env.SMTP_HOST ??= 'localhost';
process.env.SMTP_USER ??= 'x';
process.env.SMTP_PASS ??= 'x';
