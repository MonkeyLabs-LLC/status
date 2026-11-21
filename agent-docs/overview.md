# status: project map

Workspace survey: 2026-09-23. This is a source/navigation snapshot, not proof of a deployed version or passing tests.

Custom-built status page for MonkeyLabs products. Astro SSR on Netlify with host-based scope locking. Lives at `status.monkeylabs.gg` (canonical) and `status.sessions.gg` (alias).

## Start here

- [README.md](../README.md) — existing project reference; verify dated claims against source.

## Checkout identity

Local layout: **repository**. Run `git rev-parse --show-toplevel`, `git status --short`, and `git worktree list` in this directory before making changes. Similar names and matching module identities do not prove that two checkouts are interchangeable.

## Component routing

- [docs](../docs/AGENTS.md) — scoped entry points and module inventory.
- [public](../public/AGENTS.md) — scoped entry points and module inventory.
- [scripts](../scripts/AGENTS.md) — scoped entry points and module inventory.
- [src](../src/AGENTS.md) — scoped entry points and module inventory.

## Root source and configuration landmarks

- [demo-shots](../demo-shots/)
- [deploy](../deploy/)
- [docs](../docs/)
- [drizzle](../drizzle/)
- [instance](../instance/)
- [netlify](../netlify/)
- [public](../public/)
- [scripts](../scripts/)
- [src](../src/)

## Guide maintenance

Keep this overview about responsibilities and entry points. Update [development.md](development.md) for commands, [connections.md](connections.md) for dependencies, and the nearest component guide for local contracts. Do not duplicate entire source files, generated inventories, credentials, or transient deployment state in AGENTS.md.
