# Bananapulse composition

Status is an instance of Bananapulse, not a Git fork that merges engine history.
Production builds start from the exact release or commit source package in `bananapulse.lock.json`,
verify its SHA-256 in the Dockerfile, overlay the paths declared by
`instance/manifest.json`, and build the resulting application normally.

The instance owns branding, host/adapters, Sessions alert integration, and the
Pulp bridge configuration. All unlisted application paths come from the pinned
Bananapulse source revision. `src/status.profile.compatibility.test.ts` rejects an
unaccounted engine-copy difference during an update.

The weekly update workflow only opens a pull request. It never updates
production directly. The composition workflow downloads the proposed artifact,
verifies its checksum, runs all tests and type checks, and performs the Node
production build. Merging the PR is the deployment decision.

Rollback is deterministic: restore `bananapulse.lock.json` and the matching
Dockerfile `ADD` line from the last known-good commit, then redeploy. No upstream
merge or source conflict resolution is involved.
