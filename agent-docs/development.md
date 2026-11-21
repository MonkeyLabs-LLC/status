# status: development and verification

Commands are derived from checked-in manifests, not executed by the documentation survey. Read the applicable project runbook and scripts before running integration, migration, publishing, or deployment commands.


## JavaScript package scripts

Use the package manager and lockfile of the owning package. These are available script names, not instructions to run every script; inspect their implementations first.

- [package.json](../package.json): `dev`, `build`, `preview`, `check`, `astro`, `test`, `test:watch`.

## Change validation

For code changes, run the narrow relevant test first and the owning project gates next. For guide-only changes, verify local links, scope, and preservation of existing instructions; no service launch or production access is needed.

## Native owner CI and HTTP validation

The Status workflow builds both Astro adapters and runs the current Node app
against the native Go owner. `.github/native-owner.commit` contains the exact
Bananapulse Git commit checked out for that job; it never follows a floating
branch. Update the pin only after qualifying the new owner source. That commit
must be available in the owner repository for hosted CI; preparing or testing a
local commit does not publish it.

The owner repository's own native workflow runs Go tests, monitor race tests,
vet and a static executable build. The Status integration job repeats the Go
unit/build checks for its pinned dependency, then exercises subscription
state and the broader canonical route, nonmutation and timestamp assertions. A separate required manual-orchestration HTTP gate
checks real authenticated declarations, severity and status edits, promotion of
existing incident identities, resolution notes, corroboration protection,
manual grace expiry and durable reopen. Existing shared incidents stay open
when any affected component remains confirmed; this intentionally corrects
the legacy per-component resolution hole. Public incident moves also transfer
manual votes: removed targets receive a bounded all-clear, new targets receive
the current human declaration, and retained targets keep their existing reads.
Monitor corroboration remains authoritative. This corrects the legacy public
metadata-only move that left stale manual votes behind.
All fixtures disable delivery and use synthetic addresses; no production
PostgreSQL credentials or mail-provider secrets are used.

For an existing Node build and qualified native executable:

```sh
python3 scripts/test-native-subscription-http.py --app . --owner /path/to/bananapulse-status
python3 scripts/test-native-owner-http.py --app . --owner /path/to/bananapulse-status
python3 scripts/test-native-ci-policy.py
```

These default gates exercise only the current Go service. Frozen historical
fixtures are preserved outside this checkout in the private migration reference archive.
Historical qualification remains an explicit independent operation; it is never
a build, install, runtime, or default CI dependency.

## One current backend

Astro is the frontend and HTTP adapter for the native Go service. Current
routes always use that service; missing native configuration returns 503,
while invalid credentials and unknown identities retain their normal business
responses. No runtime PostgreSQL or Node quorum fallback remains. The existing
Resend and HTML adapter for Go-authorized admin login emails stays in Astro;
tests disable delivery.

`npm test` checks current Go-facing behavior. Historical algorithm assertions
are retained externally and are not counted as current implementation coverage.

To qualify manual actions against the same built app and native executable:

```sh
python3 scripts/test-native-manual-orchestration-http.py --app . --owner /path/to/bananapulse-status
```

This fixture uses synthetic identities and local databases, disables delivery,
and does not require PostgreSQL or email-provider credentials. Historical
seed rows use the native import operation; they are not new human declarations.
