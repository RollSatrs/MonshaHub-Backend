import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OrganizationService } from './organization.service';
import {
  OrganizationResponseDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';
import { CurrentUser, Roles } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';

@ApiTags('organization')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('organization')
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}

  @Get()
  @ApiOkResponse({
    type: OrganizationResponseDto,
    description: 'Своя организация',
  })
  get(@CurrentUser() user: AuthUser) {
    return this.service.get(user.organizationId);
  }

  @Patch()
  @Roles('OWNER')
  @ApiOkResponse({ type: OrganizationResponseDto })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrganizationDto) {
    return this.service.update(user.organizationId, dto);
  }
}
