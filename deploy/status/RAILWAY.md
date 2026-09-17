# Status page + Pulp owner on Railway

The deployment has two services in one Railway project:

- `status-web`: the public Astro SSR status page (`Dockerfile`, `railway.json`).
- `status-pulp`: the private Bananapulse Pulp owner (`Dockerfile.pulp`,
  `railway.pulp.json`) with a persistent volume mounted at `/data`.

One web service serves `status.sessions.gg`, `status.monkeylabs.gg`, and
`status.bananalabs.gg`, themed by Host header. Only `status-web` receives public
or custom domains. The web service reaches `status-pulp` over Railway's private
network.

## Cost and account guardrails

- Use the Hobby plan with a card on file so Trial-credit exhaustion cannot
  suspend production.
- Start `status-pulp` with one replica, 256 MB RAM, and a 1 GB volume.
- Set a project usage alert/cap. The expected incremental Pulp cost is roughly
  $2–$5/month, but Railway usage metrics are the source of truth.

## Create the services

1. Keep the existing GitHub-backed service and name it `status-web`. It uses
   `/railway.json` and `/Dockerfile`.
2. Add another service from `MonkeyLabs-LLC/status` and name it exactly
   `status-pulp`.
3. Set its configuration-as-code path to `/railway.pulp.json`.
4. Attach a persistent Railway volume to `status-pulp` at `/data`.
5. Do not generate a public domain for `status-pulp`.
6. Keep all three custom status domains on `status-web`.

## `status-web` variables

Keep the current web variables:

```env
DATABASE_URL=<Crunchy status-prod connection string, sslmode=require>
STATUS_ADAPTER=node
UPTIME_HOOK_SECRET=<long random secret>
GRAFANA_HOOK_SECRET=<long random secret>
UPTIMEROBOT_API_KEY=<read-only UptimeRobot key>
ADMIN_EMAIL=admin@monkeylabs.gg
ADMIN_SESSION_SECRET=<random 64-character secret>
RESEND_API_KEY=<re_...>
RESEND_FROM_EMAIL=status@monkeylabs.gg
RESEND_FROM_NAME=MonkeyLabs Status
```

After `status-pulp` is healthy and migration verification passes, add:

```env
PULP_BRIDGE_URL=http://status-pulp.railway.internal:8788
PULP_BRIDGE_TOKEN=<same generated secret as status-pulp>
PULP_MONITOR_OWNER_ENABLED=true
PULP_MONITOR_ADMIN_OWNER_ENABLED=true
PULP_INGEST_OWNER_ENABLED=true
PULP_INCIDENTS_OWNER_ENABLED=true
PULP_MAINTENANCE_OWNER_ENABLED=true
PULP_SWEEP_OWNER_ENABLED=true
PULP_SUBSCRIBERS_OWNER_ENABLED=true
PULP_SUBSCRIBERS_ADMIN_OWNER_ENABLED=true
PULP_AUTH_OWNER_ENABLED=true
PULP_SUBSCRIBER_TOKEN_SECRET=<separate generated secret>
```

The checked-in profile remains `legacy-copy` deliberately. That makes every
owner family an explicit environment-gated cutover and keeps the Postgres path
available until the Pulp deployment has proved healthy.

## `status-pulp` variables

```env
PULP_BRIDGE_TOKEN=<same generated secret as status-web>
PULP_BRIDGE_ENABLE_MONITOR_ADMIN=true
PULP_BRIDGE_ENABLE_MONITOR_INGEST=true
PULP_BRIDGE_ENABLE_MONITOR_SWEEP=true
PULP_BRIDGE_ENABLE_SUBSCRIBER_ADMIN=true
PULP_BRIDGE_ENABLE_MIGRATION=false
PULP_BRIDGE_ENABLE_AUTH=true
PULP_BRIDGE_ENABLE_AUTH_ADMIN=true
PULP_BRIDGE_ENABLE_SOURCE_ADMIN=true
PULP_SUBSCRIBER_UNSUBSCRIBE_BASE_URL=https://status.monkeylabs.gg
ADMIN_EMAIL=admin@monkeylabs.gg
ADMIN_SESSION_SECRET=<same value used by status-web>
RESEND_API_KEY=<same value used by status-web>
RESEND_FROM_EMAIL=status@monkeylabs.gg
RESEND_FROM_NAME=MonkeyLabs Status
```

The image already sets `PULP_APP_MANIFEST`, `PULP_BRIDGE_ADDR`,
`PULP_STORAGE_ROOT`, and `PORT`; do not override them.

## One-time legacy-data migration

Before enabling any owner flags on `status-web`, temporarily set these on
`status-pulp`:

```env
PULP_LEGACY_IMPORT_ENABLED=true
PULP_LEGACY_IMPORT_MIGRATION=bananapulse-postgres-v1
PULP_LEGACY_IMPORT_FENCE=sha256:0ee2c7b52f05c568c3bee1f6a893faeea78b10f8a796ebe506d295c4d7496b73
PULP_LEGACY_IMPORT_SOURCE_DSN=<existing status-prod DATABASE_URL>
PULP_LEGACY_IMPORT_REVERIFY_COMPLETED=true
```

Deploy once. Require successful startup, a healthy `/healthz`, and a non-empty
monitor projection from the service shell:

```sh
curl --fail --silent \
  -H "X-Pulp-Bridge-Token: $PULP_BRIDGE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{}' \
  http://127.0.0.1:8788/internal/v1/events/bananapulse.monitor.projection.v1
```

Then set `PULP_LEGACY_IMPORT_ENABLED=false`, remove
`PULP_LEGACY_IMPORT_SOURCE_DSN`, and redeploy. Imported owner state remains on
the `/data` volume. Only then add the bridge and owner flags to `status-web`.

## Verification and rollback

After cutover, require all of these to return 200 and real component data:

```sh
curl --fail https://status.sessions.gg/
curl --fail https://status.sessions.gg/api/status.json
curl --fail https://status.monkeylabs.gg/api/status.json
curl --fail https://status.bananalabs.gg/api/status.json
```

Rollback is environment-only: remove or set the `status-web`
`PULP_*_OWNER_ENABLED` flags to `false`, then redeploy `status-web`. It resumes
reading the unchanged Postgres owner without deleting Pulp data.

Optional internal mirror variables on `status-web`:

```env
INTERNAL_SECRET=<long random secret>
PUBLIC_STATUS_URL=https://status.monkeylabs.gg
PUBLIC_EVOLUTION_URL=https://api.sessions.gg
EVOLUTION_INTERNAL_URL=
```

Do not set Cloudflare credentials on Railway. Keep an external monitor on the
status page itself so an observer outside both production systems can detect a
status-platform outage.
