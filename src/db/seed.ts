import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../index';
import { organizationsTable, usersTable } from './schema';
import { hashFunction } from '../../shared/tools/tools';

/**
 * Development seed: демо-организация, владелец и кассир.
 * Пароли — публичные демо-значения для локальной разработки (не секреты).
 * Идемпотентен: повторный запуск ничего не дублирует.
 */
const DEMO_ORG = 'MonshaHub Demo';
const DEMO_PASSWORD = 'demo12345';
const DEMO_USERS = [
  { fullname: 'Демо Владелец', email: 'owner@monshahub.demo', role: 'OWNER' },
  { fullname: 'Демо Кассир', email: 'cashier@monshahub.demo', role: 'CASHIER' },
] as const;

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed запрещён в production');
  }

  let [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.name, DEMO_ORG))
    .limit(1);
  if (!org) {
    [org] = await db
      .insert(organizationsTable)
      .values({ name: DEMO_ORG })
      .returning();
  }

  const passwordHash = await hashFunction(DEMO_PASSWORD);
  for (const u of DEMO_USERS) {
    await db
      .insert(usersTable)
      .values({ ...u, organizationId: org.id, passwordHash })
      .onConflictDoNothing({ target: usersTable.email });
  }

  console.log(`Seed выполнен. Организация: ${DEMO_ORG}`);
  for (const u of DEMO_USERS)
    console.log(`  ${u.role}: ${u.email} / ${DEMO_PASSWORD}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
