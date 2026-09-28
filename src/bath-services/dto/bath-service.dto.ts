import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsMoney } from 'src/common/decorators/is-money.decorator';

/** Услуга (массаж, парение) — в отличие от товара, без складского остатка. */
export class BathServiceResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Массаж' })
  name: string;

  @ApiProperty({ type: String, example: '5000.00' })
  price: string;

  @ApiProperty({ description: 'false — услуга в архиве' })
  active: boolean;
}

export class CreateBathServiceDto {
  @ApiProperty({ example: 'Массаж', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsMoney()
  price: string;
}

export class UpdateBathServiceDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsMoney({ required: false })
  price?: string;

  @ApiPropertyOptional({ description: 'false — архивировать услугу' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
