import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({ example: 'Основной' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ example: 'ул. Абая, 10' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: '+7 700 000 00 00' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 'Asia/Almaty' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class BranchResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  organizationId: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  address: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone: string | null;

  @ApiProperty()
  timezone: string;

  @ApiProperty()
  active: boolean;
}
