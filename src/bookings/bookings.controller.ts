import {
  Body,
  Controller,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import {
  BookingResponseDto,
  CloseBookingDto,
  CreateBookingDto,
  ListBookingsQueryDto,
  StartBookingVisitDto,
  UpdateBookingDto,
} from './dto/booking.dto';
import { CurrentUser } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import { VisitDetailDto } from 'src/visits/dto/visit.dto';
import type { AuthUser } from 'src/types/express';

@ApiTags('bookings')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('bookings')
export class BookingsController {
  constructor(private readonly service: BookingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Брони (по умолчанию — предстоящие BOOKED)',
    description: 'Доступно OWNER и CASHIER.',
  })
  @ApiOkResponse({ type: [BookingResponseDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListBookingsQueryDto) {
    return this.service.list(user, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Создать бронь PRIVATE-помещения',
    description:
      'Пересечение с другой бронью или идущим посещением — 409 BOOKING_CONFLICT (в meta: время конфликта).',
  })
  @ApiCreatedResponse({ type: BookingResponseDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить/перенести бронь (только BOOKED)' })
  @ApiOkResponse({ type: BookingResponseDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBookingDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отменить бронь' })
  @ApiOkResponse({ type: BookingResponseDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseBookingDto,
  ) {
    return this.service.cancel(user, id, dto);
  }

  @Post(':id/no-show')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отметить неявку' })
  @ApiOkResponse({ type: BookingResponseDto })
  noShow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseBookingDto,
  ) {
    return this.service.noShow(user, id, dto);
  }

  @Post(':id/start-visit')
  @ApiOperation({
    summary: 'Начать посещение по брони',
    description:
      'Посещение стартует «сейчас» на длительность брони (или указанную). Пересечение со следующей бронью — 409 BOOKING_CONFLICT.',
  })
  @ApiCreatedResponse({ type: VisitDetailDto })
  startVisit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartBookingVisitDto,
  ) {
    return this.service.startVisit(user, id, dto);
  }
}
