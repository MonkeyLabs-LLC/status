# Status self-host (`deploy/status/`)

The instance seam for self-hosting the status page on a **separate small box**
(NOT the prod VPS / game box — a status page must not depend on the infra it
reports on). Mirrors the `api.sessions.gg` traefik+Let's-Encrypt convention.

```
DNS: status.{sessions,monkeylabs,bananalabs}.gg ─▶ Cloudflare (proxied)
   └─▶ this box
        └─ traefik (LE TLS via CF DNS-01, Host-routes all 3 → one container)
             └─ status: Astro @astrojs/node server (single instance)
                  ├─ native Go owner with separate SQLite monitor, subscriber and auth databases
                  └─ internal scheduler → POST /api/sweep + uptimerobot poll (5m)
```

## Files
- `docker-compose.yml` — Traefik, the Astro container, and the native Go owner.
- `traefik/traefik.yml` — static config (docker provider, websecure, LE `letsencrypt` resolver via Cloudflare DNS-01).
- `.env.example` — copy to `.env`, fill real values (git-ignored).
- `traefik/acme.json` — cert store; create empty with `chmod 600` (git-ignored).

## Canonical API paths

Current public and admin routes use `/api/...`, including `/api/summary.json`,
`/api/ingest`, `/api/sweep`, and `/api/admin/...`. Before activation, update any
externally configured Grafana or other webhook producers to the canonical
URLs. The retired `/api/v1/...` paths return 404; there are no redirects or aliases.

## Bring up (on the box)
```bash
# Check out the status repo, then from the repo root:
cp deploy/status/.env.example deploy/status/.env   # fill in real values
touch deploy/status/traefik/acme.json && chmod 600 deploy/status/traefik/acme.json
docker compose --env-file deploy/status/.env \
  -f deploy/status/docker-compose.yml up -d --build
```

Set `BANANAPULSE_SOURCE_DIR` to the checkout containing
`deployment/Dockerfile.status-native` and `native/cmd/status`. Supply
`STATUS_API_TOKEN` (at least 32 characters), `STATUS_SUBSCRIBER_LINK_SECRET`,
and `STATUS_UNSUBSCRIBE_URL`. The web image builds the Astro application from
this checkout. The owner image builds the Go executable from Bananapulse.

Restore `monitor.db`, `subscribers.db`, and `auth.db` to the owner volume
before startup. Preserve `source-sagas.db` when the previous host had source
lifecycle requests in progress. The Compose profile queues notification
intents with outbound delivery disabled.

The adapter is selected by `STATUS_ADAPTER=node` (set in the Dockerfile + compose);
the Netlify build is unaffected (default flag is `netlify`). The internal scheduler
runs ONLY under the node adapter, so there is no double-run with the Netlify crons
during cutover.

## Back up current state

Use the backend's `deployment/backup-native-owners.py` for a consistent SQLite
backup. Keep the monitor, authentication, subscriber and optional telemetry
stores together. Historical export adapters are retained outside this checkout
in the private migration reference archive; they are not runtime fallbacks.

## Import a legacy PostgreSQL snapshot

Use this path when PostgreSQL is the source of record. Use the SQLite export
above when the existing owners contain the current state. The two exports are
independent snapshots.

Build the native Status executable as described below. Set
`STATUS_LEGACY_POSTGRES_DSN` to a read-only account on the snapshot and run:

```bash
/tmp/bananapulse-status import-postgres /path/to/new/export
```

The importer uses one read-only PostgreSQL transaction and publishes the
directory after it verifies the native stores. Check `import-summary.json`
for the row count and import digest. Restore the three owner databases using
the same ownership as for a SQLite export. Legacy admin sessions and magic
links are excluded from the import, so admins sign in again after cutover.

The importer preserves the complete observation history, including PostgreSQL
microsecond timestamps and NULL expiry. It uses an exclusive unpublished monitor
owner with bounded 256-event transactions; normal live owner mutation semantics
are unchanged. A failed attempt is removed and a retry creates new stores from a
new PostgreSQL snapshot. Progress checkpoints are private to that attempt, not a
way to resume against a different source snapshot. The final batch commits before
streaming source-to-event content verification and atomic directory publication.

For large snapshots, create indexes on `(observed_at, id)` for `observations` and
`(at, id)` for `incident_timeline` in the disposable local restored PostgreSQL
copy before importing. Existing component-prefixed indexes do not serve these
global timestamp/ID keysets. Do not add indexes or otherwise alter the live source
as part of read-only snapshot acquisition.

## Cutover (per SELFHOST-MIGRATION.md, NOT done here)
Provision the box → bring up → point a test subdomain → verify TLS + 3-domain
theming + a synthetic ingest → low-TTL DNS flip `status.*` from Netlify to this box
(reversible) → idle Netlify once stable.

## Local HTTP parity

Build Bananapulse with `go build -o /tmp/bananapulse-status ./cmd/status` from
its `native/` directory. Build the Status app with `STATUS_ADAPTER=node` and run:

```bash
python3 scripts/test-native-subscription-http.py --app . --owner /tmp/bananapulse-status
python3 scripts/test-native-owner-http.py --app . --owner /tmp/bananapulse-status
```

The current gates exercise canonical pages, feeds, ingest, authorization,
authenticated admin actions, subscriber state and durable reopen. Historical
differential qualification uses preserved external fixtures independently.

The tests use temporary databases and synthetic addresses. They strip the
delivery environment and verify the subscription intent without sending email.
