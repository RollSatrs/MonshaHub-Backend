import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { VisitsService } from './visits.service';
import { MessageCountDto } from './dto/visit.dto';
import { LiveService } from 'src/live/live.service';
import { InsideDto } from 'src/live/dto/live.dto';
import { CurrentUser } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';
import { ApiProperty } from '@nestjs/swagger';

class CleaningFinishedDto {
  @ApiProperty() finished: boolean;
}

/** Операции над состоянием помещения (доступны OWNER и CASHIER). */
@ApiTags('rooms')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('rooms')
export class RoomOpsController {
  constructor(
    private readonly visits: VisitsService,
    private readonly live: LiveService,
  ) {}

  @Post(':id/finish-cleaning')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Уборка завершена: помещение снова свободно',
    description: 'CLEANING_NOT_ACTIVE, если помещение не на уборке.',
  })
  @ApiOkResponse({ type: CleaningFinishedDto })
  finishCleaning(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.visits.finishCleaning(user, id);
  }

  @Get(':id/inside')
  @ApiOperation({
    summary: '«Внутри сейчас» — активные чеки общественного зала',
  })
  @ApiOkResponse({ type: InsideDto })
  inside(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.live.inside(user, id);
  }

  @Post(':id/complete-paid')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Завершить все оплаченные посещения общественного зала',
    description:
      'Массово завершает активные чеки зала, у которых оплачено = итог. Остальные не затрагиваются.',
  })
  @ApiOkResponse({ type: MessageCountDto })
  completePaid(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.visits.completeAllPaid(user, id);
  }
}
