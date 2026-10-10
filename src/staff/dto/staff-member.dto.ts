import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Matches } from 'class-validator';
import { UserResponseDto } from 'src/auth/dto/user-response.dto';

export class StaffMemberResponseDto extends UserResponseDto {
  @ApiProperty({
    description: 'false — сотрудник деактивирован и не может войти',
  })
  active: boolean;
}

export class UpdateStaffDto {
  @ApiPropertyOptional({
    description:
      'false — деактивировать кассира (доступ закрывается сразу), true — вернуть доступ',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  branchId?: number;

  @ApiProperty({ required: false, example: '1234' })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'PIN должен состоять из 4 цифр' })
  pin?: string;
}
