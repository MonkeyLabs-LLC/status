/**
 * Netlify scheduled function — the status page's OWN external prober.
 *
 * Runs on Netlify (a failure domain independent of the OVH boxes and of
 * UptimeRobot), so it's the SECOND external vantage. When a box dies and the
 * on-box eyes (Evolution self-report, Grafana/Alloy blackbox) go dark, this +
 * UptimeRobot are two independent externals that can AGREE → the quorum confirms
 * the outage instead of stalling at one vote.
 *
 * It GET-probes the customer-facing endpoints (free outbound fetches), then POSTs
 * ONE batch to /api/v1/ingest/status-probe?key=<UPTIME_HOOK_SECRET>, which feeds
 * the same core engine (lazy 'Status Prober' source, appendObservation, notify).
 *
 * Cost: this run (1 invocation) + the single ingest POST (1) every 5 min ≈
 * 17k invocations/month — a few % of the free-tier function cap, and ZERO build
 * minutes. It probes EXTERNAL services only (never an SSR route, never itself).
 *
 * Required env (Netlify, Functions/Runtime scope):
 *   UPTIME_HOOK_SECRET   — reused; the status-probe adapter validates it
 *   PUBLIC_STATUS_URL    — optional; defaults to https://status.monkeylabs.gg
 *
 * Targets map directly to component ids. Add/edit a line to (un)monitor a service.
 */

export const config = { schedule: '*/5 * * * *' };

// component id  ->  the URL to GET. 2xx/3xx = up. Edit this list to change coverage.
const TARGETS = [
  { component: 'backend', url: 'https://api.sessions.gg/health' },
  { component: 'frontend', url: 'https://sessions.gg/' },
  { component: 'bananadoro', url: 'https://bananadoro.bananalabs.cloud/' },
];

async function probe(url) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) });
    return res.ok || (res.status >= 200 && res.status < 400);
  } catch {
    return false;
  }
}

export default async function handler() {
  const secret = process.env.UPTIME_HOOK_SECRET;
  if (!secret) return new Response('UPTIME_HOOK_SECRET not set', { status: 503 });
  const base = (process.env.PUBLIC_STATUS_URL || 'https://status.monkeylabs.gg').replace(/\/$/, '');

  const probes = [];
  for (const t of TARGETS) {
    probes.push({ component: t.component, up: await probe(t.url) });
  }

  try {
    const res = await fetch(`${base}/api/v1/ingest/status-probe?key=${encodeURIComponent(secret)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probes }),
      signal: AbortSignal.timeout(10000),
    });
    return new Response(`status-probe: ${res.status} ${JSON.stringify(probes)}`, { status: 200 });
  } catch (e) {
    return new Response(`status-probe ingest failed: ${e}`, { status: 502 });
  }
}
