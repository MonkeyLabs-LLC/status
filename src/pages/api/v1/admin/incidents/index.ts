/**
 * Admin incident endpoints (admin-session auth).
 *
 *   GET  /api/v1/admin/incidents          list incidents
 *   POST /api/v1/admin/incidents          MANUAL DECLARE — the engine path
 *
 * A manual declare does NOT hand-write incident status fields. It calls
 * recordManualOverride, which appends a high-weight `manual`-source
 * observation and opens a human-owned (auto=false) incident through the SAME
 * quorum engine the monitors use. The engine, not this route, owns existence.
 */
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { incidents } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { getManualSource } from '@/lib/sources';
import { recordManualOverride, openIncidentFor, type Level } from '@/lib/quorum';
import { snapshotComponent, notifyForComponent } from '@/lib/notify';

export const GET: APIRoute = async (ctx) => {
  const who = await requireAdmin(ctx);
  if (who instanceof Response) return who;
  const rows = await db.select().from(incidents).orderBy(desc(incidents.startedAt)).limit(100);
  return ok(rows);
};

export const POST: APIRoute = async (ctx) => {
  const who = await requireAdmin(ctx);
  if (who instanceof Response) return who;

  const body = await ctx.request.json().catch(() => null);
  if (!body) return err('bad_request', 'Invalid JSON body.', 400);

  const componentId: string | undefined = body.componentId ?? (Array.isArray(body.affects) ? body.affects[0] : undefined);
  if (!componentId) return err('bad_request', 'A componentId (affected component) is required.', 400);

  // severity -> engine level. 'major' is the only major; everything else degraded.
  const level: Level = body.severity === 'major' ? 'major' : 'degraded';
  const signal = level === 'major' ? 'down' : 'degraded';
  const summary: string = body.summary || body.title || 'Investigating an issue.';

  const manual = await getManualSource();
  const before = await snapshotComponent(componentId);
  // Flows through the same engine as a monitor observation (high-weight manual source).
  await recordManualOverride({
    manualSourceId: manual.id,
    componentId,
    signal,
    level,
    body: summary,
    author: who,
  });
  await notifyForComponent(componentId, before);

  const open = await openIncidentFor(componentId);
  return ok(open, 201);
};
