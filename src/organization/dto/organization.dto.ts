import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const TIME_STEPS = [15, 30, 60] as const;

export class OrganizationResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Баня «Парная»' })
  name: string;

  @ApiProperty({
    example: 'KZT',
    description: 'Валюта организации (пока не изменяется)',
  })
  currency: string;

  @ApiProperty({
    example: 'Asia/Almaty',
    description: 'Часовой пояс (пока не изменяется)',
  })
  timezone: string;

  @ApiProperty({
    enum: TIME_STEPS,
    example: 60,
    description:
      'Шаг оплачиваемого времени PRIVATE-посещения (мин): длительность старта и продления кратны шагу. Применяется к новым посещениям.',
  })
  timeStepMinutes: number;
}

/** currency и timezone намеренно не изменяются через API в MVP. */
export class UpdateOrganizationDto {
  @ApiPropertyOptional({ example: 'Баня «Парная»' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    enum: TIME_STEPS,
    description: 'Шаг времени: 15, 30 или 60 минут',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(TIME_STEPS)
  timeStepMinutes?: number;
}
