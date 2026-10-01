import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from 'src';
import { organizationsTable } from 'src/db/schema';
import { UpdateOrganizationDto } from './dto/organization.dto';

const toResponse = (o: typeof organizationsTable.$inferSelect) => ({
  id: o.id,
  name: o.name,
  currency: o.currency,
  timezone: o.timezone,
  timeStepMinutes: o.timeStepMinutes,
});

@Injectable()
export class OrganizationService {
  async get(organizationId: number) {
    const [org] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1);
    if (!org) throw new NotFoundException('Организация не найдена');
    return toResponse(org);
  }

  async update(organizationId: number, dto: UpdateOrganizationDto) {
    const set: Partial<typeof organizationsTable.$inferInsert> = {};
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.timeStepMinutes !== undefined)
      set.timeStepMinutes = dto.timeStepMinutes;
    if (!Object.keys(set).length) return this.get(organizationId);

    const [org] = await db
      .update(organizationsTable)
      .set(set)
      .where(eq(organizationsTable.id, organizationId))
      .returning();
    if (!org) throw new NotFoundException('Организация не найдена');
    return toResponse(org);
  }
}
