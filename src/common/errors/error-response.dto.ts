import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ERROR_CODES } from './error-codes';

/** Единый формат ошибки API (для Swagger). */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ enum: ERROR_CODES, example: 'VALIDATION_ERROR' })
  code: string;

  @ApiProperty({ example: 'Ошибка валидации' })
  message: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Подробности (например, список ошибок валидации)',
  })
  details?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Структурированные подробности ошибки (например, время ближайшей брони при BOOKING_CONFLICT)',
  })
  meta?: Record<string, unknown>;

  @ApiProperty({ example: '/auth/login' })
  path: string;

  @ApiProperty()
  timestamp: string;
}
