/**
 * Quorum engine — the brain of the source-agnostic core.
 *
 * Component current status is DERIVED, never stored. For each component we
 * gather the latest non-expired observation per source, count how many
 * sources report non-ok (degraded|down), and decide:
 *
 *   >=2 agree  -> DECLARED. level = worst agreeing signal (down->major,
 *                 degraded->degraded). Open an auto-incident if none open,
 *                 else update its level. Templated first update.
 *    1 non-ok  -> WATCH. Logged/surfaced, NEVER pages, no incident.
 *    0 non-ok  -> OPERATIONAL. Auto-resolve any open auto-incident.
 *
 * A source past its TTL (observation.expires_at, or default_ttl from now)
 * is STALE: it drops out of quorum and flags reduced coverage (dead-man).
 *
 * Incident *existence* is engine-owned. Incident *status*
 * (investigating->identified->monitoring->resolved) stays human-editable —
 * the engine only opens (status=investigating), updates level, and
 * force-resolves auto incidents; it never touches a human-owned incident's
 * status text. A manual override is just a high-weight `manual` source
 * observation flowing through this same engine.
 *
 * Reuses: the existing `incidents` / `incident_timeline` / `services` tables
 * (a component id IS a services.id leaf), nanoid ids, and the incident
 * severity/status vocabulary from types.ts.
 */
import { db } from '@/db';
import { observations, sources, sourceTargetMap, incidents, incidentTimeline, components } from '@/db/schema';
import { eq, and, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export type Signal = 'ok' | 'degraded' | 'down';
export type QuorumState = 'ok' | 'watch' | 'declared';
export type Level = 'degraded' | 'major';

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
    revoked_at: Date | null;
    signal: Signal;
    detail: string | null;
    observed_at: Date;
    expires_at: Date | null;
  }>(sql`
    SELECT DISTINCT ON (o.source_id)
      o.source_id, s.name, s.weight, s.kind, s.revoked_at,
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
  let hasManualNonOk = false;

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
      if (read.signal !== 'ok') {
        nonOkCount++;
        if (r.kind === 'manual') hasManualNonOk = true;
      }
    }
  }

  const liveReads = reads.filter((r) => !r.stale);
  const downAgrees = liveReads.some((r) => r.signal === 'down');
  let state: QuorumState;
  let level: Level | null = null;
  // Quorum: ≥2 independent sources agree non-ok → DECLARE; OR a `manual` override
  // (a human declare) on its own. Exactly one AUTOMATED source → WATCH (logged,
  // surfaced internally, never pages). The single-source bypass is gated on
  // kind='manual', NOT weight — so one mis-weighted monitor can never page an
  // outage without corroboration.
  if (nonOkCount >= 2 || hasManualNonOk) {
    state = 'declared';
    level = downAgrees ? 'major' : 'degraded';
  } else if (nonOkCount >= 1) {
    state = 'watch';
  } else {
    state = 'ok';
  }

  return {
    componentId,
    reads,
    staleCount,
    nonOkCount,
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
 * fall back to the stored services.status for those, preserving existing
 * behavior for services not yet wired to the engine).
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
  author: string;
  now?: Date;
}): Promise<void> {
  const now = opts.now ?? new Date();
  // Flow through the same engine as an observation (so the read model agrees).
  await appendObservation({
    sourceId: opts.manualSourceId,
    componentId: opts.componentId,
    signal: opts.signal,
    detail: `manual override by ${opts.author}`,
    now,
  });

  const open = await openIncidentFor(opts.componentId);
  const name = await componentName(opts.componentId);

  if (opts.signal === 'ok') {
    if (open) {
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
    await db.update(incidents)
      .set({ severity, auto: false })
      .where(eq(incidents.id, open.id));
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
