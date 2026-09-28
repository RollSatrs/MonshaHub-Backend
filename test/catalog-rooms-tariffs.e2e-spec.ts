import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { db } from '../src';
import { roomsTable, tariffsTable } from '../src/db/schema';
import {
  Agent,
  cleanup,
  closeDb,
  createApp,
  createCashier,
  ErrorBody,
  mkRoom,
  mkTariff,
  RoomBody,
  registerOwner,
  TariffBody,
  uniqueName,
} from './helpers';

describe('Rooms и Tariffs (e2e)', () => {
  let app: INestApplication;
  let ownerA: Awaited<ReturnType<typeof registerOwner>>;
  let ownerB: Awaited<ReturnType<typeof registerOwner>>;
  let cashierA: { agent: Agent };

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

  describe('Organization', () => {
    it('GET доступен обоим ролям, PATCH — только OWNER', async () => {
      const own = await ownerA.agent.get('/organization').expect(200);
      const org = own.body as {
        id: number;
        name: string;
        currency: string;
        timezone: string;
      };
      expect(org.id).toBe(ownerA.organizationId);
      expect(org.currency).toBe('KZT');
      expect(org.timezone).toBe('Asia/Almaty');

      await cashierA.agent.get('/organization').expect(200);
      await cashierA.agent
        .patch('/organization')
        .send({ name: 'Hack' })
        .expect(403);

      const renamed = await ownerB.agent
        .patch('/organization')
        .send({ name: '  Новая баня  ' })
        .expect(200);
      expect((renamed.body as { name: string }).name).toBe('Новая баня');
      // организация A не затронута
      const a = await ownerA.agent.get('/organization').expect(200);
      expect((a.body as { name: string }).name).not.toBe('Новая баня');
    });

    it('currency/timezone/id не изменяются через API', async () => {
      for (const extra of [
        { currency: 'USD' },
        { timezone: 'UTC' },
        { id: 1 },
      ]) {
        const res = await ownerA.agent
          .patch('/organization')
          .send({ name: 'X', ...extra })
          .expect(400);
        expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('Rooms', () => {
    it('OWNER создаёт помещение; ответ содержит activeTariffs', async () => {
      const room = await mkRoom(ownerA.agent, {
        name: 'VIP №1',
        capacity: 6,
        sortOrder: 1,
      });
      expect(room).toMatchObject({
        name: 'VIP №1',
        type: 'PRIVATE',
        capacity: 6,
        sortOrder: 1,
        active: true,
        activeTariffs: [],
      });
    });

    it('валидация: capacity, type, лишние поля', async () => {
      const post = (body: Record<string, unknown>) =>
        ownerA.agent.post('/rooms').send(body);
      for (const bad of [
        { name: 'x', type: 'PRIVATE', capacity: 0 },
        { name: 'x', type: 'PRIVATE', capacity: 1001 },
        { name: 'x', type: 'PRIVATE', capacity: 1.5 },
        { name: 'x', type: 'VIP', capacity: 5 },
        { name: '', type: 'PRIVATE', capacity: 5 },
        { type: 'PRIVATE', capacity: 5 },
        {
          name: 'x',
          type: 'PRIVATE',
          capacity: 5,
          organizationId: ownerB.organizationId,
        },
        { name: 'x', type: 'PRIVATE', capacity: 5, active: false },
      ]) {
        const res = await post(bad).expect(400);
        expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      }
    });

    it('тип помещения изменить нельзя', async () => {
      const room = await mkRoom(ownerA.agent);
      const res = await ownerA.agent
        .patch(`/rooms/${room.id}`)
        .send({ type: 'PUBLIC' })
        .expect(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    });

    it('название уникально в организации без учёта регистра → 409 DUPLICATE_NAME, но в другой организации можно', async () => {
      const name = uniqueName('Уникальный');
      await mkRoom(ownerA.agent, { name });
      const dup = await ownerA.agent
        .post('/rooms')
        .send({ name: name.toUpperCase(), type: 'PRIVATE', capacity: 2 })
        .expect(409);
      expect((dup.body as ErrorBody).code).toBe('DUPLICATE_NAME');
      await mkRoom(ownerB.agent, { name });
    });

    it('PATCH меняет поля; пустой PATCH возвращает текущее состояние', async () => {
      const room = await mkRoom(ownerA.agent);
      const res = await ownerA.agent
        .patch(`/rooms/${room.id}`)
        .send({ name: 'Renamed', capacity: 10, sortOrder: 5 })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Renamed',
        capacity: 10,
        sortOrder: 5,
      });
      const same = await ownerA.agent
        .patch(`/rooms/${room.id}`)
        .send({})
        .expect(200);
      expect((same.body as RoomBody).name).toBe('Renamed');
    });

    it('RBAC: CASHIER не может создавать/менять/удалять, но читает', async () => {
      const room = await mkRoom(ownerA.agent);
      const denied = await cashierA.agent
        .post('/rooms')
        .send({ name: 'C', type: 'PRIVATE', capacity: 1 })
        .expect(403);
      expect((denied.body as ErrorBody).code).toBe('FORBIDDEN');
      await cashierA.agent
        .patch(`/rooms/${room.id}`)
        .send({ name: 'C' })
        .expect(403);
      await cashierA.agent.delete(`/rooms/${room.id}`).expect(403);
      await cashierA.agent.get(`/rooms/${room.id}`).expect(200);
      const list = await cashierA.agent.get('/rooms').expect(200);
      expect((list.body as RoomBody[]).some((r) => r.id === room.id)).toBe(
        true,
      );
    });

    it('архивация: кассир не видит архивное (даже с includeInactive), OWNER видит по запросу', async () => {
      const room = await mkRoom(ownerA.agent);
      await ownerA.agent
        .patch(`/rooms/${room.id}`)
        .send({ active: false })
        .expect(200);

      const ids = (res: { body: unknown }) =>
        (res.body as RoomBody[]).map((r) => r.id);
      expect(ids(await cashierA.agent.get('/rooms').expect(200))).not.toContain(
        room.id,
      );
      expect(
        ids(
          await cashierA.agent.get('/rooms?includeInactive=true').expect(200),
        ),
      ).not.toContain(room.id);
      await cashierA.agent.get(`/rooms/${room.id}`).expect(404);

      expect(ids(await ownerA.agent.get('/rooms').expect(200))).not.toContain(
        room.id,
      );
      expect(
        ids(await ownerA.agent.get('/rooms?includeInactive=true').expect(200)),
      ).toContain(room.id);
      await ownerA.agent.get(`/rooms/${room.id}`).expect(200);

      await ownerA.agent
        .patch(`/rooms/${room.id}`)
        .send({ active: true })
        .expect(200);
      expect(ids(await cashierA.agent.get('/rooms').expect(200))).toContain(
        room.id,
      );
    });

    it('порядок: sortOrder, затем id', async () => {
      const first = await mkRoom(ownerB.agent, { sortOrder: 0 });
      const last = await mkRoom(ownerB.agent, { sortOrder: 9000 });
      const mid = await mkRoom(ownerB.agent, { sortOrder: 100 });
      const list = (await ownerB.agent.get('/rooms').expect(200))
        .body as RoomBody[];
      const order = list.map((r) => r.id);
      expect(order.indexOf(first.id)).toBeLessThan(order.indexOf(mid.id));
      expect(order.indexOf(mid.id)).toBeLessThan(order.indexOf(last.id));
    });

    it('tenant isolation: чужое помещение → 404 на чтение/изменение/удаление, в списке его нет', async () => {
      const room = await mkRoom(ownerA.agent);
      await ownerB.agent.get(`/rooms/${room.id}`).expect(404);
      await ownerB.agent
        .patch(`/rooms/${room.id}`)
        .send({ name: 'Stolen' })
        .expect(404);
      await ownerB.agent.delete(`/rooms/${room.id}`).expect(404);
      const list = (
        await ownerB.agent.get('/rooms?includeInactive=true').expect(200)
      ).body as RoomBody[];
      expect(list.some((r) => r.id === room.id)).toBe(false);
      // помещение не пострадало
      const [row] = await db
        .select()
        .from(roomsTable)
        .where(eq(roomsTable.id, room.id));
      expect(row.name).toBe(room.name);
    });

    it('DELETE неиспользованного помещения → 204, тарифы удаляются каскадом', async () => {
      const room = await mkRoom(ownerA.agent);
      const tariff = await mkTariff(ownerA.agent, room.id);
      await ownerA.agent.delete(`/rooms/${room.id}`).expect(204);
      await ownerA.agent.get(`/rooms/${room.id}`).expect(404);
      const rows = await db
        .select()
        .from(tariffsTable)
        .where(eq(tariffsTable.id, tariff.id));
      expect(rows).toHaveLength(0);
    });

    it('неавторизованный доступ закрыт', async () => {
      await request(app.getHttpServer()).get('/rooms').expect(401);
      await request(app.getHttpServer()).get('/tariffs').expect(401);
    });
  });

  describe('Tariffs', () => {
    it('PRIVATE: почасовой тариф; kind определяет backend, цена нормализуется', async () => {
      const room = await mkRoom(ownerA.agent);
      const tariff = await mkTariff(ownerA.agent, room.id, { price: '2500.5' });
      expect(tariff).toMatchObject({
        roomId: room.id,
        kind: 'HOURLY',
        guestCategory: null,
        price: '2500.50',
        active: true,
      });
      const withTariffs = (
        await ownerA.agent.get(`/rooms/${room.id}`).expect(200)
      ).body as RoomBody;
      expect(withTariffs.activeTariffs.map((t) => t.id)).toEqual([tariff.id]);
    });

    it('kind нельзя передать от клиента', async () => {
      const room = await mkRoom(ownerA.agent);
      const res = await ownerA.agent
        .post('/tariffs')
        .send({ roomId: room.id, name: 'x', price: '1', kind: 'PER_ENTRY' })
        .expect(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
    });

    it('PRIVATE + guestCategory → 422 TARIFF_ROOM_TYPE_MISMATCH', async () => {
      const room = await mkRoom(ownerA.agent);
      const res = await ownerA.agent
        .post('/tariffs')
        .send({
          roomId: room.id,
          name: 'x',
          price: '1',
          guestCategory: 'ADULT',
        })
        .expect(422);
      expect((res.body as ErrorBody).code).toBe('TARIFF_ROOM_TYPE_MISMATCH');
    });

    it('PUBLIC: тариф за вход требует guestCategory; ADULT и CHILD независимы', async () => {
      const room = await mkRoom(ownerA.agent, { type: 'PUBLIC', capacity: 60 });
      const missing = await ownerA.agent
        .post('/tariffs')
        .send({ roomId: room.id, name: 'x', price: '1' })
        .expect(422);
      expect((missing.body as ErrorBody).code).toBe(
        'TARIFF_ROOM_TYPE_MISMATCH',
      );

      const adult = await mkTariff(ownerA.agent, room.id, {
        name: 'Взрослый',
        guestCategory: 'ADULT',
        price: '2000',
      });
      const child = await mkTariff(ownerA.agent, room.id, {
        name: 'Детский',
        guestCategory: 'CHILD',
        price: '1000',
      });
      expect(adult).toMatchObject({
        kind: 'PER_ENTRY',
        guestCategory: 'ADULT',
      });
      expect(child).toMatchObject({
        kind: 'PER_ENTRY',
        guestCategory: 'CHILD',
      });

      const dup = await ownerA.agent
        .post('/tariffs')
        .send({
          roomId: room.id,
          name: 'Ещё взрослый',
          guestCategory: 'ADULT',
          price: '1',
        })
        .expect(409);
      expect((dup.body as ErrorBody).code).toBe('TARIFF_ALREADY_EXISTS');
    });

    it('второй активный HOURLY тариф → 409; после архивации первого можно создать новый; реактивация старого → 409', async () => {
      const room = await mkRoom(ownerA.agent);
      const first = await mkTariff(ownerA.agent, room.id, { price: '10000' });
      const dup = await ownerA.agent
        .post('/tariffs')
        .send({ roomId: room.id, name: 'Второй', price: '12000' })
        .expect(409);
      expect((dup.body as ErrorBody).code).toBe('TARIFF_ALREADY_EXISTS');

      await ownerA.agent
        .patch(`/tariffs/${first.id}`)
        .send({ active: false })
        .expect(200);
      const second = await mkTariff(ownerA.agent, room.id, {
        name: 'Новый',
        price: '12000',
      });
      expect(second.active).toBe(true);

      const reactivate = await ownerA.agent
        .patch(`/tariffs/${first.id}`)
        .send({ active: true })
        .expect(409);
      expect((reactivate.body as ErrorBody).code).toBe('TARIFF_ALREADY_EXISTS');

      // в помещении отображается только активный тариф
      const r = (await ownerA.agent.get(`/rooms/${room.id}`).expect(200))
        .body as RoomBody;
      expect(r.activeTariffs.map((t) => t.id)).toEqual([second.id]);
    });

    it('цена: принимаются только decimal-строки', async () => {
      const room = await mkRoom(ownerA.agent);
      for (const bad of [
        '10 000',
        '-5',
        '1.234',
        '1,5',
        'abc',
        '',
        '12345678901',
        100,
        null,
        {},
      ]) {
        const res = await ownerA.agent
          .post('/tariffs')
          .send({ roomId: room.id, name: 'x', price: bad })
          .expect(400);
        expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      }
      const free = await mkTariff(ownerA.agent, room.id, { price: '0' });
      expect(free.price).toBe('0.00');
    });

    it('PATCH: меняет цену и название (roomId/kind менять нельзя)', async () => {
      const room = await mkRoom(ownerA.agent);
      const t = await mkTariff(ownerA.agent, room.id);
      const res = await ownerA.agent
        .patch(`/tariffs/${t.id}`)
        .send({ price: '15000', name: 'Обновлённый' })
        .expect(200);
      expect(res.body).toMatchObject({
        price: '15000.00',
        name: 'Обновлённый',
        kind: 'HOURLY',
      });
      await ownerA.agent
        .patch(`/tariffs/${t.id}`)
        .send({ roomId: 1 })
        .expect(400);
      await ownerA.agent
        .patch(`/tariffs/${t.id}`)
        .send({ kind: 'PER_ENTRY' })
        .expect(400);
    });

    it('RBAC: CASHIER читает только активные тарифы и не может писать', async () => {
      const room = await mkRoom(ownerA.agent, { type: 'PUBLIC', capacity: 30 });
      const active = await mkTariff(ownerA.agent, room.id, {
        guestCategory: 'ADULT',
        price: '2000',
      });
      const archived = await mkTariff(ownerA.agent, room.id, {
        guestCategory: 'CHILD',
        price: '1000',
      });
      await ownerA.agent
        .patch(`/tariffs/${archived.id}`)
        .send({ active: false })
        .expect(200);

      const ids = (r: { body: unknown }) =>
        (r.body as TariffBody[]).map((t) => t.id);
      const cashierList = await cashierA.agent
        .get(`/tariffs?roomId=${room.id}&includeInactive=true`)
        .expect(200);
      expect(ids(cashierList)).toEqual([active.id]);
      const ownerList = await ownerA.agent
        .get(`/tariffs?roomId=${room.id}&includeInactive=true`)
        .expect(200);
      expect(ids(ownerList).sort()).toEqual([active.id, archived.id].sort());

      await cashierA.agent
        .post('/tariffs')
        .send({
          roomId: room.id,
          name: 'x',
          guestCategory: 'CHILD',
          price: '1',
        })
        .expect(403);
      await cashierA.agent
        .patch(`/tariffs/${active.id}`)
        .send({ price: '1' })
        .expect(403);
      await cashierA.agent.delete(`/tariffs/${active.id}`).expect(403);
    });

    it('tenant isolation: тариф на чужое помещение → 404; чужой тариф недоступен', async () => {
      const roomA = await mkRoom(ownerA.agent);
      const tariffA = await mkTariff(ownerA.agent, roomA.id);

      await ownerB.agent
        .post('/tariffs')
        .send({ roomId: roomA.id, name: 'x', price: '1' })
        .expect(404);
      await ownerB.agent
        .patch(`/tariffs/${tariffA.id}`)
        .send({ price: '1' })
        .expect(404);
      await ownerB.agent.delete(`/tariffs/${tariffA.id}`).expect(404);
      const list = (
        await ownerB.agent
          .get(`/tariffs?roomId=${roomA.id}&includeInactive=true`)
          .expect(200)
      ).body as TariffBody[];
      expect(list).toEqual([]);

      const [row] = await db
        .select()
        .from(tariffsTable)
        .where(eq(tariffsTable.id, tariffA.id));
      expect(row.price).toBe('10000.00');
    });

    it('DELETE тарифа: 204 для неиспользованного, 404 для отсутствующего', async () => {
      const room = await mkRoom(ownerA.agent);
      const t = await mkTariff(ownerA.agent, room.id);
      await ownerA.agent.delete(`/tariffs/${t.id}`).expect(204);
      await ownerA.agent.delete(`/tariffs/${t.id}`).expect(404);
    });

    it('DB-инварианты: тариф нельзя привязать к помещению другой организации и нарушить kind/category', async () => {
      const roomA = await mkRoom(ownerA.agent);
      // composite FK (room_id, organization_id)
      await expect(
        db.insert(tariffsTable).values({
          organizationId: ownerB.organizationId,
          roomId: roomA.id,
          kind: 'HOURLY',
          name: uniqueName('bad'),
          price: '1.00',
        }),
      ).rejects.toThrow();
      // HOURLY с guest_category
      await expect(
        db.insert(tariffsTable).values({
          organizationId: ownerA.organizationId,
          roomId: roomA.id,
          kind: 'HOURLY',
          guestCategory: 'ADULT',
          name: uniqueName('bad'),
          price: '1.00',
        }),
      ).rejects.toThrow();
      // отрицательная цена
      await expect(
        db.insert(tariffsTable).values({
          organizationId: ownerA.organizationId,
          roomId: roomA.id,
          kind: 'HOURLY',
          name: uniqueName('bad'),
          price: '-1.00',
        }),
      ).rejects.toThrow();
    });
  });
});
