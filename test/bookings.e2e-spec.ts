import { INestApplication } from '@nestjs/common';
import { db } from '../src';
import { exclusionViolation } from '../src/common/db-errors';
import { bookingsTable } from '../src/db/schema';
import {
  Agent,
  BookingBody,
  cleanup,
  closeDb,
  createApp,
  createCashier,
  ErrorBody,
  getClock,
  getVisit,
  mkPrivateRoom,
  mkPublicRoom,
  mustStartPrivate,
  registerOwner,
  roomState,
  startPrivate,
  VisitBody,
} from './helpers';

describe('Booking (e2e)', () => {
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerOwner>>;
  let other: Awaited<ReturnType<typeof registerOwner>>;
  let cashier: { agent: Agent };
  const clock = () => getClock(app);

  /** ISO-время через N минут от «сейчас» (часы теста заморожены). */
  const at = (minutes: number) =>
    new Date(clock().now().getTime() + minutes * 60_000).toISOString();

  const book = (
    agent: Agent,
    roomId: number,
    fromMinutes: number,
    duration = 60,
    over: Record<string, unknown> = {},
  ) =>
    agent.post('/bookings').send({
      roomId,
      customerName: 'Гость',
      customerPhone: '+7 701 000 00 00',
      startsAt: at(fromMinutes),
      durationMinutes: duration,
      ...over,
    });

  const mustBook = async (
    agent: Agent,
    roomId: number,
    fromMinutes: number,
    duration = 60,
    over: Record<string, unknown> = {},
  ) => {
    const res = await book(agent, roomId, fromMinutes, duration, over);
    if (res.status !== 201)
      throw new Error(`book: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as BookingBody;
  };

  const err = (res: { body: unknown }) => res.body as ErrorBody;

  beforeAll(async () => {
    app = await createApp();
    owner = await registerOwner(app, 'Bookings');
    other = await registerOwner(app, 'Other');
    cashier = await createCashier(owner, app);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    await closeDb();
  });

  describe('создание и валидация', () => {
    it('создаёт бронь: endsAt = startsAt + длительность, статус BOOKED', async () => {
      const room = await mkPrivateRoom(owner.agent, '10000', {
        name: 'VIP-бронь',
      });
      const b = await mustBook(cashier.agent, room.id, 60, 120, {
        notes: 'День рождения',
      });
      expect(b).toMatchObject({
        roomId: room.id,
        roomName: 'VIP-бронь',
        status: 'BOOKED',
        durationMinutes: 120,
        customerName: 'Гость',
        isLate: false,
        visitId: null,
      });
      expect(
        new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime(),
      ).toBe(120 * 60_000);
    });

    it('валидация: прошлое, телефон, длительность, лишние поля, обязательные поля', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const cases: [Record<string, unknown>, number][] = [
        [{ startsAt: at(-60) }, 400],
        [{ customerPhone: 'abc' }, 400],
        [{ customerPhone: '' }, 400],
        [{ customerName: '' }, 400],
        [{ durationMinutes: 45 }, 400],
        [{ durationMinutes: 0 }, 400],
        [{ startsAt: 'вчера' }, 400],
        [{ organizationId: 1 }, 400],
        [{ status: 'STARTED' }, 400],
      ];
      for (const [over, status] of cases) {
        const res = await book(cashier.agent, room.id, 60, 60, over);
        expect(res.status).toBe(status);
        expect(err(res).code).toBe('VALIDATION_ERROR');
      }
    });

    it('PUBLIC-зал бронировать нельзя → 422; архивное помещение → 400; чужое → 404', async () => {
      const pub = await mkPublicRoom(owner.agent);
      const r1 = await book(cashier.agent, pub.id, 60);
      expect(r1.status).toBe(422);
      expect(err(r1).code).toBe('ROOM_TYPE_MISMATCH');

      const archived = await mkPrivateRoom(owner.agent);
      await owner.agent
        .patch(`/rooms/${archived.id}`)
        .send({ active: false })
        .expect(200);
      expect((await book(cashier.agent, archived.id, 60)).status).toBe(400);

      const foreign = await mkPrivateRoom(other.agent);
      expect((await book(cashier.agent, foreign.id, 60)).status).toBe(404);
    });
  });

  describe('пересечения броней', () => {
    it('матрица пересечений [+60,+180): точное, частичное, вложенное, охватывающее → 409; смежные — можно', async () => {
      const room = await mkPrivateRoom(owner.agent);
      await mustBook(cashier.agent, room.id, 60, 120); // [+60, +180)

      const conflicts: [number, number][] = [
        [60, 120], // точное совпадение
        [30, 60], // [+30,+90) — заходит в начало
        [150, 60], // [+150,+210) — заходит в конец
        [90, 60], // внутри
        [0, 240], // охватывает
        [120, 120], // [+120,+240)
      ];
      for (const [from, dur] of conflicts) {
        const res = await book(cashier.agent, room.id, from, dur);
        expect(res.status).toBe(409);
        expect(err(res).code).toBe('BOOKING_CONFLICT');
        expect(res.body).toMatchObject({
          meta: { conflictStartsAt: at(60), conflictEndsAt: at(180) },
        });
      }

      // смежные интервалы не пересекаются
      await mustBook(cashier.agent, room.id, 0, 60); // [0,+60) упирается в начало
      await mustBook(cashier.agent, room.id, 180, 60); // [+180,+240) начинается в конце
      // другое помещение в то же время — свободно
      const room2 = await mkPrivateRoom(owner.agent);
      await mustBook(cashier.agent, room2.id, 60, 120);
    });

    it('отмена и неявка освобождают время; повторная обработка → 409 BOOKING_NOT_ACTIVE', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const a = await mustBook(cashier.agent, room.id, 60, 60);
      expect((await book(cashier.agent, room.id, 60, 60)).status).toBe(409);

      const cancelled = (
        await cashier.agent
          .post(`/bookings/${a.id}/cancel`)
          .send({ reason: 'Передумали' })
          .expect(200)
      ).body as BookingBody;
      expect(cancelled.status).toBe('CANCELLED');
      const b = await mustBook(cashier.agent, room.id, 60, 60); // слот свободен

      const again = await cashier.agent
        .post(`/bookings/${a.id}/cancel`)
        .send({});
      expect(again.status).toBe(409);
      expect(err(again).code).toBe('BOOKING_NOT_ACTIVE');
      expect(
        (await cashier.agent.patch(`/bookings/${a.id}`).send({ notes: 'x' }))
          .status,
      ).toBe(409);

      const noShow = (
        await cashier.agent
          .post(`/bookings/${b.id}/no-show`)
          .send({})
          .expect(200)
      ).body as BookingBody;
      expect(noShow.status).toBe('NO_SHOW');
      await mustBook(cashier.agent, room.id, 60, 60);
    });

    it('перенос: можно сдвинуть внутри собственного слота, конфликт с чужой бронью → 409', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const a = await mustBook(cashier.agent, room.id, 60, 60); // [60,120)
      await mustBook(cashier.agent, room.id, 180, 60); // [180,240)

      const moved = (
        await cashier.agent
          .patch(`/bookings/${a.id}`)
          .send({ startsAt: at(90), durationMinutes: 60 })
          .expect(200)
      ).body as BookingBody;
      expect(moved.startsAt).toBe(at(90));

      const clash = await cashier.agent
        .patch(`/bookings/${a.id}`)
        .send({ startsAt: at(150), durationMinutes: 60 });
      expect(clash.status).toBe(409);
      expect(err(clash).code).toBe('BOOKING_CONFLICT');
      // бронь осталась на прежнем месте
      const list = (
        await cashier.agent.get(`/bookings?roomId=${room.id}`).expect(200)
      ).body as BookingBody[];
      expect(list.find((x) => x.id === a.id)!.startsAt).toBe(at(90));

      // правка имени/телефона без изменения времени не проверяет пересечения
      await cashier.agent
        .patch(`/bookings/${a.id}`)
        .send({ customerName: 'Новое имя' })
        .expect(200);
    });

    it('10 параллельных бронирований одного слота → ровно одна успешная', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => book(cashier.agent, room.id, 60, 60)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      results
        .filter((r) => r.status !== 201)
        .forEach((r) => {
          expect(r.status).toBe(409);
          expect(err(r).code).toBe('BOOKING_CONFLICT');
        });
      const list = (
        await cashier.agent.get(`/bookings?roomId=${room.id}`).expect(200)
      ).body as BookingBody[];
      expect(list).toHaveLength(1);
    });

    it('DB-защита: exclusion constraint не даёт создать пересекающуюся бронь в обход сервиса', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const a = await mustBook(cashier.agent, room.id, 60, 120);
      const failure: unknown = await db
        .insert(bookingsTable)
        .values({
          organizationId: owner.organizationId,
          roomId: room.id,
          customerName: 'Обход',
          customerPhone: '+7 700 000 00 00',
          startsAt: new Date(new Date(a.startsAt).getTime() + 30 * 60_000),
          endsAt: new Date(new Date(a.endsAt).getTime() + 30 * 60_000),
          createdBy: 1,
        })
        .then(() => null)
        .catch((e: unknown) => e);
      expect(exclusionViolation(failure)).toBe('bookings_no_overlap');
    });
  });

  describe('Visit и Booking', () => {
    it('старт по брони: посещение с данными брони на её длительность, бронь → STARTED', async () => {
      const room = await mkPrivateRoom(owner.agent, '10000');
      const b = await mustBook(cashier.agent, room.id, 10, 120, {
        customerName: 'Айгуль',
      });

      const res = await cashier.agent
        .post(`/bookings/${b.id}/start-visit`)
        .send({})
        .expect(201);
      const v = res.body as VisitBody;
      expect(v).toMatchObject({
        status: 'ACTIVE',
        kind: 'PRIVATE',
        bookingId: b.id,
        customerName: 'Айгуль',
        total: '20000.00',
      });
      // стартует «сейчас», а не в запланированное время
      expect(v.startedAt).toBe(clock().now().toISOString());
      expect(
        new Date(v.endsAt!).getTime() - new Date(v.startedAt).getTime(),
      ).toBe(120 * 60_000);

      const list = (
        await cashier.agent
          .get(`/bookings?status=STARTED&roomId=${room.id}`)
          .expect(200)
      ).body as BookingBody[];
      expect(list[0]).toMatchObject({
        id: b.id,
        status: 'STARTED',
        visitId: v.id,
      });

      // повторный старт по той же брони
      const again = await cashier.agent
        .post(`/bookings/${b.id}/start-visit`)
        .send({});
      expect(again.status).toBe(409);
      expect(err(again).code).toBe('BOOKING_NOT_ACTIVE');
    });

    it('старт по брони можно сократить; отмена такого посещения возвращает бронь в BOOKED', async () => {
      const room = await mkPrivateRoom(owner.agent, '10000');
      const b = await mustBook(cashier.agent, room.id, 60, 120);
      const v = (
        await cashier.agent
          .post(`/bookings/${b.id}/start-visit`)
          .send({ durationMinutes: 60 })
          .expect(201)
      ).body as VisitBody;
      expect(v.total).toBe('10000.00');

      await cashier.agent
        .post(`/visits/${v.id}/cancel`)
        .send({ reason: 'Ошиблись' })
        .expect(200);
      const list = (
        await cashier.agent.get(`/bookings?roomId=${room.id}`).expect(200)
      ).body as BookingBody[];
      expect(list.find((x) => x.id === b.id)).toMatchObject({
        status: 'BOOKED',
        visitId: null,
      });
      // и по ней можно начать посещение снова
      await cashier.agent
        .post(`/bookings/${b.id}/start-visit`)
        .send({})
        .expect(201);
    });

    it('walk-in против брони: пересечение → 409 BOOKING_CONFLICT с availableMinutes; короче — можно', async () => {
      const room = await mkPrivateRoom(owner.agent, '10000');
      await mustBook(cashier.agent, room.id, 60, 60);

      const res = await startPrivate(cashier.agent, room.id, 120);
      expect(res.status).toBe(409);
      expect(err(res).code).toBe('BOOKING_CONFLICT');
      expect(res.body).toMatchObject({ meta: { availableMinutes: 60 } });

      // «Баня сейчас» тоже сообщает, сколько минут свободно до брони
      const state = await roomState(cashier.agent, room.id);
      expect(state).toMatchObject({ state: 'AVAILABLE', availableMinutes: 60 });
      expect(state.nextBooking).not.toBeNull();

      // ровно до начала брони — можно
      await mustStartPrivate(cashier.agent, room.id, 60);
    });

    it('бронь против идущего посещения → 409', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const v = await mustStartPrivate(cashier.agent, room.id, 120);
      const res = await book(cashier.agent, room.id, 30, 60);
      expect(res.status).toBe(409);
      expect(err(res).code).toBe('BOOKING_CONFLICT');
      // после отмены посещения слот свободен
      await cashier.agent
        .post(`/visits/${v.id}/cancel`)
        .send({ reason: 'тест' })
        .expect(200);
      await mustBook(cashier.agent, room.id, 30, 60);
    });

    it('продление против следующей брони → 409 BOOKING_CONFLICT (meta.availableMinutes); после отмены брони можно', async () => {
      const room = await mkPrivateRoom(owner.agent, '10000');
      const v = await mustStartPrivate(cashier.agent, room.id, 60); // до +60
      const next = await mustBook(cashier.agent, room.id, 90, 60); // [+90,+150)

      const res = await cashier.agent
        .post(`/visits/${v.id}/extend`)
        .send({ minutes: 60 });
      expect(res.status).toBe(409);
      expect(err(res).code).toBe('BOOKING_CONFLICT');
      expect(res.body).toMatchObject({ meta: { availableMinutes: 30 } });
      // посещение и итог не изменились
      const same = await getVisit(cashier.agent, v.id);
      expect(same.endsAt).toBe(v.endsAt);
      expect(same.total).toBe('10000.00');

      await cashier.agent
        .post(`/bookings/${next.id}/cancel`)
        .send({})
        .expect(200);
      await cashier.agent
        .post(`/visits/${v.id}/extend`)
        .send({ minutes: 60 })
        .expect(200);
    });

    it('продление вплотную к брони (без пересечения) разрешено', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      await mustBook(cashier.agent, room.id, 120, 60); // начинается ровно там, где закончится продление
      const res = await cashier.agent
        .post(`/visits/${v.id}/extend`)
        .send({ minutes: 60 });
      expect(res.status).toBe(200);
    });

    it('гонка: walk-in против создания брони на пересекающееся время → успешно ровно одно', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const [visit, booking] = await Promise.all([
        startPrivate(cashier.agent, room.id, 60), // [0,+60)
        book(cashier.agent, room.id, 30, 60), // [+30,+90)
      ]);
      const successes = [visit.status === 201, booking.status === 201].filter(
        Boolean,
      );
      expect(successes).toHaveLength(1);
      const loser = visit.status === 201 ? booking : visit;
      expect(loser.status).toBe(409);
      expect(err(loser).code).toBe('BOOKING_CONFLICT');
    });

    it('гонка: продление против создания брони вплотную → успешно ровно одно', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const v = await mustStartPrivate(cashier.agent, room.id, 60);
      const [ext, booking] = await Promise.all([
        cashier.agent.post(`/visits/${v.id}/extend`).send({ minutes: 60 }),
        book(cashier.agent, room.id, 60, 60), // [+60,+120): пересекается с продлением
      ]);
      const successes = [ext.status === 200, booking.status === 201].filter(
        Boolean,
      );
      expect(successes).toHaveLength(1);
    });

    it('опоздавшая бронь: isLate после наступления времени; после окончания интервала не блокирует помещение', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const b = await mustBook(cashier.agent, room.id, 30, 60); // [+30,+90)
      expect(b.isLate).toBe(false);

      clock().advanceMinutes(45);
      const late = (
        await cashier.agent.get(`/bookings?roomId=${room.id}`).expect(200)
      ).body as BookingBody[];
      expect(late[0].isLate).toBe(true);
      // walk-in на время брони пока блокируется
      expect((await startPrivate(cashier.agent, room.id, 60)).status).toBe(409);

      clock().advanceMinutes(60); // интервал брони прошёл
      await mustStartPrivate(cashier.agent, room.id, 60);
    });
  });

  describe('список, права и изоляция', () => {
    it('фильтры списка: по умолчанию предстоящие BOOKED; status, roomId, from/to', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const a = await mustBook(cashier.agent, room.id, 60, 60);
      const b = await mustBook(cashier.agent, room.id, 300, 60);
      await cashier.agent.post(`/bookings/${b.id}/cancel`).send({}).expect(200);

      const ids = async (qs: string) =>
        (
          (
            await cashier.agent
              .get(`/bookings?roomId=${room.id}${qs}`)
              .expect(200)
          ).body as BookingBody[]
        ).map((x) => x.id);
      expect(await ids('')).toEqual([a.id]);
      expect(await ids('&status=CANCELLED')).toEqual([b.id]);
      expect(await ids(`&to=${encodeURIComponent(at(30))}`)).toEqual([]);
      expect(
        await ids(`&from=${encodeURIComponent(at(200))}&status=CANCELLED`),
      ).toEqual([b.id]);
      expect((await cashier.agent.get('/bookings?status=WRONG')).status).toBe(
        400,
      );
    });

    it('tenant isolation: чужие брони не видны и недоступны (404)', async () => {
      const room = await mkPrivateRoom(owner.agent);
      const b = await mustBook(cashier.agent, room.id, 60, 60);
      const list = (await other.agent.get('/bookings').expect(200))
        .body as BookingBody[];
      expect(list.some((x) => x.id === b.id)).toBe(false);

      await other.agent
        .patch(`/bookings/${b.id}`)
        .send({ notes: 'x' })
        .expect(404);
      await other.agent.post(`/bookings/${b.id}/cancel`).send({}).expect(404);
      await other.agent.post(`/bookings/${b.id}/no-show`).send({}).expect(404);
      await other.agent
        .post(`/bookings/${b.id}/start-visit`)
        .send({})
        .expect(404);
      // бронь не пострадала
      const still = (
        await cashier.agent.get(`/bookings?roomId=${room.id}`).expect(200)
      ).body as BookingBody[];
      expect(still[0].status).toBe('BOOKED');
    });
  });
});
