import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from 'src';
import { productsTable, stockMovementsTable, usersTable } from 'src/db/schema';
import { canSeeInactive } from 'src/common/access';
import { isForeignKeyViolation, uniqueViolation } from 'src/common/db-errors';
import { ListQueryDto } from 'src/common/dto/list-query.dto';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';
import { normalizeMoney } from 'src/common/money';
import type { AuthUser } from 'src/types/express';
import {
  CreateProductDto,
  CreateStockMovementDto,
  ProductResponseDto,
  StockMovementResponseDto,
  UpdateProductDto,
} from './dto/product.dto';
import { applyStockMovement } from './stock';

const notFound = () => new NotFoundException('Товар не найден');

const duplicateName = () =>
  new AppException(
    ErrorCode.DUPLICATE_NAME,
    'Товар с таким названием уже существует (возможно, в архиве)',
    HttpStatus.CONFLICT,
  );

const toResponse = (
  p: typeof productsTable.$inferSelect,
): ProductResponseDto => ({
  id: p.id,
  name: p.name,
  price: p.price,
  stock: p.stock,
  active: p.active,
});

const validation = (message: string) =>
  new AppException(
    ErrorCode.VALIDATION_ERROR,
    'Ошибка валидации',
    HttpStatus.BAD_REQUEST,
    [message],
  );

@Injectable()
export class ProductsService {
  async list(user: AuthUser, query: ListQueryDto) {
    const conditions = [eq(productsTable.organizationId, user.organizationId)];
    if (!canSeeInactive(user, query))
      conditions.push(eq(productsTable.active, true));
    const rows = await db
      .select()
      .from(productsTable)
      .where(and(...conditions))
      .orderBy(asc(productsTable.name), asc(productsTable.id));
    return rows.map(toResponse);
  }

  async get(user: AuthUser, id: number) {
    const [row] = await db
      .select()
      .from(productsTable)
      .where(
        and(
          eq(productsTable.id, id),
          eq(productsTable.organizationId, user.organizationId),
        ),
      )
      .limit(1);
    if (!row || (!row.active && user.role !== 'OWNER')) throw notFound();
    return toResponse(row);
  }

  async create(user: AuthUser, dto: CreateProductDto) {
    try {
      return await db.transaction(async (tx) => {
        const [product] = await tx
          .insert(productsTable)
          .values({
            organizationId: user.organizationId,
            name: dto.name.trim(),
            price: normalizeMoney(dto.price),
            stock: 0,
          })
          .returning();

        const initial = dto.stock ?? 0;
        if (initial > 0) {
          // начальный остаток — тоже движение, чтобы журнал не начинался с «необъяснимого» числа
          const { stock } = await applyStockMovement(tx, {
            organizationId: user.organizationId,
            productId: product.id,
            type: 'RESTOCK',
            quantityDelta: initial,
            reason: 'Начальный остаток',
            userId: user.id,
          });
          product.stock = stock;
        }
        return toResponse(product);
      });
    } catch (err) {
      if (uniqueViolation(err) !== undefined) throw duplicateName();
      throw err;
    }
  }

  async update(user: AuthUser, id: number, dto: UpdateProductDto) {
    const set: Partial<typeof productsTable.$inferInsert> = {};
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.price !== undefined) set.price = normalizeMoney(dto.price);
    if (dto.active !== undefined) set.active = dto.active;
    if (!Object.keys(set).length) return this.get(user, id);

    try {
      const [row] = await db
        .update(productsTable)
        .set(set)
        .where(
          and(
            eq(productsTable.id, id),
            eq(productsTable.organizationId, user.organizationId),
          ),
        )
        .returning();
      if (!row) throw notFound();
      return toResponse(row);
    } catch (err) {
      if (uniqueViolation(err) !== undefined) throw duplicateName();
      throw err;
    }
  }

  /**
   * Техническая операция: только для товара без единого движения и продаж.
   * Товар с остатком/историей нужно архивировать (PATCH active=false).
   */
  async remove(user: AuthUser, id: number) {
    try {
      const deleted = await db
        .delete(productsTable)
        .where(
          and(
            eq(productsTable.id, id),
            eq(productsTable.organizationId, user.organizationId),
          ),
        )
        .returning({ id: productsTable.id });
      if (!deleted.length) throw notFound();
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new AppException(
          ErrorCode.ENTITY_IN_USE,
          'У товара есть история движений или продаж. Архивируйте его вместо удаления.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  /** Ручное движение остатка (RESTOCK / WRITE_OFF / ADJUSTMENT): изменение остатка и запись журнала — одна транзакция. */
  async addMovement(user: AuthUser, id: number, dto: CreateStockMovementDto) {
    const delta = dto.quantityDelta;
    if (delta === 0) throw validation('quantityDelta не может быть 0');
    if (dto.type === 'RESTOCK' && delta < 0)
      throw validation('RESTOCK: quantityDelta должен быть > 0');
    if (dto.type === 'WRITE_OFF' && delta > 0)
      throw validation('WRITE_OFF: quantityDelta должен быть < 0');
    const reason = dto.reason?.trim() || undefined;
    if ((dto.type === 'WRITE_OFF' || dto.type === 'ADJUSTMENT') && !reason)
      throw validation(`${dto.type}: укажите причину (reason)`);

    return db.transaction(async (tx) => {
      const { movement } = await applyStockMovement(tx, {
        organizationId: user.organizationId,
        productId: id,
        type: dto.type,
        quantityDelta: delta,
        reason,
        userId: user.id,
      });
      const [product] = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, id))
        .limit(1);
      const [author] = await tx
        .select({ fullname: usersTable.fullname })
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .limit(1);
      return {
        movement: {
          id: movement.id,
          productId: movement.productId,
          type: movement.type,
          quantityDelta: movement.quantityDelta,
          balanceAfter: movement.balanceAfter,
          reason: movement.reason,
          createdBy: movement.createdBy,
          createdByName: author?.fullname ?? null,
          createdAt: movement.createdAt.toISOString(),
        } satisfies StockMovementResponseDto,
        product: toResponse(product),
      };
    });
  }

  async listMovements(user: AuthUser, id: number, limit = 50) {
    const [product] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.id, id),
          eq(productsTable.organizationId, user.organizationId),
        ),
      )
      .limit(1);
    if (!product) throw notFound();

    const rows = await db
      .select({
        m: stockMovementsTable,
        createdByName: usersTable.fullname,
      })
      .from(stockMovementsTable)
      .leftJoin(usersTable, eq(usersTable.id, stockMovementsTable.createdBy))
      .where(
        and(
          eq(stockMovementsTable.productId, id),
          eq(stockMovementsTable.organizationId, user.organizationId),
        ),
      )
      .orderBy(
        desc(stockMovementsTable.createdAt),
        desc(stockMovementsTable.id),
      )
      .limit(limit);

    return rows.map(({ m, createdByName }) => ({
      id: m.id,
      productId: m.productId,
      type: m.type,
      quantityDelta: m.quantityDelta,
      balanceAfter: m.balanceAfter,
      reason: m.reason,
      createdBy: m.createdBy,
      createdByName,
      createdAt: m.createdAt.toISOString(),
    }));
  }
}
