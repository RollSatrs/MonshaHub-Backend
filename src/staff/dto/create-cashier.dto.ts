import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCashierDto {
  @ApiProperty({ example: 'Айгуль Касымова' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullname: string;

  @ApiProperty({ example: 'cashier@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
