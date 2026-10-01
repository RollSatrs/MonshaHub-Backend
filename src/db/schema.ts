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
/** Новые временные колонки — с часовым поясом (timestamptz). */
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const createdAtTz = () => tstz('created_at').defaultNow().notNull();
const updatedAtTz = () =>
  tstz('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());
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
  'SALE_RETURN',
]);
export const bookingStatusEnum = pgEnum('booking_status', [
  'BOOKED',
  'STARTED',
  'CANCELLED',
  'NO_SHOW',
]);
export const visitStatusEnum = pgEnum('visit_status', [
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
]);
export const visitItemKindEnum = pgEnum('visit_item_kind', [
  'ROOM_TIME',
  'ENTRY',
  'PRODUCT',
  'SERVICE',
]);
export const paymentMethodEnum = pgEnum('payment_method', [
  'CASH',
  'CARD',
  'KASPI',
  'OTHER',
]);

// ─── Organization / users ─────────────────────────────────────────────────

export const organizationsTable = pgTable(
  'organizations',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 255 }).notNull(),
    // Пока не изменяются через API: смена валюты сделала бы исторические суммы
    // неоднозначными, смена часового пояса сдвинула бы границы «сегодня».
    currency: char({ length: 3 }).default('KZT').notNull(),
    timezone: varchar({ length: 64 }).default('Asia/Almaty').notNull(),
    // Шаг оплачиваемого времени PRIVATE-посещения: длительность старта и продления кратны шагу.
    // Копируется в Visit при старте, изменение не затрагивает начатые посещения.
    timeStepMinutes: integer('time_step_minutes').default(60).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'organizations_time_step_check',
      sql`${t.timeStepMinutes} IN (15, 30, 60)`,
    ),
  ],
);

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
    // продажа/возврат в рамках посещения (SALE / SALE_RETURN)
    visitItemId: integer('visit_item_id'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => usersTable.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'stock_movements_visit_item_fk',
      columns: [t.visitItemId, t.organizationId],
      foreignColumns: [visitItemsTable.id, visitItemsTable.organizationId],
    }),
    index('stock_movements_visit_item_idx').on(t.visitItemId),
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
      // сравнение через ::text — чтобы миграция не использовала новое значение enum в той же транзакции
      sql`(${t.type}::text IN ('RESTOCK', 'SALE_RETURN') AND ${t.quantityDelta} > 0) OR (${t.type}::text IN ('WRITE_OFF', 'SALE') AND ${t.quantityDelta} < 0) OR ${t.type}::text = 'ADJUSTMENT'`,
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

// ─── Bookings ─────────────────────────────────────────────────────────────

/**
 * Бронь PRIVATE-помещения. Резервирует помещение, пока status = BOOKED и интервал не прошёл.
 * Пересечения активных броней одного помещения запрещены: блокировкой помещения в сервисе
 * и exclusion constraint в PostgreSQL (см. custom-миграцию bookings_no_overlap).
 */
