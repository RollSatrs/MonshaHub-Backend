import { ApiProperty } from '@nestjs/swagger';
import { ROLES } from 'shared/constants/roles';
import type { Role } from 'shared/constants/roles';

/** Публичное представление пользователя. Никогда не содержит passwordHash. */
export class UserResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 1 })
  organizationId: number;

  @ApiProperty({ type: Number, nullable: true })
  branchId: number | null;

  @ApiProperty({ example: 'Иван Иванов' })
  fullname: string;

  @ApiProperty({ example: 'owner@example.com' })
  email: string;

  @ApiProperty({ enum: ROLES })
  role: Role;

  @ApiProperty({ type: String, nullable: true })
  avatar: string | null;
}

export class AuthUserResponseDto {
  @ApiProperty()
  message: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}

export class MessageResponseDto {
  @ApiProperty()
  message: string;
}

export function toUserResponse(u: {
  id: number;
  organizationId: number;
  branchId?: number | null;
  fullname: string;
  email: string;
  role: Role;
  avatar: string | null;
}): UserResponseDto {
  return {
    id: u.id,
    organizationId: u.organizationId,
    branchId: u.branchId ?? null,
    fullname: u.fullname,
    email: u.email,
    role: u.role,
    avatar: u.avatar,
  };
}
