import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
} from 'class-validator';

export const BOOKING_STATUSES = [
  'BOOKED',
  'STARTED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const PHONE_RE = /^[+\d][\d\s()-]{3,30}$/;

export class BookingResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() roomId: number;
  @ApiProperty() roomName: string;
  @ApiProperty() customerName: string;
  @ApiProperty() customerPhone: string;
  @ApiProperty({ description: 'ISO-время начала' }) startsAt: string;
  @ApiProperty({ description: 'ISO-время окончания' }) endsAt: string;
  @ApiProperty({ description: 'Длительность в минутах (endsAt − startsAt)' })
  durationMinutes: number;
  @ApiProperty({ enum: BOOKING_STATUSES }) status: BookingStatus;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty({
    description: 'true — бронь ещё не начата, но её время уже наступило',
  })
  isLate: boolean;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Посещение, начатое по этой брони',
  })
  visitId: number | null;
  @ApiProperty({ type: String, nullable: true }) closedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) closeReason: string | null;
}

export class CreateBookingDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId: number;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  customerName: string;

  @ApiProperty({ example: '+7 701 123 45 67' })
  @Matches(PHONE_RE, { message: 'Некорректный номер телефона' })
  customerPhone: string;

  @ApiProperty({
    example: '2026-01-01T18:00:00+05:00',
    description: 'Начало брони (ISO 8601 с часовым поясом)',
  })
  @IsISO8601({ strict: true })
  startsAt: string;

  @ApiProperty({
    example: 120,
    description: 'Длительность в минутах, кратна шагу организации',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateBookingDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PHONE_RE, { message: 'Некорректный номер телефона' })
  customerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CloseBookingDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class StartBookingVisitDto {
  @ApiPropertyOptional({
    description:
      'Оплачиваемая длительность. По умолчанию — длительность брони. Кратна шагу организации.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;
}

export class ListBookingsQueryDto {
  @ApiPropertyOptional({
    description:
      'Брони, заканчивающиеся не раньше этого времени. По умолчанию — сейчас.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Брони, начинающиеся не позже этого времени',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId?: number;

  @ApiPropertyOptional({
    enum: BOOKING_STATUSES,
    description: 'По умолчанию — BOOKED',
  })
  @IsOptional()
  @IsEnum(BOOKING_STATUSES)
  status?: BookingStatus;
}
