# Status outage repair — 2026-09-24

## Prepared locally, not deployed

- Database connection establishment now times out after five seconds (previously
  the Postgres.js default of thirty seconds).
- Public component pages return a branded HTTP 503 on either database or Pulp
  read failure. Successful lookups without a matching page still return 404.
- The unavailable HTML response uses `Cache-Control: no-store` and
  `Retry-After: 30`.
- `npm run test:outage` builds the Node server and checks both public brands
  against an unresponsive loopback PostgreSQL handshake. The subprocess receives
  dummy credentials only, with background scheduling disabled.

This bounds connection establishment, not every query on an already-established
connection. It does not fix a provider restart/failover or a crashed host.

## Verification

- `npm test`: 138 passed, three existing skips.
- `npm run check`: zero errors/warnings, five hints.
- `STATUS_ADAPTER=node npm run build`: passed.
- `node scripts/test-database-outage.mjs`: four checks passed against that build;
  `/` and `/api/status.json` on both `status.sessions.gg` and
  `status.monkeylabs.gg` returned 503 within eight seconds. HTML shows unavailable;
  JSON reports unknown, `live:false`, and no fabricated services.
- `git diff --check`: passed.

## Unresolved live incident

Both public origins timed out after twenty seconds during this pass. Existing
mailbox evidence reported repeated Crunchy `status-prod` availability restarts
and failover attempts. That evidence does not identify the underlying cause.

