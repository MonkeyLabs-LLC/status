import { db } from '@/db';
import { products } from '@/db/schema';
import { eq, isNull, isNotNull, asc, and } from 'drizzle-orm';
import type { Product } from './types';

function mapDbProduct(row: typeof products.$inferSelect): Product {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    launched: row.launched,
    domain: row.domain,
    brandColor: row.brandColor,
  };
}

/* ── raw queries (used by admin pages) ─────────────────────── */

export async function getAllProducts(opts?: { archived?: boolean }) {
  const conditions = [];
  if (opts?.archived === false) conditions.push(isNull(products.archivedAt));
  if (opts?.archived === true) conditions.push(isNotNull(products.archivedAt));

  return db.select().from(products)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(products.sortOrder));
}

/* ── mapped queries (used by public pages) ─────────────────── */

export async function getProducts(): Promise<Product[]> {
  const rows = await db.select().from(products)
    .where(isNull(products.archivedAt))
    .orderBy(asc(products.sortOrder));
  return rows.map(mapDbProduct);
}

export async function getLaunchedProducts(): Promise<Product[]> {
  const all = await getProducts();
  return all.filter(p => p.launched);
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const rows = await db.select().from(products).where(eq(products.id, id));
  const row = rows[0];
  return row ? mapDbProduct(row) : undefined;
}

/* ── mutations (used by admin pages) ───────────────────────── */

interface CreateProductInput {
  id: string;
  name: string;
  tag?: string | null;
  launched?: boolean;
  domain?: string | null;
  brandColor?: string | null;
  sortOrder?: number;
}

export async function createProduct(data: CreateProductInput) {
  await db.insert(products).values({
    id: data.id,
    name: data.name,
    tag: data.tag ?? null,
    launched: data.launched ?? true,
    domain: data.domain ?? null,
    brandColor: data.brandColor ?? null,
    sortOrder: data.sortOrder ?? 0,
  });
}

interface UpdateProductInput {
  name?: string;
  tag?: string | null;
  launched?: boolean;
  domain?: string | null;
  brandColor?: string | null;
  sortOrder?: number;
}

export async function updateProduct(id: string, data: UpdateProductInput) {
  await db.update(products).set(data).where(eq(products.id, id));
}

export async function archiveProduct(id: string) {
  await db.update(products).set({ archivedAt: new Date() }).where(eq(products.id, id));
}
