import { db } from '@/db';
import { services } from '@/db/schema';
import { eq, isNull, isNotNull, asc, and } from 'drizzle-orm';
import type { Service, ServiceStatus, DayStatus } from './types';
import { derivedComponentStatuses } from './quorum';

/* ── status mapping (DB short codes → public types) ────────── */

function mapStatus(s: string): ServiceStatus {
  switch (s) {
    case 'ok':    return 'operational';
    case 'deg':   return 'degraded';
    case 'out':   return 'outage';
    case 'maint': return 'maintenance';
    default:      return 'operational';
  }
}

function mapDbService(row: typeof services.$inferSelect): Service {
  return {
    id: row.id,
    name: row.name,
    product: row.product,
    status: mapStatus(row.status),
    uptime90d: (row.uptime90d ?? []) as DayStatus[],
  };
}

/* ── raw queries (used by admin pages) ─────────────────────── */

export async function getServices(opts?: { product?: string; archived?: boolean }) {
  const conditions = [];
  if (opts?.product) conditions.push(eq(services.product, opts.product));
  if (opts?.archived === false) conditions.push(isNull(services.archivedAt));
  if (opts?.archived === true) conditions.push(isNotNull(services.archivedAt));

  return db.select().from(services)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(services.sortOrder));
}

export async function getService(id: string) {
  const rows = await db.select().from(services).where(eq(services.id, id));
  return rows[0] ?? null;
}

/* ── mapped queries (used by public pages) ─────────────────── */

/**
 * Overlay the quorum engine's DERIVED status onto stored service rows. The
 * engine never writes services.status (status is derived from observations);
 * the public pages must reflect it so the page is truthful during an outage
 * with the admin untouched. Services with no engine observations keep their
 * stored status. Mirrors the same overlay summary.json applies.
 */
async function overlayDerived(list: Service[]): Promise<Service[]> {
  if (list.length === 0) return list;
  const derived = await derivedComponentStatuses();
  return list.map((s) => {
    const d = derived[s.id];
    if (!d) return s;
    const status: ServiceStatus =
      d.status === 'outage' ? 'outage' : d.status === 'degraded' ? 'degraded' : 'operational';
    return { ...s, status };
  });
}

export async function getPublicServices(opts?: { product?: string }): Promise<Service[]> {
  const conditions = [isNull(services.archivedAt)];
  if (opts?.product) conditions.push(eq(services.product, opts.product));

  const rows = await db.select().from(services)
    .where(and(...conditions))
    .orderBy(asc(services.sortOrder));
  return overlayDerived(rows.map(mapDbService));
}

export async function getPublicService(id: string): Promise<Service | undefined> {
  const rows = await db.select().from(services).where(eq(services.id, id));
  const row = rows[0];
  if (!row) return undefined;
  return (await overlayDerived([mapDbService(row)]))[0];
}
