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
    const [org] = await db
      .update(organizationsTable)
      .set({ name: dto.name.trim() })
      .where(eq(organizationsTable.id, organizationId))
      .returning();
    if (!org) throw new NotFoundException('Организация не найдена');
    return toResponse(org);
  }
}
