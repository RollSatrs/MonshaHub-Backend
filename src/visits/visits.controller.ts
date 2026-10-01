import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { VisitsService } from './visits.service';
import {
  AddGuestsDto,
  AddProductDto,
  AddServiceDto,
  CancelVisitDto,
  CompleteVisitDto,
  CreatePaymentDto,
  ExtendVisitDto,
  ListVisitsQueryDto,
  StartPrivateVisitDto,
  StartPublicVisitDto,
  VisitDetailDto,
  VisitListDto,
  VoidItemDto,
} from './dto/visit.dto';
import { CurrentUser } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';

/** Все операции посещений доступны OWNER и CASHIER. Каждый ответ — актуальный VisitDetail с итогом от backend. */
@ApiTags('visits')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('visits')
export class VisitsController {
  constructor(private readonly service: VisitsService) {}

  @Post('private')
  @ApiOperation({
    summary: 'Начать посещение PRIVATE-помещения (walk-in)',
    description:
      'Оплачиваемая длительность фиксируется сразу (кратна шагу организации). Ошибки: ROOM_NOT_AVAILABLE (занято/на уборке), BOOKING_CONFLICT (пересечение с бронью), TARIFF_NOT_CONFIGURED.',
  })
  @ApiCreatedResponse({ type: VisitDetailDto })
  startPrivate(
    @CurrentUser() user: AuthUser,
    @Body() dto: StartPrivateVisitDto,
  ) {
    return this.service.startPrivate(user, dto);
  }

  @Post('public')
  @ApiOperation({
    summary: 'Вход в общественный зал: новый чек человека/группы',
    description:
      'Создаёт посещение с позициями входа (цена — snapshot тарифа). Ошибки: ROOM_CAPACITY_EXCEEDED, TARIFF_NOT_CONFIGURED.',
  })
  @ApiCreatedResponse({ type: VisitDetailDto })
  startPublic(@CurrentUser() user: AuthUser, @Body() dto: StartPublicVisitDto) {
    return this.service.startPublic(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'История посещений',
    description:
      'CASHIER — только последние 24 часа, OWNER — вся история организации.',
  })
  @ApiOkResponse({ type: VisitListDto })
  list(@CurrentUser() user: AuthUser, @Query() query: ListVisitsQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Посещение: позиции, платежи, итог, оплачено, остаток',
  })
  @ApiOkResponse({ type: VisitDetailDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user, id);
  }

  @Post(':id/products')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Добавить товар',
    description:
      'Одной транзакцией: позиция + уменьшение остатка + движение SALE. INSUFFICIENT_STOCK откатывает всё.',
  })
  @ApiOkResponse({ type: VisitDetailDto })
  addProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddProductDto,
  ) {
    return this.service.addProduct(user, id, dto);
  }

  @Post(':id/services')
  @HttpCode(200)
  @ApiOperation({ summary: 'Добавить услугу (без складского движения)' })
  @ApiOkResponse({ type: VisitDetailDto })
  addService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddServiceDto,
  ) {
    return this.service.addService(user, id, dto);
  }

  @Post(':id/guests')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Добавить гостей в чек общественного зала',
    description: 'Проверяет вместимость: ROOM_CAPACITY_EXCEEDED.',
  })
  @ApiOkResponse({ type: VisitDetailDto })
  addGuests(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddGuestsDto,
  ) {
    return this.service.addGuests(user, id, dto);
  }

  @Post(':id/extend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Продлить PRIVATE-посещение',
    description:
      'На целое число шагов. Продление считается от прежнего конца (при просрочке — задним числом). Пересечение со следующей бронью — 409 BOOKING_CONFLICT (meta.availableMinutes).',
  })
  @ApiOkResponse({ type: VisitDetailDto })
  extend(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExtendVisitDto,
  ) {
    return this.service.extend(user, id, dto);
  }

  @Post(':id/items/:itemId/void')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Убрать ошибочную позицию',
    description:
      'Позиция не удаляется: сохраняются кто, когда и причина. Товар возвращается на склад (SALE_RETURN). Время помещения убрать нельзя. Оплаченную позицию — нельзя (ITEM_ALREADY_PAID).',
  })
  @ApiOkResponse({ type: VisitDetailDto })
  voidItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: VoidItemDto,
  ) {
    return this.service.voidItem(user, id, itemId, dto);
  }

  @Post(':id/payments')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Принять платёж',
    description:
      'Можно несколько платежей (разные методы). Сумма не больше остатка: PAYMENT_EXCEEDS_BALANCE.',
  })
  @ApiOkResponse({ type: VisitDetailDto })
  addPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.service.addPayment(user, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Завершить посещение (выход)',
    description:
      'Только при полной оплате. Платежи из тела применяются в той же транзакции; если оплата не покрывает итог — 409 VISIT_NOT_PAID и ничего не сохраняется. PRIVATE после завершения переходит на уборку.',
  })
  @ApiOkResponse({ type: VisitDetailDto })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteVisitDto,
  ) {
    return this.service.complete(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Отменить посещение, начатое по ошибке',
    description:
      'Только пока нет платежей (VISIT_HAS_PAYMENTS). Товары возвращаются на склад. Сохраняются кто, когда и причина.',
  })
  @ApiOkResponse({ type: VisitDetailDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelVisitDto,
  ) {
    return this.service.cancel(user, id, dto);
  }
}
