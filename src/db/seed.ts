import 'dotenv/config';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../index';
import {
  branchesTable,
  bookingsTable,
  organizationsTable,
  paymentsTable,
  productsTable,
  roomsTable,
  roomCleaningsTable,
  servicesTable,
  stockMovementsTable,
  tariffsTable,
  usersTable,
  visitItemsTable,
  visitsTable,
} from './schema';
import { hashFunction } from '../../shared/tools/tools';

/**
 * Development seed: демо-организация, пользователи и каталог (помещения, тарифы, товары, услуги).
 * Пароли — публичные демо-значения для локальной разработки (не секреты).
 * Идемпотентен: повторный запуск ничего не дублирует и не перезаписывает изменения владельца
 * (существующие записи пропускаются по уникальным ограничениям).
 */
const DEMO_ORG = 'MonshaHub Demo';
const DEMO_PASSWORD = 'demo12345';
const DEMO_PIN = '1234';
const DEMO_USERS = [
  { fullname: 'Демо Владелец', email: 'owner@monshahub.demo', role: 'OWNER' },
  { fullname: 'Демо Кассир', email: 'cashier@monshahub.demo', role: 'CASHIER' },
] as const;

const ROOMS = [
  {
    name: 'VIP №1',
    type: 'PRIVATE',
    capacity: 6,
    tariffs: [{ name: 'Почасовой', price: '10000.00' }],
  },
  {
    name: 'VIP №2',
    type: 'PRIVATE',
    capacity: 6,
    tariffs: [{ name: 'Почасовой', price: '12000.00' }],
  },
  {
    name: 'VIP №3',
    type: 'PRIVATE',
    capacity: 8,
    tariffs: [{ name: 'Почасовой', price: '15000.00' }],
  },
  {
    name: 'Семейный зал',
    type: 'PRIVATE',
    capacity: 10,
    tariffs: [{ name: 'Почасовой', price: '8000.00' }],
  },
  {
    name: 'Общий мужской зал',
    type: 'PUBLIC',
    capacity: 60,
    tariffs: [
      { name: 'Взрослый', guestCategory: 'ADULT', price: '2000.00' },
      { name: 'Детский', guestCategory: 'CHILD', price: '1000.00' },
    ],
  },
] as const;

const PRODUCTS = [
  { name: 'Веник', price: '2500.00', stock: 50 },
  { name: 'Шапка', price: '1500.00', stock: 30 },
  { name: 'Полотенце', price: '1000.00', stock: 40 },
  { name: 'Вода', price: '500.00', stock: 100 },
  { name: 'Чай', price: '1500.00', stock: 100 },
] as const;

const SERVICES = [
  { name: 'Массаж', price: '5000.00' },
  { name: 'Парение', price: '3000.00' },
] as const;

export async function seedBase() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed запрещён в production');
  }

  // организация
  let [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.name, DEMO_ORG))
    .limit(1);
  if (!org) {
    [org] = await db
      .insert(organizationsTable)
      .values({ name: DEMO_ORG })
      .returning();
  }
  const organizationId = org.id;

  let [branch] = await db
    .select()
    .from(branchesTable)
    .where(
      and(
        eq(branchesTable.organizationId, organizationId),
        eq(branchesTable.name, 'Основной'),
      ),
    )
    .limit(1);
  if (!branch) {
    [branch] = await db
      .insert(branchesTable)
      .values({
        organizationId,
        name: 'Основной',
        timezone: org.timezone,
      })
      .returning();
  }
  const branchId = branch.id;

  // Переход со старой однофилиальной схемы: все прежние данные относятся к
  // автоматически созданному филиалу «Основной».
  const branchScopedTables = [
    usersTable,
    roomsTable,
    productsTable,
    servicesTable,
    bookingsTable,
    visitsTable,
    visitItemsTable,
    paymentsTable,
    roomCleaningsTable,
    stockMovementsTable,
  ] as const;
  for (const table of branchScopedTables) {
    await db
      .update(table)
      .set({ branchId })
      .where(
        and(eq(table.organizationId, organizationId), isNull(table.branchId)),
      );
  }
  await db
    .update(usersTable)
    .set({ branchId: null })
    .where(
      and(
        eq(usersTable.organizationId, organizationId),
        eq(usersTable.role, 'OWNER'),
      ),
    );

  // пользователи
  const passwordHash = await hashFunction(DEMO_PASSWORD);
  const pinHash = await hashFunction(DEMO_PIN);
  for (const u of DEMO_USERS) {
    await db
      .insert(usersTable)
      .values({
        ...u,
        organizationId,
        branchId: u.role === 'CASHIER' ? branchId : null,
        passwordHash,
        pinHash,
      })
      .onConflictDoUpdate({
        target: usersTable.email,
        set: {
          pinHash,
          ...(u.role === 'CASHIER' ? { branchId } : {}),
        },
      });
  }
  const [owner] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.organizationId, organizationId),
        eq(usersTable.role, 'OWNER'),
      ),
    )
    .limit(1);

  // помещения и тарифы
  let sortOrder = 0;
  for (const room of ROOMS) {
    sortOrder += 1;
    await db
      .insert(roomsTable)
      .values({
        organizationId,
        branchId,
        name: room.name,
        type: room.type,
        capacity: room.capacity,
        sortOrder,
      })
      .onConflictDoNothing();
    const [row] = await db
      .select()
      .from(roomsTable)
      .where(
        and(
          eq(roomsTable.organizationId, organizationId),
          sql`lower(${roomsTable.name}) = lower(${room.name})`,
        ),
      )
      .limit(1);

    for (const t of room.tariffs) {
      await db
        .insert(tariffsTable)
        .values({
          organizationId,
          roomId: row.id,
          kind: room.type === 'PRIVATE' ? 'HOURLY' : 'PER_ENTRY',
          guestCategory: 'guestCategory' in t ? t.guestCategory : null,
          name: t.name,
          price: t.price,
        })
        // если активный тариф такого вида уже есть — оставляем как есть
        .onConflictDoNothing();
    }
  }

  // товары + начальный остаток как движение журнала (в одной транзакции)
  for (const p of PRODUCTS) {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(productsTable)
        .values({
          organizationId,
          branchId,
          name: p.name,
          price: p.price,
          stock: p.stock,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) return; // уже есть — историю остатков не трогаем
      await tx.insert(stockMovementsTable).values({
        organizationId,
        branchId,
        productId: created.id,
        type: 'RESTOCK',
        quantityDelta: p.stock,
        balanceAfter: p.stock,
        reason: 'Начальный остаток',
        createdBy: owner.id,
      });
    });
  }

  // услуги
  for (const s of SERVICES) {
    await db
      .insert(servicesTable)
      .values({ organizationId, branchId, name: s.name, price: s.price })
      .onConflictDoNothing();
  }

  console.log(`Seed выполнен. Организация: ${DEMO_ORG}`);
  for (const u of DEMO_USERS)
    console.log(
      `  ${u.role}: ${u.email} / PIN ${DEMO_PIN} / пароль ${DEMO_PASSWORD}`,
    );
}

if (require.main === module) {
  seedBase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
