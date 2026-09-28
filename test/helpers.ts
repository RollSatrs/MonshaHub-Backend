import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inArray, like } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/mail/mail.service';
import { db } from '../src';
import { organizationsTable, usersTable } from '../src/db/schema';

export const PASSWORD = 'password123';
export const TEST_EMAIL_DOMAIN = '@e2e.monshahub.test';

export const sentResetTokens: { to: string; token: string }[] = [];

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({
      sendPasswordReset: (to: string, token: string) => {
        sentResetTokens.push({ to, token });
        return Promise.resolve();
      },
    })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  // постоянный эфемерный порт: параллельные запросы supertest не пересоздают listen
  await app.listen(0);
  return app;
}

let counter = 0;
export function uniqueEmail(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}${TEST_EMAIL_DOMAIN}`;
}

/** Регистрирует организацию + OWNER и возвращает агента с cookie. */
export async function registerOwner(app: INestApplication, name = 'Org') {
  const email = uniqueEmail('owner');
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      organizationName: `E2E ${name} ${email}`,
      fullname: 'Owner',
      email,
      password: PASSWORD,
    })
    .expect(201);
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return {
    agent,
    email,
    organizationId: (res.body as { user: { organizationId: number } }).user
      .organizationId,
  };
}

export async function createCashier(
  owner: { agent: ReturnType<typeof request.agent> },
  app: INestApplication,
) {
  const email = uniqueEmail('cashier');
  await owner.agent
    .post('/staff/cashiers')
    .send({ fullname: 'Cashier', email, password: PASSWORD })
    .expect(201);
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return { agent, email };
}

/** Удаляет данные, созданные e2e (пользователи с тестовым доменом и их организации). */
export async function cleanup() {
  const users = await db
    .select({ orgId: usersTable.organizationId })
    .from(usersTable)
    .where(like(usersTable.email, `%${TEST_EMAIL_DOMAIN}`));
  const orgIds = [...new Set(users.map((u) => u.orgId))];
  if (orgIds.length) {
    await db
      .delete(organizationsTable)
      .where(inArray(organizationsTable.id, orgIds));
  }
}

/** Закрывает пул соединений, чтобы Jest завершался без --forceExit. */
export async function closeDb() {
  await db.$client.end();
}

// ─── Phase 1: справочники ─────────────────────────────────────────────────

export type Agent = ReturnType<typeof request.agent>;

let nameCounter = 0;
export function uniqueName(prefix: string) {
  nameCounter += 1;
  return `${prefix} ${Date.now()}-${nameCounter}`;
}

export interface RoomBody {
  id: number;
  name: string;
  type: 'PRIVATE' | 'PUBLIC';
  capacity: number;
  sortOrder: number;
  active: boolean;
  activeTariffs: TariffBody[];
}

export interface TariffBody {
  id: number;
  roomId: number;
  kind: 'HOURLY' | 'PER_ENTRY';
  guestCategory: 'ADULT' | 'CHILD' | null;
  name: string;
  price: string;
  active: boolean;
}

export interface ProductBody {
  id: number;
  name: string;
  price: string;
  stock: number;
  active: boolean;
}

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: string[];
}

export async function mkRoom(agent: Agent, over: Record<string, unknown> = {}) {
  const res = await agent
    .post('/rooms')
    .send({ name: uniqueName('Room'), type: 'PRIVATE', capacity: 6, ...over })
    .expect(201);
  return res.body as RoomBody;
}

export async function mkTariff(
  agent: Agent,
  roomId: number,
  over: Record<string, unknown> = {},
) {
  const res = await agent
    .post('/tariffs')
    .send({ roomId, name: 'Почасовой', price: '10000', ...over })
    .expect(201);
  return res.body as TariffBody;
}

export async function mkProduct(
  agent: Agent,
  over: Record<string, unknown> = {},
) {
  const res = await agent
    .post('/products')
    .send({ name: uniqueName('Product'), price: '2500', stock: 0, ...over })
    .expect(201);
  return res.body as ProductBody;
}
