import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  FRONT_URL: z.string().min(1, 'FRONT_URL обязателен'),
  SECRET_KEY: z.string().min(1, 'SECRET_KEY обязателен'),
  OPENAI_API: z.string().optional(),
  SMTP_HOST: z.string().min(1, 'SMTP_HOST обязателен'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().min(1, 'SMTP_USER обязателен'),
  SMTP_PASS: z.string().min(1, 'SMTP_PASS обязателен'),
  SMTP_FROM: z.string().optional(),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

export function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Некорректные переменные окружения:\n${issues}`);
  }

  return result.data;
}
