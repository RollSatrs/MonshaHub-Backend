import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IsMoney } from 'src/common/decorators/is-money.decorator';
import { ListQueryDto } from 'src/common/dto/list-query.dto';
import { tariffsTable } from 'src/db/schema';

export const TARIFF_KINDS = ['HOURLY', 'PER_ENTRY'] as const;
export const GUEST_CATEGORIES = ['ADULT', 'CHILD'] as const;
export type GuestCategory = (typeof GUEST_CATEGORIES)[number];

export class TariffResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 1 })
  roomId: number;

  @ApiProperty({
    enum: TARIFF_KINDS,
    description:
      'Определяется backend по типу помещения: PRIVATE → HOURLY, PUBLIC → PER_ENTRY',
  })
  kind: (typeof TARIFF_KINDS)[number];

  @ApiProperty({
    enum: GUEST_CATEGORIES,
    nullable: true,
    description: 'Только для PER_ENTRY',
  })
  guestCategory: GuestCategory | null;

  @ApiProperty({ example: 'Почасовой' })
  name: string;

  @ApiProperty({
    type: String,
    example: '10000.00',
    description:
      'Цена часа (HOURLY) или одного входа (PER_ENTRY), decimal-строка',
  })
  price: string;

  @ApiProperty()
  active: boolean;
}

export class CreateTariffDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId: number;

  @ApiProperty({ example: 'Почасовой', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    enum: GUEST_CATEGORIES,
    description: 'Обязательно для PUBLIC-помещения, запрещено для PRIVATE',
  })
  @IsOptional()
  @IsEnum(GUEST_CATEGORIES)
  guestCategory?: GuestCategory;

  @IsMoney()
  price: string;
}

export class UpdateTariffDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsMoney({ required: false })
  price?: string;

  @ApiPropertyOptional({ description: 'false — архивировать тариф' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListTariffsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ description: 'Только тарифы этого помещения' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId?: number;
}

export function toTariffResponse(
  t: typeof tariffsTable.$inferSelect,
): TariffResponseDto {
  return {
    id: t.id,
    roomId: t.roomId,
    kind: t.kind,
    guestCategory: t.guestCategory,
    name: t.name,
    price: t.price,
    active: t.active,
  };
}
