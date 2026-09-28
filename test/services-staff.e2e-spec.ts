import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  Agent,
  cleanup,
  closeDb,
  createApp,
  createCashier,
  ErrorBody,
  PASSWORD,
  registerOwner,
  uniqueEmail,
  uniqueName,
} from './helpers';

interface ServiceBody {
  id: number;
  name: string;
  price: string;
  active: boolean;
}
interface StaffBody {
  id: number;
  email: string;
  role: string;
  active: boolean;
  organizationId: number;
}

describe('Services и Staff (e2e)', () => {
  let app: INestApplication;
  let ownerA: Awaited<ReturnType<typeof registerOwner>>;
  let ownerB: Awaited<ReturnType<typeof registerOwner>>;
  let cashierA: { agent: Agent; email: string };

  const mkService = async (agent: Agent, over: Record<string, unknown> = {}) =>
    (
      await agent
        .post('/services')
        .send({ name: uniqueName('Service'), price: '5000', ...over })
        .expect(201)
    ).body as ServiceBody;

  beforeAll(async () => {
    app = await createApp();
    ownerA = await registerOwner(app, 'A');
    ownerB = await registerOwner(app, 'B');
    cashierA = await createCashier(ownerA, app);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await closeDb();
  });

  describe('Services', () => {
    it('создание с нормализацией цены', async () => {
      const s = await mkService(ownerA.agent, {
        name: 'Массаж',
        price: '5000',
      });
      expect(s).toMatchObject({
        name: 'Массаж',
        price: '5000.00',
        active: true,
      });
    });

    it('валидация цены и лишних полей', async () => {
      for (const bad of [
        { price: '-1' },
        { price: '1.234' },
        { price: 5 },
        { name: '' },
        { stock: 1 },
        { organizationId: 1 },
      ]) {
        const res = await ownerA.agent
          .post('/services')
          .send({ name: uniqueName('S'), price: '1', ...bad })
          .expect(400);
        expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      }
    });

    it('дубликат названия → 409 DUPLICATE_NAME (в другой организации можно)', async () => {
      const name = uniqueName('Парение');
      await mkService(ownerA.agent, { name });
      const dup = await ownerA.agent
        .post('/services')
        .send({ name: name.toLowerCase(), price: '1' })
        .expect(409);
      expect((dup.body as ErrorBody).code).toBe('DUPLICATE_NAME');
      await mkService(ownerB.agent, { name });
    });

    it('PATCH и архивация; CASHIER видит только активные и не может писать', async () => {
      const s = await mkService(ownerA.agent);
      const upd = await ownerA.agent
        .patch(`/services/${s.id}`)
        .send({ price: '6000', name: 'Новое' })
        .expect(200);
      expect(upd.body).toMatchObject({ price: '6000.00', name: 'Новое' });

      await cashierA.agent
        .patch(`/services/${s.id}`)
        .send({ price: '1' })
        .expect(403);
      await cashierA.agent
        .post('/services')
        .send({ name: 'x', price: '1' })
        .expect(403);
      await cashierA.agent.delete(`/services/${s.id}`).expect(403);

      await ownerA.agent
        .patch(`/services/${s.id}`)
        .send({ active: false })
        .expect(200);
      const ids = (r: { body: unknown }) =>
        (r.body as ServiceBody[]).map((x) => x.id);
      expect(
        ids(
          await cashierA.agent
            .get('/services?includeInactive=true')
            .expect(200),
        ),
      ).not.toContain(s.id);
      expect(
        ids(
          await ownerA.agent.get('/services?includeInactive=true').expect(200),
        ),
      ).toContain(s.id);
      expect(
        ids(await ownerA.agent.get('/services').expect(200)),
      ).not.toContain(s.id);
      await cashierA.agent.get(`/services/${s.id}`).expect(404);
    });

    it('tenant isolation: чужая услуга → 404', async () => {
      const s = await mkService(ownerA.agent);
      await ownerB.agent.get(`/services/${s.id}`).expect(404);
      await ownerB.agent
        .patch(`/services/${s.id}`)
        .send({ price: '1' })
        .expect(404);
      await ownerB.agent.delete(`/services/${s.id}`).expect(404);
      const list = (
        await ownerB.agent.get('/services?includeInactive=true').expect(200)
      ).body as ServiceBody[];
      expect(list.some((x) => x.id === s.id)).toBe(false);
    });

    it('DELETE неиспользованной услуги → 204', async () => {
      const s = await mkService(ownerA.agent);
      await ownerA.agent.delete(`/services/${s.id}`).expect(204);
      await ownerA.agent.get(`/services/${s.id}`).expect(404);
    });
  });

  describe('Staff', () => {
    it('список содержит статус active; кассир создаётся в своей организации', async () => {
      const list = (await ownerA.agent.get('/staff').expect(200))
        .body as StaffBody[];
      const cashier = list.find((u) => u.email === cashierA.email)!;
      expect(cashier).toMatchObject({
        role: 'CASHIER',
        active: true,
        organizationId: ownerA.organizationId,
      });
      expect(JSON.stringify(list)).not.toMatch(/password/i);
    });

    it('деактивация кассира закрывает доступ сразу (действующая сессия), реактивация возвращает', async () => {
      const cashier = await createCashier(ownerA, app);
      await cashier.agent.get('/auth/me').expect(200);
      const id = (
        (await cashier.agent.get('/auth/me').expect(200)).body as { id: number }
      ).id;

      const off = await ownerA.agent
        .patch(`/staff/${id}`)
        .send({ active: false })
        .expect(200);
      expect((off.body as StaffBody).active).toBe(false);

      // уже выданный JWT перестаёт работать
      await cashier.agent.get('/auth/me').expect(401);
      await cashier.agent.get('/rooms').expect(401);
      // и войти заново нельзя
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: cashier.email, password: PASSWORD })
        .expect(401);

      await ownerA.agent
        .patch(`/staff/${id}`)
        .send({ active: true })
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: cashier.email, password: PASSWORD })
        .expect(200);
    });

    it('нельзя деактивировать себя; другой OWNER-запись недоступна; кассир не может управлять', async () => {
      const me = (await ownerA.agent.get('/auth/me').expect(200)).body as {
        id: number;
      };
      const res = await ownerA.agent
        .patch(`/staff/${me.id}`)
        .send({ active: false })
        .expect(409);
      expect((res.body as ErrorBody).code).toBe('CANNOT_DEACTIVATE_SELF');

      const cashierMe = (await cashierA.agent.get('/auth/me').expect(200))
        .body as { id: number };
      await cashierA.agent
        .patch(`/staff/${cashierMe.id}`)
        .send({ active: false })
        .expect(403);
      // проверка, что владелец остался активным
      await ownerA.agent.get('/auth/me').expect(200);
    });

    it('tenant isolation: сотрудник другой организации → 404; статус не изменился', async () => {
      const bCashier = await createCashier(ownerB, app);
      const id = (
        (await bCashier.agent.get('/auth/me').expect(200)).body as {
          id: number;
        }
      ).id;
      await ownerA.agent
        .patch(`/staff/${id}`)
        .send({ active: false })
        .expect(404);
      await bCashier.agent.get('/auth/me').expect(200);
    });

    it('валидация: active обязателен и булев', async () => {
      const id = (
        (await cashierA.agent.get('/auth/me').expect(200)).body as {
          id: number;
        }
      ).id;
      await ownerA.agent.patch(`/staff/${id}`).send({}).expect(400);
      await ownerA.agent
        .patch(`/staff/${id}`)
        .send({ active: 'no' })
        .expect(400);
      await ownerA.agent
        .patch(`/staff/${id}`)
        .send({ active: false, role: 'OWNER' })
        .expect(400);
    });

    it('дубликат email кассира → 409', async () => {
      const email = uniqueEmail('dupcashier');
      await ownerA.agent
        .post('/staff/cashiers')
        .send({ fullname: 'C', email, password: PASSWORD })
        .expect(201);
      const res = await ownerB.agent
        .post('/staff/cashiers')
        .send({ fullname: 'C', email, password: PASSWORD })
        .expect(409);
      expect((res.body as ErrorBody).code).toBe('EMAIL_ALREADY_EXISTS');
    });
  });
});
