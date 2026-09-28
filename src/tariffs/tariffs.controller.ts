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
import { TariffsService } from './tariffs.service';
import {
  CreateTariffDto,
  ListTariffsQueryDto,
  TariffResponseDto,
  UpdateTariffDto,
} from './dto/tariff.dto';
import { CurrentUser, Roles } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';

@ApiTags('tariffs')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('tariffs')
export class TariffsController {
  constructor(private readonly service: TariffsService) {}

  @Get()
  @ApiOperation({ summary: 'Тарифы (CASHIER — только активные)' })
  @ApiOkResponse({ type: [TariffResponseDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListTariffsQueryDto) {
    return this.service.list(user, query);
  }

  @Post()
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Создать тариф помещения',
    description:
      'kind определяется по типу помещения. PRIVATE → HOURLY (без guestCategory); PUBLIC → PER_ENTRY (guestCategory обязателен). Не более одного активного тарифа на вид.',
  })
  @ApiCreatedResponse({ type: TariffResponseDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTariffDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Изменить тариф / архивировать (active=false)',
    description:
      'Смена цены не влияет на уже начатые посещения (Visit хранит snapshot тарифа).',
  })
  @ApiOkResponse({ type: TariffResponseDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTariffDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить тариф (техническая операция)',
    description:
      'Только для тарифа, который никогда не использовался. Иначе 409 ENTITY_IN_USE — архивируйте (PATCH active=false).',
  })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(user, id);
  }
}
