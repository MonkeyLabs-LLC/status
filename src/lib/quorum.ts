/**
 * Quorum engine — the brain of the source-agnostic core.
 *
 * Component current status is DERIVED, never stored. For each component we
 * gather the latest non-expired observation per source, count how many sources
 * report non-ok (degraded|down), and decide on a CONFIDENCE LADDER — vantage
 * validates and ESCALATES, it never hides a real signal:
 *
 *   >=2 monitors agree   -> DECLARED, confirmed. level = worst agreeing signal
 *                           (down->major, degraded->degraded).
 *   1 TRUSTED first-party -> DECLARED, capped to degraded ("investigating"). A
 *                           first-party report is real; one vantage just can't
 *                           confirm a full outage. A 2nd source escalates it.
 *   1 UNtrusted validator -> WATCH. Surfaced, NEVER pages, no incident (an
 *                           uncorroborated external blip is the false-positive
 *                           case WATCH exists for).
 *   0 non-ok             -> OPERATIONAL. Auto-resolve any open auto-incident.
 *
 * On DECLARE: open an auto-incident if none open, else update its level.
 * Templated first update. `trusted` is a per-source boolean (sources.trusted).
 *
 * A source past its TTL (observation.expires_at, or default_ttl from now)
 * is STALE: it drops out of quorum and flags reduced coverage (dead-man).
 *
 * A LIVE `manual` observation carries weight, but is SUBORDINATE to monitor
 * corroboration: monitors win on agreement. A human non-ok DECLARES on its own
 * (human escalation is authoritative, no expiry). A human 'ok' (Resolve / "all
 * clear") forces OPERATIONAL ONLY when fewer than two live monitors disagree —
 * it can clear a single-source / flapping / human-declared situation, but it can
 * NOT suppress an outage that ≥2 live monitors independently corroborate. The
 * manual 'ok' carries a grace TTL so even that limited suppression expires and
 * the engine falls back to monitor quorum — a stale resolve can never mask a
 * genuine future outage.
 *
 * Incident *existence* is engine-owned. Incident *status*
 * (investigating->identified->monitoring->resolved) stays human-editable —
 * the engine only opens (status=investigating), updates level, and
 * force-resolves auto incidents; it never touches a human-owned incident's
 * status text. A manual override is a high-weight `manual` source observation
 * flowing through this same engine.
 *
 * Reuses: the existing `incidents` / `incident_timeline` / `components` tables
 * (a component id IS a components.id leaf), nanoid ids, and the incident
 * severity/status vocabulary from types.ts.
 */
