import { Controller, Get } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { LiveService } from './live.service';
import { LiveBoardDto } from './dto/live.dto';
import { CurrentUser } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';

@ApiTags('live')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('live')
export class LiveController {
  constructor(private readonly service: LiveService) {}

  @Get('board')
  @ApiOperation({
    summary: '«Баня сейчас»: состояние всех помещений',
    description:
      'Состояние (AVAILABLE, OCCUPIED, ENDING_SOON, OVERTIME, CLEANING, OPEN, FULL) вычисляет backend. Frontend отсчитывает время от endsAt и serverTime и периодически перезапрашивает.',
  })
  @ApiOkResponse({ type: LiveBoardDto })
  board(@CurrentUser() user: AuthUser) {
    return this.service.board(user);
  }
}
