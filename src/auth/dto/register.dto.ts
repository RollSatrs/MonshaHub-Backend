import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Публичная регистрация создаёт новую организацию и её владельца (OWNER). Роль выбрать нельзя. */
export class RegisterDto {
  @ApiProperty({
    example: 'Баня «Парная»',
    description: 'Название бани / комплекса',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  organizationName: string;

  @ApiProperty({ example: 'Иван Иванов' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fullname: string;

  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}
