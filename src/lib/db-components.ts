/**
 * Admin CRUD for the `components` adjacency tree. Status is intentionally NOT
 * settable here — it's derived by the engine (status §5 discipline). Archive,
 * never hard-delete.
 */
import { db } from '@/db';
import { components } from '@/db/schema';
import { eq, isNull, isNotNull, asc, and } from 'drizzle-orm';

export async function getComponentsAdmin(opts?: { archived?: boolean }) {
  const conds = [];
  if (opts?.archived === false) conds.push(isNull(components.archivedAt));
  if (opts?.archived === true) conds.push(isNotNull(components.archivedAt));
  return db.select().from(components)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(components.sortOrder));
}

export async function getComponentRow(id: string) {
  const rows = await db.select().from(components).where(eq(components.id, id));
  return rows[0] ?? null;
}

export interface ComponentInput {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  tag: string | null;
  brand: string | null;
  domain: string | null;
  sortOrder: number;
}

export async function createComponentRow(v: ComponentInput) {
  await db.insert(components).values({
    id: v.id, name: v.name, kind: v.kind, parentId: v.parentId,
    tag: v.tag, brand: v.brand, domain: v.domain, sortOrder: v.sortOrder, status: 'ok',
  });
}

export async function updateComponentRow(id: string, patch: Record<string, unknown>) {
  if (Object.keys(patch).length) await db.update(components).set(patch).where(eq(components.id, id));
}

export async function setComponentArchived(id: string, archived: boolean) {
  await db.update(components).set({ archivedAt: archived ? new Date() : null }).where(eq(components.id, id));
}
