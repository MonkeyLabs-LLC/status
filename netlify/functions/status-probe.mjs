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
  // Two attempts with a short gap: a single transient slow/errored fetch (a cold
  // edge, a momentary network blip) must NOT register as a real outage. Report
  // down only when BOTH the initial GET and one retry fail. This kills false
  // downs at the source; the engine's watch/dwell debounce is the second layer.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) });
      if (res.ok || (res.status >= 200 && res.status < 400)) return true;
    } catch { /* fall through to the retry */ }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

export default async function handler() {
  const secret = process.env.UPTIME_HOOK_SECRET;
  if (!secret) return new Response('UPTIME_HOOK_SECRET not set', { status: 503 });
  const base = (process.env.PUBLIC_STATUS_URL || 'https://status.monkeylabs.gg').replace(/\/$/, '');

  // Probe all targets concurrently — runtime stays ~one slow probe regardless of
  // how many services you add, so this scales to a long TARGETS list without
  // hitting the function time limit. (Cost is unchanged: still 1 run + 1 batch POST.)
  const probes = await Promise.all(
    TARGETS.map(async (t) => ({ component: t.component, up: await probe(t.url) })),
  );

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
