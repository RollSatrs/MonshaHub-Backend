import { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src';
import { uniqueViolation } from '../src/common/db-errors';
import {
  stockMovementsTable,
  visitItemsTable,
  visitsTable,
} from '../src/db/schema';
import {
  Agent,
  cleanup,
  closeDb,
  createApp,
  createCashier,
  ErrorBody,
  getClock,
  getVisit,
  mkPrivateRoom,
  mkProduct,
  mkRoom,
  mustStartPrivate,
  payAndComplete,
  ProductBody,
  registerOwner,
  roomState,
  startPrivate,
  uniqueName,
  VisitBody,
} from './helpers';

describe('PRIVATE Visit (e2e)', () => {
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerOwner>>;
  let cashier: { agent: Agent };
  const clock = () => getClock(app);

  const ownerAgent = () => owner.agent;
  const post = (
    agent: Agent,
    url: string,
    body: Record<string, unknown> = {},
  ) => agent.post(url).send(body);
  const err = (res: { body: unknown }) => res.body as ErrorBody;

  const stockOf = async (productId: number) =>
    (await ownerAgent().get(`/products/${productId}`).expect(200))
      .body as ProductBody;

  beforeAll(async () => {
    app = await createApp();
    owner = await registerOwner(app, 'Visits');
    cashier = await createCashier(owner, app);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await closeDb();
  });

  describe('старт и итог', () => {
    it('старт: оплаченная длительность, ROOM_TIME со snapshot, итог = ставка × часы', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000', {
        name: 'VIP №1',
      });
      const v = await mustStartPrivate(cashier.agent, room.id, 120, {
        customerName: 'Иван',
        customerPhone: '+7 701 123 45 67',
      });

      expect(v).toMatchObject({
        kind: 'PRIVATE',
        status: 'ACTIVE',
        roomName: 'VIP №1',
        customerName: 'Иван',
        hourlyRate: '10000.00',
        timeStepMinutes: 60,
        currency: 'KZT',
        total: '20000.00',
        paid: '0.00',
        balance: '20000.00',
        paymentStatus: 'UNPAID',
        timeState: 'OCCUPIED',
      });
      expect(v.items).toHaveLength(1);
      expect(v.items[0]).toMatchObject({
        kind: 'ROOM_TIME',
        minutes: 120,
        lineTotal: '20000.00',
      });
      expect(
        new Date(v.endsAt!).getTime() - new Date(v.startedAt).getTime(),
      ).toBe(120 * 60_000);
      expect(v.remainingSeconds).toBe(7200);
    });

    it('длительность должна быть кратна шагу организации; шаг настраивает OWNER', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '12345.67');
      for (const bad of [0, -60, 45, 90 + 1, 1441, 2000]) {
        const res = await startPrivate(cashier.agent, room.id, bad);
        expect(res.status).toBe(400);
        expect(err(res).code).toBe('VALIDATION_ERROR');
      }
      await cashier.agent
        .patch('/organization')
        .send({ timeStepMinutes: 30 })
        .expect(403);
      await ownerAgent()
        .patch('/organization')
        .send({ timeStepMinutes: 20 })
        .expect(400);

      await ownerAgent()
        .patch('/organization')
        .send({ timeStepMinutes: 30 })
        .expect(200);
      try {
        // 30 минут при ставке 12345.67 → 6172.835 → half-up = 6172.84
        const v = await mustStartPrivate(cashier.agent, room.id, 30);
        expect(v.timeStepMinutes).toBe(30);
        expect(v.total).toBe('6172.84');
        // 45 мин не кратно 30
        const room2 = await mkPrivateRoom(ownerAgent(), '10000');
        expect((await startPrivate(cashier.agent, room2.id, 45)).status).toBe(
          400,
        );
      } finally {
        await ownerAgent()
          .patch('/organization')
          .send({ timeStepMinutes: 60 })
          .expect(200);
      }
    });

    it('смена шага не меняет уже начатое посещение (snapshot шага)', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      await ownerAgent()
        .patch('/organization')
        .send({ timeStepMinutes: 15 })
        .expect(200);
      try {
        expect((await getVisit(cashier.agent, v.id)).timeStepMinutes).toBe(60);
        // продление по шагу посещения (60), а не организации (15)
        const res = await post(cashier.agent, `/visits/${v.id}/extend`, {
          minutes: 15,
        });
        expect(res.status).toBe(400);
      } finally {
        await ownerAgent()
          .patch('/organization')
          .send({ timeStepMinutes: 60 })
          .expect(200);
      }
    });

    it('нет тарифа → 409 TARIFF_NOT_CONFIGURED; PUBLIC-зал → 422; архивное → 409', async () => {
      const noTariff = await mkRoom(ownerAgent(), { type: 'PRIVATE' });
      const r1 = await startPrivate(cashier.agent, noTariff.id, 60);
      expect(r1.status).toBe(409);
      expect(err(r1).code).toBe('TARIFF_NOT_CONFIGURED');

      const pub = await mkRoom(ownerAgent(), { type: 'PUBLIC', capacity: 10 });
      const r2 = await startPrivate(cashier.agent, pub.id, 60);
      expect(r2.status).toBe(422);
      expect(err(r2).code).toBe('ROOM_TYPE_MISMATCH');

      const archived = await mkPrivateRoom(ownerAgent());
      await ownerAgent()
        .patch(`/rooms/${archived.id}`)
        .send({ active: false })
        .expect(200);
      const r3 = await startPrivate(cashier.agent, archived.id, 60);
      expect(r3.status).toBe(409);
      expect(err(r3).code).toBe('ROOM_NOT_AVAILABLE');
    });

    it('в занятом помещении второй старт → 409 ROOM_NOT_AVAILABLE', async () => {
      const room = await mkPrivateRoom(ownerAgent());
      await mustStartPrivate(cashier.agent, room.id, 60);
      const res = await startPrivate(cashier.agent, room.id, 60);
      expect(res.status).toBe(409);
      expect(err(res).code).toBe('ROOM_NOT_AVAILABLE');
    });

    it('12 параллельных стартов одного помещения → ровно один успех', async () => {
      const room = await mkPrivateRoom(ownerAgent());
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          startPrivate(cashier.agent, room.id, 60),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const failed = results.filter((r) => r.status !== 201);
      expect(failed).toHaveLength(11);
      failed.forEach((r) => {
        expect(r.status).toBe(409);
        expect(err(r).code).toBe('ROOM_NOT_AVAILABLE');
      });
      const rows = await db
        .select()
        .from(visitsTable)
        .where(eq(visitsTable.roomId, room.id));
      expect(rows).toHaveLength(1);
      const items = await db
        .select()
        .from(visitItemsTable)
        .where(eq(visitItemsTable.visitId, rows[0].id));
      expect(items).toHaveLength(1);
    });

    it('DB-инвариант: два ACTIVE PRIVATE в одном помещении невозможны даже в обход сервиса', async () => {
      const room = await mkPrivateRoom(ownerAgent());
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const [row] = await db
        .select()
        .from(visitsTable)
        .where(eq(visitsTable.id, v.id));
      const { id: _id, ...copy } = row;
      void _id;
      const failure: unknown = await db
        .insert(visitsTable)
        .values(copy)
        .then(() => null)
        .catch((e: unknown) => e);
      expect(uniqueViolation(failure)).toBe(
        'visits_active_private_room_unique',
      );
    });
  });

  describe('вычисляемые состояния (управляемые часы)', () => {
    it('OCCUPIED → ENDING_SOON → OVERTIME → (продление) → снова идёт', async () => {
      const room = await mkPrivateRoom(ownerAgent());
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      expect((await roomState(cashier.agent, room.id)).state).toBe('OCCUPIED');

      clock().advanceMinutes(49);
      expect((await roomState(cashier.agent, room.id)).state).toBe('OCCUPIED'); // осталось 11 мин
      clock().advanceMinutes(1);
      expect((await roomState(cashier.agent, room.id)).state).toBe(
        'ENDING_SOON',
      ); // осталось 10 мин
      expect((await getVisit(cashier.agent, v.id)).timeState).toBe(
        'ENDING_SOON',
      );

      clock().advanceMinutes(10);
      expect((await roomState(cashier.agent, room.id)).state).toBe(
        'ENDING_SOON',
      ); // ровно 0
      clock().advanceMinutes(1);
      const overtime = await roomState(cashier.agent, room.id);
      expect(overtime.state).toBe('OVERTIME');
      expect((await getVisit(cashier.agent, v.id)).remainingSeconds).toBe(-60);

      // просрочка не начисляет денег автоматически
      expect((await getVisit(cashier.agent, v.id)).total).toBe('10000.00');

      // продление считается от прежнего конца (задним числом) и оплачивается
      const ext = await post(cashier.agent, `/visits/${v.id}/extend`, {
        minutes: 60,
      }).expect(200);
      const extended = ext.body as VisitBody;
      expect(extended.total).toBe('20000.00');
      expect(
        new Date(extended.endsAt!).getTime() - new Date(v.startedAt).getTime(),
      ).toBe(120 * 60_000);
      // теперь до конца ~59 минут
      expect((await roomState(cashier.agent, room.id)).state).toBe('OCCUPIED');
    });
  });

  describe('товары и услуги', () => {
    it('товар: позиция + остаток − количество + SALE-движение; итог пересчитан backend', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const product = await mkProduct(ownerAgent(), {
        name: uniqueName('Веник'),
        price: '2500',
        stock: 10,
      });
      const v = await mustStartPrivate(cashier.agent, room.id, 60);

      const res = await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: product.id,
        quantity: 2,
      }).expect(200);
      const body = res.body as VisitBody;
      expect(body.total).toBe('15000.00');
      const item = body.items.find((i) => i.kind === 'PRODUCT')!;
      expect(item).toMatchObject({
        name: product.name,
        unitPrice: '2500.00',
        quantity: 2,
        lineTotal: '5000.00',
      });

      expect((await stockOf(product.id)).stock).toBe(8);
      const movements = await db
        .select()
        .from(stockMovementsTable)
        .where(eq(stockMovementsTable.visitItemId, item.id));
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: 'SALE',
        quantityDelta: -2,
        balanceAfter: 8,
      });
    });

    it('недостаточно остатка → 409, откат ВСЕГО: нет позиции, нет движения, остаток и итог прежние', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const product = await mkProduct(ownerAgent(), {
        price: '1500',
        stock: 2,
      });
      const v = await mustStartPrivate(cashier.agent, room.id, 60);

      const res = await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: product.id,
        quantity: 3,
      });
      expect(res.status).toBe(409);
      expect(err(res).code).toBe('INSUFFICIENT_STOCK');

      const after = await getVisit(cashier.agent, v.id);
      expect(after.items.filter((i) => i.kind === 'PRODUCT')).toHaveLength(0);
      expect(after.total).toBe('10000.00');
      expect((await stockOf(product.id)).stock).toBe(2);
      const sales = await db
        .select()
        .from(stockMovementsTable)
        .where(eq(stockMovementsTable.productId, product.id));
      expect(sales).toHaveLength(1); // только начальный RESTOCK
      const items = await db
        .select()
        .from(visitItemsTable)
        .where(eq(visitItemsTable.visitId, v.id));
      expect(items).toHaveLength(1);
    });

    it('параллельная продажа последнего товара из 5 посещений → ровно одна успешная', async () => {
      const product = await mkProduct(ownerAgent(), { price: '500', stock: 1 });
      const visits: VisitBody[] = [];
      for (let i = 0; i < 5; i++) {
        const room = await mkPrivateRoom(ownerAgent());
        visits.push(await mustStartPrivate(cashier.agent, room.id, 60));
      }
      const results = await Promise.all(
        visits.map((v) =>
          post(cashier.agent, `/visits/${v.id}/products`, {
            productId: product.id,
            quantity: 1,
          }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const failed = results.filter((r) => r.status !== 200);
      expect(failed).toHaveLength(4);
      failed.forEach((r) => expect(err(r).code).toBe('INSUFFICIENT_STOCK'));

      expect((await stockOf(product.id)).stock).toBe(0);
      const sales = await db
        .select()
        .from(stockMovementsTable)
        .where(eq(stockMovementsTable.productId, product.id));
      expect(sales.filter((m) => m.type === 'SALE')).toHaveLength(1);
      // и ровно у одного посещения появилась позиция
      let withItem = 0;
      for (const v of visits) {
        if (
          (await getVisit(cashier.agent, v.id)).items.some(
            (i) => i.kind === 'PRODUCT',
          )
        )
          withItem += 1;
      }
      expect(withItem).toBe(1);
    });

    it('архивный товар и услуга нельзя добавить; несуществующие/чужие → 404', async () => {
      const room = await mkPrivateRoom(ownerAgent());
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const product = await mkProduct(ownerAgent(), { stock: 5 });
      await ownerAgent()
        .patch(`/products/${product.id}`)
        .send({ active: false })
        .expect(200);
      const r1 = await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: product.id,
        quantity: 1,
      });
      expect(r1.status).toBe(409);
      expect(err(r1).code).toBe('PRODUCT_NOT_AVAILABLE');
      expect((await stockOf(product.id)).stock).toBe(5);

      const service = (
        await ownerAgent()
          .post('/services')
          .send({ name: uniqueName('Массаж'), price: '5000' })
          .expect(201)
      ).body as { id: number };
      await ownerAgent()
        .patch(`/services/${service.id}`)
        .send({ active: false })
        .expect(200);
      const r2 = await post(cashier.agent, `/visits/${v.id}/services`, {
        serviceId: service.id,
        quantity: 1,
      });
      expect(r2.status).toBe(409);
      expect(err(r2).code).toBe('SERVICE_NOT_AVAILABLE');

      await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: 999999,
        quantity: 1,
      }).expect(404);
      await post(cashier.agent, `/visits/${v.id}/services`, {
        serviceId: 999999,
        quantity: 1,
      }).expect(404);
    });

    it('услуга: позиция без складского движения; валидация количества', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const service = (
        await ownerAgent()
          .post('/services')
          .send({ name: uniqueName('Парение'), price: '3000' })
          .expect(201)
      ).body as { id: number; name: string };
      const res = await post(cashier.agent, `/visits/${v.id}/services`, {
        serviceId: service.id,
        quantity: 2,
      }).expect(200);
      const body = res.body as VisitBody;
      expect(body.total).toBe('16000.00');
      const item = body.items.find((i) => i.kind === 'SERVICE')!;
      expect(item).toMatchObject({
        name: service.name,
        unitPrice: '3000.00',
        quantity: 2,
        lineTotal: '6000.00',
      });
      const movements = await db
        .select()
        .from(stockMovementsTable)
        .where(eq(stockMovementsTable.visitItemId, item.id));
      expect(movements).toHaveLength(0);

      for (const q of [0, -1, 1.5, 1001]) {
        expect(
          (
            await post(cashier.agent, `/visits/${v.id}/services`, {
              serviceId: service.id,
              quantity: q,
            })
          ).status,
        ).toBe(400);
      }
    });

    it('итоги считаются точно: 19.99 × 3 + час + услуга, без float-ошибок', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '12345.67');
      const product = await mkProduct(ownerAgent(), {
        price: '19.99',
        stock: 10,
      });
      const service = (
        await ownerAgent()
          .post('/services')
          .send({ name: uniqueName('S'), price: '0.10' })
          .expect(201)
      ).body as { id: number };
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: product.id,
        quantity: 3,
      }).expect(200);
      const res = await post(cashier.agent, `/visits/${v.id}/services`, {
        serviceId: service.id,
        quantity: 3,
      }).expect(200);
      // 12345.67 + 59.97 + 0.30
      expect((res.body as VisitBody).total).toBe('12405.94');
    });
  });

  describe('snapshot: история не меняется после правки каталога', () => {
    it('смена цены/названия товара, услуги, тарифа и помещения не влияет на существующий чек', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000', {
        name: uniqueName('Snap'),
      });
      const product = await mkProduct(ownerAgent(), {
        name: uniqueName('Чай'),
        price: '1500',
        stock: 10,
      });
      const service = (
        await ownerAgent()
          .post('/services')
          .send({ name: uniqueName('Массаж'), price: '5000' })
          .expect(201)
      ).body as { id: number };
      const v = await mustStartPrivate(cashier.agent, room.id, 120);
      await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: product.id,
        quantity: 2,
      }).expect(200);
      await post(cashier.agent, `/visits/${v.id}/services`, {
        serviceId: service.id,
        quantity: 1,
      }).expect(200);
      const before = await getVisit(cashier.agent, v.id);

      const tariff = (
        await ownerAgent().get(`/tariffs?roomId=${room.id}`).expect(200)
      ).body as { id: number }[];
      await ownerAgent()
        .patch(`/tariffs/${tariff[0].id}`)
        .send({ price: '99999', name: 'Новый' })
        .expect(200);
      await ownerAgent()
        .patch(`/products/${product.id}`)
        .send({ price: '9999', name: 'Переименован' })
        .expect(200);
      await ownerAgent()
        .patch(`/services/${service.id}`)
        .send({ price: '8888', name: 'Другая' })
        .expect(200);
      await ownerAgent()
        .patch(`/rooms/${room.id}`)
        .send({ name: uniqueName('Переименованная') })
        .expect(200);

      const after = await getVisit(cashier.agent, v.id);
      expect(after.total).toBe(before.total);
      expect(after.roomName).toBe(before.roomName);
      expect(after.hourlyRate).toBe('10000.00');
      expect(
        after.items.map((i) => [i.name, i.unitPrice, i.lineTotal]),
      ).toEqual(before.items.map((i) => [i.name, i.unitPrice, i.lineTotal]));

      // продление идёт по ставке, зафиксированной в посещении, а не по новой цене тарифа
      const ext = await post(cashier.agent, `/visits/${v.id}/extend`, {
        minutes: 60,
      }).expect(200);
      expect((ext.body as VisitBody).total).toBe(
        // было 20000 + 3000 + 5000, продление +10000 по старой ставке
        '38000.00',
      );
    });
  });

  describe('продление', () => {
    it('добавляет позицию ROOM_TIME, двигает endsAt, пересчитывает итог; кратность шагу', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      for (const bad of [0, 30, 61, -60]) {
        expect(
          (
            await post(cashier.agent, `/visits/${v.id}/extend`, {
              minutes: bad,
            })
          ).status,
        ).toBe(400);
      }
      const res = await post(cashier.agent, `/visits/${v.id}/extend`, {
        minutes: 120,
      }).expect(200);
      const body = res.body as VisitBody;
      expect(body.total).toBe('30000.00');
      expect(body.items.filter((i) => i.kind === 'ROOM_TIME')).toHaveLength(2);
      expect(
        new Date(body.endsAt!).getTime() - new Date(v.startedAt).getTime(),
      ).toBe(180 * 60_000);
    });
  });

  describe('исправление позиций', () => {
    it('void товара: возврат на склад (SALE_RETURN), итог уменьшился, сохранены кто/когда/причина', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const product = await mkProduct(ownerAgent(), {
        price: '2500',
        stock: 10,
      });
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const withItem = (
        await post(cashier.agent, `/visits/${v.id}/products`, {
          productId: product.id,
          quantity: 3,
        }).expect(200)
      ).body as VisitBody;
      const item = withItem.items.find((i) => i.kind === 'PRODUCT')!;
      expect((await stockOf(product.id)).stock).toBe(7);

      // причина обязательна
      expect(
        (await post(cashier.agent, `/visits/${v.id}/items/${item.id}/void`, {}))
          .status,
      ).toBe(400);
      expect(
        (
          await post(cashier.agent, `/visits/${v.id}/items/${item.id}/void`, {
            reason: '  ',
          })
        ).status,
      ).toBe(400);

      const res = await post(
        cashier.agent,
        `/visits/${v.id}/items/${item.id}/void`,
        {
          reason: 'Добавили по ошибке',
        },
      ).expect(200);
      const body = res.body as VisitBody;
      expect(body.total).toBe('10000.00');
      const voided = body.items.find((i) => i.id === item.id)!;
      expect(voided).toMatchObject({
        voided: true,
        voidReason: 'Добавили по ошибке',
        voidedByName: 'Cashier',
      });

      expect((await stockOf(product.id)).stock).toBe(10);
      const movements = await db
        .select()
        .from(stockMovementsTable)
        .where(eq(stockMovementsTable.visitItemId, item.id));
      expect(movements.map((m) => m.type).sort()).toEqual([
        'SALE',
        'SALE_RETURN',
      ]);
      // повторно убрать нельзя — и остаток не задваивается
      const again = await post(
        cashier.agent,
        `/visits/${v.id}/items/${item.id}/void`,
        { reason: 'ещё раз' },
      );
      expect(again.status).toBe(409);
      expect((await stockOf(product.id)).stock).toBe(10);
    });

    it('время помещения убрать нельзя; чужая/несуществующая позиция → 404', async () => {
      const room = await mkPrivateRoom(ownerAgent());
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const roomTime = v.items[0];
      const res = await post(
        cashier.agent,
        `/visits/${v.id}/items/${roomTime.id}/void`,
        { reason: 'x' },
      );
      expect(res.status).toBe(409);
      expect(err(res).code).toBe('ITEM_NOT_VOIDABLE');
      await post(cashier.agent, `/visits/${v.id}/items/999999/void`, {
        reason: 'x',
      }).expect(404);
    });

    it('оплаченную позицию убрать нельзя (после удаления оплата превысила бы итог)', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '1000');
      const service = (
        await ownerAgent()
          .post('/services')
          .send({ name: uniqueName('S'), price: '500' })
          .expect(201)
      ).body as { id: number };
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const withItem = (
        await post(cashier.agent, `/visits/${v.id}/services`, {
          serviceId: service.id,
          quantity: 1,
        }).expect(200)
      ).body as VisitBody;
      await post(cashier.agent, `/visits/${v.id}/payments`, {
        method: 'CASH',
        amount: '1500',
      }).expect(200);
      const item = withItem.items.find((i) => i.kind === 'SERVICE')!;
      const res = await post(
        cashier.agent,
        `/visits/${v.id}/items/${item.id}/void`,
        { reason: 'oops' },
      );
      expect(res.status).toBe(409);
      expect(err(res).code).toBe('ITEM_ALREADY_PAID');
    });
  });

  describe('оплата и завершение', () => {
    it('несколько платежей, статусы UNPAID → PARTIAL → PAID; переплата → 409', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      expect(v.paymentStatus).toBe('UNPAID');

      const p1 = (
        await post(cashier.agent, `/visits/${v.id}/payments`, {
          method: 'CASH',
          amount: '4000',
        }).expect(200)
      ).body as VisitBody;
      expect(p1).toMatchObject({
        paid: '4000.00',
        balance: '6000.00',
        paymentStatus: 'PARTIAL',
      });

      const over = await post(cashier.agent, `/visits/${v.id}/payments`, {
        method: 'CARD',
        amount: '6000.01',
      });
      expect(over.status).toBe(409);
      expect(err(over).code).toBe('PAYMENT_EXCEEDS_BALANCE');

      const p2 = (
        await post(cashier.agent, `/visits/${v.id}/payments`, {
          method: 'KASPI',
          amount: '6000',
        }).expect(200)
      ).body as VisitBody;
      expect(p2).toMatchObject({
        paid: '10000.00',
        balance: '0.00',
        paymentStatus: 'PAID',
      });
      expect(p2.payments.map((p) => p.method)).toEqual(['CASH', 'KASPI']);

      // ещё платёж — уже нечем платить
      expect(
        (
          await post(cashier.agent, `/visits/${v.id}/payments`, {
            method: 'OTHER',
            amount: '0.01',
          })
        ).status,
      ).toBe(409);
    });

    it('валидация платежа: метод, формат и положительная сумма', async () => {
      const room = await mkPrivateRoom(ownerAgent());
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      for (const bad of [
        { method: 'BITCOIN', amount: '100' },
        { method: 'CASH', amount: '-1' },
        { method: 'CASH', amount: '0' },
        { method: 'CASH', amount: '1.234' },
        { method: 'CASH', amount: 100 },
        { method: 'CASH' },
        { method: 'CASH', amount: '100', extra: 1 },
      ]) {
        const res = await post(cashier.agent, `/visits/${v.id}/payments`, bad);
        expect(res.status).toBe(400);
      }
      expect((await getVisit(cashier.agent, v.id)).paid).toBe('0.00');
    });

    it('завершить без оплаты нельзя → 409 VISIT_NOT_PAID; неполные платежи в complete откатываются целиком', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60);

      const r1 = await post(cashier.agent, `/visits/${v.id}/complete`, {});
      expect(r1.status).toBe(409);
      expect(err(r1).code).toBe('VISIT_NOT_PAID');
      expect(r1.body).toMatchObject({
        meta: { total: '10000.00', paid: '0.00', balance: '10000.00' },
      });

      const r2 = await post(cashier.agent, `/visits/${v.id}/complete`, {
        payments: [{ method: 'CASH', amount: '3000' }],
      });
      expect(r2.status).toBe(409);
      // платёж 3000 из неудачного complete НЕ сохранён
      const after = await getVisit(cashier.agent, v.id);
      expect(after).toMatchObject({ status: 'ACTIVE', paid: '0.00' });
      expect(after.payments).toHaveLength(0);
    });

    it('«Оплатить и завершить»: платежи + завершение одной операцией; помещение → CLEANING', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      clock().advanceMinutes(30);
      const res = await post(cashier.agent, `/visits/${v.id}/complete`, {
        payments: [
          { method: 'CASH', amount: '6000' },
          { method: 'CARD', amount: '4000' },
        ],
      }).expect(200);
      const done = res.body as VisitBody;
      expect(done).toMatchObject({
        status: 'COMPLETED',
        paid: '10000.00',
        balance: '0.00',
        paymentStatus: 'PAID',
      });
      expect(
        new Date(done.endedAt!).getTime() - new Date(v.startedAt).getTime(),
      ).toBe(30 * 60_000);
      expect(done.payments).toHaveLength(2);
      expect((await roomState(cashier.agent, room.id)).state).toBe('CLEANING');
    });

    it('завершение предоплаченного посещения без тела (payments не нужны)', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      await post(cashier.agent, `/visits/${v.id}/payments`, {
        method: 'CASH',
        amount: '10000',
      }).expect(200);
      const res = await post(
        cashier.agent,
        `/visits/${v.id}/complete`,
        {},
      ).expect(200);
      expect((res.body as VisitBody).status).toBe('COMPLETED');
    });
  });

  describe('завершённое посещение неизменяемо', () => {
    it('любая мутация → 409 VISIT_ALREADY_COMPLETED, данные не меняются', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const product = await mkProduct(ownerAgent(), { stock: 5 });
      const service = (
        await ownerAgent()
          .post('/services')
          .send({ name: uniqueName('S'), price: '100' })
          .expect(201)
      ).body as { id: number };
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const done = await payAndComplete(cashier.agent, v).then(
        (r) => r.body as VisitBody,
      );
      expect(done.status).toBe('COMPLETED');
      const snapshot = JSON.stringify(await getVisit(cashier.agent, v.id));

      const attempts: [string, Record<string, unknown>][] = [
        [`/visits/${v.id}/products`, { productId: product.id, quantity: 1 }],
        [`/visits/${v.id}/services`, { serviceId: service.id, quantity: 1 }],
        [`/visits/${v.id}/extend`, { minutes: 60 }],
        [`/visits/${v.id}/items/${v.items[0].id}/void`, { reason: 'x' }],
        [`/visits/${v.id}/payments`, { method: 'CASH', amount: '1' }],
        [`/visits/${v.id}/complete`, {}],
        [`/visits/${v.id}/cancel`, { reason: 'x' }],
      ];
      for (const [url, body] of attempts) {
        const res = await post(cashier.agent, url, body);
        expect(res.status).toBe(409);
        expect(err(res).code).toBe('VISIT_ALREADY_COMPLETED');
      }
      expect(JSON.stringify(await getVisit(cashier.agent, v.id))).toBe(
        snapshot,
      );
      expect((await stockOf(product.id)).stock).toBe(5);
    });
  });

  describe('уборка', () => {
    it('COMPLETED → CLEANING → (нельзя начать) → «Уборка завершена» → AVAILABLE', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      await payAndComplete(cashier.agent, v);

      const cleaning = await roomState(cashier.agent, room.id);
      expect(cleaning.state).toBe('CLEANING');
      expect(cleaning.cleaningStartedAt).not.toBeNull();
      expect(cleaning.visit).toBeNull();

      const blocked = await startPrivate(cashier.agent, room.id, 60);
      expect(blocked.status).toBe(409);
      expect(err(blocked).code).toBe('ROOM_NOT_AVAILABLE');

      await post(cashier.agent, `/rooms/${room.id}/finish-cleaning`).expect(
        200,
      );
      expect((await roomState(cashier.agent, room.id)).state).toBe('AVAILABLE');

      const again = await post(
        cashier.agent,
        `/rooms/${room.id}/finish-cleaning`,
      );
      expect(again.status).toBe(409);
      expect(err(again).code).toBe('CLEANING_NOT_ACTIVE');

      await mustStartPrivate(cashier.agent, room.id, 60);
    });

    it('параллельное «уборка завершена»: успешен ровно один вызов', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      await payAndComplete(
        cashier.agent,
        await mustStartPrivate(cashier.agent, room.id, 60),
      );
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          post(cashier.agent, `/rooms/${room.id}/finish-cleaning`),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    });
  });

  describe('отмена посещения', () => {
    it('без платежей: статус CANCELLED, товары возвращены, кто/когда/причина сохранены, уборки нет', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const product = await mkProduct(ownerAgent(), {
        price: '1000',
        stock: 5,
      });
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: product.id,
        quantity: 2,
      }).expect(200);
      expect((await stockOf(product.id)).stock).toBe(3);

      expect(
        (await post(cashier.agent, `/visits/${v.id}/cancel`, {})).status,
      ).toBe(400);
      const res = await post(cashier.agent, `/visits/${v.id}/cancel`, {
        reason: 'Не то помещение',
      }).expect(200);
      const body = res.body as VisitBody;
      expect(body).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Не то помещение',
        cancelledByName: 'Cashier',
      });
      expect((await stockOf(product.id)).stock).toBe(5);
      expect((await roomState(cashier.agent, room.id)).state).toBe('AVAILABLE');

      // отменённое посещение не изменяется
      const again = await post(cashier.agent, `/visits/${v.id}/extend`, {
        minutes: 60,
      });
      expect(again.status).toBe(409);
      expect(err(again).code).toBe('VISIT_NOT_ACTIVE');
      // помещение можно занять снова
      await mustStartPrivate(cashier.agent, room.id, 60);
    });

    it('с платежами отменить нельзя → 409 VISIT_HAS_PAYMENTS', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      await post(cashier.agent, `/visits/${v.id}/payments`, {
        method: 'CASH',
        amount: '1',
      }).expect(200);
      const res = await post(cashier.agent, `/visits/${v.id}/cancel`, {
        reason: 'x',
      });
      expect(res.status).toBe(409);
      expect(err(res).code).toBe('VISIT_HAS_PAYMENTS');
      expect((await getVisit(cashier.agent, v.id)).status).toBe('ACTIVE');
    });
  });

  describe('снимок остатка: сумма журнала = остаток', () => {
    it('после продаж, возвратов и отмен остаток равен сумме движений', async () => {
      const room = await mkPrivateRoom(ownerAgent(), '10000');
      const product = await mkProduct(ownerAgent(), {
        price: '100',
        stock: 20,
      });
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const a = (
        await post(cashier.agent, `/visits/${v.id}/products`, {
          productId: product.id,
          quantity: 4,
        }).expect(200)
      ).body as VisitBody;
      await post(cashier.agent, `/visits/${v.id}/products`, {
        productId: product.id,
        quantity: 3,
      }).expect(200);
      const first = a.items.find((i) => i.kind === 'PRODUCT')!;
      await post(cashier.agent, `/visits/${v.id}/items/${first.id}/void`, {
        reason: 'ошибка',
      }).expect(200);
      await post(cashier.agent, `/visits/${v.id}/cancel`, {
        reason: 'всё отменяем',
      }).expect(200);

      const [sum] = await db
        .select({
          s: sql<number>`sum(${stockMovementsTable.quantityDelta})::int`,
        })
        .from(stockMovementsTable)
        .where(eq(stockMovementsTable.productId, product.id));
      const p = await stockOf(product.id);
      expect(p.stock).toBe(20);
      expect(sum.s).toBe(p.stock);
    });
  });
});