export const bookingsTable = pgTable(
  'bookings',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    roomId: integer('room_id').notNull(),
    customerName: varchar('customer_name', { length: 255 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 32 }).notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    status: bookingStatusEnum().default('BOOKED').notNull(),
    notes: varchar({ length: 500 }),
    createdBy: integer('created_by')
      .notNull()
      .references(() => usersTable.id),
    // отмена / неявка: кто, когда, почему
    closedAt: tstz('closed_at'),
    closedBy: integer('closed_by').references(() => usersTable.id),
    closeReason: varchar('close_reason', { length: 500 }),
    createdAt: createdAtTz(),
    updatedAt: updatedAtTz(),
  },
  (t) => [
    foreignKey({
      name: 'bookings_room_organization_fk',
      columns: [t.roomId, t.organizationId],
      foreignColumns: [roomsTable.id, roomsTable.organizationId],
    }),
    unique('bookings_id_organization_unique').on(t.id, t.organizationId),
    index('bookings_room_starts_idx').on(t.roomId, t.startsAt),
    index('bookings_organization_starts_idx').on(t.organizationId, t.startsAt),
    check('bookings_interval_check', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

// ─── Visits ───────────────────────────────────────────────────────────────

/**
 * Visit — единый счёт посещения (PRIVATE: аренда помещения по времени; PUBLIC: чек человека/группы).
 * Итог не хранится: это сумма visit_items без погашенных. Название помещения, тариф и валюта
 * копируются в момент старта — история не меняется после правки каталога.
 */
export const visitsTable = pgTable(
  'visits',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    roomId: integer('room_id').notNull(),
    kind: roomTypeEnum().notNull(),
    status: visitStatusEnum().default('ACTIVE').notNull(),
    bookingId: integer('booking_id'),
    customerName: varchar('customer_name', { length: 255 }),
    customerPhone: varchar('customer_phone', { length: 32 }),
    guestsCount: integer('guests_count'),
    startedAt: tstz('started_at').notNull(),
    // PRIVATE: оплаченный конец времени (растёт при продлении). PUBLIC: null.
    endsAt: tstz('ends_at'),
    // фактическое завершение (COMPLETED)
    endedAt: tstz('ended_at'),
    completedBy: integer('completed_by').references(() => usersTable.id),
    // snapshot на момент старта
    roomName: varchar('room_name', { length: 255 }).notNull(),
    tariffId: integer('tariff_id'),
    tariffName: varchar('tariff_name', { length: 255 }),
    hourlyRate: money('hourly_rate'),
    timeStepMinutes: integer('time_step_minutes'),
    currency: char({ length: 3 }).notNull(),
    // отмена: кто, когда, почему
    cancelledAt: tstz('cancelled_at'),
    cancelledBy: integer('cancelled_by').references(() => usersTable.id),
    cancelReason: varchar('cancel_reason', { length: 500 }),
    createdBy: integer('created_by')
      .notNull()
      .references(() => usersTable.id),
    createdAt: createdAtTz(),
    updatedAt: updatedAtTz(),
  },
  (t) => [
    foreignKey({
      name: 'visits_room_organization_fk',
      columns: [t.roomId, t.organizationId],
      foreignColumns: [roomsTable.id, roomsTable.organizationId],
    }),
    foreignKey({
      name: 'visits_booking_organization_fk',
      columns: [t.bookingId, t.organizationId],
      foreignColumns: [bookingsTable.id, bookingsTable.organizationId],
    }),
    foreignKey({
      name: 'visits_tariff_organization_fk',
      columns: [t.tariffId, t.organizationId],
      foreignColumns: [tariffsTable.id, tariffsTable.organizationId],
    }),
    unique('visits_id_organization_unique').on(t.id, t.organizationId),
    // не более одного активного PRIVATE-посещения на помещение (защита от параллельного старта)
    uniqueIndex('visits_active_private_room_unique')
      .on(t.roomId)
      .where(sql`${t.status} = 'ACTIVE' AND ${t.kind} = 'PRIVATE'`),
    // одна бронь — одно неотменённое посещение
    uniqueIndex('visits_booking_unique')
      .on(t.bookingId)
      .where(sql`${t.bookingId} IS NOT NULL AND ${t.status} <> 'CANCELLED'`),
    index('visits_organization_status_idx').on(t.organizationId, t.status),
    index('visits_room_status_idx').on(t.roomId, t.status),
    index('visits_organization_started_idx').on(t.organizationId, t.startedAt),
    check(
      'visits_private_fields_check',
      sql`(${t.kind} = 'PRIVATE' AND ${t.endsAt} IS NOT NULL AND ${t.hourlyRate} IS NOT NULL AND ${t.timeStepMinutes} IS NOT NULL) OR (${t.kind} = 'PUBLIC' AND ${t.endsAt} IS NULL)`,
    ),
  ],
);

export const visitItemsTable = pgTable(
  'visit_items',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    visitId: integer('visit_id').notNull(),
    kind: visitItemKindEnum().notNull(),
    productId: integer('product_id'),
    serviceId: integer('service_id'),
    tariffId: integer('tariff_id'),
    // snapshot: цена и название на момент добавления
    nameSnapshot: varchar('name_snapshot', { length: 255 }).notNull(),
    unitPrice: money('unit_price').notNull(),
    quantity: integer().default(1).notNull(),
    // ROOM_TIME: оплаченные минуты; ENTRY: категория гостя
    minutes: integer(),
    guestCategory: guestCategoryEnum('guest_category'),
    // считает backend при вставке; итог посещения = сумма line_total без погашенных
    lineTotal: money('line_total').notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => usersTable.id),
    createdAt: createdAtTz(),
    // исправление ошибки: позиция не удаляется, а гасится (кто, когда, почему)
    voidedAt: tstz('voided_at'),
    voidedBy: integer('voided_by').references(() => usersTable.id),
    voidReason: varchar('void_reason', { length: 500 }),
  },
  (t) => [
    foreignKey({
      name: 'visit_items_visit_organization_fk',
      columns: [t.visitId, t.organizationId],
      foreignColumns: [visitsTable.id, visitsTable.organizationId],
    }),
    foreignKey({
      name: 'visit_items_product_organization_fk',
      columns: [t.productId, t.organizationId],
      foreignColumns: [productsTable.id, productsTable.organizationId],
    }),
    foreignKey({
      name: 'visit_items_service_organization_fk',
      columns: [t.serviceId, t.organizationId],
      foreignColumns: [servicesTable.id, servicesTable.organizationId],
    }),
    foreignKey({
      name: 'visit_items_tariff_organization_fk',
      columns: [t.tariffId, t.organizationId],
      foreignColumns: [tariffsTable.id, tariffsTable.organizationId],
    }),
    unique('visit_items_id_organization_unique').on(t.id, t.organizationId),
    index('visit_items_visit_idx').on(t.visitId),
    index('visit_items_organization_kind_created_idx').on(
      t.organizationId,
      t.kind,
      t.createdAt,
    ),
    check('visit_items_quantity_check', sql`${t.quantity} > 0`),
    check(
      'visit_items_amounts_check',
      sql`${t.unitPrice} >= 0 AND ${t.lineTotal} >= 0`,
    ),
    check(
      'visit_items_kind_check',
      sql`(${t.kind} = 'PRODUCT' AND ${t.productId} IS NOT NULL) OR (${t.kind} = 'SERVICE' AND ${t.serviceId} IS NOT NULL) OR (${t.kind} = 'ENTRY' AND ${t.guestCategory} IS NOT NULL) OR (${t.kind} = 'ROOM_TIME' AND ${t.minutes} IS NOT NULL AND ${t.minutes} > 0)`,
    ),
    check(
      'visit_items_void_check',
      sql`(${t.voidedAt} IS NULL) = (${t.voidedBy} IS NULL)`,
    ),
  ],
);

