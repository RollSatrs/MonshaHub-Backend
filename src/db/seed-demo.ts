import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { BookingsService } from '../bookings/bookings.service';
import { Clock } from '../common/clock';
import { db } from '../index';
import {
  bookingsTable,
  organizationsTable,
  paymentsTable,
  productsTable,
  roomCleaningsTable,
  roomsTable,
  servicesTable,
  stockMovementsTable,
  usersTable,
  visitItemsTable,
  visitsTable,
} from './schema';
import { seedBase } from './seed';
import { ProductsService } from '../products/products.service';
import { VisitsService } from '../visits/visits.service';
import type { AuthUser } from '../types/express';

/**
 * Живой demo-сценарий MonshaHub: открыть систему и сразу увидеть работающую баню.
 *
 *   VIP №1 — занят (идёт посещение с товарами и услугой)
 *   VIP №2 — скоро закончится (осталось ~8 минут)
 *   VIP №3 — уборка
 *   Семейный зал — свободен, впереди бронь
 *   Общий мужской зал — 37 человек внутри
 *   История — завершённые посещения за 6 дней (+ отменённое и с убранной позицией)
 *
 * Идёт через те же сервисы, что и API (остатки, итоги, snapshot, уборка), время задаётся
 * управляемыми часами. Повторный запуск сбрасывает активность demo-организации и создаёт сценарий заново
 * (состояния «сейчас» быстро устаревают — просто запустите ещё раз).
 */
