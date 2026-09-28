import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  cleanup,
  closeDb,
  createApp,
  createCashier,
  PASSWORD,
  registerOwner,
  uniqueEmail,
} from './helpers';

describe('RBAC и tenant isolation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await closeDb();
  });

  it('OWNER видит только сотрудников своей организации', async () => {
    const ownerA = await registerOwner(app, 'A');
    const ownerB = await registerOwner(app, 'B');
    const cashierA = uniqueEmail('cashier');
    await ownerA.agent
      .post('/staff/cashiers')
      .send({ fullname: 'CA', email: cashierA, password: PASSWORD })
      .expect(201);

    const listA = await ownerA.agent.get('/staff').expect(200);
    const listB = await ownerB.agent.get('/staff').expect(200);

    const emailsA = (listA.body as { email: string }[]).map((u) => u.email);
    const emailsB = (listB.body as { email: string }[]).map((u) => u.email);
    expect(emailsA).toEqual(expect.arrayContaining([ownerA.email, cashierA]));
    expect(emailsA).not.toContain(ownerB.email);
    expect(emailsB).toEqual([ownerB.email]);
  });

  it('кассир создаётся в организации владельца, organizationId из body игнорируется/запрещён', async () => {
    const ownerA = await registerOwner(app, 'A');
    const ownerB = await registerOwner(app, 'B');
    await ownerA.agent
      .post('/staff/cashiers')
      .send({
        fullname: 'X',
        email: uniqueEmail('x'),
        password: PASSWORD,
        organizationId: ownerB.organizationId,
      })
      .expect(400);

    const created = await ownerA.agent
      .post('/staff/cashiers')
      .send({ fullname: 'Y', email: uniqueEmail('y'), password: PASSWORD })
      .expect(201);
    const body = created.body as { organizationId: number; role: string };
    expect(body.organizationId).toBe(ownerA.organizationId);
    expect(body.role).toBe('CASHIER');
    expect(JSON.stringify(created.body)).not.toMatch(/password/i);
  });

  it('CASHIER не имеет доступа к /staff → 403 FORBIDDEN', async () => {
    const owner = await registerOwner(app);
    const cashier = await createCashier(owner, app);

    const res = await cashier.agent.get('/staff').expect(403);
    expect((res.body as { code: string }).code).toBe('FORBIDDEN');
    await cashier.agent
      .post('/staff/cashiers')
      .send({ fullname: 'Z', email: uniqueEmail('z'), password: PASSWORD })
      .expect(403);
  });

  it('роль кассира в JWT — CASHIER и своя организация', async () => {
    const owner = await registerOwner(app);
    const cashier = await createCashier(owner, app);
    const me = await cashier.agent.get('/auth/me').expect(200);
    const body = me.body as { role: string; organizationId: number };
    expect(body.role).toBe('CASHIER');
    expect(body.organizationId).toBe(owner.organizationId);
  });

  it('без аутентификации закрыты все бизнес-эндпоинты', async () => {
    await request(app.getHttpServer()).get('/staff').expect(401);
    await request(app.getHttpServer())
      .post('/staff/cashiers')
      .send({ fullname: 'a', email: uniqueEmail('a'), password: PASSWORD })
      .expect(401);
  });

  it('удалённого /ai/chat больше нет', async () => {
    await request(app.getHttpServer())
      .post('/ai/chat')
      .send({ message: 'hi' })
      .expect(404);
  });
});
