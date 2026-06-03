/**
 * POST /api/v1/ingest/grafana — Grafana Cloud alerting webhook adapter.
 *
 * THIN ADAPTER over the core engine (mirrors /api/uptime-hook). Grafana Cloud
 * (and Alertmanager-compatible) alert webhooks POST a fixed envelope with an
 * `alerts[]` array; this route translates each alert into a core observation
 * and funnels it through the SAME quorum engine as /api/v1/ingest via
 * appendObservation(). Vendor vocabulary never reaches the core — it is mapped
 * to a component here / via source_target_map.
 *
 * This is VANTAGE 2 (machine truth, shipped off-box to Grafana Cloud).
 *
 * Auth: a shared secret in GRAFANA_HOOK_SECRET, accepted either as
 *   Authorization: Bearer <secret>      (Grafana's webhook bearer-token field)
 * or
 *   X-Grafana-Hook-Secret: <secret>
 * Both are timing-safe-compared. The observations attribute to a lazily
 * created `Grafana Cloud` adapter source (kind=probe), like the other adapters.
 *
 * Payload shape (Grafana Cloud / Alertmanager grafana_alerts):
 *   {
 *     "alerts": [
 *       {
 *         "status": "firing" | "resolved",
 *         "labels": { "alertname": "...", "instance": "...", "job": "...",
 *                     "severity": "critical|warning|...", "target": "..." },
 *         "annotations": { "summary": "...", "description": "..." }
 *       }, ...
 *     ]
 *   }
 *
 * Signal mapping (per alert):
 *   status=resolved                          -> ok
 *   status=firing & severity in {warning,    -> degraded
 *                  minor,info}
 *   status=firing (anything else, incl.      -> down
 *                  critical/no severity)
 *
 * Target resolution (raw label, in priority order, first present wins):
 *   labels.target -> labels.component -> labels.service -> labels.instance
 *   -> labels.job -> labels.alertname
 * resolved through source_target_map for the grafana source (falls back to the
 * raw label as a component id, matching resolveTarget semantics).
 */
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { getOrCreateAdapterSource, resolveTarget } from '@/lib/sources';
import { appendObservation, type Signal } from '@/lib/quorum';
import { snapshotComponent, notifyForComponent } from '@/lib/notify';

const DEGRADED_SEVERITIES = new Set(['warning', 'warn', 'minor', 'info', 'low']);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function secretMatches(provided: string, secret: string): boolean {
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

/** Map one Grafana alert (status + severity label) to a core signal. */
function alertToSignal(status: string, severity: string | undefined): Signal {
  if (status === 'resolved') return 'ok';
  // firing:
  if (severity && DEGRADED_SEVERITIES.has(severity.toLowerCase())) return 'degraded';
  return 'down';
}

/** Pick the raw target label from an alert's labels, in priority order. */
function rawTarget(labels: Record<string, string>): string | null {
  return (
    labels.target ?? labels.component ?? labels.service ??
    labels.instance ?? labels.job ?? labels.alertname ?? null
  );
}

export const POST: APIRoute = async ({ request }) => {
  const secret = process.env.GRAFANA_HOOK_SECRET;
  if (!secret) {
    return json({ error: { code: 'not_configured', message: 'Grafana webhook not configured.' } }, 503);
  }

  // Accept the secret as a Bearer token (Grafana webhook auth) or a header.
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const headerSecret = request.headers.get('X-Grafana-Hook-Secret') ?? '';
  const provided = bearer || headerSecret;
  if (!provided || !secretMatches(provided, secret)) {
    return json({ error: { code: 'unauthorized', message: 'Invalid or missing secret.' } }, 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: 'bad_request', message: 'Body must be JSON.' } }, 400);
  }

  const alerts: any[] = Array.isArray(body?.alerts) ? body.alerts : [];
  if (alerts.length === 0) {
    return json({ error: { code: 'bad_request', message: 'Expected a non-empty `alerts[]` array.' } }, 400);
  }

  const source = await getOrCreateAdapterSource('Grafana Cloud', 'probe');

  const results: Array<{ target: string; signal: Signal; mapped: boolean }> = [];
  let accepted = 0;

  for (const alert of alerts) {
    const status = typeof alert?.status === 'string' ? alert.status : 'firing';
    const labels: Record<string, string> = (alert?.labels && typeof alert.labels === 'object') ? alert.labels : {};
    const annotations: Record<string, string> = (alert?.annotations && typeof alert.annotations === 'object') ? alert.annotations : {};

    const raw = rawTarget(labels);
    if (!raw) {
      results.push({ target: '(none)', signal: 'down', mapped: false });
      continue;
    }

    const signal = alertToSignal(status, labels.severity);
    const componentId = await resolveTarget(source.id, raw);
    if (!componentId) {
      // No mapping row for this raw label: record as unmapped (skip), so the
      // adapter is loud-but-not-fatal, matching the core's 422 semantics.
      results.push({ target: raw, signal, mapped: false });
      continue;
    }

    const detail = annotations.summary || annotations.description || `grafana:${labels.alertname ?? raw}`;

    // Snapshot before the engine runs so we can narrate the exact transition.
    const before = await snapshotComponent(componentId);
    await appendObservation({
      sourceId: source.id,
      componentId,
      signal,
      detail,
      defaultTtlSeconds: source.defaultTtl ?? null,
    });
    await notifyForComponent(componentId, before);

    accepted++;
    results.push({ target: raw, signal, mapped: true });
  }

  return json({ data: { accepted, total: alerts.length, results } }, 202);
};
