# Status on Railway

Build `status-web` from this repository with its Dockerfile and the persistent Railway service settings. Build
`status-owners` from the Bananapulse revision containing
`deployment/Dockerfile.status-native`. Attach the public status domains to
`status-web` and connect to the owner over Railway's private network.

| Environment variable | Value or service |
| --- | --- |
| `STATUS_OWNER_ADDR` | `0.0.0.0:8788` on the owner |
| `STATUS_API_TOKEN` | Owner service credential, at least 32 characters |
| `STATUS_API_URL` | `http://status-owners.railway.internal:8788` on the web service |
| `STATUS_API_TOKEN` | Same owner service credential, on the web service |
| `STATUS_MONITOR_DB` | `/data/monitor.db` on the owner |
| `STATUS_SUBSCRIBER_DB` | `/data/subscribers.db` on the owner |
| `STATUS_AUTH_DB` | `/data/auth.db` on the owner |
| `STATUS_SOURCE_SAGA_DB` | `/data/source-sagas.db` on the owner |
| `STATUS_UNSUBSCRIBE_BASE_URL` | `https://status.monkeylabs.gg/api/unsubscribe` on the owner |
| `STATUS_SUBSCRIBER_LINK_SECRET` | Existing link-signing secret on the web service |
| `STATUS_DELIVERY_ENABLED` | `false` on the owner during migration |

Give the owner a volume writable by UID 10001. Use `/health` for the rebuilt
native owner and for the Astro web probe. Set the web probe timeout to 120 seconds.
The public status feed remains at `/api/status.json`. The retained rollback
owner image uses `/healthz`.
[Export the existing owner databases](README.md#export-existing-owner-state)
before routing traffic. Verify the restored component, incident and subscriber
state independently of the health checks.

Keep `UPTIME_HOOK_SECRET`, `GRAFANA_HOOK_SECRET`,
`UPTIMEROBOT_API_KEY`, `ADMIN_EMAIL`, and `ADMIN_SESSION_SECRET` on the web
service. Keep Resend and SMTP credentials out of both migration services.

The web service does not need a PostgreSQL connection. All nine imported data
tables belong to the native owner. Historical admin sessions and magic links
are deliberately excluded; administrators log in again. `STATUS_LEGACY_POSTGRES_DSN`
is only an explicitly read-only CLI import input, never a web-service setting.
The existing Astro Resend adapter renders and transports Go-authorized admin
login emails; delivery remains disabled during local qualification.
