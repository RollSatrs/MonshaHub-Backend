import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptions } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { MONEY_PATTERN } from '../money';

/** Денежное поле: decimal-строка, до 10 цифр целой части и до 2 знаков после точки. */
export function IsMoney(options: ApiPropertyOptions = {}) {
  return applyDecorators(
    ApiProperty({
      type: String,
      example: '10000.00',
      pattern: MONEY_PATTERN,
      description: 'Decimal-строка, до 2 знаков после точки',
      ...options,
    }),
    Matches(new RegExp(MONEY_PATTERN), {
      message: 'Сумма должна быть числом вида 1234 или 1234.56',
    }),
  );
}
