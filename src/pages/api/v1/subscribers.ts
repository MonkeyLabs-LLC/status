import type { APIRoute } from 'astro';
import { listSubscribers } from '@/lib/subscribers';
import { validateApiToken } from '@/lib/api-tokens';

export const GET: APIRoute = async ({ request }) => {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid API token.' } }), { status: 401 });
  const token = await validateApiToken(auth.slice(7));
  if (!token) return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid API token.' } }), { status: 401 });
  const rows = await listSubscribers();
  return new Response(JSON.stringify({ data: rows }), { headers: { 'Content-Type': 'application/json' } });
};
