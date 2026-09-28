import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { UserResponseDto } from 'src/auth/dto/user-response.dto';

export class StaffMemberResponseDto extends UserResponseDto {
  @ApiProperty({
    description: 'false — сотрудник деактивирован и не может войти',
  })
  active: boolean;
}

export class UpdateStaffDto {
  @ApiProperty({
    description:
      'false — деактивировать кассира (доступ закрывается сразу), true — вернуть доступ',
  })
  @IsBoolean()
  active: boolean;
}
