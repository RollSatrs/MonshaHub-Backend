import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateWorkplaceDto {
  @ApiProperty({ example: 'Касса №1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  branchId: number;
}

export class UpdateWorkplaceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  branchId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class WorkplaceResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  branchId: number;

  @ApiProperty()
  branchName: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: String, nullable: true })
  lastSeenAt: string | null;
}

export class CreatedWorkplaceResponseDto extends WorkplaceResponseDto {
  @ApiProperty({ description: 'Показывается только один раз после создания' })
  activationToken: string;
}
