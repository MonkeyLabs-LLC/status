import type { APIRoute } from 'astro';
import { db } from '@/db';
import { maintenance } from '@/db/schema';
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

export const PATCH: APIRoute = async ({ request, params }) => {
  const token = await authenticate(request, 'write');
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });
  const body = await request.json();
  const updates: Record<string, any> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.summary !== undefined) updates.summary = body.summary;
  if (body.scheduled_start !== undefined) updates.scheduledStart = new Date(body.scheduled_start);
  if (body.scheduled_end !== undefined) updates.scheduledEnd = new Date(body.scheduled_end);
  if (body.affects !== undefined) updates.affects = body.affects;
  await db.update(maintenance).set(updates).where(eq(maintenance.id, params.id!));
  const updated = await db.select().from(maintenance).where(eq(maintenance.id, params.id!));
  if (!updated[0]) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Maintenance not found.' } }), { status: 404 });
  return new Response(JSON.stringify({ data: updated[0] }), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const token = await authenticate(request, 'full');
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });
  await db.delete(maintenance).where(eq(maintenance.id, params.id!));
  return new Response(JSON.stringify({ data: { deleted: true } }), { headers: { 'Content-Type': 'application/json' } });
};
