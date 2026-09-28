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
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  CreateStockMovementDto,
  ListMovementsQueryDto,
  ProductResponseDto,
  StockMovementResponseDto,
  StockMovementResultDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ListQueryDto } from 'src/common/dto/list-query.dto';
import { CurrentUser, Roles } from 'src/common/decorators/auth.decorators';
import { ErrorResponseDto } from 'src/common/errors/error-response.dto';
import type { AuthUser } from 'src/types/express';

@ApiTags('products')
@ApiCookieAuth('access_token')
@ApiDefaultResponse({ type: ErrorResponseDto, description: 'Ошибка' })
@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Товары (CASHIER — только активные)' })
  @ApiOkResponse({ type: [ProductResponseDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: ProductResponseDto })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles('OWNER')
  @ApiCreatedResponse({ type: ProductResponseDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Изменить товар / архивировать (active=false)',
    description:
      'Остаток здесь не меняется — используйте POST /products/:id/stock-movements.',
  })
  @ApiOkResponse({ type: ProductResponseDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить товар (техническая операция)',
    description:
      'Только для товара без истории движений и продаж. Иначе 409 ENTITY_IN_USE — архивируйте (PATCH active=false).',
  })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(user, id);
  }

  @Post(':id/stock-movements')
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Ручное движение остатка',
    description:
      'RESTOCK (+), WRITE_OFF (−, нужна причина), ADJUSTMENT (±, нужна причина). Остаток и запись журнала меняются атомарно; ниже нуля остаток не уйдёт (409 INSUFFICIENT_STOCK).',
  })
  @ApiCreatedResponse({ type: StockMovementResultDto })
  addMovement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStockMovementDto,
  ) {
    return this.service.addMovement(user, id, dto);
  }

  @Get(':id/stock-movements')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Журнал движений товара (новые сверху)' })
  @ApiOkResponse({ type: [StockMovementResponseDto] })
  listMovements(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListMovementsQueryDto,
  ) {
    return this.service.listMovements(user, id, query.limit);
  }
}
