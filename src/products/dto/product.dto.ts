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
  ValidateIf,
} from 'class-validator';
import { IsMoney } from 'src/common/decorators/is-money.decorator';

export class ProductResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Веник' })
  name: string;

  @ApiProperty({ type: String, example: '2500.00' })
  price: string;

  @ApiProperty({
    example: 50,
    description: 'Текущий остаток. Меняется только через stock-movements.',
  })
  stock: number;

  @ApiProperty({
    description: 'false — товар в архиве (не продаётся, история сохраняется)',
  })
  active: boolean;
}

export class CreateProductDto {
  @ApiProperty({ example: 'Веник', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsMoney()
  price: string;

  @ApiPropertyOptional({
    example: 50,
    default: 0,
    description: 'Начальный остаток; при > 0 создаётся движение RESTOCK',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock?: number;
}

/** stock здесь нет намеренно: остаток меняется только движениями. */
export class UpdateProductDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsMoney({ required: false })
  price?: string;

  @ApiPropertyOptional({ description: 'false — архивировать товар' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export const MANUAL_MOVEMENT_TYPES = [
  'RESTOCK',
  'WRITE_OFF',
  'ADJUSTMENT',
] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export class CreateStockMovementDto {
  @ApiProperty({
    enum: MANUAL_MOVEMENT_TYPES,
    description:
      'SALE создаётся автоматически при добавлении товара в посещение (Phase 2)',
  })
  @IsEnum(MANUAL_MOVEMENT_TYPES)
  type: ManualMovementType;

  @ApiProperty({
    example: 20,
    description:
      'Изменение остатка со знаком. RESTOCK > 0, WRITE_OFF < 0, ADJUSTMENT — любое ≠ 0.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  quantityDelta: number;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Обязательна для WRITE_OFF и ADJUSTMENT',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class StockMovementResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;

  @ApiProperty({ enum: ['RESTOCK', 'WRITE_OFF', 'ADJUSTMENT', 'SALE'] })
  type: 'RESTOCK' | 'WRITE_OFF' | 'ADJUSTMENT' | 'SALE';

  @ApiProperty({ example: 20 }) quantityDelta: number;
  @ApiProperty({ example: 70, description: 'Остаток после операции' })
  balanceAfter: number;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty() createdBy: number;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
  @ApiProperty() createdAt: string;
}

export class StockMovementResultDto {
  @ApiProperty({ type: StockMovementResponseDto })
  movement: StockMovementResponseDto;

  @ApiProperty({ type: ProductResponseDto })
  product: ProductResponseDto;
}

export class ListMovementsQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
