# Status self-host (`deploy/status/`)

The instance seam for self-hosting the status page on a **separate small box**
(NOT the prod VPS / game box — a status page must not depend on the infra it
reports on). Mirrors the `api.sessions.gg` traefik+Let's-Encrypt convention.

```
DNS: status.{sessions,monkeylabs,bananalabs}.gg ─▶ Cloudflare (proxied)
   └─▶ this box
        └─ traefik (LE TLS via CF DNS-01, Host-routes all 3 → one container)
             └─ status: Astro @astrojs/node server (single instance)
                  ├─ reads/writes Crunchy status-prod (DATABASE_URL)
                  └─ internal scheduler → POST /api/v1/sweep + uptimerobot poll (5m)
```

## Files
- `docker-compose.yml` — traefik + the status container (build context = repo root `Dockerfile`).
- `traefik/traefik.yml` — static config (docker provider, websecure, LE `letsencrypt` resolver via Cloudflare DNS-01).
- `.env.example` — copy to `.env`, fill real values (git-ignored).
- `traefik/acme.json` — cert store; create empty with `chmod 600` (git-ignored).

## Bring up (on the box)
```bash
# Check out the status repo, then from the repo root:
cp deploy/status/.env.example deploy/status/.env   # fill in real values
touch deploy/status/traefik/acme.json && chmod 600 deploy/status/traefik/acme.json
docker compose -f deploy/status/docker-compose.yml --env-file deploy/status/.env up -d --build
```

The adapter is selected by `STATUS_ADAPTER=node` (set in the Dockerfile + compose);
the Netlify build is unaffected (default flag is `netlify`). The internal scheduler
runs ONLY under the node adapter, so there is no double-run with the Netlify crons
during cutover.

## Cutover (per SELFHOST-MIGRATION.md, NOT done here)
Provision the box → bring up → point a test subdomain → verify TLS + 3-domain
theming + a synthetic ingest → low-TTL DNS flip `status.*` from Netlify to this box
(reversible) → idle Netlify once stable.
