/**
 * Admin single-product endpoints (admin-session auth). Uses lib/db-products.ts.
 *   PATCH  /api/v1/admin/products/:id   edit
 *   DELETE /api/v1/admin/products/:id   ARCHIVE (soft) — never hard-delete
 */
import type { APIRoute } from 'astro';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { updateProduct, archiveProduct } from '@/lib/db-products';

export const PATCH: APIRoute = async (ctx) => {
  const who = await requireAdmin(ctx);
  if (who instanceof Response) return who;
  const id = ctx.params.id!;
  const b = await ctx.request.json().catch(() => null);
  if (!b) return err('bad_request', 'Invalid JSON body.', 400);
  const u: Record<string, unknown> = {};
  if (b.name) u.name = b.name;
  if (b.tag !== undefined) u.tag = b.tag || null;
  if (b.launched !== undefined) u.launched = b.launched === true || b.launched === 'true';
  if (b.domain !== undefined) u.domain = b.domain || null;
  if (b.brandColor !== undefined) u.brandColor = b.brandColor || null;
  if (b.sortOrder != null && b.sortOrder !== '') u.sortOrder = Number(b.sortOrder);
  if (Object.keys(u).length) await updateProduct(id, u);
  return ok({ id });
};

export const DELETE: APIRoute = async (ctx) => {
  const who = await requireAdmin(ctx);
  if (who instanceof Response) return who;
  await archiveProduct(ctx.params.id!);
  return ok({ archived: true });
};
