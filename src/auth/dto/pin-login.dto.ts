import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PinLoginDto {
  @ApiProperty({ example: 'owner@monshahub.demo' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '1234', pattern: '^\\d{4}$' })
  @Matches(/^\d{4}$/, { message: 'PIN должен состоять из 4 цифр' })
  pin: string;

  @ApiPropertyOptional({ description: 'Токен зарегистрированного моноблока' })
  @IsOptional()
  @IsString()
  workplaceToken?: string;
}
