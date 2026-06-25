/**
 * DB-backed maintenance queries for public pages.
 * Returns data mapped to the Maintenance interface from types.ts.
 */
import { db } from '@/db';
import { maintenance } from '@/db/schema';
import { gte, asc } from 'drizzle-orm';
import type { Maintenance } from './types';
import { serviceIdsForProduct, resolveProduct } from '@/lib/components';

function mapDbMaintenance(row: typeof maintenance.$inferSelect, product: string): Maintenance {
  return {
    id: row.id,
    title: row.title,
    product,
    scheduledStart: row.scheduledStart.toISOString(),
    scheduledEnd: row.scheduledEnd.toISOString(),
    body: row.summary,
  };
}

export async function getUpcomingMaintenance(product?: string): Promise<Maintenance[]> {
  const rows = await db.select().from(maintenance)
    .where(gte(maintenance.scheduledEnd, new Date()))
    .orderBy(asc(maintenance.scheduledStart));

  let filtered = rows;
  if (product) {
    const svcIds = await serviceIdsForProduct(product);
    filtered = filtered.filter(r => r.affects.some(a => svcIds.includes(a)));
  }

  return Promise.all(filtered.map(async (row) => {
    const prod = product ?? await resolveProduct(row.affects);
    return mapDbMaintenance(row, prod);
  }));
}
