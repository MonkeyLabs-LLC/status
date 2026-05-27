import type { APIRoute } from 'astro';
import { db } from '@/db';
import { incidents, incidentTimeline } from '@/db/schema';
import { validateApiToken } from '@/lib/api-tokens';
import { eq, desc, and, arrayContains } from 'drizzle-orm';
import { nanoid } from 'nanoid';

async function authenticate(request: Request, requiredScope: 'read' | 'write' | 'full') {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = await validateApiToken(auth.slice(7));
  if (!token) return null;
  const scopeRank: Record<string, number> = { read: 1, write: 2, full: 3 };
  if ((scopeRank[token.scope] ?? 0) < (scopeRank[requiredScope] ?? 3)) return null;
  return token;
}

export const GET: APIRoute = async ({ request, url }) => {
  const token = await authenticate(request, 'read');
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });

  const status = url.searchParams.get('status');
  const product = url.searchParams.get('product');
  const limit = parseInt(url.searchParams.get('limit') ?? '50');
  const offset = parseInt(url.searchParams.get('offset') ?? '0');

  const conditions = [];
  if (status) conditions.push(eq(incidents.status, status));
  if (product) conditions.push(arrayContains(incidents.affects, [product]));

  const rows = await db.select().from(incidents)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(incidents.startedAt))
    .limit(limit).offset(offset);

  return new Response(JSON.stringify({ data: rows }), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request }) => {
  const token = await authenticate(request, 'write');
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });

  const body = await request.json();
  const { title, summary, severity, affects, status: incStatus } = body;
  if (!title || !summary || !severity || !affects?.length) {
    return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'title, summary, severity, and affects are required.' } }), { status: 400 });
  }

  const id = nanoid();
  await db.insert(incidents).values({
    id, title, summary, severity, affects,
    status: incStatus ?? 'investigating',
    startedAt: new Date(),
  });

  // Create initial timeline entry if provided
  if (body.initial_note) {
    await db.insert(incidentTimeline).values({
      id: nanoid(),
      incidentId: id,
      at: new Date(),
      label: (incStatus ?? 'INVESTIGATING').toUpperCase(),
      body: body.initial_note,
    });
  }

  const created = await db.select().from(incidents).where(eq(incidents.id, id));
  return new Response(JSON.stringify({ data: created[0] }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};
