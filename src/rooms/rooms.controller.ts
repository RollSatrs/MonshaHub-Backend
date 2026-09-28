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
import { RoomsService } from './rooms.service';
import { CreateRoomDto, RoomResponseDto, UpdateRoomDto } from './dto/room.dto';
import { ListQueryDto } from 'src/common/dto/list-query.dto';
import { CurrentUser, Roles } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';

@ApiTags('rooms')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('rooms')
export class RoomsController {
  constructor(private readonly service: RoomsService) {}

  @Get()
  @ApiOperation({
    summary: 'Помещения (CASHIER — только активные) с активными тарифами',
  })
  @ApiOkResponse({ type: [RoomResponseDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: RoomResponseDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles('OWNER')
  @ApiCreatedResponse({ type: RoomResponseDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoomDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Изменить помещение / архивировать (active=false)',
    description: 'Тип помещения изменить нельзя.',
  })
  @ApiOkResponse({ type: RoomResponseDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить помещение (техническая операция)',
    description:
      'Только для помещения, которое никогда не использовалось. Иначе 409 ENTITY_IN_USE — архивируйте (PATCH active=false).',
  })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(user, id);
  }
}
