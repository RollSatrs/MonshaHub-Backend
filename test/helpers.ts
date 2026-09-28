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
