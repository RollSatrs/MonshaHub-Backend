import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../src';
import { roomCleaningsTable } from '../src/db/schema';
import {
  Agent,
  cleanup,
  closeDb,
  createApp,
  createCashier,
  ErrorBody,
  getVisit,
  mkPrivateRoom,
  mkProduct,
  mkPublicRoom,
  mustStartPrivate,
  mustStartPublic,
  registerOwner,
  roomState,
  VisitBody,
} from './helpers';

interface InsideBody {
  roomId: number;
  capacity: number;
  inside: number;
  visits: {
    visitId: number;
    adults: number;
    children: number;
    guests: number;
    total: string;
    balance: string;
    paymentStatus: string;
  }[];
}

describe('PUBLIC Visit (e2e)', () => {
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerOwner>>;
  let other: Awaited<ReturnType<typeof registerOwner>>;
  let cashier: { agent: Agent };

  const post = (
    agent: Agent,
    url: string,
    body: Record<string, unknown> = {},
  ) => agent.post(url).send(body);
  const err = (res: { body: unknown }) => res.body as ErrorBody;
  const enter = (
    roomId: number,
    guests: { category: string; quantity: number }[],
  ) => post(cashier.agent, '/visits/public', { roomId, guests });
  const inside = async (roomId: number) =>
    (await cashier.agent.get(`/rooms/${roomId}/inside`).expect(200))
      .body as InsideBody;
  const pay = (v: VisitBody) =>
    post(cashier.agent, `/visits/${v.id}/payments`, {
      method: 'CASH',
      amount: v.balance,
    });

  beforeAll(async () => {
    app = await createApp();
    owner = await registerOwner(app, 'Public');
    other = await registerOwner(app, 'Other');
    cashier = await createCashier(owner, app);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await closeDb();
  });

  describe('вход и чек', () => {
    it('группа 2 взрослых + 1 ребёнок → один чек; итог и snapshot цен от backend', async () => {
      const room = await mkPublicRoom(owner.agent, 60, '2000', '1000');
      const v = await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 2 },
        { category: 'CHILD', quantity: 1 },
      ]);
      expect(v).toMatchObject({
        kind: 'PUBLIC',
        status: 'ACTIVE',
        total: '5000.00',
        guests: 3,
        endsAt: null,
        timeState: null,
        remainingSeconds: null,
        hourlyRate: null,
      });
      expect(
        v.items.map((i) => [
          i.kind,
          i.guestCategory,
          i.quantity,
          i.unitPrice,
          i.lineTotal,
        ]),
      ).toEqual([
        ['ENTRY', 'ADULT', 2, '2000.00', '4000.00'],
        ['ENTRY', 'CHILD', 1, '1000.00', '1000.00'],
      ]);

      // смена тарифа не меняет уже созданный чек
      const tariffs = (
        await owner.agent.get(`/tariffs?roomId=${room.id}`).expect(200)
      ).body as {
        id: number;
        guestCategory: string;
      }[];
      const adult = tariffs.find((t) => t.guestCategory === 'ADULT')!;
      await owner.agent
        .patch(`/tariffs/${adult.id}`)
        .send({ price: '9999' })
        .expect(200);
      expect((await getVisit(cashier.agent, v.id)).total).toBe('5000.00');
      // а новый гость платит по новой цене
      const next = await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 1 },
      ]);
      expect(next.total).toBe('9999.00');
    });

    it('один чек: вход + веник + полотенце + услуга; оплата и выход', async () => {
      const room = await mkPublicRoom(owner.agent, 60, '2000', '1000');
      const broom = await mkProduct(owner.agent, { price: '2500', stock: 10 });
      const towel = await mkProduct(owner.agent, { price: '1000', stock: 10 });
      const v = await mustStartPublic(cashier.agent, room.id);
      await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: broom.id,
        quantity: 1,
      }).expect(200);
      const res = await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: towel.id,
        quantity: 1,
      }).expect(200);
      const bill = res.body as VisitBody;
      expect(bill.total).toBe('5500.00');
      expect(bill.items.map((i) => i.kind)).toEqual([
        'ENTRY',
        'PRODUCT',
        'PRODUCT',
      ]);

      // нельзя выйти без оплаты
      expect(
        (await post(cashier.agent, `/visits/${v.id}/complete`)).status,
      ).toBe(409);
      const done = await post(cashier.agent, `/visits/${v.id}/complete`, {
        payments: [{ method: 'KASPI', amount: '5500' }],
      }).expect(200);
      expect(done.body).toMatchObject({
        status: 'COMPLETED',
        paid: '5500.00',
        balance: '0.00',
      });

      // у PUBLIC нет уборки
      const cleanings = await db
        .select()
        .from(roomCleaningsTable)
        .where(eq(roomCleaningsTable.roomId, room.id));
      expect(cleanings).toHaveLength(0);
      expect((await roomState(cashier.agent, room.id)).state).toBe('OPEN');
    });

    it('валидация входа и типов помещений', async () => {
      const room = await mkPublicRoom(owner.agent, 10);
      for (const guests of [
        [],
        [{ category: 'ADULT', quantity: 0 }],
        [{ category: 'ADULT', quantity: -1 }],
        [{ category: 'ADULT', quantity: 201 }],
        [{ category: 'SENIOR', quantity: 1 }],
        [{ category: 'ADULT', quantity: 1.5 }],
      ]) {
        expect((await enter(room.id, guests)).status).toBe(400);
      }
      const priv = await mkPrivateRoom(owner.agent);
      const r = await enter(priv.id, [{ category: 'ADULT', quantity: 1 }]);
      expect(r.status).toBe(422);
      expect(err(r).code).toBe('ROOM_TYPE_MISMATCH');
    });

    it('нет тарифа на категорию → 409 TARIFF_NOT_CONFIGURED, чек не создаётся', async () => {
      const room = await mkPublicRoom(owner.agent, 10, '2000', null);
      const r = await enter(room.id, [{ category: 'CHILD', quantity: 1 }]);
      expect(r.status).toBe(409);
      expect(err(r).code).toBe('TARIFF_NOT_CONFIGURED');
      expect((await inside(room.id)).visits).toHaveLength(0);
      await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 1 },
      ]);
    });

    it('бесплатный вход (цена 0): чек с нулевым итогом завершается без оплаты', async () => {
      const room = await mkPublicRoom(owner.agent, 10, '2000', '0');
      const v = await mustStartPublic(cashier.agent, room.id, [
        { category: 'CHILD', quantity: 2 },
      ]);
      expect(v).toMatchObject({ total: '0.00', paymentStatus: 'PAID' });
      const done = await post(cashier.agent, `/visits/${v.id}/complete`).expect(
        200,
      );
      expect((done.body as VisitBody).status).toBe('COMPLETED');
    });
  });

  describe('счётчик и вместимость', () => {
    it('«Внутри сейчас» = сумма гостей активных чеков; выход уменьшает', async () => {
      const room = await mkPublicRoom(owner.agent, 60);
      const a = await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 2 },
      ]);
      const b = await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 1 },
        { category: 'CHILD', quantity: 3 },
      ]);
      let state = await roomState(cashier.agent, room.id);
      expect(state).toMatchObject({
        state: 'OPEN',
        inside: 6,
        activeVisits: 2,
        capacity: 60,
      });

      const list = await inside(room.id);
      expect(list.inside).toBe(6);
      expect(list.visits.find((x) => x.visitId === b.id)).toMatchObject({
        adults: 1,
        children: 3,
        guests: 4,
      });

      await post(cashier.agent, `/visits/${a.id}/complete`, {
        payments: [{ method: 'CASH', amount: a.total }],
      }).expect(200);
      state = await roomState(cashier.agent, room.id);
      expect(state).toMatchObject({ inside: 4, activeVisits: 1 });
    });

    it('вместимость: зал заполняется до предела, дальше → 409 ROOM_CAPACITY_EXCEEDED; состояние FULL', async () => {
      const room = await mkPublicRoom(owner.agent, 5);
      const a = await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 3 },
      ]);
      await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 2 },
      ]);
      expect((await roomState(cashier.agent, room.id)).state).toBe('FULL');

      const res = await enter(room.id, [{ category: 'ADULT', quantity: 1 }]);
      expect(res.status).toBe(409);
      expect(err(res).code).toBe('ROOM_CAPACITY_EXCEEDED');
      expect(res.body).toMatchObject({
        meta: { inside: 5, capacity: 5, requested: 1 },
      });
      // неудачная попытка не оставила чек
      expect((await inside(room.id)).visits).toHaveLength(2);

      // вышли — место освободилось
      await post(cashier.agent, `/visits/${a.id}/complete`, {
        payments: [{ method: 'CARD', amount: a.total }],
      }).expect(200);
      expect((await roomState(cashier.agent, room.id)).state).toBe('OPEN');
      await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 3 },
      ]);
    });

    it('группа, не влезающая целиком, не входит вообще (без частичного создания)', async () => {
      const room = await mkPublicRoom(owner.agent, 4);
      await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 3 },
      ]);
      const res = await enter(room.id, [
        { category: 'ADULT', quantity: 1 },
        { category: 'CHILD', quantity: 1 },
      ]);
      expect(res.status).toBe(409);
      expect((await inside(room.id)).inside).toBe(3);
    });

    it('10 параллельных входов при одном свободном месте → ровно один успешный, внутри не больше вместимости', async () => {
      const room = await mkPublicRoom(owner.agent, 10);
      for (let i = 0; i < 9; i++) await mustStartPublic(cashier.agent, room.id);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          enter(room.id, [{ category: 'ADULT', quantity: 1 }]),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      results
        .filter((r) => r.status !== 201)
        .forEach((r) => {
          expect(r.status).toBe(409);
          expect(err(r).code).toBe('ROOM_CAPACITY_EXCEEDED');
        });
      expect((await roomState(cashier.agent, room.id)).inside).toBe(10);
    });

    it('добавление гостей в чек проверяет вместимость; в PRIVATE-посещение нельзя; продлить PUBLIC нельзя', async () => {
      const room = await mkPublicRoom(owner.agent, 4);
      const v = await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 2 },
      ]);
      const ok = await post(cashier.agent, `/visits/${v.id}/guests`, {
        guests: [{ category: 'CHILD', quantity: 2 }],
      }).expect(200);
      expect(ok.body).toMatchObject({ guests: 4, total: '6000.00' });
      const over = await post(cashier.agent, `/visits/${v.id}/guests`, {
        guests: [{ category: 'ADULT', quantity: 1 }],
      });
      expect(over.status).toBe(409);
      expect(err(over).code).toBe('ROOM_CAPACITY_EXCEEDED');

      const priv = await mkPrivateRoom(owner.agent);
      const pv = await mustStartPrivate(cashier.agent, priv.id, 60);
      const r1 = await post(cashier.agent, `/visits/${pv.id}/guests`, {
        guests: [{ category: 'ADULT', quantity: 1 }],
      });
      expect(r1.status).toBe(422);
      const r2 = await post(cashier.agent, `/visits/${v.id}/extend`, {
        minutes: 60,
      });
      expect(r2.status).toBe(422);
    });

    it('исправление: убрать ошибочно добавленный вход (void ENTRY) уменьшает счётчик и итог', async () => {
      const room = await mkPublicRoom(owner.agent, 10);
      const v = await mustStartPublic(cashier.agent, room.id, [
        { category: 'ADULT', quantity: 1 },
        { category: 'CHILD', quantity: 2 },
      ]);
      const child = v.items.find((i) => i.guestCategory === 'CHILD')!;
      const res = await post(
        cashier.agent,
        `/visits/${v.id}/items/${child.id}/void`,
        { reason: 'Ошиблись в количестве' },
      ).expect(200);
      expect(res.body).toMatchObject({ total: '2000.00', guests: 1 });
      expect((await roomState(cashier.agent, room.id)).inside).toBe(1);
    });
  });

  describe('массовое «Завершить оплаченные»', () => {
    it('завершает только чеки без долга; неоплаченные остаются; повтор — 0', async () => {
      const room = await mkPublicRoom(owner.agent, 60);
      const paid1 = await mustStartPublic(cashier.agent, room.id);
      const paid2 = await mustStartPublic(cashier.agent, room.id, [
        { category: 'CHILD', quantity: 2 },
      ]);
      const unpaid = await mustStartPublic(cashier.agent, room.id);
      const partial = await mustStartPublic(cashier.agent, room.id);
      await pay(paid1).then((r) => expect(r.status).toBe(200));
      await pay(paid2).then((r) => expect(r.status).toBe(200));
      await post(cashier.agent, `/visits/${partial.id}/payments`, {
        method: 'CASH',
        amount: '500',
      }).expect(200);

      const res = await post(
        cashier.agent,
        `/rooms/${room.id}/complete-paid`,
      ).expect(200);
      expect(res.body).toEqual({ completed: 2 });

      expect((await getVisit(cashier.agent, paid1.id)).status).toBe(
        'COMPLETED',
      );
      expect((await getVisit(cashier.agent, paid2.id)).status).toBe(
        'COMPLETED',
      );
      expect((await getVisit(cashier.agent, unpaid.id)).status).toBe('ACTIVE');
      expect((await getVisit(cashier.agent, partial.id)).status).toBe('ACTIVE');
      expect((await roomState(cashier.agent, room.id)).inside).toBe(2);

      const again = await post(
        cashier.agent,
        `/rooms/${room.id}/complete-paid`,
      ).expect(200);
      expect(again.body).toEqual({ completed: 0 });
    });

    it('для PRIVATE-помещения недоступно → 422', async () => {
      const priv = await mkPrivateRoom(owner.agent);
      expect(
        (await post(cashier.agent, `/rooms/${priv.id}/complete-paid`)).status,
      ).toBe(422);
    });
  });

  describe('изоляция организаций', () => {
    it('чужой зал/чек недоступен: inside, complete-paid, вход, операции над чеком → 404', async () => {
      const room = await mkPublicRoom(owner.agent, 10);
      const v = await mustStartPublic(cashier.agent, room.id);

      await other.agent.get(`/rooms/${room.id}/inside`).expect(404);
      await other.agent.post(`/rooms/${room.id}/complete-paid`).expect(404);
      expect(
        (
          await other.agent.post('/visits/public').send({
            roomId: room.id,
            guests: [{ category: 'ADULT', quantity: 1 }],
          })
        ).status,
      ).toBe(404);
      await other.agent.get(`/visits/${v.id}`).expect(404);
      await other.agent
        .post(`/visits/${v.id}/guests`)
        .send({ guests: [{ category: 'ADULT', quantity: 1 }] })
        .expect(404);
      await other.agent
        .post(`/visits/${v.id}/payments`)
        .send({ method: 'CASH', amount: '1' })
        .expect(404);
      await other.agent.post(`/visits/${v.id}/complete`).send({}).expect(404);
      await other.agent
        .post(`/visits/${v.id}/cancel`)
        .send({ reason: 'x' })
        .expect(404);
      expect((await getVisit(cashier.agent, v.id)).status).toBe('ACTIVE');
    });
  });
});
