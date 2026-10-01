import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inArray, like } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/mail/mail.service';
import { Clock } from '../src/common/clock';
import { db } from '../src';
import { organizationsTable, usersTable } from '../src/db/schema';

export const PASSWORD = 'password123';
export const TEST_EMAIL_DOMAIN = '@e2e.monshahub.test';

export const sentResetTokens: { to: string; token: string }[] = [];

/** Управляемые часы: время «заморожено» и двигается только явно — состояния зависят от времени детерминированно. */
export class TestClock extends Clock {
  private current = new Date();
  now(): Date {
    return new Date(this.current);
  }
  set(date: Date) {
    this.current = new Date(date);
  }
  advanceMinutes(minutes: number) {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

export function getClock(app: INestApplication): TestClock {
  return app.get(Clock);
}

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(new TestClock())
    .overrideProvider(MailService)
    .useValue({
      sendPasswordReset: (to: string, token: string) => {
        sentResetTokens.push({ to, token });
        return Promise.resolve();
      },
    })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  // постоянный эфемерный порт: параллельные запросы supertest не пересоздают listen
  await app.listen(0);
  return app;
}

let counter = 0;
export function uniqueEmail(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}${TEST_EMAIL_DOMAIN}`;
}

/** Регистрирует организацию + OWNER и возвращает агента с cookie. */
export async function registerOwner(app: INestApplication, name = 'Org') {
  const email = uniqueEmail('owner');
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      organizationName: `E2E ${name} ${email}`,
      fullname: 'Owner',
      email,
      password: PASSWORD,
    })
    .expect(201);
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return {
    agent,
    email,
    organizationId: (res.body as { user: { organizationId: number } }).user
      .organizationId,
  };
}

export async function createCashier(
  owner: { agent: ReturnType<typeof request.agent> },
  app: INestApplication,
) {
  const email = uniqueEmail('cashier');
  await owner.agent
    .post('/staff/cashiers')
    .send({ fullname: 'Cashier', email, password: PASSWORD })
    .expect(201);
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return { agent, email };
}

/** Удаляет данные, созданные e2e (пользователи с тестовым доменом и их организации). */
export async function cleanup() {
  const users = await db
    .select({ orgId: usersTable.organizationId })
    .from(usersTable)
    .where(like(usersTable.email, `%${TEST_EMAIL_DOMAIN}`));
  const orgIds = [...new Set(users.map((u) => u.orgId))];
  if (orgIds.length) {
    await db
      .delete(organizationsTable)
      .where(inArray(organizationsTable.id, orgIds));
  }
}

/** Закрывает пул соединений, чтобы Jest завершался без --forceExit. */
export async function closeDb() {
  await db.$client.end();
}

// ─── Phase 1: справочники ─────────────────────────────────────────────────

export type Agent = ReturnType<typeof request.agent>;

let nameCounter = 0;
export function uniqueName(prefix: string) {
  nameCounter += 1;
  return `${prefix} ${Date.now()}-${nameCounter}`;
}

export interface RoomBody {
  id: number;
  name: string;
  type: 'PRIVATE' | 'PUBLIC';
  capacity: number;
  sortOrder: number;
  active: boolean;
  activeTariffs: TariffBody[];
}

export interface TariffBody {
  id: number;
  roomId: number;
  kind: 'HOURLY' | 'PER_ENTRY';
  guestCategory: 'ADULT' | 'CHILD' | null;
  name: string;
  price: string;
  active: boolean;
}

export interface ProductBody {
  id: number;
  name: string;
  price: string;
  stock: number;
  active: boolean;
}

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: string[];
}

export async function mkRoom(agent: Agent, over: Record<string, unknown> = {}) {
  const res = await agent
    .post('/rooms')
    .send({ name: uniqueName('Room'), type: 'PRIVATE', capacity: 6, ...over })
    .expect(201);
  return res.body as RoomBody;
}

export async function mkTariff(
  agent: Agent,
  roomId: number,
  over: Record<string, unknown> = {},
) {
  const res = await agent
    .post('/tariffs')
    .send({ roomId, name: 'Почасовой', price: '10000', ...over })
    .expect(201);
  return res.body as TariffBody;
}

export async function mkProduct(
  agent: Agent,
  over: Record<string, unknown> = {},
) {
  const res = await agent
    .post('/products')
    .send({ name: uniqueName('Product'), price: '2500', stock: 0, ...over })
    .expect(201);
  return res.body as ProductBody;
}

// ─── Phase 2: посещения, брони, live ──────────────────────────────────────

export interface VisitItemBody {
  id: number;
  kind: 'ROOM_TIME' | 'ENTRY' | 'PRODUCT' | 'SERVICE';
  name: string;
  unitPrice: string;
  quantity: number;
  minutes: number | null;
  guestCategory: 'ADULT' | 'CHILD' | null;
  lineTotal: string;
  voided: boolean;
  voidedByName: string | null;
  voidReason: string | null;
}

export interface VisitBody {
  id: number;
  kind: 'PRIVATE' | 'PUBLIC';
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  roomId: number;
  roomName: string;
  bookingId: number | null;
  customerName: string | null;
  startedAt: string;
  endsAt: string | null;
  endedAt: string | null;
  currency: string;
  timeStepMinutes: number | null;
  hourlyRate: string | null;
  timeState: 'OCCUPIED' | 'ENDING_SOON' | 'OVERTIME' | null;
  remainingSeconds: number | null;
  items: VisitItemBody[];
  payments: {
    id: number;
    amount: string;
    method: string;
    createdByName: string | null;
  }[];
  total: string;
  paid: string;
  balance: string;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  guests: number | null;
  cancelReason: string | null;
  cancelledByName: string | null;
  serverTime: string;
}

export interface BookingBody {
  id: number;
  roomId: number;
  roomName: string;
  customerName: string;
  customerPhone: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: 'BOOKED' | 'STARTED' | 'CANCELLED' | 'NO_SHOW';
  isLate: boolean;
  visitId: number | null;
}

export interface LiveRoomBody {
  id: number;
  name: string;
  type: 'PRIVATE' | 'PUBLIC';
  state: string;
  capacity: number;
  visit: {
    id: number;
    total: string;
    paid: string;
    balance: string;
    paymentStatus: string;
    endsAt: string | null;
  } | null;
  cleaningStartedAt: string | null;
  nextBooking: { id: number; startsAt: string; endsAt: string } | null;
  availableMinutes: number | null;
  inside: number | null;
  activeVisits: number | null;
  hasTariff: boolean;
}

export interface BoardBody {
  serverTime: string;
  endingSoonMinutes: number;
  currency: string;
  timeStepMinutes: number;
  rooms: LiveRoomBody[];
}

/** PRIVATE-помещение с почасовым тарифом. */
export async function mkPrivateRoom(
  agent: Agent,
  price = '10000',
  over: Record<string, unknown> = {},
) {
  const room = await mkRoom(agent, { type: 'PRIVATE', ...over });
  await mkTariff(agent, room.id, { name: 'Почасовой', price });
  return room;
}

/** PUBLIC-помещение с тарифами входа. */
export async function mkPublicRoom(
  agent: Agent,
  capacity = 60,
  adult = '2000',
  child: string | null = '1000',
) {
  const room = await mkRoom(agent, { type: 'PUBLIC', capacity });
  await mkTariff(agent, room.id, {
    name: 'Взрослый',
    guestCategory: 'ADULT',
    price: adult,
  });
  if (child !== null) {
    await mkTariff(agent, room.id, {
      name: 'Детский',
      guestCategory: 'CHILD',
      price: child,
    });
  }
  return room;
}

export async function startPrivate(
  agent: Agent,
  roomId: number,
  durationMinutes = 60,
  extra: Record<string, unknown> = {},
): Promise<request.Response> {
  const res = await agent
    .post('/visits/private')
    .send({ roomId, durationMinutes, ...extra });
  return res;
}

export async function mustStartPrivate(
  agent: Agent,
  roomId: number,
  durationMinutes = 60,
  extra: Record<string, unknown> = {},
) {
  const res = await startPrivate(agent, roomId, durationMinutes, extra);
  if (res.status !== 201)
    throw new Error(`start private: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as VisitBody;
}

export async function mustStartPublic(
  agent: Agent,
  roomId: number,
  guests: { category: 'ADULT' | 'CHILD'; quantity: number }[] = [
    { category: 'ADULT', quantity: 1 },
  ],
) {
  const res = await agent.post('/visits/public').send({ roomId, guests });
  if (res.status !== 201)
    throw new Error(`start public: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as VisitBody;
}

export async function board(agent: Agent) {
  return (await agent.get('/live/board').expect(200)).body as BoardBody;
}

export async function roomState(agent: Agent, roomId: number) {
  const b = await board(agent);
  return b.rooms.find((r) => r.id === roomId)!;
}

export async function getVisit(agent: Agent, id: number) {
  return (await agent.get(`/visits/${id}`).expect(200)).body as VisitBody;
}

export async function payAndComplete(
  agent: Agent,
  visit: VisitBody,
  method = 'CASH',
): Promise<request.Response> {
  const res = await agent.post(`/visits/${visit.id}/complete`).send({
    payments:
      visit.balance === '0.00' ? [] : [{ method, amount: visit.balance }],
  });
  return res;
}
