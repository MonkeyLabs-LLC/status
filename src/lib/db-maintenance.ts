/**
 * DB-backed maintenance queries for public pages.
 * Returns data mapped to the Maintenance interface from types.ts.
 */
import { db } from '@/db';
import { maintenance, services } from '@/db/schema';
import { gte, asc, eq } from 'drizzle-orm';
import type { Maintenance } from './types';

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

/** Resolve the product for a maintenance window by looking at the first affected service. */
async function resolveProduct(affects: string[]): Promise<string> {
  if (affects.length === 0) return 'sessions';
  const rows = await db.select({ product: services.product })
    .from(services)
    .where(eq(services.id, affects[0]))
    .limit(1);
  return rows[0]?.product ?? 'sessions';
}

async function serviceIdsForProduct(product: string): Promise<string[]> {
  const rows = await db.select({ id: services.id })
    .from(services)
    .where(eq(services.product, product));
  return rows.map(r => r.id);
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
