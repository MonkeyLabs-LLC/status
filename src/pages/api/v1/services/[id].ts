import type { APIRoute } from 'astro';
import { db } from '@/db';
import { services } from '@/db/schema';
import { validateApiToken } from '@/lib/api-tokens';
import { eq } from 'drizzle-orm';

async function authenticate(request: Request, requiredScope: 'read' | 'write' | 'full') {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = await validateApiToken(auth.slice(7));
  if (!token) return null;
  const scopeRank: Record<string, number> = { read: 1, write: 2, full: 3 };
  if ((scopeRank[token.scope] ?? 0) < (scopeRank[requiredScope] ?? 3)) return null;
  return token;
}

export const GET: APIRoute = async ({ request, params }) => {
  const token = await authenticate(request, 'read');
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });

  const rows = await db.select().from(services).where(eq(services.id, params.id!));
  if (!rows[0]) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Service not found.' } }), { status: 404 });
  return new Response(JSON.stringify({ data: rows[0] }), { headers: { 'Content-Type': 'application/json' } });
};

export const PATCH: APIRoute = async ({ request, params }) => {
  const token = await authenticate(request, 'write');
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });

  const body = await request.json();
  const updates: Record<string, any> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.product !== undefined) updates.product = body.product;
  if (body.tag !== undefined) updates.tag = body.tag;
  if (body.status !== undefined) updates.status = body.status;
  if (body.sort_order !== undefined) updates.sortOrder = body.sort_order;

  if (Object.keys(updates).length === 0) {
    return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'No fields to update.' } }), { status: 400 });
  }

  await db.update(services).set(updates).where(eq(services.id, params.id!));
  const updated = await db.select().from(services).where(eq(services.id, params.id!));
  if (!updated[0]) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Service not found.' } }), { status: 404 });
  return new Response(JSON.stringify({ data: updated[0] }), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const token = await authenticate(request, 'full');
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });

  await db.update(services).set({ archivedAt: new Date() }).where(eq(services.id, params.id!));
  return new Response(JSON.stringify({ data: { archived: true } }), { headers: { 'Content-Type': 'application/json' } });
};