import { db } from '@/db';
import { observations, sources, sourceTargetMap, incidents, incidentTimeline, components } from '@/db/schema';
import { eq, and, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export type Signal = 'ok' | 'degraded' | 'down';
export type QuorumState = 'ok' | 'watch' | 'declared';
export type Level = 'degraded' | 'major';

/**
 * Grace window (seconds) attached to a manual `ok` ("all clear") override.
 *
 * A live manual `ok` can suppress only a sub-corroboration situation (fewer than
 * two live monitors disagree — see evaluateComponent; it can NOT out-vote a
 * ≥2-monitor outage). To stop even that limited suppression from masking a
 * genuine FUTURE outage, it must expire — after this window the manual `ok`
 * becomes stale, drops out, and the engine falls back to monitor quorum. A
 * manual NON-ok (an active human declare) is deliberately NOT given a TTL: the
 * banner must persist until a human resolves it.
 */
export const MANUAL_OK_GRACE_SECONDS = 3600;

/** One source's current read on a component. */
export interface SourceRead {
  sourceId: string;
  sourceName: string;
  weight: number;
  signal: Signal;
  detail: string | null;
  observedAt: Date;
  stale: boolean;
}

export interface ComponentEvaluation {
  componentId: string;
  reads: SourceRead[];      // latest non-expired read per active source
  staleCount: number;       // sources that should report but are past TTL
  nonOkCount: number;       // sources reporting degraded|down (non-stale)
  trustedNonOkCount: number; // TRUSTED (first-party) monitors reporting non-ok (non-stale)
  totalSources: number;     // active (non-revoked) sources mapped/observing this component
  state: QuorumState;
  level: Level | null;      // only set when declared
  reducedCoverage: boolean; // dead-man: at least one expected source is stale
  hasLiveReads: boolean;    // at least one non-stale read exists (false = total blackout)
}

/* ── derivation ──────────────────────────────────────────────── */

/**
 * Gather the latest observation per source for a component, then classify
 * each as live or stale (expired). Returns the per-source reads plus counts.
 */
export async function evaluateComponent(componentId: string, now = new Date()): Promise<ComponentEvaluation> {
  // Latest observation per (source) for this component, with the source's metadata.
  // DISTINCT ON keeps the newest row per source_id.
  const rows = await db.execute<{
    source_id: string;
    name: string;
    weight: number;
    kind: string;
    trusted: boolean;
    revoked_at: Date | null;
    signal: Signal;
    detail: string | null;
    observed_at: Date;
    expires_at: Date | null;
  }>(sql`
    SELECT DISTINCT ON (o.source_id)
      o.source_id, s.name, s.weight, s.kind, s.trusted, s.revoked_at,
      o.signal, o.detail, o.observed_at, o.expires_at
    FROM ${observations} o
    JOIN ${sources} s ON s.id = o.source_id
    WHERE o.component_id = ${componentId}
    ORDER BY o.source_id, o.observed_at DESC
  `);

  const reads: SourceRead[] = [];
  let staleCount = 0;
  let nonOkCount = 0;
  let liveCount = 0;
  // Live MONITOR (non-manual) non-ok reads only — the corroboration set. A
  // manual read never counts here so that monitor corroboration is measured
  // independently of any human verdict (see decision precedence below).
  let monitorNonOkCount = 0;
  let monitorDownAgrees = false;
  // Live TRUSTED monitor (non-manual, first-party) non-ok reads. A trusted
  // source is authoritative enough to DECLARE on its own (see decision
  // precedence) — corroboration then escalates it; it is never demoted to a
  // silent WATCH the way a lone untrusted validator is.
  let trustedNonOkCount = 0;
  // The latest LIVE (non-expired) manual read, if any. `rows` is ordered newest
  // observation first per source, and the manual source emits at most one live
  // read, so the first live manual row we see is the current human verdict.
  let liveManual: SourceRead | null = null;

  for (const r of rows) {
    if (r.revoked_at) continue; // revoked source: ignore entirely
    const expired = r.expires_at != null && new Date(r.expires_at).getTime() <= now.getTime();
    const read: SourceRead = {
      sourceId: r.source_id,
      sourceName: r.name,
      weight: r.weight,
      signal: r.signal,
      detail: r.detail,
      observedAt: new Date(r.observed_at),
      stale: expired,
    };
    reads.push(read);
    if (expired) {
      staleCount++;
    } else {
      liveCount++;
      if (r.kind === 'manual' && (!liveManual || read.observedAt > liveManual.observedAt)) {
        liveManual = read;
      }
      if (read.signal !== 'ok') {
        nonOkCount++;
        if (r.kind !== 'manual') {
          monitorNonOkCount++;
          if (read.signal === 'down') monitorDownAgrees = true;
          if (r.trusted) trustedNonOkCount++;
        }
      }
    }
  }

  let state: QuorumState;
  let level: Level | null = null;
  // Decision precedence — a CONFIDENCE LADDER, not an on/off gate. Corroboration
  // raises severity; it never decides whether a real signal is visible. The
  // asymmetry is deliberate: a TRUSTED first-party source declares on its own,
  // an UNtrusted external source only validates.
  //
  //   1. ≥2 live MONITOR (non-manual) reads non-ok -> DECLARE, CONFIRMED. Worst
  //      agreeing monitor level (any monitor 'down' -> major outage, else
  //      degraded). A live manual 'ok' CANNOT suppress this — the "no invisible
  //      outage" guarantee. (CRITICAL/HIGH fix: previously a single manual 'ok'
  //      out-voted everything, so a write-scope token re-POSTing PATCH
  //      .../incidents/:id {"status":"resolved"} every <MANUAL_OK_GRACE_SECONDS
  //      pinned a monitor-confirmed outage GREEN forever, and one premature
  //      "all clear" hid a corroborated outage for up to an hour.)
  //   2. Else a live manual NON-ok exists -> DECLARE at its full stated level.
  //      Human escalation is authoritative and never auto-expires (a human
  //      declare pages on its own; no corroboration required).
  //   3. Else a live manual 'ok' exists -> OPERATIONAL. With <2 monitors
  //      disagreeing a human can still clear a single-source / flapping
  //      situation. This `ok` carries a grace TTL (MANUAL_OK_GRACE_SECONDS) so
  //      once it expires it drops out and we fall back to monitor quorum — a
  //      stale resolve can never permanently mask a future outage.
  //   4. Else ≥1 live TRUSTED monitor non-ok -> DECLARE, but capped to
  //      'degraded' (status reads degraded / "investigating") EVEN IF it said
  //      'down'. A trusted first-party report is REAL and must never be a silent
  //      WATCH — but one vantage cannot confirm a FULL outage. A second source
  //      agreeing promotes this into branch 1 and escalates the level. This is
  //      the fix for the single-vantage blind spot (a lone trusted "Resend
  //      down" used to sit in WATCH and report NOTHING).
  //   5. Else ≥1 live UNtrusted monitor non-ok -> WATCH (surfaced, never pages).
  //      An external validator seeing a blip we cannot corroborate is exactly
  //      the false-positive case WATCH exists for: it validates an outage, it
  //      does not declare one alone.
  //   6. Else -> OK.
  //
  // The corroboration set is gated on kind!='manual', NOT weight — so one
  // mis-weighted monitor can never page an outage without independent agreement.
  if (monitorNonOkCount >= 2) {
    state = 'declared';
    level = monitorDownAgrees ? 'major' : 'degraded';
  } else if (liveManual && liveManual.signal !== 'ok') {
    state = 'declared';
    level = liveManual.signal === 'down' ? 'major' : 'degraded';
  } else if (liveManual && liveManual.signal === 'ok') {
    state = 'ok';
  } else if (trustedNonOkCount >= 1) {
    state = 'declared';
    level = 'degraded'; // single trusted vantage: real, but not a confirmed full outage
  } else if (monitorNonOkCount >= 1) {
    state = 'watch';
  } else {
    state = 'ok';
  }

  return {
    componentId,
    reads,
    staleCount,
    nonOkCount,
    trustedNonOkCount,
    totalSources: reads.length,
    state,
    level,
    reducedCoverage: staleCount > 0,
    hasLiveReads: liveCount > 0,
  };
}

/* ── auto-incident wiring ────────────────────────────────────── */

// Engine level (degraded|major) -> incident severity vocabulary (types.ts).
function levelToSeverity(level: Level): 'moderate' | 'major' {
  return level === 'major' ? 'major' : 'moderate';
}

async function componentName(componentId: string): Promise<string> {
  const rows = await db.select({ name: components.name }).from(components).where(eq(components.id, componentId));
  return rows[0]?.name ?? componentId;
}

/** Templated first update so the page reads acceptably with zero human input. */
function templateFirstUpdate(name: string, level: Level): string {
  if (level === 'major') {
    return `We're investigating a major issue affecting ${name}. Some requests may be failing. We'll post an update as soon as we know more.`;
  }
  return `We're investigating degraded performance affecting ${name}. You may notice slower responses. We'll keep this page updated.`;
}

function templateResolution(name: string): string {
  return `Our monitors no longer detect an issue affecting ${name}. Service has returned to normal.`;
}

/**
 * Find an open (non-resolved) incident attached to this component.
 * Matches incidents whose `affects[]` includes the component id.
 */
async function openIncidentFor(componentId: string) {
  const rows = await db.select().from(incidents)
    .where(and(ne(incidents.status, 'resolved'), sql`${componentId} = ANY(${incidents.affects})`));
  return rows[0] ?? null;
}

/**
 * Reconcile incidents for a component against its derived quorum state.
 * Engine-owned moves only:
 *   - declared & no open incident          -> open auto-incident (investigating) + templated update
 *   - declared & open AUTO incident         -> bump severity/title if level changed
 *   - declared & open MANUAL incident       -> leave it (human owns the words/status)
 *   - operational & open AUTO incident      -> auto-resolve + templated resolution update
 *   - operational & open MANUAL incident    -> leave it (only a human resolves human incidents)
 *   - watch / 1-source                      -> never opens or touches an incident
 */
export async function reconcileIncident(ev: ComponentEvaluation, now = new Date()): Promise<void> {
  const open = await openIncidentFor(ev.componentId);
  const name = await componentName(ev.componentId);

  if (ev.state === 'declared' && ev.level) {
    const severity = levelToSeverity(ev.level);
    if (!open) {
      const incId = nanoid();
      await db.insert(incidents).values({
        id: incId,
        title: `${name} — ${ev.level === 'major' ? 'major outage' : 'degraded performance'}`,
        summary: templateFirstUpdate(name, ev.level),
        status: 'investigating',
        severity,
        affects: [ev.componentId],
        auto: true,
        startedAt: now,
      });
      await db.insert(incidentTimeline).values({
        id: nanoid(),
        incidentId: incId,
        at: now,
        label: 'INVESTIGATING',
        body: templateFirstUpdate(name, ev.level),
        author: 'engine',
      });
    } else if (open.auto && open.severity !== severity) {
      // Engine owns level on its own incidents; escalate/de-escalate severity.
      await db.update(incidents)
        .set({ severity, title: `${name} — ${ev.level === 'major' ? 'major outage' : 'degraded performance'}` })
        .where(eq(incidents.id, open.id));
    }
    // open && manual: leave entirely alone.
    return;
  }

  if (ev.state === 'ok') {
    // 0 non-ok: auto-resolve engine-owned incidents only — but NEVER during a
    // monitoring blackout (all sources stale → no live reads). Dead-man fails
    // SAFE: hold the incident open under reduced coverage rather than report
    // "recovered" exactly when we've lost the ability to see.
    if (open && open.auto && ev.hasLiveReads) {
      await db.update(incidents)
        .set({ status: 'resolved', resolvedAt: now })
        .where(eq(incidents.id, open.id));
      await db.insert(incidentTimeline).values({
        id: nanoid(),
        incidentId: open.id,
        at: now,
        label: 'RESOLVED',
        body: templateResolution(name),
        author: 'engine',
      });
    }
  }
  // watch (1 non-ok): never opens, never resolves. Just surfaced.
}

/** Run the full evaluate -> reconcile cycle for a single component. */
export async function runQuorum(componentId: string, now = new Date()): Promise<ComponentEvaluation> {
  const ev = await evaluateComponent(componentId, now);
  await reconcileIncident(ev, now);
  return ev;
}

/* ── sweep (timer-callable, also the dead-man path) ──────────── */

/**
 * Every component that has at least one observation OR a mapping. We run
 * quorum across all of them so that TTL expiry (a source going silent) is
 * detected even when no new observation arrives — the dead-man's switch.
 */
async function componentsWithSignal(): Promise<string[]> {
  const rows = await db.execute<{ component_id: string }>(sql`
    SELECT DISTINCT component_id FROM ${observations}
    UNION
    SELECT DISTINCT component_id FROM ${sourceTargetMap}
  `);
  return rows.map((r) => r.component_id);
}

/**
 * Sweep every known component through the quorum engine. Callable from a
 * scheduled function / timer. Returns the per-component evaluations (useful
 * for the admin dashboard: declared, watch, stale/reduced-coverage).
 */
export async function sweepQuorum(now = new Date()): Promise<ComponentEvaluation[]> {
  const ids = await componentsWithSignal();
  const out: ComponentEvaluation[] = [];
  for (const id of ids) {
    out.push(await runQuorum(id, now));
  }
  return out;
}

/* ── derived per-component status (for summary.json) ─────────── */

export type DerivedStatus = 'operational' | 'degraded' | 'outage';

export function evaluationToStatus(ev: ComponentEvaluation): DerivedStatus {
  if (ev.state === 'declared') return ev.level === 'major' ? 'outage' : 'degraded';
  // watch and ok both read as operational on the public surface (watch never pages).
  return 'operational';
}

/**
 * Derived status for every component that has core observations, as a map of
 * component_id -> status. Components with no observations are absent (callers
 * fall back to the stored components.status for those, preserving existing
 * behavior for components not yet wired to the engine).
 */
export async function derivedComponentStatuses(now = new Date()): Promise<Record<string, { status: DerivedStatus; state: QuorumState; reducedCoverage: boolean }>> {
  const rows = await db.execute<{ component_id: string }>(sql`
    SELECT DISTINCT component_id FROM ${observations}
  `);
  const out: Record<string, { status: DerivedStatus; state: QuorumState; reducedCoverage: boolean }> = {};
  for (const r of rows) {
    const ev = await evaluateComponent(r.component_id, now);
    out[r.component_id] = {
      status: evaluationToStatus(ev),
      state: ev.state,
      reducedCoverage: ev.reducedCoverage,
    };
  }
  return out;
}

/* ── ingest core (the one path) ──────────────────────────────── */

/**
 * Append an observation and run quorum for its component. This is the single
 * core path — both /api/v1/ingest and the legacy uptime-hook adapter funnel
 * through here so there is exactly one engine entry point.
 */
export async function appendObservation(opts: {
  sourceId: string;
  componentId: string;
  signal: Signal;
  detail?: string | null;
  expiresAt?: Date | null;
  defaultTtlSeconds?: number | null;
  now?: Date;
}): Promise<{ observationId: string; evaluation: ComponentEvaluation }> {
  const now = opts.now ?? new Date();
  // Resolve expiry: explicit expires_at wins, else source default_ttl from now, else null (never expires).
  let expiresAt: Date | null = opts.expiresAt ?? null;
  if (!expiresAt && opts.defaultTtlSeconds && opts.defaultTtlSeconds > 0) {
    expiresAt = new Date(now.getTime() + opts.defaultTtlSeconds * 1000);
  }

  const observationId = nanoid();
  await db.insert(observations).values({
    id: observationId,
    sourceId: opts.sourceId,
    componentId: opts.componentId,
    signal: opts.signal,
    detail: opts.detail ?? null,
    observedAt: now,
    expiresAt,
  });

  const evaluation = await runQuorum(opts.componentId, now);
  return { observationId, evaluation };
}

/**
 * Record a human override. The override is, per spec, "just a high-weight
 * `manual` source observation flowing through the same engine" — so we append
 * the observation AND, because a single source can't reach quorum on its own,
 * authoritatively open/resolve a HUMAN-owned (auto=false) incident. Human
 * incidents are never auto-resolved by the engine; only a human clears them.
 *
 * @param signal  the override signal ('down'|'degraded' opens, 'ok' resolves)
 * @param author  admin email, recorded on the timeline update
 */
export async function recordManualOverride(opts: {
  manualSourceId: string;
  componentId: string;
  signal: Signal;
  level?: Level;            // explicit level for the incident when opening
  body?: string;            // human update text
  title?: string;           // human title; overwrites the engine's templated headline
  author: string;
  now?: Date;
}): Promise<void> {
  const now = opts.now ?? new Date();
  // Flow through the same engine as an observation (so the read model agrees).
  //
  // A manual 'ok' (an "all clear" / Resolve) carries a grace TTL: it can clear a
  // sub-corroboration situation (<2 monitors disagree) but is SUBORDINATE to a
  // ≥2-monitor outage (see evaluateComponent), and must expire so even that
  // limited suppression can't mask a genuine future outage. The manual source's
  // own defaultTtl is null (never expires), so we set expires_at explicitly here.
  // A manual NON-ok (an active human declare) gets NO expiry — the banner
  // persists until a human resolves.
  const expiresAt =
    opts.signal === 'ok' ? new Date(now.getTime() + MANUAL_OK_GRACE_SECONDS * 1000) : null;
  const { evaluation } = await appendObservation({
    sourceId: opts.manualSourceId,
    componentId: opts.componentId,
    signal: opts.signal,
    detail: `manual override by ${opts.author}`,
    expiresAt,
    now,
  });

  const open = await openIncidentFor(opts.componentId);
  const name = await componentName(opts.componentId);

  if (opts.signal === 'ok') {
    // A manual 'ok' resolves the open incident ONLY when the engine itself now
    // derives the component OK. Monitors win on corroboration: if ≥2 live
    // monitors still report non-ok, evaluateComponent keeps state='declared'
    // (the manual 'ok' is subordinate — see the decision precedence), and we
    // must NOT force the incident resolved here. Doing so would flip the page
    // green against monitor truth and, worse, let the next sweep re-open a NEW
    // incident (re-spam) since the component is still declared. So we only
    // resolve when state !== 'declared' — when fewer than two monitors disagree
    // and the human's "all clear" actually carried. This closes the CRITICAL
    // (re-POSTed resolve can no longer pin a monitor-confirmed outage GREEN)
    // and the HIGH (a single all-clear can no longer suppress a corroborated
    // outage). reconcileIncident already auto-resolved the incident inside
    // appendObservation when the engine agreed it was OK, so this block is the
    // human-owned (auto=false) resolution path.
    if (open && evaluation.state !== 'declared') {
      await db.update(incidents)
        .set({ status: 'resolved', resolvedAt: now })
        .where(eq(incidents.id, open.id));
      await db.insert(incidentTimeline).values({
        id: nanoid(), incidentId: open.id, at: now, label: 'RESOLVED',
        body: opts.body ?? `Resolved by ${opts.author}.`, author: opts.author,
      });
    }
    return;
  }

  // Opening / escalating a human-owned incident.
  const level: Level = opts.level ?? (opts.signal === 'down' ? 'major' : 'degraded');
  const severity = levelToSeverity(level);
  if (!open) {
    const incId = nanoid();
    await db.insert(incidents).values({
      id: incId,
      title: `${name} — ${level === 'major' ? 'major outage' : 'degraded performance'}`,
      summary: opts.body ?? `${name} is being investigated.`,
      status: 'investigating',
      severity,
      affects: [opts.componentId],
      auto: false,
      startedAt: now,
    });
    await db.insert(incidentTimeline).values({
      id: nanoid(), incidentId: incId, at: now, label: 'INVESTIGATING',
      body: opts.body ?? `${name} is being investigated.`, author: opts.author,
    });
  } else {
    // An incident is already open — typically the engine auto-created one the
    // instant the manual observation reached quorum, with a TEMPLATED summary
    // (and generic title). Promote the operator to owner AND make their words
    // the headline: overwrite summary with opts.body (and title when supplied),
    // so the page shows what the human wrote, not the template.
    const patch: { severity: typeof severity; auto: boolean; summary?: string; title?: string } = {
      severity, auto: false,
    };
    if (opts.body) patch.summary = opts.body;
    if (opts.title) patch.title = opts.title;
    await db.update(incidents).set(patch).where(eq(incidents.id, open.id));
    if (opts.body) {
      await db.insert(incidentTimeline).values({
        id: nanoid(), incidentId: open.id, at: now, label: open.status.toUpperCase(),
        body: opts.body, author: opts.author,
      });
    }
  }
}

/* exported for re-use elsewhere */
export { openIncidentFor };
