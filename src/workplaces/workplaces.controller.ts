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
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';
import {
  CreatedWorkplaceResponseDto,
  CreateWorkplaceDto,
  UpdateWorkplaceDto,
  WorkplaceResponseDto,
} from './dto/workplace.dto';
import { WorkplacesService } from './workplaces.service';

@ApiTags('workplaces')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Roles('OWNER')
@Controller('workplaces')
export class WorkplacesController {
  constructor(private readonly service: WorkplacesService) {}

  @Get()
  @ApiOkResponse({ type: [WorkplaceResponseDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Post()
  @ApiCreatedResponse({ type: CreatedWorkplaceResponseDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkplaceDto) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: WorkplaceResponseDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkplaceDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }
}