const DEMO_ORG = 'MonshaHub Demo';
const DAYS_OF_HISTORY = 6;
const DEMO_ROOMS = [
  'VIP №1',
  'VIP №2',
  'VIP №3',
  'Семейный зал',
  'Общий мужской зал',
];
const DEMO_PRODUCTS = ['Веник', 'Шапка', 'Полотенце', 'Вода', 'Чай'];
const DEMO_SERVICES = ['Массаж', 'Парение'];

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function resetDemoActivity(organizationId: number) {
  await db.transaction(async (tx) => {
    // движения по продажам и демо-пополнения
    await tx
      .delete(stockMovementsTable)
      .where(
        and(
          eq(stockMovementsTable.organizationId, organizationId),
          or(
            isNotNull(stockMovementsTable.visitItemId),
            eq(stockMovementsTable.reason, 'Пополнение для демо'),
          ),
        ),
      );
    await tx
      .delete(paymentsTable)
      .where(eq(paymentsTable.organizationId, organizationId));
    await tx
      .delete(roomCleaningsTable)
      .where(eq(roomCleaningsTable.organizationId, organizationId));
    await tx
      .delete(visitItemsTable)
      .where(eq(visitItemsTable.organizationId, organizationId));
    await tx
      .delete(visitsTable)
      .where(eq(visitsTable.organizationId, organizationId));
    await tx
      .delete(bookingsTable)
      .where(eq(bookingsTable.organizationId, organizationId));
    // помещения/товары/услуги из seed возвращаем в рабочее состояние (могли быть заархивированы при ручной проверке);
    // записи, созданные вручную, не трогаем
    await tx
      .update(roomsTable)
      .set({ active: true })
      .where(
        and(
          eq(roomsTable.organizationId, organizationId),
          inArray(roomsTable.name, DEMO_ROOMS),
        ),
      );
    await tx
      .update(productsTable)
      .set({ active: true })
      .where(
        and(
          eq(productsTable.organizationId, organizationId),
          inArray(productsTable.name, DEMO_PRODUCTS),
        ),
      );
    await tx
      .update(servicesTable)
      .set({ active: true })
      .where(
        and(
          eq(servicesTable.organizationId, organizationId),
          inArray(servicesTable.name, DEMO_SERVICES),
        ),
      );
    // остаток = сумма оставшихся движений
    await tx.execute(sql`
      update products p set stock = coalesce((
        select sum(m.quantity_delta) from stock_movements m where m.product_id = p.id
      ), 0)
      where p.organization_id = ${organizationId}
    `);
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo-seed запрещён в production');
  }

  await seedBase();

  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.name, DEMO_ORG))
    .limit(1);
  const organizationId = org.id;

  await resetDemoActivity(organizationId);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const visits = app.get(VisitsService);
  const bookings = app.get(BookingsService);

  // управляемые часы (только в этом процессе)
  const clock: { now: () => Date } = app.get(Clock);
  let current = new Date();
  clock.now = () => new Date(current);
  const setTime = (d: Date) => {
    current = d;
  };
  const minutes = (m: number) => m * 60_000;
  const realNow = new Date();

  const users = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.organizationId, organizationId));
  const toActor = (u: (typeof users)[number]): AuthUser => ({
    id: u.id,
    email: u.email,
    role: u.role,
    organizationId: u.organizationId,
  });
  const owner = toActor(users.find((u) => u.role === 'OWNER')!);
  const cashier = toActor(users.find((u) => u.role === 'CASHIER')!);

  const roomRows = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.organizationId, organizationId));
  const room = (name: string) => roomRows.find((r) => r.name === name)!;
  const productRows = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.organizationId, organizationId));
  const product = (name: string) => productRows.find((p) => p.name === name)!;
  const serviceRows = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.organizationId, organizationId));
  const service = (name: string) => serviceRows.find((s) => s.name === name)!;

  // запас товара, чтобы история не упёрлась в остаток
  const productsSvc = app.get(ProductsService);
  for (const p of productRows) {
    await productsSvc.addMovement(owner, p.id, {
      type: 'RESTOCK',
      quantityDelta: 200,
      reason: 'Пополнение для демо',
    });
  }

  const vip1 = room('VIP №1');
  const vip2 = room('VIP №2');
  const vip3 = room('VIP №3');
  const family = room('Семейный зал');
  const hall = room('Общий мужской зал');
  const privateRooms = [vip1, vip2, vip3, family];
  const customers = [
    'Асхат',
    'Мадина',
    'Ержан',
    'Динара',
    'Тимур',
    'Алия',
    'Бауыржан',
    'Салтанат',
    'Нурлан',
    'Гульнара',
  ];
  const methods = ['CASH', 'CARD', 'KASPI'] as const;

  const pay = (
    actor: AuthUser,
    visitId: number,
    total: string,
    random: () => number,
  ) => {
    if (Number(total) === 0) return [];
    const method = methods[Math.floor(random() * methods.length)];
    if (random() < 0.25 && Number(total) >= 2000) {
      // разделённая оплата
      const first = (Math.floor(Number(total) / 2 / 100) * 100).toFixed(2);
      const rest = (Number(total) - Number(first)).toFixed(2);
      return [
        { method: 'CASH' as const, amount: first },
        { method: 'CARD' as const, amount: rest },
      ];
    }
    void actor;
    void visitId;
    return [{ method, amount: total }];
  };

  // ── История за прошлые дни ──────────────────────────────────────────────
  const random = rng(20260928);
  let historyVisits = 0;
  for (let d = DAYS_OF_HISTORY; d >= 1; d--) {
    const dayStart = new Date(realNow.getTime() - d * 24 * 60 * 60_000);
    dayStart.setUTCHours(6, 0, 0, 0); // ≈ 11:00 по Алматы
    let t = dayStart.getTime();

    // приватные посещения
    const perDay = 3 + Math.floor(random() * 3);
    for (let i = 0; i < perDay; i++) {
      const r = privateRooms[(i + d) % privateRooms.length];
      const actor = random() < 0.85 ? cashier : owner;
      t += minutes(20 + Math.floor(random() * 70));
      setTime(new Date(t));
      const hours = 1 + Math.floor(random() * 3);
      try {
        const v = await visits.startPrivate(actor, {
          roomId: r.id,
          durationMinutes: hours * 60,
          customerName: customers[Math.floor(random() * customers.length)],
        });
        if (random() < 0.7) {
          await visits.addProduct(actor, v.id, {
            productId: product(
              ['Веник', 'Вода', 'Чай', 'Полотенце', 'Шапка'][
                Math.floor(random() * 5)
              ],
            ).id,
            quantity: 1 + Math.floor(random() * 2),
          });
        }
        if (random() < 0.4) {
          await visits.addService(actor, v.id, {
            serviceId: service(random() < 0.6 ? 'Массаж' : 'Парение').id,
            quantity: 1,
          });
        }
        if (random() < 0.25) {
          await visits.extend(actor, v.id, { minutes: 60 });
        }
        const detail = await visits.get(actor, v.id);
        t += minutes(detail.items.reduce((n, it) => n + (it.minutes ?? 0), 0));
        setTime(new Date(t));
        await visits.complete(actor, v.id, {
          payments: pay(actor, v.id, detail.total, random),
        });
        t += minutes(10);
        setTime(new Date(t));
        await visits.finishCleaning(actor, r.id);
        historyVisits += 1;
      } catch (e) {
        console.warn(
          `пропущено историческое посещение: ${(e as Error).message}`,
        );
      }
    }

    // общий зал
    const publicCount = 6 + Math.floor(random() * 5);
    for (let i = 0; i < publicCount; i++) {
      const actor = random() < 0.85 ? cashier : owner;
      t += minutes(5 + Math.floor(random() * 20));
      setTime(new Date(t));
      try {
        const guests: { category: 'ADULT' | 'CHILD'; quantity: number }[] = [
          { category: 'ADULT', quantity: 1 + Math.floor(random() * 3) },
        ];
        if (random() < 0.35) guests.push({ category: 'CHILD', quantity: 1 });
        const v = await visits.startPublic(actor, { roomId: hall.id, guests });
        if (random() < 0.5) {
          await visits.addProduct(actor, v.id, {
            productId: product(random() < 0.5 ? 'Веник' : 'Полотенце').id,
            quantity: 1,
          });
        }
        const detail = await visits.get(actor, v.id);
        t += minutes(60 + Math.floor(random() * 90));
        setTime(new Date(t));
        await visits.complete(actor, v.id, {
          payments: pay(actor, v.id, detail.total, random),
        });
        historyVisits += 1;
      } catch (e) {
        console.warn(`пропущен исторический чек: ${(e as Error).message}`);
      }
    }
  }

  // одно посещение с ошибочно добавленной (убранной) позицией и одно отменённое — для аудита
  {
    const t = new Date(realNow.getTime() - 26 * 60 * 60_000);
    setTime(t);
    const v = await visits.startPrivate(cashier, {
      roomId: family.id,
      durationMinutes: 60,
      customerName: 'Аудит',
    });
    const withItem = await visits.addProduct(cashier, v.id, {
      productId: product('Шапка').id,
      quantity: 2,
    });
    const item = withItem.items.find((i) => i.kind === 'PRODUCT')!;
    await visits.voidItem(cashier, v.id, item.id, {
      reason: 'Добавили по ошибке',
    });
    setTime(new Date(t.getTime() + minutes(60)));
    const done = await visits.get(cashier, v.id);
    await visits.complete(cashier, v.id, {
      payments: [{ method: 'CASH', amount: done.total }],
    });
    await visits.finishCleaning(cashier, family.id);

    setTime(new Date(t.getTime() + minutes(120)));
    const wrong = await visits.startPrivate(cashier, {
      roomId: vip1.id,
      durationMinutes: 60,
    });
    await visits.cancel(cashier, wrong.id, {
      reason: 'Начали не в том помещении',
    });
  }

  // ── Живая картина «сейчас» ──────────────────────────────────────────────
  // VIP №3: было посещение, оплачено и завершено 25 минут назад → уборка
  setTime(new Date(realNow.getTime() - minutes(80)));
  const v3 = await visits.startPrivate(cashier, {
    roomId: vip3.id,
    durationMinutes: 60,
    customerName: 'Компания Сергея',
  });
  await visits.addProduct(cashier, v3.id, {
    productId: product('Чай').id,
    quantity: 3,
  });

  // VIP №2: закончится через 8 минут
  setTime(new Date(realNow.getTime() - minutes(52)));
  await visits.startPrivate(cashier, {
    roomId: vip2.id,
    durationMinutes: 60,
    customerName: 'Динара',
    customerPhone: '+7 701 555 12 34',
  });

  // VIP №1: идёт, с товарами и услугой
  setTime(new Date(realNow.getTime() - minutes(40)));
  const v1 = await visits.startPrivate(cashier, {
    roomId: vip1.id,
    durationMinutes: 120,
    customerName: 'Ержан',
    customerPhone: '+7 707 111 22 33',
    guestsCount: 4,
  });
  setTime(new Date(realNow.getTime() - minutes(30)));
  await visits.addProduct(cashier, v1.id, {
    productId: product('Веник').id,
    quantity: 2,
  });
  await visits.addProduct(cashier, v1.id, {
    productId: product('Чай').id,
    quantity: 1,
  });
  await visits.addService(cashier, v1.id, {
    serviceId: service('Массаж').id,
    quantity: 1,
  });

  // VIP №3 завершается 25 минут назад
  setTime(new Date(realNow.getTime() - minutes(25)));
  const v3detail = await visits.get(cashier, v3.id);
  await visits.complete(cashier, v3.id, {
    payments: [{ method: 'KASPI', amount: v3detail.total }],
  });

  // Общий зал: ровно 37 человек внутри
  const groups: { a: number; c: number; paid: boolean; extra?: string }[] = [
    { a: 2, c: 0, paid: true },
    { a: 1, c: 0, paid: true },
    { a: 3, c: 1, paid: true, extra: 'Веник' },
    { a: 1, c: 0, paid: false },
    { a: 2, c: 2, paid: true },
    { a: 1, c: 0, paid: true, extra: 'Полотенце' },
    { a: 4, c: 0, paid: false },
    { a: 2, c: 0, paid: true },
    { a: 1, c: 2, paid: true },
    { a: 1, c: 0, paid: false, extra: 'Вода' },
    { a: 3, c: 0, paid: true },
    { a: 2, c: 1, paid: true },
    { a: 1, c: 0, paid: true },
    { a: 1, c: 0, paid: false },
  ];
  let inHall = groups.reduce((n, g) => n + g.a + g.c, 0);
  const rest = 37 - inHall;
  if (rest > 0) groups.push({ a: rest, c: 0, paid: true });
  inHall = groups.reduce((n, g) => n + g.a + g.c, 0);
  let minutesAgo = 95;
  for (const g of groups) {
    minutesAgo -= 6;
    setTime(new Date(realNow.getTime() - minutes(Math.max(minutesAgo, 3))));
    const guests: { category: 'ADULT' | 'CHILD'; quantity: number }[] = [];
    if (g.a) guests.push({ category: 'ADULT', quantity: g.a });
    if (g.c) guests.push({ category: 'CHILD', quantity: g.c });
    const v = await visits.startPublic(cashier, { roomId: hall.id, guests });
    if (g.extra)
      await visits.addProduct(cashier, v.id, {
        productId: product(g.extra).id,
        quantity: 1,
      });
    if (g.paid) {
      const detail = await visits.get(cashier, v.id);
      const entryOnly = g.extra
        ? detail.items
            .filter((i) => i.kind === 'ENTRY')
            .reduce((s, i) => s + Number(i.lineTotal), 0)
        : Number(detail.total);
      await visits.addPayment(cashier, v.id, {
        method: 'CASH',
        amount: entryOnly.toFixed(2),
      });
    }
  }

  // Семейный зал свободен, но впереди бронь; у VIP №2 бронь после текущего посещения
  setTime(realNow);
  await bookings.create(cashier, {
    roomId: family.id,
    customerName: 'Мадина (день рождения)',
    customerPhone: '+7 702 333 44 55',
    startsAt: new Date(realNow.getTime() + minutes(120)).toISOString(),
    durationMinutes: 180,
    notes: 'Торт принесут с собой',
  });
  await bookings.create(cashier, {
    roomId: vip2.id,
    customerName: 'Тимур',
    customerPhone: '+7 705 999 88 77',
    startsAt: new Date(realNow.getTime() + minutes(90)).toISOString(),
    durationMinutes: 120,
  });
  await bookings.create(cashier, {
    roomId: vip3.id,
    customerName: 'Алия',
    customerPhone: '+7 747 123 00 11',
    startsAt: new Date(realNow.getTime() + minutes(240)).toISOString(),
    durationMinutes: 60,
  });

  setTime(realNow);
  console.log('Demo готов:');
  console.log(
    `  история: ${historyVisits} завершённых посещений за ${DAYS_OF_HISTORY} дней (+ отменённое и с убранной позицией)`,
  );
  console.log(`  Общий мужской зал: ${inHall} человек внутри`);
  console.log(
    '  VIP №1 занят · VIP №2 скоро закончится · VIP №3 уборка · Семейный зал свободен (впереди бронь)',
  );
  console.log(
    '  Вход: owner@monshahub.demo / cashier@monshahub.demo, пароль demo12345',
  );

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
