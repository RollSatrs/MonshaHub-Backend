import { ApiProperty } from '@nestjs/swagger';
import { PAYMENT_STATUSES } from 'src/visits/dto/visit.dto';
import type { PaymentStatus } from 'src/visits/dto/visit.dto';
import { ROOM_STATES } from '../room-state';
import type { RoomState } from '../room-state';

export class LiveVisitDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty() startedAt: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'PRIVATE: оплаченный конец',
  })
  endsAt: string | null;
  @ApiProperty({ type: String, example: '31500.00' }) total: string;
  @ApiProperty({ type: String, example: '0.00' }) paid: string;
  @ApiProperty({ type: String, example: '31500.00' }) balance: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) paymentStatus: PaymentStatus;
}

export class LiveBookingDto {
  @ApiProperty() id: number;
  @ApiProperty() customerName: string;
  @ApiProperty() startsAt: string;
  @ApiProperty() endsAt: string;
}

export class LiveRoomDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ['PRIVATE', 'PUBLIC'] }) type: 'PRIVATE' | 'PUBLIC';
  @ApiProperty() capacity: number;
  @ApiProperty({
    enum: ROOM_STATES,
    description:
      'Вычисляет backend. PRIVATE: AVAILABLE, OCCUPIED, ENDING_SOON, OVERTIME, CLEANING. PUBLIC: OPEN, FULL.',
  })
  state: RoomState;
  @ApiProperty({
    type: LiveVisitDto,
    nullable: true,
    description: 'PRIVATE: идущее посещение',
  })
  visit: LiveVisitDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'CLEANING: когда началась уборка',
  })
  cleaningStartedAt: string | null;
  @ApiProperty({
    type: LiveBookingDto,
    nullable: true,
    description: 'Ближайшая будущая бронь (PRIVATE)',
  })
  nextBooking: LiveBookingDto | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Для AVAILABLE: сколько минут свободно до ближайшей брони (null — брони нет)',
  })
  availableMinutes: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'PUBLIC: сколько человек внутри',
  })
  inside: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'PUBLIC: сколько активных чеков',
  })
  activeVisits: number | null;
  @ApiProperty({
    description: 'false — не задан нужный тариф, начать посещение нельзя',
  })
  hasTariff: boolean;
}

export class LiveBoardDto {
  @ApiProperty({
    description: 'Время сервера — от него считать обратный отсчёт',
  })
  serverTime: string;
  @ApiProperty({
    description: 'За сколько минут до конца помещение становится ENDING_SOON',
  })
  endingSoonMinutes: number;
  @ApiProperty({ example: 'KZT' }) currency: string;
  @ApiProperty({ example: 'Asia/Almaty' }) timezone: string;
  @ApiProperty({ description: 'Шаг оплачиваемого времени (15/30/60)' })
  timeStepMinutes: number;
  @ApiProperty({ type: [LiveRoomDto] }) rooms: LiveRoomDto[];
}

export class InsideVisitDto {
  @ApiProperty() visitId: number;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty() adults: number;
  @ApiProperty() children: number;
  @ApiProperty() guests: number;
  @ApiProperty() startedAt: string;
  @ApiProperty({ type: String, example: '2000.00' }) total: string;
  @ApiProperty({ type: String, example: '2000.00' }) paid: string;
  @ApiProperty({ type: String, example: '0.00' }) balance: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) paymentStatus: PaymentStatus;
}

export class InsideDto {
  @ApiProperty() roomId: number;
  @ApiProperty() roomName: string;
  @ApiProperty() capacity: number;
  @ApiProperty() inside: number;
  @ApiProperty({ type: [InsideVisitDto] }) visits: InsideVisitDto[];
  @ApiProperty({ description: 'Serverное время' }) serverTime: string;
}
