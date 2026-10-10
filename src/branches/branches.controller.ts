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
import { BranchesService } from './branches.service';
import {
  BranchResponseDto,
  CreateBranchDto,
  UpdateBranchDto,
} from './dto/branch.dto';

@ApiTags('branches')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('branches')
export class BranchesController {
  constructor(private readonly service: BranchesService) {}

  @Get()
  @Roles('OWNER')
  @ApiOkResponse({ type: [BranchResponseDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.organizationId);
  }

  @Get('current')
  @ApiOkResponse({ type: BranchResponseDto })
  current(@CurrentUser() user: AuthUser) {
    return this.service.current(user);
  }

  @Post()
  @Roles('OWNER')
  @ApiCreatedResponse({ type: BranchResponseDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBranchDto) {
    return this.service.create(user.organizationId, dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  @ApiOkResponse({ type: BranchResponseDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.service.update(user.organizationId, id, dto);
  }
}
