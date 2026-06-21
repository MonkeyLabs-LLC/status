# Customer reporting — design spec (draft)

Status: **design draft**, not built. Companion to [SEVERITY-MODEL.md](./SEVERITY-MODEL.md).

## Goal

Let real customers report "something's broken" from the public status page, without
needing to know the internal component tree — and feed that signal into the existing
quorum engine **safely** (no brigading, no privacy leaks).

## The one load-bearing principle

**The crowd is the lowest-trust vantage, and it is ONE vote — not N.**

- 1000 customer reports = **one** untrusted vantage in the quorum, not 1000.
- Crowd-alone therefore lands exactly where any single untrusted vantage lands today:
  `watch` → surfaced as a **MINOR / suspected** signal. It **never alone declares
  MODERATE or MAJOR.**
- A real monitor (UptimeRobot / Grafana / Status Prober) agreeing turns crowd +
  monitor into `≥2` → **declared**, at the criticality-aware severity. So the crowd's
  job is to *corroborate a monitor* (promote a single-monitor "suspected" to
  "confirmed") and to *catch what monitors miss* — never to page on its own.

This reuses the whole engine we just built; the crowd is just a new source row.

## How it plugs in

- New source: `name='Crowd Reports'`, `kind='crowd'` (or `probe`), `trusted=false`,
  low weight.
- Aggregation (sweep or on-write): count **distinct MATCHED customers** (see Identity)
  for a mapped component in a rolling window. Above a **configurable** threshold
  (`CROWD_REPORT_MIN` / `CROWD_REPORT_WINDOW`, default **≥3 distinct customers / 15 min**
  — NOT hardcoded) → emit/refresh ONE Crowd observation (`degraded` or `down`) on that
  component, short TTL (auto-decays when reports stop). Below threshold → stored only,
  visible to ops, no signal.
- Anti-overreaction, guarded four ways: (1) it takes MANY matched customers to fire the
  vote at all (threshold), (2) the crowd is **one** vote no matter the volume, (3)
  crowd-alone is capped at **MINOR** — can never fan a false major, (4) escalation needs
  a real monitor to independently agree. Dedup per customer per component per window.

## Consumer UI flow (no component names shown)

Plain-language categories that map to components behind the scenes:

| Customer picks | Maps to component |
|---|---|
| "Can't reach the site / sign in" | `frontend` / `backend` |
| "Checkout or payment failed" | `payments` |
| "My game server is down or lagging" | `provisioner` (+ server-ref, see below) |
| "Something else" | (free text, routed to ops, no auto-signal) |

Flow: **button → category → email or order ID → (optional) one-line detail → submit.**
The email/order is **required and matched server-side** to a real customer — only matched
reports carry weight (see Identity). No login required (works during an outage — they
just type the email). IP/session hashed for dedup.

## The "which server?" sub-prompt (privacy is the hard part)

**Never show a public list of provisioned/suspected servers** — that leaks every
customer's server names and who's having trouble. Scope it to the reporter instead:

- Because email/order is already matched (see Identity), we **know the customer** →
  let them pick from **their own** servers only (Evolution owns the order→server map).
  Other customers' inventory is never revealed.
- Publicly we only ever surface known **incidents** (already public), e.g. "We're aware
  of an issue affecting some servers — is yours affected?" — not raw inventory.

### Single-server vs infra (important distinction)

Individual customer servers are **not** status-page components (the tree models infra:
provisioner, machines, minecraft deps — not each instance). So:

- **One user, one server down** → that's a **support signal**, not a public outage.
  Capture it, route to ops, don't move the status page.
- **Many users across many servers** in a window → **infra pattern** → crowd signal on
  `provisioner` / `machines`. (Pattern detection is the real value of collecting the
  server-ref.)

## Data model (`reports`)

```
id, created_at, reporter_hash (IP/session, for dedup), category,
component_id (mapped), email_or_order (required), matched_customer_id (nullable —
null ⇒ unmatched ⇒ zero weight), server_ref (nullable), detail (nullable free text),
ua (abuse triage), linked_incident_id (nullable), triage_status (new | linked | dismissed)
```

## What the customer sees back

- Acknowledgment ("Thanks — logged."). No gameable public counters.
- If a known incident already covers their component → show it + "follow along" link
  (turns a report into a subscription opportunity, not a dead end).

## Abuse / noise controls

- **Matched-customer gate is the primary anti-troll**: no real order/email ⇒ zero weight.
- Rate-limit per IP/session; dedup (one effective report per customer/component/window).
- Honeypot field (no heavy captcha — anti-coercion).
- Crowd = one vote regardless of volume; never alone declares moderate/major.

## Phasing

1. **MVP** — report button → category → matched email/order (+ optional detail) → stored;
   show matching known incident. Ops reviews; **no auto-signal yet.** (Ships value + data,
   zero risk.)
2. **Crowd vote** — threshold aggregation → one untrusted Crowd observation into the
   quorum (corroborates monitors; minor-only alone).
3. **Server-ref + pattern detection** — account-scoped server lookup; many-servers →
   infra signal on `provisioner`.

## Non-goals

- Public per-customer-server status (we don't model it; privacy).
- Crowd alone declaring an outage.
- Exposing server inventory or who's affected.
- Heavy captcha / friction.

## Locked decisions (2026-06-21)

- **Threshold:** configurable (`CROWD_REPORT_MIN` / `CROWD_REPORT_WINDOW`), default
  **≥3 distinct matched customers / 15 min**. Never hardcoded — tunable as traffic grows.
- **Crowd weight:** counts as **one untrusted vote**. Crowd alone = MINOR; crowd + 1
  monitor = confirmed (criticality-aware severity). Overreaction is guarded four ways
  (threshold · one-vote-not-N · minor-cap · monitor-must-agree).
- **Identity:** email or order ID **required and matched** to a real customer. Matched →
  counts toward the threshold. Unmatched (no such customer) → logged for ops, **zero
  weight**, never signals. No login required (works mid-outage). Kills trolls (no real
  order ⇒ no signal) and enables per-customer server scoping.
