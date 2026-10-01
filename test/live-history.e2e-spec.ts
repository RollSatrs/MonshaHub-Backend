import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  Agent,
  board,
  cleanup,
  closeDb,
  createApp,
  createCashier,
  getClock,
  getVisit,
  mkPrivateRoom,
  mkProduct,
  mkPublicRoom,
  mkRoom,
  mustStartPrivate,
  mustStartPublic,
  payAndComplete,
  registerOwner,
  roomState,
  VisitBody,
} from './helpers';

interface HistoryBody {
  hasMore: boolean;
  items: {
    id: number;
    status: string;
    roomName: string;
    total: string;
    paid: string;
    voidedItemsCount: number;
    cancelReason: string | null;
    guests: number | null;
  }[];
}

describe('«Баня сейчас» и история (e2e)', () => {
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerOwner>>;
  let other: Awaited<ReturnType<typeof registerOwner>>;
  let cashier: { agent: Agent };
  const clock = () => getClock(app);
  const post = (
    agent: Agent,
    url: string,
    body: Record<string, unknown> = {},
  ) => agent.post(url).send(body);
  const history = async (agent: Agent, qs = '') =>
    (await agent.get(`/visits${qs}`).expect(200)).body as HistoryBody;

  beforeAll(async () => {
    app = await createApp();
    owner = await registerOwner(app, 'Live');
    other = await registerOwner(app, 'Other');
    cashier = await createCashier(owner, app);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await closeDb();
  });

  describe('«Баня сейчас»', () => {
    it('одновременно все состояния: AVAILABLE, OCCUPIED, ENDING_SOON, OVERTIME, CLEANING, OPEN/FULL', async () => {
      const suffix = Date.now();
      const available = await mkPrivateRoom(owner.agent, '10000', {
        name: `A-${suffix}`,
        sortOrder: 1,
      });
      const occupied = await mkPrivateRoom(owner.agent, '10000', {
        name: `O-${suffix}`,
        sortOrder: 2,
      });
      const ending = await mkPrivateRoom(owner.agent, '10000', {
        name: `E-${suffix}`,
        sortOrder: 3,
      });
      const overtime = await mkPrivateRoom(owner.agent, '10000', {
        name: `T-${suffix}`,
        sortOrder: 4,
      });
      const cleaning = await mkPrivateRoom(owner.agent, '10000', {
        name: `C-${suffix}`,
        sortOrder: 5,
      });
      const open = await mkPublicRoom(owner.agent, 60);
      const full = await mkPublicRoom(owner.agent, 2);

      // время: overtime стартует раньше всех, потом сдвигаем часы
      await mustStartPrivate(cashier.agent, overtime.id, 60);
      await mustStartPrivate(cashier.agent, ending.id, 120);
      clock().advanceMinutes(65); // overtime просрочен на 5; ending осталось 55
      const endingVisit = await mustStartPrivate(
        cashier.agent,
        occupied.id,
        120,
      );
      await mustStartPrivate(cashier.agent, cleaning.id, 60);
      const cleaningVisit = (await board(cashier.agent)).rooms.find(
        (r) => r.id === cleaning.id,
      )!.visit!;
      await payAndComplete(
        cashier.agent,
        await getVisit(cashier.agent, cleaningVisit.id),
      );
      clock().advanceMinutes(46); // ending (было 55, стало 9) → ENDING_SOON; occupied: осталось 74
      void endingVisit;

      await mustStartPublic(cashier.agent, open.id, [
        { category: 'ADULT', quantity: 3 },
      ]);
      await mustStartPublic(cashier.agent, full.id, [
        { category: 'ADULT', quantity: 2 },
      ]);

      const b = await board(cashier.agent);
      const byId = new Map(b.rooms.map((r) => [r.id, r]));
      expect(byId.get(available.id)!.state).toBe('AVAILABLE');
      expect(byId.get(occupied.id)!.state).toBe('OCCUPIED');
      expect(byId.get(ending.id)!.state).toBe('ENDING_SOON');
      expect(byId.get(overtime.id)!.state).toBe('OVERTIME');
      expect(byId.get(cleaning.id)!.state).toBe('CLEANING');
      expect(byId.get(open.id)).toMatchObject({
        state: 'OPEN',
        inside: 3,
        capacity: 60,
      });
      expect(byId.get(full.id)).toMatchObject({
        state: 'FULL',
        inside: 2,
        capacity: 2,
      });

      // порядок — по sortOrder, затем id
      const order = b.rooms.map((r) => r.id);
      expect(order.indexOf(available.id)).toBeLessThan(
        order.indexOf(occupied.id),
      );
      expect(order.indexOf(occupied.id)).toBeLessThan(
        order.indexOf(cleaning.id),
      );

      // общие поля
      expect(b).toMatchObject({
        endingSoonMinutes: 10,
        currency: 'KZT',
        timeStepMinutes: 60,
      });
      expect(b.serverTime).toBe(clock().now().toISOString());
    });

    it('в карточке занятого помещения актуальные итог и оплата от backend', async () => {
      const room = await mkPrivateRoom(owner.agent, '10000');
      const product = await mkProduct(owner.agent, { price: '2500', stock: 5 });
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      expect((await roomState(cashier.agent, room.id)).visit).toMatchObject({
        id: v.id,
        total: '10000.00',
        paid: '0.00',
        balance: '10000.00',
        paymentStatus: 'UNPAID',
      });

      await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: product.id,
        quantity: 2,
      }).expect(200);
      await post(cashier.agent, `/visits/${v.id}/payments`, {
        method: 'CASH',
        amount: '5000',
      }).expect(200);
      expect((await roomState(cashier.agent, room.id)).visit).toMatchObject({
        total: '15000.00',
        paid: '5000.00',
        balance: '10000.00',
        paymentStatus: 'PARTIAL',
      });
    });

    it('ближайшая бронь и availableMinutes; помещение без тарифа помечено hasTariff=false; архивные скрыты', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const noTariff = await mkRoom(owner.agent, { type: 'PRIVATE' });
      const archived = await mkPrivateRoom(owner.agent);
      await owner.agent
        .patch(`/rooms/${archived.id}`)
        .send({ active: false })
        .expect(200);
      const startsAt = new Date(
        clock().now().getTime() + 90 * 60_000,
      ).toISOString();
      await cashier.agent
        .post('/bookings')
        .send({
          roomId: room.id,
          customerName: 'Гость',
          customerPhone: '+7 700 111 22 33',
          startsAt,
          durationMinutes: 60,
        })
        .expect(201);

      const b = await board(cashier.agent);
      const r = b.rooms.find((x) => x.id === room.id)!;
      expect(r.state).toBe('AVAILABLE');
      expect(r.nextBooking).toMatchObject({ startsAt });
      expect(r.availableMinutes).toBe(90);
      expect(b.rooms.find((x) => x.id === noTariff.id)!.hasTariff).toBe(false);
      expect(r.hasTariff).toBe(true);
      expect(b.rooms.some((x) => x.id === archived.id)).toBe(false);
    });

    it('tenant isolation: организация видит только свои помещения', async () => {
      const foreign = await mkPrivateRoom(other.agent);
      const mine = await board(cashier.agent);
      expect(mine.rooms.some((r) => r.id === foreign.id)).toBe(false);
      const theirs = await board(other.agent);
      expect(theirs.rooms.map((r) => r.id)).toEqual([foreign.id]);
    });

    it('без аутентификации закрыто', async () => {
      await request(app.getHttpServer()).get('/live/board').expect(401);
    });
  });

  describe('история', () => {
    let completed: VisitBody;
    let cancelled: VisitBody;
    let roomName: string;

    it('OWNER видит завершённые и отменённые: итоги, оплату, количество убранных позиций, причину отмены', async () => {
      const room = await mkPrivateRoom(owner.agent, '10000', {
        name: `H-${Date.now()}`,
      });
      roomName = room.name;
      const product = await mkProduct(owner.agent, {
        price: '1000',
        stock: 10,
      });

      const a = await mustStartPrivate(cashier.agent, room.id, 60);
      const withItem = (
        await post(cashier.agent, `/visits/${a.id}/products`, {
          productId: product.id,
          quantity: 2,
        }).expect(200)
      ).body as VisitBody;
      const item = withItem.items.find((i) => i.kind === 'PRODUCT')!;
      await post(cashier.agent, `/visits/${a.id}/items/${item.id}/void`, {
        reason: 'Ошибка кассира',
      }).expect(200);
      completed = await payAndComplete(
        cashier.agent,
        await getVisit(cashier.agent, a.id),
      ).then((r) => r.body as VisitBody);
      await post(cashier.agent, `/rooms/${room.id}/finish-cleaning`).expect(
        200,
      );

      const b = await mustStartPrivate(cashier.agent, room.id, 60);
      cancelled = (
        await post(cashier.agent, `/visits/${b.id}/cancel`, {
          reason: 'Начали по ошибке',
        }).expect(200)
      ).body as VisitBody;

      const list = await history(owner.agent, `?roomId=${room.id}`);
      expect(list.hasMore).toBe(false);
      const done = list.items.find((i) => i.id === completed.id)!;
      const canc = list.items.find((i) => i.id === cancelled.id)!;
      expect(done).toMatchObject({
        status: 'COMPLETED',
        total: '10000.00',
        paid: '10000.00',
        voidedItemsCount: 1,
      });
      expect(canc).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Начали по ошибке',
        paid: '0.00',
      });

      // фильтр по статусу
      const onlyCancelled = await history(
        owner.agent,
        `?roomId=${room.id}&status=CANCELLED`,
      );
      expect(onlyCancelled.items.map((i) => i.id)).toEqual([cancelled.id]);
      // OWNER видит в посещении, кто и почему убрал позицию
      const detail = await getVisit(owner.agent, completed.id);
      const voided = detail.items.find((i) => i.voided)!;
      expect(voided).toMatchObject({
        voidReason: 'Ошибка кассира',
        voidedByName: 'Cashier',
      });
      const cancelDetail = await getVisit(owner.agent, cancelled.id);
      expect(cancelDetail).toMatchObject({
        cancelReason: 'Начали по ошибке',
        cancelledByName: 'Cashier',
      });
    });

    it('активные посещения не попадают в историю; status=ACTIVE возвращает их', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const hist = await history(owner.agent, `?roomId=${room.id}`);
      expect(hist.items).toHaveLength(0);
      const active = await history(
        owner.agent,
        `?roomId=${room.id}&status=ACTIVE`,
      );
      expect(active.items.map((i) => i.id)).toEqual([v.id]);
    });

    it('пагинация: limit/offset/hasMore, порядок от новых к старым', async () => {
      const room = await mkPublicRoom(owner.agent, 100);
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        const v = await mustStartPublic(cashier.agent, room.id);
        await payAndComplete(cashier.agent, v);
        ids.push(v.id);
        clock().advanceMinutes(1);
      }
      const page1 = await history(owner.agent, `?roomId=${room.id}&limit=2`);
      expect(page1.items.map((i) => i.id)).toEqual([ids[4], ids[3]]);
      expect(page1.hasMore).toBe(true);
      const page3 = await history(
        owner.agent,
        `?roomId=${room.id}&limit=2&offset=4`,
      );
      expect(page3.items.map((i) => i.id)).toEqual([ids[0]]);
      expect(page3.hasMore).toBe(false);
      expect(page1.items[0].guests).toBe(1);
      expect((await owner.agent.get('/visits?limit=0')).status).toBe(400);
      expect((await owner.agent.get('/visits?limit=201')).status).toBe(400);
    });

    it('CASHIER видит только последние 24 часа; OWNER — всё; детали старого посещения кассиру недоступны', async () => {
      const room = await mkPublicRoom(owner.agent, 50);
      const v = await mustStartPublic(cashier.agent, room.id);
      await payAndComplete(cashier.agent, v);

      expect(
        (await history(cashier.agent, `?roomId=${room.id}`)).items.map(
          (i) => i.id,
        ),
      ).toEqual([v.id]);
      await cashier.agent.get(`/visits/${v.id}`).expect(200);

      clock().advanceMinutes(25 * 60);
      expect(
        (await history(cashier.agent, `?roomId=${room.id}`)).items,
      ).toHaveLength(0);
      // cashier не обходит ограничение параметром from
      const longAgo = encodeURIComponent(
        new Date(clock().now().getTime() - 72 * 3600_000).toISOString(),
      );
      expect(
        (await history(cashier.agent, `?roomId=${room.id}&from=${longAgo}`))
          .items,
      ).toHaveLength(0);
      await cashier.agent.get(`/visits/${v.id}`).expect(404);

      expect(
        (await history(owner.agent, `?roomId=${room.id}`)).items.map(
          (i) => i.id,
        ),
      ).toEqual([v.id]);
      await owner.agent.get(`/visits/${v.id}`).expect(200);
    });

    it('tenant isolation: история и детали другой организации недоступны', async () => {
      const list = await history(other.agent);
      expect(list.items.some((i) => i.roomName === roomName)).toBe(false);
      await other.agent.get(`/visits/${completed.id}`).expect(404);
      await other.agent.get(`/visits/${cancelled.id}`).expect(404);
    });
  });

  describe('операции над чужим посещением → 404', () => {
    it('все мутации чужого PRIVATE-посещения недоступны и ничего не меняют', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const product = await mkProduct(owner.agent, { stock: 3 });
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const foreignProduct = await mkProduct(other.agent, { stock: 3 });

      const attempts: [string, Record<string, unknown>][] = [
        [
          `/visits/${v.id}/products`,
          { productId: foreignProduct.id, quantity: 1 },
        ],
        [`/visits/${v.id}/services`, { serviceId: 1, quantity: 1 }],
        [`/visits/${v.id}/extend`, { minutes: 60 }],
        [`/visits/${v.id}/items/${v.items[0].id}/void`, { reason: 'x' }],
        [`/visits/${v.id}/payments`, { method: 'CASH', amount: '1' }],
        [`/visits/${v.id}/complete`, {}],
        [`/visits/${v.id}/cancel`, { reason: 'x' }],
        [`/rooms/${room.id}/finish-cleaning`, {}],
      ];
      for (const [url, body] of attempts) {
        expect((await post(other.agent, url, body)).status).toBe(404);
      }
      // и свой посещение с чужим товаром — тоже 404
      expect(
        (
          await post(cashier.agent, `/visits/${v.id}/products`, {
            productId: foreignProduct.id,
            quantity: 1,
          })
        ).status,
      ).toBe(404);
      const after = await getVisit(cashier.agent, v.id);
      expect(after).toMatchObject({
        status: 'ACTIVE',
        total: '10000.00',
        paid: '0.00',
      });
      void product;
    });
  });
});
