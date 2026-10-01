import { Injectable } from '@nestjs/common';
import { db } from 'src';
import { Clock } from 'src/common/clock';
import type { AuthUser } from 'src/types/express';
import {
  AddGuestsDto,
  AddProductDto,
  AddServiceDto,
  CancelVisitDto,
  CompleteVisitDto,
  CreatePaymentDto,
  ExtendVisitDto,
  ListVisitsQueryDto,
  StartPrivateVisitDto,
  StartPublicVisitDto,
  VoidItemDto,
} from './dto/visit.dto';
import {
  addGuests,
  addPayment,
  addProduct,
  addService,
  cancelVisit,
  completeAllPaid,
  completeVisit,
  extendVisit,
  finishCleaning,
  mapVisitDbError,
  startPrivateVisit,
  startPublicVisit,
  visitRoomId,
  voidItem,
} from './visit-ops';
import { listVisits, loadVisitDetail } from './visit-view';

/**
 * Тонкая обёртка: транзакция + время (Clock) + ответ VisitDetail, собранный в той же транзакции.
 * Вся бизнес-логика — в visit-ops.ts.
 */
@Injectable()
export class VisitsService {
  constructor(private readonly clock: Clock) {}

  private async run<T>(
    fn: (
      tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
      now: Date,
    ) => Promise<T>,
  ) {
    const now = this.clock.now();
    try {
      return await db.transaction((tx) => fn(tx, now));
    } catch (err) {
      throw mapVisitDbError(err);
    }
  }

  startPrivate(user: AuthUser, dto: StartPrivateVisitDto) {
    return this.run(async (tx, now) => {
      const id = await startPrivateVisit(tx, {
        user,
        now,
        roomId: dto.roomId,
        durationMinutes: dto.durationMinutes,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        guestsCount: dto.guestsCount,
      });
      return loadVisitDetail(tx, user, id, now);
    });
  }

  startPublic(user: AuthUser, dto: StartPublicVisitDto) {
    return this.run(async (tx, now) => {
      const id = await startPublicVisit(tx, {
        user,
        now,
        roomId: dto.roomId,
        guests: dto.guests,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
      });
      return loadVisitDetail(tx, user, id, now);
    });
  }

  get(user: AuthUser, visitId: number) {
    return this.run((tx, now) => loadVisitDetail(tx, user, visitId, now));
  }

  list(user: AuthUser, query: ListVisitsQueryDto) {
    return this.run((tx, now) => listVisits(tx, user, query, now));
  }

  addProduct(user: AuthUser, visitId: number, dto: AddProductDto) {
    return this.run(async (tx, now) => {
      await addProduct(tx, {
        user,
        visitId,
        productId: dto.productId,
        quantity: dto.quantity,
      });
      return loadVisitDetail(tx, user, visitId, now);
    });
  }

  addService(user: AuthUser, visitId: number, dto: AddServiceDto) {
    return this.run(async (tx, now) => {
      await addService(tx, {
        user,
        visitId,
        serviceId: dto.serviceId,
        quantity: dto.quantity,
      });
      return loadVisitDetail(tx, user, visitId, now);
    });
  }

  addGuests(user: AuthUser, visitId: number, dto: AddGuestsDto) {
    return this.run(async (tx, now) => {
      const roomId = await visitRoomId(tx, user.organizationId, visitId);
      await addGuests(tx, { user, visitId, roomId, guests: dto.guests });
      return loadVisitDetail(tx, user, visitId, now);
    });
  }

  extend(user: AuthUser, visitId: number, dto: ExtendVisitDto) {
    return this.run(async (tx, now) => {
      const roomId = await visitRoomId(tx, user.organizationId, visitId);
      await extendVisit(tx, { user, visitId, roomId, minutes: dto.minutes });
      return loadVisitDetail(tx, user, visitId, now);
    });
  }

  voidItem(user: AuthUser, visitId: number, itemId: number, dto: VoidItemDto) {
    return this.run(async (tx, now) => {
      await voidItem(tx, { user, visitId, itemId, reason: dto.reason, now });
      return loadVisitDetail(tx, user, visitId, now);
    });
  }

  addPayment(user: AuthUser, visitId: number, dto: CreatePaymentDto) {
    return this.run(async (tx, now) => {
      await addPayment(tx, { user, visitId, payment: dto });
      return loadVisitDetail(tx, user, visitId, now);
    });
  }

  complete(user: AuthUser, visitId: number, dto: CompleteVisitDto) {
    return this.run(async (tx, now) => {
      const roomId = await visitRoomId(tx, user.organizationId, visitId);
      await completeVisit(tx, {
        user,
        visitId,
        roomId,
        payments: dto.payments ?? [],
        now,
      });
      return loadVisitDetail(tx, user, visitId, now);
    });
  }

  cancel(user: AuthUser, visitId: number, dto: CancelVisitDto) {
    return this.run(async (tx, now) => {
      const roomId = await visitRoomId(tx, user.organizationId, visitId);
      await cancelVisit(tx, {
        user,
        visitId,
        roomId,
        reason: dto.reason,
        now,
      });
      return loadVisitDetail(tx, user, visitId, now);
    });
  }

  finishCleaning(user: AuthUser, roomId: number) {
    return this.run(async (tx, now) => {
      await finishCleaning(tx, { user, roomId, now });
      return { finished: true };
    });
  }

  completeAllPaid(user: AuthUser, roomId: number) {
    return this.run(async (tx, now) => {
      const completed = await completeAllPaid(tx, { user, roomId, now });
      return { completed };
    });
  }
}
