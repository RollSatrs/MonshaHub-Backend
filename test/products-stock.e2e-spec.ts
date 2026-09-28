import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../src';
import { productsTable, stockMovementsTable } from '../src/db/schema';
import {
  Agent,
  cleanup,
  closeDb,
  createApp,
  createCashier,
  ErrorBody,
  mkProduct,
  ProductBody,
  registerOwner,
  uniqueName,
} from './helpers';

interface MovementBody {
  id: number;
  productId: number;
  type: string;
  quantityDelta: number;
  balanceAfter: number;
  reason: string | null;
  createdBy: number;
  createdByName: string | null;
}

describe('Products и stock movements (e2e)', () => {
  let app: INestApplication;
  let ownerA: Awaited<ReturnType<typeof registerOwner>>;
  let ownerB: Awaited<ReturnType<typeof registerOwner>>;
  let cashierA: { agent: Agent };

  const movements = async (agent: Agent, productId: number) =>
    (await agent.get(`/products/${productId}/stock-movements`).expect(200))
      .body as MovementBody[];

  const dbStock = async (productId: number) =>
    (
      await db
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, productId))
    )[0].stock;

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

  describe('CRUD', () => {
    it('создание: цена нормализуется; начальный остаток пишется в журнал как RESTOCK', async () => {
      const p = await mkProduct(ownerA.agent, {
        name: 'Веник',
        price: '2500',
        stock: 50,
      });
      expect(p).toMatchObject({
        name: 'Веник',
        price: '2500.00',
        stock: 50,
        active: true,
      });

      const log = await movements(ownerA.agent, p.id);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        type: 'RESTOCK',
        quantityDelta: 50,
        balanceAfter: 50,
        reason: 'Начальный остаток',
      });
      expect(log[0].createdByName).toBe('Owner');
    });

    it('товар с нулевым остатком не создаёт движений', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 0 });
      expect(await movements(ownerA.agent, p.id)).toHaveLength(0);
    });

    it('валидация: цена, остаток, лишние поля', async () => {
      for (const bad of [
        { price: '-1' },
        { price: '1.999' },
        { price: 100 },
        { stock: -1 },
        { stock: 1.5 },
        { stock: 2_000_000 },
        { name: '' },
        { organizationId: ownerB.organizationId },
        { active: false },
      ]) {
        const res = await ownerA.agent
          .post('/products')
          .send({ name: uniqueName('P'), price: '1', stock: 1, ...bad })
          .expect(400);
        expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      }
    });

    it('остаток нельзя изменить через PATCH (только движениями)', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 5 });
      const res = await ownerA.agent
        .patch(`/products/${p.id}`)
        .send({ stock: 999 })
        .expect(400);
      expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      expect(await dbStock(p.id)).toBe(5);

      const ok = await ownerA.agent
        .patch(`/products/${p.id}`)
        .send({ name: 'Переименован', price: '3000' })
        .expect(200);
      expect(ok.body).toMatchObject({
        name: 'Переименован',
        price: '3000.00',
        stock: 5,
      });
    });

    it('название уникально без учёта регистра → 409 DUPLICATE_NAME; в другой организации можно', async () => {
      const name = uniqueName('Чай');
      await mkProduct(ownerA.agent, { name });
      const dup = await ownerA.agent
        .post('/products')
        .send({ name: name.toUpperCase(), price: '1' })
        .expect(409);
      expect((dup.body as ErrorBody).code).toBe('DUPLICATE_NAME');
      await mkProduct(ownerB.agent, { name });
    });

    it('неудачное создание (дубликат) не оставляет следов в журнале', async () => {
      const name = uniqueName('Дубль');
      await mkProduct(ownerA.agent, { name, stock: 1 });
      const before = await db
        .select()
        .from(stockMovementsTable)
        .where(eq(stockMovementsTable.organizationId, ownerA.organizationId));
      await ownerA.agent
        .post('/products')
        .send({ name, price: '1', stock: 7 })
        .expect(409);
      const after = await db
        .select()
        .from(stockMovementsTable)
        .where(eq(stockMovementsTable.organizationId, ownerA.organizationId));
      expect(after).toHaveLength(before.length);
    });
  });

  describe('RBAC и жизненный цикл', () => {
    it('CASHIER читает только активные товары, не пишет и не видит журнал', async () => {
      const active = await mkProduct(ownerA.agent, { stock: 3 });
      const archived = await mkProduct(ownerA.agent, { stock: 3 });
      await ownerA.agent
        .patch(`/products/${archived.id}`)
        .send({ active: false })
        .expect(200);

      const ids = (res: { body: unknown }) =>
        (res.body as ProductBody[]).map((p) => p.id);
      expect(
        ids(
          await cashierA.agent
            .get('/products?includeInactive=true')
            .expect(200),
        ),
      ).toContain(active.id);
      expect(
        ids(
          await cashierA.agent
            .get('/products?includeInactive=true')
            .expect(200),
        ),
      ).not.toContain(archived.id);
      expect(
        ids(
          await ownerA.agent.get('/products?includeInactive=true').expect(200),
        ),
      ).toContain(archived.id);
      expect(
        ids(await ownerA.agent.get('/products').expect(200)),
      ).not.toContain(archived.id);

      await cashierA.agent.get(`/products/${archived.id}`).expect(404);
      await ownerA.agent.get(`/products/${archived.id}`).expect(200);

      await cashierA.agent
        .post('/products')
        .send({ name: 'x', price: '1' })
        .expect(403);
      await cashierA.agent
        .patch(`/products/${active.id}`)
        .send({ name: 'x' })
        .expect(403);
      await cashierA.agent.delete(`/products/${active.id}`).expect(403);
      await cashierA.agent
        .post(`/products/${active.id}/stock-movements`)
        .send({ type: 'RESTOCK', quantityDelta: 1 })
        .expect(403);
      await cashierA.agent
        .get(`/products/${active.id}/stock-movements`)
        .expect(403);
    });

    it('архивный товар: остаток можно списать (движения разрешены)', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 4 });
      await ownerA.agent
        .patch(`/products/${p.id}`)
        .send({ active: false })
        .expect(200);
      await ownerA.agent
        .post(`/products/${p.id}/stock-movements`)
        .send({
          type: 'WRITE_OFF',
          quantityDelta: -4,
          reason: 'Списание при архивации',
        })
        .expect(201);
      expect(await dbStock(p.id)).toBe(0);
    });

    it('DELETE: товар без истории → 204; с историей движений → 409 ENTITY_IN_USE (данные целы)', async () => {
      const clean = await mkProduct(ownerA.agent, { stock: 0 });
      await ownerA.agent.delete(`/products/${clean.id}`).expect(204);

      const used = await mkProduct(ownerA.agent, { stock: 5 });
      const res = await ownerA.agent.delete(`/products/${used.id}`).expect(409);
      expect((res.body as ErrorBody).code).toBe('ENTITY_IN_USE');
      expect(await dbStock(used.id)).toBe(5);
      expect(await movements(ownerA.agent, used.id)).toHaveLength(1);
    });
  });

  describe('Stock movements', () => {
    const move = (agent: Agent, id: number, body: Record<string, unknown>) =>
      agent.post(`/products/${id}/stock-movements`).send(body);

    it('RESTOCK / WRITE_OFF / ADJUSTMENT меняют остаток и пишут журнал с balanceAfter', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 10 });

      const r1 = await move(ownerA.agent, p.id, {
        type: 'RESTOCK',
        quantityDelta: 5,
      }).expect(201);
      const body = r1.body as { movement: MovementBody; product: ProductBody };
      expect(body.product.stock).toBe(15);
      expect(body.movement).toMatchObject({
        type: 'RESTOCK',
        quantityDelta: 5,
        balanceAfter: 15,
        reason: null,
      });

      await move(ownerA.agent, p.id, {
        type: 'WRITE_OFF',
        quantityDelta: -3,
        reason: 'Порча',
      }).expect(201);
      await move(ownerA.agent, p.id, {
        type: 'ADJUSTMENT',
        quantityDelta: -2,
        reason: 'Инвентаризация',
      }).expect(201);
      await move(ownerA.agent, p.id, {
        type: 'ADJUSTMENT',
        quantityDelta: 1,
        reason: 'Нашли',
      }).expect(201);

      expect(await dbStock(p.id)).toBe(11);
      const log = await movements(ownerA.agent, p.id);
      // новые сверху
      expect(log.map((m) => m.balanceAfter)).toEqual([11, 10, 12, 15, 10]);
      // остаток = сумме дельт журнала
      expect(log.reduce((s, m) => s + m.quantityDelta, 0)).toBe(11);
      expect(log[0].createdBy).toBe(log[1].createdBy);
    });

    it('валидация знаков, причины и типов', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 10 });
      const bad: Record<string, unknown>[] = [
        { type: 'RESTOCK', quantityDelta: -1 },
        { type: 'RESTOCK', quantityDelta: 0 },
        { type: 'WRITE_OFF', quantityDelta: 1, reason: 'x' },
        { type: 'WRITE_OFF', quantityDelta: -1 },
        { type: 'WRITE_OFF', quantityDelta: -1, reason: '   ' },
        { type: 'ADJUSTMENT', quantityDelta: 1 },
        { type: 'ADJUSTMENT', quantityDelta: 0, reason: 'x' },
        { type: 'SALE', quantityDelta: -1, reason: 'x' },
        { type: 'RESTOCK', quantityDelta: 1.5 },
        { type: 'RESTOCK', quantityDelta: 2_000_000 },
        { type: 'RESTOCK', quantityDelta: 1, productId: 999 },
      ];
      for (const body of bad) {
        const res = await move(ownerA.agent, p.id, body).expect(400);
        expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
      }
      expect(await dbStock(p.id)).toBe(10);
      expect(await movements(ownerA.agent, p.id)).toHaveLength(1);
    });

    it('списание больше остатка → 409 INSUFFICIENT_STOCK, остаток и журнал не меняются', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 2 });
      const res = await move(ownerA.agent, p.id, {
        type: 'WRITE_OFF',
        quantityDelta: -3,
        reason: 'Много',
      }).expect(409);
      expect((res.body as ErrorBody).code).toBe('INSUFFICIENT_STOCK');
      expect(await dbStock(p.id)).toBe(2);
      expect(await movements(ownerA.agent, p.id)).toHaveLength(1);

      // ADJUSTMENT тоже не может увести остаток в минус
      await move(ownerA.agent, p.id, {
        type: 'ADJUSTMENT',
        quantityDelta: -3,
        reason: 'x',
      }).expect(409);
      // но до нуля — можно
      await move(ownerA.agent, p.id, {
        type: 'WRITE_OFF',
        quantityDelta: -2,
        reason: 'Всё',
      }).expect(201);
      expect(await dbStock(p.id)).toBe(0);
    });

    it('конкурентное списание: 20 параллельных −1 при остатке 10 → ровно 10 успешных, остаток 0, журнал согласован', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 10 });

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          move(ownerA.agent, p.id, {
            type: 'WRITE_OFF',
            quantityDelta: -1,
            reason: 'race',
          }),
        ),
      );
      const ok = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 409);
      expect(ok).toHaveLength(10);
      expect(rejected).toHaveLength(10);
      rejected.forEach((r) =>
        expect((r.body as ErrorBody).code).toBe('INSUFFICIENT_STOCK'),
      );

      expect(await dbStock(p.id)).toBe(0);
      const log = await movements(ownerA.agent, p.id);
      expect(log).toHaveLength(11); // начальный + 10 списаний, без «фантомных» записей
      expect(log.reduce((s, m) => s + m.quantityDelta, 0)).toBe(0);
      // каждое списание видело уникальный остаток 9..0
      expect(
        log
          .filter((m) => m.type === 'WRITE_OFF')
          .map((m) => m.balanceAfter)
          .sort((a, b) => a - b),
      ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('конкурентные пополнения и списания не теряют обновлений', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 100 });
      const ops = [
        ...Array.from({ length: 10 }, () =>
          move(ownerA.agent, p.id, { type: 'RESTOCK', quantityDelta: 3 }),
        ),
        ...Array.from({ length: 10 }, () =>
          move(ownerA.agent, p.id, {
            type: 'WRITE_OFF',
            quantityDelta: -2,
            reason: 'r',
          }),
        ),
      ];
      const results = await Promise.all(ops);
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await dbStock(p.id)).toBe(100 + 30 - 20);
    });

    it('tenant isolation: чужой товар → 404 для движений, журнала, PATCH, DELETE', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 5 });
      await move(ownerB.agent, p.id, {
        type: 'RESTOCK',
        quantityDelta: 100,
      }).expect(404);
      await move(ownerB.agent, p.id, {
        type: 'WRITE_OFF',
        quantityDelta: -1,
        reason: 'x',
      }).expect(404);
      await ownerB.agent.get(`/products/${p.id}/stock-movements`).expect(404);
      await ownerB.agent.get(`/products/${p.id}`).expect(404);
      await ownerB.agent
        .patch(`/products/${p.id}`)
        .send({ price: '1' })
        .expect(404);
      await ownerB.agent.delete(`/products/${p.id}`).expect(404);

      const list = (
        await ownerB.agent.get('/products?includeInactive=true').expect(200)
      ).body as ProductBody[];
      expect(list.some((x) => x.id === p.id)).toBe(false);
      expect(await dbStock(p.id)).toBe(5);
      expect(await movements(ownerA.agent, p.id)).toHaveLength(1);
    });

    it('DB-инвариант: остаток и знак движения защищены CHECK-ограничениями', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 1 });
      await expect(
        db
          .update(productsTable)
          .set({ stock: -1 })
          .where(eq(productsTable.id, p.id)),
      ).rejects.toThrow();
      await expect(
        db.insert(stockMovementsTable).values({
          organizationId: ownerA.organizationId,
          productId: p.id,
          type: 'RESTOCK',
          quantityDelta: -1,
          balanceAfter: 0,
          createdBy: 1,
        }),
      ).rejects.toThrow();
    });

    it('limit журнала ограничивает выдачу', async () => {
      const p = await mkProduct(ownerA.agent, { stock: 1 });
      for (let i = 0; i < 3; i++) {
        await move(ownerA.agent, p.id, {
          type: 'RESTOCK',
          quantityDelta: 1,
        }).expect(201);
      }
      const res = await ownerA.agent
        .get(`/products/${p.id}/stock-movements?limit=2`)
        .expect(200);
      expect(res.body as MovementBody[]).toHaveLength(2);
      await ownerA.agent
        .get(`/products/${p.id}/stock-movements?limit=0`)
        .expect(400);
      await ownerA.agent
        .get(`/products/${p.id}/stock-movements?limit=1000`)
        .expect(400);
    });
  });
});
