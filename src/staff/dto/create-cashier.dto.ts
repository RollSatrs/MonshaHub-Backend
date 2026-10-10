import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsInt,
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCashierDto {
  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsInt()
  branchId?: number;

  @ApiProperty({ example: 'Айгуль Касымова' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullname: string;

  @ApiProperty({ example: 'cashier@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, required: false, deprecated: true })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiProperty({ example: '1234', pattern: '^\\d{4}$', required: false })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'PIN должен состоять из 4 цифр' })
  pin?: string;
}
