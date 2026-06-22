# Status page → Railway (managed, off Netlify)

The status app is a standard Astro SSR server (`@astrojs/node`) in a plain Docker
image. Railway runs that container; nothing in the code knows it's on Railway, so
it stays portable (move the same image to a VPS or another host any time).

**One container serves all three domains** (`status.sessions.gg`,
`status.monkeylabs.gg`, `status.bananalabs.gg`), themed per domain by Host header.
You are NOT paying per product.

## Plan
- **Hobby — $5/mo** (includes $5 usage). A single small always-on container behind
  Cloudflare cache realistically uses ~$2–4/mo → sits inside the $5.
- **Set a spend cap** (Railway → Usage) so a runaway container can never surprise-bill.
- Do NOT use the free **Trial** plan for production — that's the only Railway path that
  *suspends* when credit runs out. Hobby + a card on file = no lockout (overage just bills).

## Billing model (NOT the Netlify trap)
Railway meters **resource-time** (RAM/CPU-hours), not per-request invocations. Traffic
floods hit the running container (cheap, CF-cached) — they cannot blow a usage cap and
503 you the way Netlify's invocation ceiling did.

## Cutover steps (yours — needs your account / card / DNS)
1. Create a Railway account → **Hobby** plan + card → set a **spend cap**.
2. **New Project → Deploy from GitHub repo** → `MonkeyLabs-LLC/status`. Railway detects
   `railway.json` + `Dockerfile` and builds automatically. (No build config needed — the
   image runs `node ./dist/server/entry.mjs`; Railway injects `PORT`.)
3. **Variables** → add the env vars below (Settings → Variables, or paste as a block).
4. **Settings → Networking → Custom Domain** → add all three:
   `status.sessions.gg`, `status.monkeylabs.gg`, `status.bananalabs.gg`. Railway gives a
   CNAME target per domain and issues TLS automatically.
5. **Cloudflare DNS** → point each `status.*` record at the Railway CNAME target.
   - Do this with a **low TTL** first; Netlify stays live as fallback until you flip.
   - Reversible: flip the CNAMEs back to Netlify to roll back.
6. Verify each domain themes correctly + `/api/status.json` returns data, then idle/
   delete the Netlify site.

## Env vars to set in Railway
Required:
```
DATABASE_URL=<Crunchy status-prod connection string, sslmode=require>
STATUS_ADAPTER=node
UPTIME_HOOK_SECRET=<long random — guards /api/v1/sweep + ingest + internal scheduler>
GRAFANA_HOOK_SECRET=<long random — guards Grafana ingest>
UPTIMEROBOT_API_KEY=<read-only UptimeRobot key the internal poller reads>
ADMIN_EMAIL=admin@monkeylabs.gg
ADMIN_SESSION_SECRET=<random 64-char — admin session signing>
RESEND_API_KEY=<re_... — magic-link email>
RESEND_FROM_EMAIL=status@monkeylabs.gg
RESEND_FROM_NAME=MonkeyLabs Status
```
Optional (internal-mirror to Evolution site-alert; all have fallbacks):
```
INTERNAL_SECRET=<long random>
PUBLIC_STATUS_URL=https://status.monkeylabs.gg
PUBLIC_EVOLUTION_URL=https://api.sessions.gg
EVOLUTION_INTERNAL_URL=
```
Do NOT set on Railway: `PORT`/`HOST` (Railway injects PORT; Dockerfile binds 0.0.0.0),
`CF_API_EMAIL`/`CF_DNS_API_TOKEN` (traefik-only — the VPS fallback path).

## Separation notes (independence — the point of a status page)
- Compute is on Railway (≠ your OVH prod) → an OVH/provider outage can't take status down.
- DB stays on Crunchy `status-prod` via `DATABASE_URL` (don't use Railway's managed
  Postgres — keeps the DB independent of the compute host *and* avoids lock).
- Fast-follow for fuller separation: put `status-prod` in a **different region** (and ideally
  a separate billing account) from `sessions-prod` — protects against a single AWS-region or
  account/billing event taking both down.
- Keep an external watcher (UptimeRobot) on the status page itself — something outside both
  prod and status must witness it.
