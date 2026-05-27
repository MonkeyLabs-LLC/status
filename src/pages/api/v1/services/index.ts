import type { APIRoute } from 'astro';
import { db } from '@/db';
import { services } from '@/db/schema';
import { validateApiToken } from '@/lib/api-tokens';
import { eq, and, asc, isNull, isNotNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';

async function authenticate(request: Request, requiredScope: 'read' | 'write' | 'full') {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = await validateApiToken(auth.slice(7));
  if (!token) return null;
  const scopeRank: Record<string, number> = { read: 1, write: 2, full: 3 };
  const requiredRank = scopeRank[requiredScope] ?? 3;
  if ((scopeRank[token.scope] ?? 0) < requiredRank) return null;
  return token;
}

export const GET: APIRoute = async ({ request, url }) => {
  const token = await authenticate(request, 'read');
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });

  const product = url.searchParams.get('product');
  const archived = url.searchParams.get('archived');
  const limit = parseInt(url.searchParams.get('limit') ?? '50');
  const offset = parseInt(url.searchParams.get('offset') ?? '0');

  const conditions = [];
  if (product) conditions.push(eq(services.product, product));
  if (archived === 'true') conditions.push(isNotNull(services.archivedAt));
  else if (archived !== 'all') conditions.push(isNull(services.archivedAt));

  const rows = await db.select().from(services)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(services.sortOrder))
    .limit(limit).offset(offset);

  return new Response(JSON.stringify({ data: rows }), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request }) => {
  const token = await authenticate(request, 'write');
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });

  const body = await request.json();
  const { name, product, tag, status, sort_order } = body;
  if (!name || !product) {
    return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'name and product are required.' } }), { status: 400 });
  }

  const id = nanoid();
  const row = {
    id, name, product,
    tag: tag ?? null,
    status: status ?? 'ok',
    sortOrder: sort_order ?? 0,
  };
  await db.insert(services).values(row);
  const created = await db.select().from(services).where(eq(services.id, id));
  return new Response(JSON.stringify({ data: created[0] }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};
