/**
 * Legacy uptime webhook — now a THIN ADAPTER over the core engine.
 *
 * It keeps its fixed payload `{ service_id, status }` and shared-secret auth
 * (back-compat for whatever is already pointed at it), but instead of writing
 * service status directly it TRANSLATES the payload into a core observation
 * and funnels it through the same quorum engine as /api/v1/ingest. There is
 * exactly one core path; this route is just one of its adapters.
 *
 * Status translation: ok -> ok, deg -> degraded, out -> down.
 * `maint` is not an observation signal (maintenance is a separate, scheduled
 * concern); a maint payload is accepted but recorded only on the legacy
 * uptime_90d bar, not the quorum engine.
 */
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { components } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { getOrCreateAdapterSource } from '@/lib/sources';
import { appendObservation, type Signal } from '@/lib/quorum';
import { snapshotComponent, notifyForComponent } from '@/lib/notify';

const SIGNAL_MAP: Record<string, Signal | 'maint'> = {
  ok: 'ok',
  deg: 'degraded',
  out: 'down',
  maint: 'maint',
};

/**
 * Dead-man TTL for UptimeRobot observations. The external probe heartbeats on a
 * fixed interval; an observation must expire at ~2x that interval so a probe
 * that simply dies goes stale instead of pinning the last 'ok' forever. Default
 * to 600s (~2x a 5-minute probe) when no interval is configured.
 */
const UPTIME_OBS_TTL_SECONDS = Number(process.env.UPTIME_HOOK_TTL_SECONDS) || 600;

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

    const mapped = SIGNAL_MAP[newStatus];
    if (!mapped) {
      return new Response(JSON.stringify({ error: { code: 'bad_request', message: `status must be one of: ${Object.keys(SIGNAL_MAP).join(', ')}` } }), { status: 400 });
    }

    // Confirm the component exists (single model — no orphan targets).
    const rows = await db.select().from(components).where(eq(components.id, service_id));
    const svc = rows[0];
    if (!svc || svc.archivedAt != null) {
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Component not found.' } }), { status: 404 });
    }

    // Always keep the 90-day uptime bar (legacy behavior the public page reads).
    const today = new Date().toISOString().split('T')[0];
    const uptime = Array.isArray(svc.uptime90d) ? [...(svc.uptime90d as any[])] : [];
    const existing = uptime.findIndex((d: any) => d.date === today);
    if (existing >= 0) {
      uptime[existing] = { date: today, status: newStatus };
    } else {
      uptime.push({ date: today, status: newStatus });
    }
    await db.update(components).set({ uptime90d: uptime.slice(-90) }).where(eq(components.id, service_id));

    // Route real signals (ok/deg/out) through the core engine as an observation.
    if (mapped !== 'maint') {
      const source = await getOrCreateAdapterSource('UptimeRobot', 'probe');
      const before = await snapshotComponent(service_id);
      await appendObservation({
        sourceId: source.id,
        componentId: service_id, // the raw label IS the component id for this trusted adapter
        signal: mapped,
        detail: 'uptime-hook',
        defaultTtlSeconds: UPTIME_OBS_TTL_SECONDS, // dead-man: stale if the probe dies
      });
      await notifyForComponent(service_id, before);
    }

    return new Response(JSON.stringify({ data: { updated: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: { code: 'server_error', message: 'Something went wrong.' } }), { status: 500 });
  }
};
