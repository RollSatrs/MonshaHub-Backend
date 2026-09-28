import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BathServicesService } from './bath-services.service';
import {
  BathServiceResponseDto,
  CreateBathServiceDto,
  UpdateBathServiceDto,
} from './dto/bath-service.dto';
import { ListQueryDto } from 'src/common/dto/list-query.dto';
import { CurrentUser, Roles } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';

@ApiTags('services')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('services')
export class BathServicesController {
  constructor(private readonly service: BathServicesService) {}

  @Get()
  @ApiOperation({ summary: 'Услуги (CASHIER — только активные)' })
  @ApiOkResponse({ type: [BathServiceResponseDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: BathServiceResponseDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles('OWNER')
  @ApiCreatedResponse({ type: BathServiceResponseDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBathServiceDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Изменить услугу / архивировать (active=false)' })
  @ApiOkResponse({ type: BathServiceResponseDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBathServiceDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить услугу (техническая операция)',
    description:
      'Только для услуги, которая никогда не использовалась. Иначе 409 ENTITY_IN_USE — архивируйте (PATCH active=false).',
  })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(user, id);
  }
}
