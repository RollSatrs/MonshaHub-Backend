// src/auth/dto/register.dto.ts
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ROLES } from 'shared/constants/roles';
import type { Role } from 'shared/type/type.role';

export class RegisterDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fullname: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: ROLES })
  @IsEnum(ROLES)
  role: Role;
}
