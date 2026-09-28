// Значения нужны только для прохождения env-валидации; соединений не открывается.
// Импортируется первым, до модулей приложения (src/index.ts читает DATABASE_URL при импорте).
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/openapi_export';
process.env.FRONT_URL ??= 'http://localhost:3000';
process.env.SECRET_KEY ??= 'openapi-export-placeholder-secret-0123456789abcdef';
process.env.SMTP_HOST ??= 'localhost';
process.env.SMTP_USER ??= 'x';
process.env.SMTP_PASS ??= 'x';
