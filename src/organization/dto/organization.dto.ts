import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class OrganizationResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Баня «Парная»' })
  name: string;

  @ApiProperty({
    example: 'KZT',
    description: 'Валюта организации (пока не изменяется)',
  })
  currency: string;

  @ApiProperty({
    example: 'Asia/Almaty',
    description: 'Часовой пояс (пока не изменяется)',
  })
  timezone: string;
}

/** currency и timezone намеренно не изменяются через API в MVP. */
export class UpdateOrganizationDto {
  @ApiProperty({ example: 'Баня «Парная»' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}
