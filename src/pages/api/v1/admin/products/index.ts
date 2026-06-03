/**
 * Admin product endpoints (admin-session auth). Uses lib/db-products.ts.
 *   GET  /api/v1/admin/products   list (active by default)
 *   POST /api/v1/admin/products   create
 */
import type { APIRoute } from 'astro';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { getAllProducts, createProduct } from '@/lib/db-products';

export const GET: APIRoute = async (ctx) => {
  const who = await requireAdmin(ctx);
  if (who instanceof Response) return who;
  const archived = ctx.url.searchParams.get('archived') === 'true';
  return ok(await getAllProducts({ archived }));
};

export const POST: APIRoute = async (ctx) => {
  const who = await requireAdmin(ctx);
  if (who instanceof Response) return who;
  const b = await ctx.request.json().catch(() => null);
  if (!b?.id || !b?.name) return err('bad_request', 'id and name are required.', 400);
  await createProduct({
    id: b.id, name: b.name,
    tag: b.tag || null,
    launched: b.launched === true || b.launched === 'true',
    domain: b.domain || null,
    brandColor: b.brandColor || null,
    sortOrder: b.sortOrder != null ? Number(b.sortOrder) : 0,
  });
  return ok({ id: b.id }, 201);
};
