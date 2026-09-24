# Status network follow-up — 2026-09-24

## Verified boundary

The public application/query repair is deployed and CI passed (see
[outage-repair-20260924.md](outage-repair-20260924.md)). The remaining intermittent
failures occur before HTTP, during TCP establishment or TLS negotiation.

Eight requests per hostname, with certificate verification enabled, from each
vantage showed:

| Vantage | Sessions | MonkeyLabs |
| --- | --- | --- |
| AI-WORKSPACE, first sample | 8/8 HTTP 200 | 6/8 HTTP 200, two TLS timeouts |
| Existing Sessions VPS, same script | 8/8 HTTP 200 | 8/8 HTTP 200 |
| Homelab gateway, same script | 6/8 HTTP 200 | 6/8 HTTP 200 |

The VPS uses the configured `15.204.225.51` SSH alias (`debian`), not `root`.
Successful independent responses took approximately 0.09–0.14 seconds.
TLS 1.2-only diagnostic requests still failed intermittently. No server TLS
policy or certificate verification was weakened.

A header-only capture on the homelab gateway showed a failed TCP flow completing
the handshake, transmitting a 231-byte TLS ClientHello, and receiving its ACK,
but receiving no TLS response before the client's three-second deadline. This
narrows the failure to the edge/network path; it does not prove which provider
or intermediate device is responsible. Captures contain no packet payloads and
remain outside this repository.

## DNS and access

Railway reports the two configured custom domains ACTIVE, targeting port 8080,
with verified DNS and valid certificates. Public DNS sends clients directly to
Railway, not through the Cloudflare proxy.

The existing Cloudflare Wrangler OAuth login was successfully refreshed. Zone
listing works, but DNS record listing returns HTTP 403 / code 10000, and SSL
settings access returns HTTP 403 / code 9109. Account-level permissions returned
by zone listing do not confer those permissions on this OAuth token. DNS-edit
access or an operator action in the dashboard is required; this is a provider
permission limitation, not a Codex automatic-approval rejection.

## Prepared next change

With appropriate access, first inspect and privately back up the exact `status`
CNAME records and applicable SSL settings in `sessions.gg` and `monkeylabs.gg`.
Test enabling the Cloudflare proxy on one status hostname, retaining its exact
Railway CNAME target and ownership TXT record:

- `status.sessions.gg` → `u7bccdtn.up.railway.app`
- `status.monkeylabs.gg` → `bh0spon8.up.railway.app`

 Do not change apex/app/mail records
or weaken zone-wide TLS verification. Verify certificate behavior and live JSON
from both network paths; repeat the bounded sample. Revert only the changed
record if errors appear. Apply to the second hostname only after the first is
verified. This is a proposed route mitigation, not an already-applied fix.

## Separate BananaLabs hostname

Public DNS returns NXDOMAIN for `status.bananalabs.gg`; the homelab DNS server
instead resolves it to private gateway `10.0.40.101`. The previous self-signed
certificate result was from that local route, not from a configured public
Railway domain. No BananaLabs custom domain exists on the Railway service.

An attempt to register it was rejected because the current service has reached
its custom-domain limit. No hostname was added, no existing domain was removed,
and no plan/billing upgrade was made. Restoring this third hostname requires a
separate routing choice or an approved provider plan change plus DNS access.
Do not publish a CNAME that points to an unregistered Railway hostname.

No customer email, support message, customer data mutation, firewall change,
DNS change, plan upgrade, or application deployment was performed in this pass.

## Cloudflare path test (user-authorized)

A temporary `workers.dev` diagnostic was deployed with the existing Workers
permission, without custom routes or DNS changes. It accepted GET only for two
fixed public status JSON URLs, did not forward caller headers/cookies, used
`cache: no-store`, retained certificate verification, bounded each origin request
to five seconds and 64 KiB, and expired after ten minutes. The artifact passed
Wrangler dry-run validation before deployment.

Eight paired samples per hostname from AI-WORKSPACE gave:

| Route | Sessions | MonkeyLabs |
| --- | --- | --- |
| Direct to Railway | 5/8 passed | 4/8 passed |
| Through Cloudflare Worker (OMA) | 8/8 passed | 8/8 passed |

All seven direct failures timed out during TLS after TCP connection completed.
Every Cloudflare response verified HTTP 200 and valid JSON from the origin.
Median end-to-end Cloudflare times were 101 ms (Sessions) and 97 ms (MonkeyLabs).
No retries were used to hide failures. This supports the Cloudflare-route
mitigation for the observed network path; it is not proof that production
orange-cloud routing is configured or that all geographic paths are healthy.

Diagnostic Worker `status-path-test-76f29a23` was successfully deleted immediately
after the test. Production DNS/application configuration and customer emails
were unchanged. Raw sample results remain at
`/tmp/status-cf-path-test/results.json` outside the synced repository.
DNS-edit access remains necessary to apply and validate the production routing
change. This evidence entry is local to avoid triggering an unrelated deploy.

## Production routing repair completed (2026-09-24, 22:10 UTC)

The user supplied an encrypted credential through Projects. It was decrypted
only into owner-readable private state outside Projects; no plaintext token was
printed or copied into source. The active token permits DNS reads/edits but not
reading the zone SSL setting. Existing TLS settings were left unchanged.

Backed up each exact DNS record privately before changing it. Enabled only
`proxied: true`, first on `status.sessions.gg` and then, after live verification,
on `status.monkeylabs.gg`. Both retain their existing Railway CNAME targets,
record IDs, and TTL. Ownership TXT records, other DNS records, application
releases, and provider plans were unchanged. Cloudflare readback confirms both
records are proxied.

Production checks:

- 16/16 requests from AI-WORKSPACE used Cloudflare IPs and returned HTTP 200.
- 8/8 Sessions requests from the independent VPS used Cloudflare and returned
  HTTP 200. That VPS initially cached the old MonkeyLabs IP (all eight requests
  also passed); a further 8/8 requests explicitly used the two newly published
  Cloudflare IPs with the real MonkeyLabs hostname and certificate verification.
- Thus all 32 requests verified through Cloudflare passed, with no retries.
- Public Sessions JSON reported `server: cloudflare`, `cf-cache-status: DYNAMIC`,
  valid JSON, and HTTP 200 on both Cloudflare addresses.
- Chromium verified both branded homepages and `/history` pages, plus both
  `/api/v1/summary.json` endpoints: all HTTP 200, Cloudflare response headers,
  correct page titles, and zero page JavaScript errors. Initial harness attempts
  encountered a missing newer Chromium binary and a network-idle timeout;
  the complete passing run used the installed Chromium executable and DOM
  readiness, appropriate for pages with continuing network activity.
- Read-only database check at 22:10:07 UTC: postmaster start still 20:25:08 UTC,
  seven connections, no other active queries, no deadlocks, no temporary files.

No customer/test email, support message, or database mutation was sent. The
separate BananaLabs domain-limit/DNS issue remains as described above. This
routing change addresses the reproduced client-to-Railway path failure; it does
not claim a proven provider-level cause for past database restarts. Final
operational evidence is committed locally without retriggering an application
deployment for a DNS-only repair.
