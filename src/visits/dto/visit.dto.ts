import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsMoney } from 'src/common/decorators/is-money.decorator';

export const VISIT_KINDS = ['PRIVATE', 'PUBLIC'] as const;
export const VISIT_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export const VISIT_ITEM_KINDS = [
  'ROOM_TIME',
  'ENTRY',
  'PRODUCT',
  'SERVICE',
] as const;
export const PAYMENT_METHODS = ['CASH', 'CARD', 'KASPI', 'OTHER'] as const;
export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export const GUEST_CATEGORIES = ['ADULT', 'CHILD'] as const;
export const TIME_STATES = ['OCCUPIED', 'ENDING_SOON', 'OVERTIME'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Пробелы по краям обрезаются до валидации: причина из одних пробелов считается пустой. */
const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

const PHONE_RE = /^[+\d][\d\s()-]{3,30}$/;

// ─── ответы ───────────────────────────────────────────────────────────────

export class VisitItemDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: VISIT_ITEM_KINDS })
  kind: (typeof VISIT_ITEM_KINDS)[number];
  @ApiProperty({ description: 'Название на момент добавления (snapshot)' })
  name: string;
  @ApiProperty({
    type: String,
    example: '2500.00',
    description: 'Цена на момент добавления (snapshot)',
  })
  unitPrice: string;
  @ApiProperty() quantity: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'ROOM_TIME: оплаченные минуты',
  })
  minutes: number | null;
  @ApiProperty({ enum: GUEST_CATEGORIES, nullable: true })
  guestCategory: (typeof GUEST_CATEGORIES)[number] | null;
  @ApiProperty({
    type: String,
    example: '5000.00',
    description: 'Сумма позиции (считает backend)',
  })
  lineTotal: string;
  @ApiProperty({ description: 'true — позиция убрана (в итог не входит)' })
  voided: boolean;
  @ApiProperty({ type: String, nullable: true }) voidedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) voidedByName: string | null;
  @ApiProperty({ type: String, nullable: true }) voidReason: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
}

export class PaymentDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, example: '10000.00' }) amount: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) method: PaymentMethod;
  @ApiProperty() createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
}

export class VisitDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: VISIT_KINDS }) kind: (typeof VISIT_KINDS)[number];
  @ApiProperty({ enum: VISIT_STATUSES })
  status: (typeof VISIT_STATUSES)[number];
  @ApiProperty() roomId: number;
  @ApiProperty({
    description: 'Название помещения на момент старта (snapshot)',
  })
  roomName: string;
  @ApiProperty({ type: Number, nullable: true }) bookingId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ type: String, nullable: true }) customerPhone: string | null;
  @ApiProperty({ type: Number, nullable: true }) guestsCount: number | null;
  @ApiProperty() startedAt: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'PRIVATE: оплаченный конец времени',
  })
  endsAt: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Фактическое завершение',
  })
  endedAt: string | null;
  @ApiProperty({ example: 'KZT' }) currency: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Шаг времени, действовавший при старте',
  })
  timeStepMinutes: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '10000.00',
    description: 'Часовая ставка на момент старта',
  })
  hourlyRate: string | null;
  @ApiProperty({
    enum: TIME_STATES,
    nullable: true,
    description: 'Только для ACTIVE PRIVATE, вычисляет backend',
  })
  timeState: (typeof TIME_STATES)[number] | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Секунд до конца на serverTime (отрицательное — просрочка)',
  })
  remainingSeconds: number | null;
  @ApiProperty({ type: [VisitItemDto] }) items: VisitItemDto[];
  @ApiProperty({ type: [PaymentDto] }) payments: PaymentDto[];
  @ApiProperty({
    type: String,
    example: '31500.00',
    description: 'Итог = сумма позиций без убранных',
  })
  total: string;
  @ApiProperty({ type: String, example: '0.00' }) paid: string;
  @ApiProperty({
    type: String,
    example: '31500.00',
    description: 'Осталось оплатить',
  })
  balance: string;
  @ApiProperty({ enum: PAYMENT_STATUSES }) paymentStatus: PaymentStatus;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'PUBLIC: сколько гостей в этом чеке',
  })
  guests: number | null;
  @ApiProperty({ type: String, nullable: true }) completedByName: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelledAt: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelledByName: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty({
    description: 'Время сервера — от него считать обратный отсчёт',
  })
  serverTime: string;
}

