# Status page — self-host migration scope

**Why:** Netlify's free-tier function-invocation cap 503'd the whole site (`usage_exceeded`,
2026-06-18). The vendor quota is the only lock here. Self-hosting removes it and matches the
no-vendor-lock rule. The sweep-cadence fix (every-min→every-5-min) buys headroom; this scopes the
durable move.

## Hard constraints (must be preserved)
1. **Multi-domain.** One deployment serves `status.sessions.gg` / `status.monkeylabs.gg` /
   `status.bananalabs.gg`, themed per domain. (This is *currently* why Netlify is used — multiple
   custom domains → one site.) Migration MUST keep one deployment serving all domains.
2. **Independence.** A status page must NOT depend on the infrastructure it reports on. So it must
   **NOT** run on the prod VPS (`15.204.225.51`) or the game box — a provider/host outage there would
   take down prod *and* the page that's supposed to report it. This is the whole reason it's off-box today.
3. Same **Crunchy `status-prod`** Postgres (no DB migration).
4. All ingest webhooks keep working (Grafana → `/api/v1/ingest/grafana`, UptimeRobot poll, resolver push).

## What's already portable (the good news)
- **All API/ingest/admin/status.json logic = Astro SSR routes** (`src/pages/api/**`) — adapter-agnostic.
- **Multi-domain theming = Host-header → `data-scope`** (`Skin.astro`), and the scope↔domain map is
  **DB-driven** (admin "Domains served (Host-header scoping)"). Works behind *any* proxy that passes the
  Host header through. Netlify isn't doing anything special here.
- **DB = drizzle-orm + `postgres.js` + `DATABASE_URL`** → Crunchy. Standard PG, no `@netlify/neon`, no lock.
- **Only 2 things are Netlify-specific:** the `@astrojs/netlify` adapter, and the 2 scheduled functions
  (`sweep-cron.mjs`, `uptimerobot-poll.mjs`) — which merely POST to the Astro routes, so any scheduler replaces them.

## Target architecture
**ONE small box** (NOT the prod VPS — independence; ideally a different provider/region, ~$5-6/mo) with
**Cloudflare in front** (CDN/edge — same CF account already used for sessions.gg):
```
DNS: status.{sessions,monkeylabs,bananalabs}.gg ─▶ Cloudflare (proxied: caching + edge TLS + DDoS + hides origin)
   └─▶ ONE separate box
        └─ traefik (Let's Encrypt TLS at origin, Host-routing all 3 domains → one container)
             └─ status container: Astro @astrojs/node server (node dist/server/entry.mjs)  ← single instance
                  ├─ reads/writes Crunchy status-prod (DATABASE_URL)
                  └─ internal scheduler → POST /api/v1/sweep (5m) + UptimeRobot poll (5m)
```
Multi-domain is preserved exactly: CF routes all three domains to the origin; traefik routes the three
`Host()`s to the **one** container; the app themes by Host → `data-scope` — the same one-deployment-many-
domains model Netlify gives. (Mirrors the existing `api.sessions.gg` traefik+LE setup.)

## Scaling & edge — DECIDED (no scaling; Cloudflare as removable CDN-in-front)
- **No scaling / single instance.** A status page is a tiny workload (a few ingest webhooks per minute +
  the 5-min sweep + occasional page views). The Netlify 503 was **cadence (every-min cron), not load** —
  there is no scale problem to solve. One small Node process is plenty.
- **The one spike — a real outage** (everyone refreshes at once) — is absorbed by **CDN caching, not
  horizontal scaling.** Cloudflare serves a cached `status.json` + page to a flood while the single origin
  quietly sweeps every 5 min.
- **Cloudflare = edge IN FRONT of a self-hosted origin** (caching, DDoS, edge TLS, origin-IP hiding). Free
  tier, already in use, and **not new lock-in** — it's a removable caching layer; pull it and the origin
  still serves. **Do NOT run the SSR on CF Workers/Pages** (`@astrojs/cloudflare` exists, but Workers have
  their own request/CPU caps — that just swaps Netlify's vendor ceiling for CF's, the exact failure mode).
  Keep the runtime on your box; CF only caches/edges.
