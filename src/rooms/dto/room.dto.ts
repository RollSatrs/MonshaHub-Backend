import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TariffResponseDto } from 'src/tariffs/dto/tariff.dto';

export const ROOM_TYPES = ['PRIVATE', 'PUBLIC'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export class RoomResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'VIP №1' })
  name: string;

  @ApiProperty({
    enum: ROOM_TYPES,
    description:
      'PRIVATE — арендует клиент/группа; PUBLIC — общественный зал. Не меняется после создания.',
  })
  type: RoomType;

  @ApiProperty({ example: 6 })
  capacity: number;

  @ApiProperty({
    example: 0,
    description: 'Порядок отображения (меньше — раньше)',
  })
  sortOrder: number;

  @ApiProperty({ description: 'false — помещение в архиве' })
  active: boolean;

  @ApiProperty({
    type: [TariffResponseDto],
    description: 'Активные тарифы помещения (собраны на backend)',
  })
  activeTariffs: TariffResponseDto[];
}

export class CreateRoomDto {
  @ApiProperty({ example: 'VIP №1', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ enum: ROOM_TYPES })
  @IsEnum(ROOM_TYPES)
  type: RoomType;

  @ApiProperty({ example: 6, minimum: 1, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

/** type намеренно отсутствует: тип помещения не меняется. */
export class UpdateRoomDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'false — архивировать помещение' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