export class VisitSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: VISIT_KINDS }) kind: (typeof VISIT_KINDS)[number];
  @ApiProperty({ enum: VISIT_STATUSES })
  status: (typeof VISIT_STATUSES)[number];
  @ApiProperty() roomName: string;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty() startedAt: string;
  @ApiProperty({ type: String, nullable: true }) endedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelledAt: string | null;
  @ApiProperty({ type: String, example: '31500.00' }) total: string;
  @ApiProperty({ type: String, example: '31500.00' }) paid: string;
  @ApiProperty({
    description:
      'Сколько позиций было убрано (OWNER видит подробности в посещении)',
  })
  voidedItemsCount: number;
  @ApiProperty({ type: Number, nullable: true }) guests: number | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
}

export class VisitListDto {
  @ApiProperty({ type: [VisitSummaryDto] }) items: VisitSummaryDto[];
  @ApiProperty() hasMore: boolean;
}

export class MessageCountDto {
  @ApiProperty({ description: 'Сколько посещений завершено' })
  completed: number;
}

// ─── запросы ──────────────────────────────────────────────────────────────

export class GuestDto {
  @ApiProperty({ enum: GUEST_CATEGORIES })
  @IsEnum(GUEST_CATEGORIES)
  category: (typeof GUEST_CATEGORIES)[number];

  @ApiProperty({ minimum: 1, maximum: 200, example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  quantity: number;
}

class CustomerFields {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerName?: string;

  @ApiPropertyOptional({ example: '+7 701 123 45 67' })
  @IsOptional()
  @Matches(PHONE_RE, { message: 'Некорректный номер телефона' })
  customerPhone?: string;
}

export class StartPrivateVisitDto extends CustomerFields {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId: number;

  @ApiProperty({
    example: 120,
    description:
      'Оплачиваемая длительность, минут. Кратна шагу организации (15/30/60).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  guestsCount?: number;
}

export class StartPublicVisitDto extends CustomerFields {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId: number;

  @ApiProperty({
    type: [GuestDto],
    description: 'Кто входит: например 2 взрослых и 1 ребёнок',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => GuestDto)
  guests: GuestDto[];
}

export class AddGuestsDto {
  @ApiProperty({ type: [GuestDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => GuestDto)
  guests: GuestDto[];
}

export class AddProductDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number;

  @ApiProperty({ minimum: 1, maximum: 1000, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

export class AddServiceDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceId: number;

  @ApiProperty({ minimum: 1, maximum: 1000, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

export class ExtendVisitDto {
  @ApiProperty({
    example: 60,
    description: 'На сколько минут продлить; кратно шагу посещения',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  minutes: number;
}

export class VoidItemDto {
  @ApiProperty({ maxLength: 500, example: 'Добавили по ошибке' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class ReduceItemDto extends VoidItemDto {
  @ApiProperty({ minimum: 1, maximum: 1000, example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

export class CancelVisitDto {
  @ApiProperty({ maxLength: 500, example: 'Начали не в том помещении' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class CreatePaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsEnum(PAYMENT_METHODS)
  method: PaymentMethod;

  @IsMoney({ description: 'Сумма платежа, не больше остатка к оплате' })
  amount: string;
}

export class CompleteVisitDto {
  @ApiPropertyOptional({
    type: [CreatePaymentDto],
    description:
      'Платежи, применяемые в той же транзакции. Если после них оплата не покрывает итог — ничего не сохраняется (409 VISIT_NOT_PAID).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreatePaymentDto)
  payments?: CreatePaymentDto[];
}

export class ListVisitsQueryDto {
  @ApiPropertyOptional({
    enum: VISIT_STATUSES,
    description:
      'Без параметра — история (COMPLETED и CANCELLED). CASHIER видит только последние 24 часа.',
  })
  @IsOptional()
  @IsEnum(VISIT_STATUSES)
  status?: (typeof VISIT_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId?: number;

  @ApiPropertyOptional({
    description: 'ISO-время: с этого момента (по времени завершения/отмены)',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO-время: по этот момент' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
