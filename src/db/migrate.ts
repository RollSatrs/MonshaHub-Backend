import 'dotenv/config';
import { join } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * Применяет SQL-миграции из ./drizzle (тот же журнал, что и у `drizzle-kit migrate`).
 * Работает в production-образе: нужен только drizzle-orm, drizzle-kit не требуется.
 * Запуск: `pnpm db:migrate:prod` (после сборки) или `node dist/src/db/migrate`.
 */
async function run() {
  const db = drizzle(process.env.DATABASE_URL!);
  await migrate(db, {
    migrationsFolder:
      process.env.MIGRATIONS_DIR ?? join(process.cwd(), 'drizzle'),
  });
  await db.$client.end();
  console.log('Миграции применены');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
