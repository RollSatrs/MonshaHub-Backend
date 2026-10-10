import { HttpStatus, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { db } from 'src';
import { productsTable, stockMovementsTable } from 'src/db/schema';
import { AppException } from 'src/common/errors/app.exception';
import { ErrorCode } from 'src/common/errors/error-codes';

/** `db` или транзакция — чтобы Phase 2 (SALE при добавлении товара в Visit) вызывал то же самое внутри своей транзакции. */
export type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StockMovementType =
  | 'RESTOCK'
  | 'WRITE_OFF'
  | 'ADJUSTMENT'
  | 'SALE'
  | 'SALE_RETURN';

export interface StockMovementInput {
  organizationId: number;
  branchId: number;
  productId: number;
  type: StockMovementType;
  /** Знак должен соответствовать типу (RESTOCK/SALE_RETURN > 0; WRITE_OFF/SALE < 0; ADJUSTMENT любой ≠ 0) */
  quantityDelta: number;
  reason?: string | null;
  /** позиция посещения, к которой относится SALE / SALE_RETURN */
  visitItemId?: number | null;
  userId: number;
}

/**
 * Единственное место, где меняется products.stock.
 * Атомарно: один условный UPDATE (остаток не уйдёт ниже нуля даже при параллельных
 * запросах — строка блокируется на время UPDATE) + запись в журнал.
 * Для атомарности с журналом вызывать внутри транзакции.
 */
export async function applyStockMovement(
  tx: DbExecutor,
  input: StockMovementInput,
) {
  const { organizationId, branchId, productId, quantityDelta } = input;

  const [updated] = await tx
    .update(productsTable)
    .set({ stock: sql`${productsTable.stock} + ${quantityDelta}` })
    .where(
      and(
        eq(productsTable.id, productId),
        eq(productsTable.organizationId, organizationId),
        eq(productsTable.branchId, branchId),
        sql`${productsTable.stock} + ${quantityDelta} >= 0`,
      ),
    )
    .returning({ stock: productsTable.stock });

  if (!updated) {
    const [exists] = await tx
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.id, productId),
          eq(productsTable.organizationId, organizationId),
          eq(productsTable.branchId, branchId),
        ),
      )
      .limit(1);
    if (!exists) throw new NotFoundException('Товар не найден');
    throw new AppException(
      ErrorCode.INSUFFICIENT_STOCK,
      'Недостаточно товара на складе',
      HttpStatus.CONFLICT,
    );
  }

  const [movement] = await tx
    .insert(stockMovementsTable)
    .values({
      organizationId,
      branchId,
      productId,
      type: input.type,
      quantityDelta,
      balanceAfter: updated.stock,
      reason: input.reason ?? null,
      visitItemId: input.visitItemId ?? null,
      createdBy: input.userId,
    })
    .returning();

  return { stock: updated.stock, movement };
}