- **Cache headers to set** (so CF actually absorbs the spike without staling incident updates):
  - **`GET /status.json` and the public page** → app sets `Cache-Control: public, s-maxage=30,
    stale-while-revalidate=60` (CDN caches 30s, serves stale up to 60s while it refetches → spike-proof,
    ≤30s update lag). NOTE: today these return `private, max-age=0` — must change to cacheable for CF to help.
  - **`/api/v1/admin/**`, all ingest endpoints, `/api/v1/sweep`, subscribe/unsubscribe** → `Cache-Control:
    no-store` and a CF cache-bypass rule. Never cache mutations or admin.
- Single instance also means the **internal scheduler has no double-run problem** (no need to elect a leader
  across replicas — there's one).

## What changes (instance-level only — keep the Bananapulse engine generic)
1. **Adapter:** add `@astrojs/node` (`output: 'server'`). Keep `@astrojs/netlify` selectable via an env/flag
   so the repo can target either (no burned bridge during cutover).
2. **Dockerfile:** `node:22-slim` → `npm ci` → `astro build` → `node ./dist/server/entry.mjs` on `$PORT`.
3. **Scheduler (replaces the 2 Netlify cron functions):** simplest = the server's own `setInterval`
   on boot (5-min sweep + 5-min UptimeRobot poll), guarded so only one instance runs them; or a tiny
   system-cron/sidecar hitting the endpoints. (On-brand alternative: a Pulp `ext-workers` tick — more work,
   defer.) Recommend internal scheduler: one process, nothing extra to operate.
4. **traefik + compose** on the box: router rule `Host(\`status.sessions.gg\`) || Host(\`status.monkeylabs.gg\`)
   || Host(\`status.bananalabs.gg\`)` → status service, `certResolver=letsencrypt`. Env (`DATABASE_URL`,
   `UPTIME_HOOK_SECRET`, `GRAFANA_HOOK_SECRET`, `UPTIMEROBOT_API_KEY`, `ADMIN_*`) via compose `.env` (like Evolution).

## Migration steps
1. Add Node adapter + Dockerfile + a `deploy/status/` compose (traefik + status) — build/run locally, verify
   all 3 domains theme correctly via a local `Host:` header test + status.json renders from Crunchy.
2. Provision the separate box; install Docker; bring up traefik + status; point a *test* subdomain at it,
   verify TLS + multi-domain + ingest (fire a synthetic Grafana/UptimeRobot webhook).
3. **DNS cutover** (low TTL first): repoint `status.*` from Netlify → the box; verify; Netlify stays as a
   warm fallback for a day. Reversible (flip DNS back).
4. Decommission/idle the Netlify site once stable.

## Decisions
- **Scaling:** DECIDED — none; single instance (see "Scaling & edge").
- **CDN:** DECIDED — Cloudflare in front of the self-hosted origin (NOT CF Workers as the runtime).
- **Where:** OPEN — separate cheap VPS (recommended — independence + cost + no quota) vs keep-Netlify-and-
  upgrade (Pro $19/mo, 2M invocations — keeps independence, but pays a vendor for what your own box does free).
- **Scheduler:** OPEN (lean internal `setInterval`) — internal timer (simplest, single-instance so no leader
  election) vs system cron vs a Pulp ext-workers tick.

## Effort / risk
- ~1 day total: adapter+Dockerfile+compose ~half day; box+DNS+verify ~couple hours; scheduler ~1 hour.
- **Low risk:** Netlify stays live until the DNS flip; the flip is reversible; same DB throughout (no data move).
- **Watch-the-watcher:** keep an external uptime check on the page itself (UptimeRobot already monitors
  `status.*`) — a self-hosted status page that's down needs an outside witness.
- Engine stays upstream-generic (Bananapulse); adapter/Dockerfile/traefik are this instance's seam, like
  `pulse.config.ts` + `brand.css` already are.
