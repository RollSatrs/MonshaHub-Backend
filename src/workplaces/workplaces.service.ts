import { createHash, randomBytes } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { db } from 'src';
import { branchesTable, workplacesTable } from 'src/db/schema';
import { CreateWorkplaceDto, UpdateWorkplaceDto } from './dto/workplace.dto';

export const hashWorkplaceToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class WorkplacesService {
  async list(organizationId: number) {
    const rows = await db
      .select({ workplace: workplacesTable, branchName: branchesTable.name })
      .from(workplacesTable)
      .innerJoin(branchesTable, eq(branchesTable.id, workplacesTable.branchId))
      .where(eq(workplacesTable.organizationId, organizationId))
      .orderBy(asc(workplacesTable.id));
    return rows.map(({ workplace, branchName }) => ({
      id: workplace.id,
      branchId: workplace.branchId,
      branchName,
      name: workplace.name,
      active: workplace.active,
      lastSeenAt: workplace.lastSeenAt?.toISOString() ?? null,
    }));
  }

  async create(organizationId: number, dto: CreateWorkplaceDto) {
    const branch = await this.branch(organizationId, dto.branchId);
    const activationToken = randomBytes(32).toString('base64url');
    const [workplace] = await db
      .insert(workplacesTable)
      .values({
        organizationId,
        branchId: branch.id,
        name: dto.name.trim(),
        tokenHash: hashWorkplaceToken(activationToken),
      })
      .returning();
    return {
      id: workplace.id,
      branchId: workplace.branchId,
      branchName: branch.name,
      name: workplace.name,
      active: workplace.active,
      lastSeenAt: null,
      activationToken,
    };
  }

  async update(organizationId: number, id: number, dto: UpdateWorkplaceDto) {
    if (dto.branchId !== undefined) {
      await this.branch(organizationId, dto.branchId);
    }
    const set: Partial<typeof workplacesTable.$inferInsert> = {};
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.branchId !== undefined) set.branchId = dto.branchId;
    if (dto.active !== undefined) set.active = dto.active;
    const [workplace] = await db
      .update(workplacesTable)
      .set(set)
      .where(
        and(
          eq(workplacesTable.id, id),
          eq(workplacesTable.organizationId, organizationId),
        ),
      )
      .returning();
    if (!workplace) throw new NotFoundException('Рабочее место не найдено');
    const branch = await this.branch(organizationId, workplace.branchId);
    return {
      id: workplace.id,
      branchId: workplace.branchId,
      branchName: branch.name,
      name: workplace.name,
      active: workplace.active,
      lastSeenAt: workplace.lastSeenAt?.toISOString() ?? null,
    };
  }

  private async branch(organizationId: number, branchId: number) {
    const [branch] = await db
      .select()
      .from(branchesTable)
      .where(
        and(
          eq(branchesTable.id, branchId),
          eq(branchesTable.organizationId, organizationId),
          eq(branchesTable.active, true),
        ),
      )
      .limit(1);
    if (!branch) throw new NotFoundException('Филиал не найден');
    return branch;
  }
}
