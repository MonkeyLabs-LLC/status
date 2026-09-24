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
