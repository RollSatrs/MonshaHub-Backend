import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { CreateCashierDto } from './dto/create-cashier.dto';
import { UserResponseDto } from 'src/auth/dto/user-response.dto';
import { CurrentUser, Roles } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';

@ApiTags('staff')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Roles('OWNER')
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @ApiOkResponse({
    type: [UserResponseDto],
    description: 'Сотрудники своей организации',
  })
  list(@CurrentUser() user: AuthUser) {
    return this.staffService.list(user.organizationId);
  }

  @Post('cashiers')
  @ApiCreatedResponse({ type: UserResponseDto })
  createCashier(@CurrentUser() user: AuthUser, @Body() dto: CreateCashierDto) {
    return this.staffService.createCashier(user.organizationId, dto);
  }
}
