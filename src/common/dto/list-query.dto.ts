import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListQueryDto {
  @ApiPropertyOptional({
    description:
      'Включить архивные записи. Только для OWNER; для CASHIER параметр игнорируется (всегда только активные).',
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  includeInactive?: boolean;
}
