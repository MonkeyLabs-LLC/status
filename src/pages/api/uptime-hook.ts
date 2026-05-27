import type { APIRoute } from 'astro';
import { db } from '@/db';
import { services } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';

export const POST: APIRoute = async ({ request }) => {
  const secret = process.env.UPTIME_HOOK_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: { code: 'not_configured', message: 'Webhook not configured.' } }), { status: 503 });
  }
  const provided = request.headers.get('X-Uptime-Hook-Secret') ?? '';
  if (provided.length !== secret.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) {
    return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid secret.' } }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { service_id, status: newStatus } = body;
    if (!service_id || !newStatus) {
      return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'service_id and status are required.' } }), { status: 400 });
    }

    const validStatuses = ['ok', 'deg', 'out', 'maint'];
    if (!validStatuses.includes(newStatus)) {
      return new Response(JSON.stringify({ error: { code: 'bad_request', message: `status must be one of: ${validStatuses.join(', ')}` } }), { status: 400 });
    }

    // Get current service
    const rows = await db.select().from(services).where(eq(services.id, service_id));
    const svc = rows[0];
    if (!svc) {
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Service not found.' } }), { status: 404 });
    }

    // Update status
    await db.update(services).set({ status: newStatus }).where(eq(services.id, service_id));

    // Append to uptime_90d
    const today = new Date().toISOString().split('T')[0];
    const uptime = Array.isArray(svc.uptime90d) ? [...(svc.uptime90d as any[])] : [];
    const existing = uptime.findIndex((d: any) => d.date === today);
    if (existing >= 0) {
      uptime[existing] = { date: today, status: newStatus };
    } else {
      uptime.push({ date: today, status: newStatus });
    }
    // Keep only last 90 days
    const trimmed = uptime.slice(-90);
    await db.update(services).set({ uptime90d: trimmed }).where(eq(services.id, service_id));

    return new Response(JSON.stringify({ data: { updated: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: { code: 'server_error', message: 'Something went wrong.' } }), { status: 500 });
  }
};
