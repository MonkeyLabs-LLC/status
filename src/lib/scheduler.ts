/**
 * Internal scheduler — the self-host replacement for the two Netlify scheduled
 * functions (netlify/functions/sweep-cron.mjs + uptimerobot-poll.mjs).
 *
 * On the @astrojs/node server boot it starts two setInterval loops that POST the
 * SAME endpoints the Netlify crons hit:
 *   - POST /api/v1/sweep                         every 5 min  (dead-man/TTL sweep)
 *   - POST /api/v1/ingest/uptimerobot?key=...    every 5 min  (UptimeRobot poll)
 *
 * GUARD: this only runs under the node adapter (STATUS_ADAPTER === 'node'). On
 * Netlify the scheduled functions own the cadence; running this there too would
 * DOUBLE every sweep/poll — the exact invocation-meter blowup self-hosting fixes.
 * Single instance, so no leader election is needed (see SELFHOST-MIGRATION.md).
 *
 * Origin: the server hits itself. We target loopback on the bound $PORT
 * (http://127.0.0.1:$PORT) and send the correct Host header so middleware scope
 * resolution stays sane — these are mutations (no scope-specific body), Host just
 * needs to be a known domain. No external origin env, no hardcoded public domain.
 *
 * Idempotent: guarded so a hot module re-eval (dev/HMR) or a double-import never
 * starts two sets of timers in one process.
 */

import { STATUS_DOMAIN } from '@/pulse.config';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min
// Small stagger so the two jobs don't fire on the exact same tick.
const POLL_OFFSET_MS = 30 * 1000;

// Module-scope flag — survives within a single Node process; prevents double-start.
let started = false;

function selfOrigin(): string {
  const port = process.env.PORT || '4321';
  return `http://127.0.0.1:${port}`;
}

// A real, known Host so middleware resolveScope() returns a defined scope.
function selfHost(): string {
  return STATUS_DOMAIN;
}

async function runSweep(): Promise<void> {
  const secret = process.env.UPTIME_HOOK_SECRET;
  if (!secret) {
    console.error('[scheduler] UPTIME_HOOK_SECRET not set; skipping sweep.');
    return;
  }
  const target = `${selfOrigin()}/api/v1/sweep`;
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'X-Uptime-Hook-Secret': secret,
        'Content-Type': 'application/json',
        Host: selfHost(),
      },
      body: '{}',
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[scheduler] sweep returned ${res.status}: ${text}`);
      return;
    }
    console.log(`[scheduler] sweep ok: ${text}`);
  } catch (e) {
    console.error('[scheduler] sweep request failed', e);
  }
}

// UptimeRobot monitor status -> adapter alertType (1=down, 2=up). null = skip.
//   0 paused · 1 not-checked-yet · 2 up · 8 seems-down · 9 down
function statusToAlertType(status: unknown): number | null {
  switch (Number(status)) {
    case 2:
      return 2; // up
    case 8:
      return 1; // seems down
    case 9:
      return 1; // down
    default:
      return null; // paused / not-yet-checked → don't report
  }
}

async function runUptimeRobotPoll(): Promise<void> {
  const apiKey = process.env.UPTIMEROBOT_API_KEY;
  const secret = process.env.UPTIME_HOOK_SECRET;
  if (!apiKey || !secret) {
    // Optional vantage — quietly skip if not configured.
    return;
  }
  const ingest = `${selfOrigin()}/api/v1/ingest/uptimerobot?key=${encodeURIComponent(secret)}`;

  let monitors: any[] = [];
  try {
    const res = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: `api_key=${encodeURIComponent(apiKey)}&format=json`,
    });
    const data: any = await res.json();
    if (data.stat !== 'ok') {
      console.error('[scheduler] uptimerobot API error:', JSON.stringify(data.error || data));
      return;
    }
    monitors = Array.isArray(data.monitors) ? data.monitors : [];
  } catch (e) {
    console.error('[scheduler] uptimerobot fetch failed', e);
    return;
  }

  const nowSecs = Math.floor(Date.now() / 1000);
  let sent = 0,
    unmapped = 0,
    skipped = 0,
    errors = 0;

  for (const m of monitors) {
    const alertType = statusToAlertType(m.status);
    if (alertType === null) {
      skipped++;
      continue;
    }
    const payload = {
      monitorID: String(m.id),
      monitorFriendlyName: m.friendly_name ?? String(m.id),
      alertType: String(alertType),
      alertDateTime: String(nowSecs),
      alertDetails: `scheduler-poll status=${m.status}`,
    };
    try {
      const r = await fetch(ingest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Host: selfHost() },
        body: JSON.stringify(payload),
      });
      if (r.status === 202) sent++;
      else if (r.status === 422) unmapped++; // unmapped monitor — expected until mapped
      else {
        errors++;
        console.error(`[scheduler] ingest ${r.status} for monitor ${m.id}`);
      }
    } catch (e) {
      errors++;
      console.error(`[scheduler] ingest failed for monitor ${m.id}`, e);
    }
  }

  console.log(
    `[scheduler] uptimerobot-poll monitors=${monitors.length} sent=${sent} unmapped=${unmapped} skipped=${skipped} errors=${errors}`,
  );
}

/**
 * Start the internal scheduler. No-op unless STATUS_ADAPTER === 'node' (never on
 * Netlify) and unless already started in this process.
 */
export function startScheduler(): void {
  if (started) return;
  if ((process.env.STATUS_ADAPTER ?? 'netlify') !== 'node') return;
  started = true;

  console.log('[scheduler] node adapter — starting internal sweep + uptimerobot poll (5m each).');

  // Kick once shortly after boot so the page is fresh without waiting a full
  // interval, then settle into the 5-min cadence.
  setTimeout(() => void runSweep(), 10 * 1000);
  setTimeout(() => void runUptimeRobotPoll(), 10 * 1000 + POLL_OFFSET_MS);

  setInterval(() => void runSweep(), SWEEP_INTERVAL_MS);
  setInterval(() => void runUptimeRobotPoll(), POLL_INTERVAL_MS);
}
