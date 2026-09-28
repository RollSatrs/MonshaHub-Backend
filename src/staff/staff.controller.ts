import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { CreateCashierDto } from './dto/create-cashier.dto';
import { StaffMemberResponseDto, UpdateStaffDto } from './dto/staff-member.dto';
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
    type: [StaffMemberResponseDto],
    description: 'Сотрудники своей организации',
  })
  list(@CurrentUser() user: AuthUser) {
    return this.staffService.list(user.organizationId);
  }

  @Post('cashiers')
  @ApiCreatedResponse({ type: StaffMemberResponseDto })
  createCashier(@CurrentUser() user: AuthUser, @Body() dto: CreateCashierDto) {
    return this.staffService.createCashier(user.organizationId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Деактивировать / активировать кассира',
    description:
      'Деактивированный кассир теряет доступ сразу (действующая сессия перестаёт работать). Себя и владельца изменить нельзя.',
  })
  @ApiOkResponse({ type: StaffMemberResponseDto })
  setActive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.setActive(user, id, dto);
  }
}