GitHub deployment `6510472148`, for source
`e887c3e0143d76f6ac8bdebb2aaa4669de2ed4ca`, reports `failure`. The Railway
[production console](https://railway.com/project/f79ac6d1-1f3c-49e9-981c-b50c6e9dd05c?environmentId=7662e029-ddc9-46cf-9d9c-2fe9160b9064)
must be inspected to distinguish build, startup, health-check, and runtime
failures. A failed deployment record does not establish which older revision
remains active.

No local Railway CLI/login or status repository deployment secrets were found.
Provider access has been requested. No infrastructure settings, customer data,
emails, purchases, or deployments were changed in this pass.

Next: inspect current Railway service logs/resource usage and Crunchy cluster
events, repair the evidenced cause, then deploy and verify real component data
on all three public status domains. A prompt 503 is an honest fallback, not
service recovery.

## Railway access and crash diagnosis

Browserless Railway authorization completed. Production reports `status` online
and `status-pulp` crashed. The backend's latest deployment is
`a24039f8-eb73-48ec-b9d6-1f1dca8d21b5`, with the source baseline above.
Its startup logs repeatedly report SQLSTATE 42P01: missing FROM-clause entry for
`incident_timeline` during the component import phase.

Both Dockerfiles used an unrestricted sed replacement to qualify timeline IDs.
It also changed the component and observation sort expressions. The prepared
repair restricts replacement to the timeline timestamp expression. Regression
tests execute each Dockerfile's sed expression against all three expressions.
`npm test` now passes 140 tests with three existing skips (subprocess tests need
an environment that permits launching sed).

Railway uses `railway-pulp/Dockerfile`, not the root `Dockerfile.pulp`; both are
fixed locally. No deployment or configuration change has been made.

The backend still has legacy import enabled and an email provider configured;
startup launches its outbox worker immediately after import. Do not restart it
without preventing unintended queued mail delivery. The public service has no
Pulp owner switches enabled and still reads Postgres. A direct read-only
Postgres connection attempt also failed with CONNECT_TIMEOUT. Crunchy provider
access is still needed to diagnose current cluster availability; neither the
connection timeout nor the old migration error identifies the provider failure.

## Authorized deployment attempt

The user explicitly requested deployment. A clean 2.1 MB snapshot was built from
tracked source plus the reviewed changes; no unrelated untracked files or
credentials were uploaded. Production composition required adding `src/db/index.ts`
and `src/pages/[...path].astro` to `instance/manifest.json`. The pinned engine
archive checksum was verified; the exact composed Node build passed all four
loopback outage checks. Final local tests: 140 passed, three existing skips;
type check: zero errors/warnings.

- Backend deployment `fcef8311-0679-4e53-90b9-3b96b0ede6d0`: Railway reports
  SUCCESS. The new image contains the corrected SQL replacement. Runtime cells
  initialized, but completed import and HTTP readiness were not established.
  This service has no configured health check, so SUCCESS alone is insufficient.
- Public deployment `af028fff-bbbb-48f4-a028-07de01b6f3a9`: FAILED after six
  `/api/status.json` readiness attempts returned service unavailable within the
  two-minute window. Its image built successfully but was not activated.
- The backend's `RESEND_FROM_EMAIL` was preserved privately and set empty with
  `--skip-deploys` before deployment. This disables its automatic outbox sender
  under the existing host contract. The public service's email settings were
  not changed. No test emails or customer operations were invoked.
- Public endpoint checks did not verify recovery despite new provider recovery
  emails. Database availability remains unresolved.
- Railway SSH health verification requires a registered SSH key; no key was
  registered in this pass.

Private deployment evidence and sender restoration value are outside Projects
under `.local/state/sessions-deploy/status-recovery/`. Keep backend delivery
disabled until queued mail has been reviewed. After database recovery, verify
backend import completion and retry the public release; do not bypass readiness
to label the status platform recovered.

## Follow-up verification and readiness configuration

Temporary Railway SSH access established that `/healthz` returns
`{"status":"ok"}` on the deployed backend. Its monitor projection contains 19
components, 64 incidents, 128 incident updates, 25 mappings and five sources.
Its subscriber projection reports zero subscribers in all states and zero
pending email intents. These are backend projection results, not a fresh
source-database parity audit. Delivery remains disabled during recovery.

Railway's `environment edit` command did not persist the requested readiness
fields. The supported `serviceInstanceUpdate` API subsequently succeeded;
readback confirmed `healthcheckPath=/healthz` and `healthcheckTimeout=120` for
backend service `b3b1f0e1-b62e-4865-9647-8401f4004129` in production. The source
`railway.pulp.json` now also points at the actual `/railway-pulp/Dockerfile`.
Future activation requires readiness; this is not continuous health monitoring.

From inside the existing public container, a read-only PostgreSQL connection
still fails with CONNECT_TIMEOUT on the configured port 5431. A diagnostic
attempt to port 5432 returned ECONNREFUSED; no connection settings were changed.
The public endpoint still times out. Repeating the failed rollout while that
dependency remains unavailable would not establish recovery. No Pulp ownership
cutover was performed without a fresh source-data verification.

Crunchy support remains the next provider diagnostic step. No support ticket
was sent from this session, and no provider access has been supplied. Account
benefits were clarified separately: allowance, eligible tiers/durations,
discount, rollover and stacking must be admin-configurable. That feature is not
implemented by this status repair.

## Database reports Ready; public retry still fails

After the user reported Ready, a read-only transaction succeeded at
2026-09-24 19:39:36 UTC. Postgres reported a server start time of 19:08:26 UTC.
The pooler rejects startup parameters used by an earlier diagnostic (08P01);
the successful check used `BEGIN READ ONLY` and a transaction-local timeout.
This diagnostic incompatibility is separate from the earlier CONNECT_TIMEOUT.

The approved public artifact was retried as deployment
`d4d0c7cf-658c-431a-afb9-d3b29088a63b`. Its image built successfully but all six
readiness attempts failed with service unavailable; Railway marked it FAILED.
The previous public revision remains active. An independent invocation of the
exact composed `/api/status.json` read handler also exceeded 15 seconds against
the database. Basic connectivity has recovered, but full status-read latency
and public availability remain unresolved. This does not establish a particular
query, locking problem, or provider fault as the cause.

## Status-read bottleneck identified and repaired

Read-only diagnostics subsequently found approximately 511,000 observation rows
(70 MB heap; 187 MB including indexes). Multiple concurrent latest-observation
queries had been active for 24–38 seconds. The query used DISTINCT ON over an
entire component's history, while component enumeration scanned observation
history again. This establishes an application query bottleneck; it does not
prove what caused the provider's earlier restart cycle.

The repair seeks the newest row per source with JOIN LATERAL and LIMIT 1 using
the existing `(source_id,component_id,observed_at)` index. Observed components
are found through indexed EXISTS probes. Independent public evaluations run
concurrently through the existing five-connection pool. Expiry, revocation,
manual overrides and quorum classification remain unchanged. No data deletion,
index migration, capacity resize or status-owner cutover is required.

The production overlay explicitly includes `src/lib/quorum.ts`. Verification:

- 140 unit tests passed; three existing skips. Type check: zero errors/warnings.
- `npm run test:queries`: disposable, network-isolated PostgreSQL parity tests
  with 50,000 historical rows; checks expired latest reads, manual/revoked
  sources, component isolation and unobserved components. EXPLAIN ANALYZE asserts
  indexed observation seeks rather than full-history scans. Container removed.
- Exact production composition built and passed all four outage checks.
- Production read-only indexed probes took 800 ms and 558 ms respectively.
- Exact composed status handler against live data returned HTTP 200: cold
  umbrella read 6,487 ms (seven services), subsequent Sessions read 853 ms (six
  services). This is pre-deployment handler evidence, not a public-site result.

Public deployment submitted: `0d64f586-e1aa-43b7-b04b-7af94b4de176`.

### Deployment verified

Railway marked that deployment SUCCESS. Public homepages returned HTTP 200:
Sessions 0.74 seconds; MonkeyLabs 0.90 seconds. IPv4 status JSON checks returned
HTTP 200 with real component data: Sessions six services in 0.46 seconds;
MonkeyLabs seven services in 0.32 seconds. Two initial urllib JSON attempts had
TLS handshake timeouts; repeat curl and browser checks succeeded.

Read-only Chromium smoke checks passed on both hosts: homepage, `/history`,
and `/api/v1/summary.json` returned 200, with no page JavaScript errors. The
first diagnostic script had a Response.status accessor mistake; it was corrected
and the complete check rerun successfully. No subscriptions, messages, orders,
or customer mutations were invoked. The status backend sender remains disabled.

The alternate hostname `status.bananalabs.gg` failed certificate verification
(self-signed certificate); its TLS/domain configuration is a separate unresolved
issue. The verified restoration covers Sessions and MonkeyLabs status pages.
The earlier Crunchy restart cause remains unproven; this repair addresses the
measured application workload, not a claimed provider root cause.