export const paymentsTable = pgTable(
  'payments',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    visitId: integer('visit_id').notNull(),
    amount: money('amount').notNull(),
    method: paymentMethodEnum().notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => usersTable.id),
    createdAt: createdAtTz(),
  },
  (t) => [
    foreignKey({
      name: 'payments_visit_organization_fk',
      columns: [t.visitId, t.organizationId],
      foreignColumns: [visitsTable.id, visitsTable.organizationId],
    }),
    index('payments_visit_idx').on(t.visitId),
    index('payments_organization_created_idx').on(
      t.organizationId,
      t.createdAt,
    ),
    check('payments_amount_check', sql`${t.amount} > 0`),
  ],
);

/** Уборка PRIVATE-помещения после посещения: открыта (finished_at IS NULL) = помещение в состоянии CLEANING. */
export const roomCleaningsTable = pgTable(
  'room_cleanings',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizationsTable.id, { onDelete: 'cascade' }),
    roomId: integer('room_id').notNull(),
    visitId: integer('visit_id').notNull(),
    startedAt: tstz('started_at').notNull(),
    finishedAt: tstz('finished_at'),
    finishedBy: integer('finished_by').references(() => usersTable.id),
  },
  (t) => [
    foreignKey({
      name: 'room_cleanings_room_organization_fk',
      columns: [t.roomId, t.organizationId],
      foreignColumns: [roomsTable.id, roomsTable.organizationId],
    }),
    foreignKey({
      name: 'room_cleanings_visit_organization_fk',
      columns: [t.visitId, t.organizationId],
      foreignColumns: [visitsTable.id, visitsTable.organizationId],
    }),
    unique('room_cleanings_visit_unique').on(t.visitId),
    // у помещения не более одной открытой уборки
    uniqueIndex('room_cleanings_open_room_unique')
      .on(t.roomId)
      .where(sql`${t.finishedAt} IS NULL`),
    index('room_cleanings_organization_started_idx').on(
      t.organizationId,
      t.startedAt,
    ),
  ],
);
