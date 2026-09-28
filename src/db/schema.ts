import { sql } from 'drizzle-orm';
import {
  pgEnum,
  integer,
  pgTable,
  varchar,
  char,
  timestamp,
  boolean,
  numeric,
  index,
  unique,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core';

/**
 * Правила схемы:
 * - все бизнес-таблицы принадлежат организации (organization_id NOT NULL);
 * - деньги — numeric(12,2), в API отдаются decimal-строкой;
 * - справочники не удаляются физически, если на них есть ссылки: FK на историю
 *   всегда NO ACTION (не CASCADE), поэтому использованную запись удалить нельзя;
 * - основной жизненный цикл справочников — active=false (архив).
 */

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const createdAt = () => timestamp('created_at').defaultNow().notNull();
const updatedAt = () =>
  timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

// ─── Enums ────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['OWNER', 'CASHIER']);
export const roomTypeEnum = pgEnum('room_type', ['PRIVATE', 'PUBLIC']);
export const tariffKindEnum = pgEnum('tariff_kind', ['HOURLY', 'PER_ENTRY']);
export const guestCategoryEnum = pgEnum('guest_category', ['ADULT', 'CHILD']);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', [
  'RESTOCK',
  'WRITE_OFF',
  'ADJUSTMENT',
  'SALE',
]);

// ─── Organization / users ─────────────────────────────────────────────────

export const organizationsTable = pgTable('organizations', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  // Пока не изменяются через API: смена валюты сделала бы исторические суммы
  // неоднозначными, смена часового пояса сдвинула бы границы «сегодня».
  currency: char({ length: 3 }).default('KZT').notNull(),
  timezone: varchar({ length: 64 }).default('Asia/Almaty').notNull(),
  createdAt: createdAt(),
});

export const usersTable = pgTable(
  'users',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    fullname: varchar({ length: 255 }).notNull(),
    email: varchar({ length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: userRoleEnum('user_role').default('CASHIER').notNull(),
    avatar: varchar({ length: 255 }),
    active: boolean().default(true).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('users_organization_id_idx').on(t.organizationId)],
);

export const passwordResetTokensTable = pgTable('password_reset_tokens', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  token: varchar({ length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean().default(false).notNull(),
});

// ─── Rooms ────────────────────────────────────────────────────────────────

export const roomsTable = pgTable(
  'rooms',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    name: varchar({ length: 255 }).notNull(),
    // тип не меняется после создания: от него зависят тарифы
    type: roomTypeEnum().notNull(),
    capacity: integer().notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // нужен для композитных FK «своя организация» из дочерних таблиц
    unique('rooms_id_organization_unique').on(t.id, t.organizationId),
    uniqueIndex('rooms_organization_name_unique').on(
      t.organizationId,
      sql`lower(${t.name})`,
    ),
    index('rooms_organization_active_sort_idx').on(
      t.organizationId,
      t.active,
      t.sortOrder,
    ),
    check('rooms_capacity_check', sql`${t.capacity} >= 1`),
  ],
);

// ─── Tariffs ──────────────────────────────────────────────────────────────

/**
 * Тариф принадлежит конкретному помещению. kind определяется типом помещения
 * (PRIVATE → HOURLY, PUBLIC → PER_ENTRY) на backend. price — базовая цена;
 * условные правила (вечер/выходные) появятся отдельной таблицей с FK на тариф.
 */
export const tariffsTable = pgTable(
  'tariffs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id').notNull(),
    roomId: integer('room_id').notNull(),
    kind: tariffKindEnum().notNull(),
    guestCategory: guestCategoryEnum('guest_category'),
    name: varchar({ length: 255 }).notNull(),
    price: money('price').notNull(),
    active: boolean().default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // тариф не может принадлежать помещению другой организации
    foreignKey({
      name: 'tariffs_room_organization_fk',
      columns: [t.roomId, t.organizationId],
      foreignColumns: [roomsTable.id, roomsTable.organizationId],
    }).onDelete('cascade'),
    unique('tariffs_id_organization_unique').on(t.id, t.organizationId),
    index('tariffs_organization_room_idx').on(t.organizationId, t.roomId),
    check('tariffs_price_check', sql`${t.price} >= 0`),
    check(
      'tariffs_kind_category_check',
      sql`(${t.kind} = 'HOURLY' AND ${t.guestCategory} IS NULL) OR (${t.kind} = 'PER_ENTRY' AND ${t.guestCategory} IS NOT NULL)`,
    ),
    // один активный почасовой тариф на помещение
    uniqueIndex('tariffs_active_hourly_unique')
      .on(t.roomId)
      .where(sql`${t.kind} = 'HOURLY' AND ${t.active}`),
    // одна активная цена входа на категорию гостя
    uniqueIndex('tariffs_active_entry_unique')
      .on(t.roomId, t.guestCategory)
      .where(sql`${t.kind} = 'PER_ENTRY' AND ${t.active}`),
  ],
);

// ─── Products / stock ─────────────────────────────────────────────────────

export const productsTable = pgTable(
  'products',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    name: varchar({ length: 255 }).notNull(),
    price: money('price').notNull(),
    // меняется только через stock_movements (атомарно)
    stock: integer().default(0).notNull(),
    active: boolean().default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('products_id_organization_unique').on(t.id, t.organizationId),
    uniqueIndex('products_organization_name_unique').on(
      t.organizationId,
      sql`lower(${t.name})`,
    ),
    index('products_organization_active_idx').on(t.organizationId, t.active),
    check('products_price_check', sql`${t.price} >= 0`),
    check('products_stock_check', sql`${t.stock} >= 0`),
  ],
);

/** Журнал движения остатка. Каждое изменение products.stock пишет сюда строку в той же транзакции. */
export const stockMovementsTable = pgTable(
  'stock_movements',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    productId: integer('product_id').notNull(),
    type: stockMovementTypeEnum().notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    // остаток после операции: объясняет «откуда число» без пересчёта журнала
    balanceAfter: integer('balance_after').notNull(),
    reason: varchar({ length: 500 }),
    createdBy: integer('created_by')
      .notNull()
      .references(() => usersTable.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'stock_movements_product_organization_fk',
      columns: [t.productId, t.organizationId],
      foreignColumns: [productsTable.id, productsTable.organizationId],
    }),
    index('stock_movements_product_created_idx').on(t.productId, t.createdAt),
    index('stock_movements_organization_created_idx').on(
      t.organizationId,
      t.createdAt,
    ),
    check('stock_movements_delta_check', sql`${t.quantityDelta} <> 0`),
    check('stock_movements_balance_check', sql`${t.balanceAfter} >= 0`),
    check(
      'stock_movements_type_sign_check',
      sql`(${t.type} = 'RESTOCK' AND ${t.quantityDelta} > 0) OR (${t.type} IN ('WRITE_OFF', 'SALE') AND ${t.quantityDelta} < 0) OR ${t.type} = 'ADJUSTMENT'`,
    ),
  ],
);

// ─── Services ─────────────────────────────────────────────────────────────

export const servicesTable = pgTable(
  'services',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    name: varchar({ length: 255 }).notNull(),
    price: money('price').notNull(),
    active: boolean().default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('services_id_organization_unique').on(t.id, t.organizationId),
    uniqueIndex('services_organization_name_unique').on(
      t.organizationId,
      sql`lower(${t.name})`,
    ),
    index('services_organization_active_idx').on(t.organizationId, t.active),
    check('services_price_check', sql`${t.price} >= 0`),
  ],
);
