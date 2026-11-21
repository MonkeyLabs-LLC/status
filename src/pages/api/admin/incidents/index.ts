/**
 * Admin incident endpoints (admin-session auth).
 *
 *   GET  /api/admin/incidents          list incidents
 *   POST /api/admin/incidents          MANUAL DECLARE — the engine path
 *
 * A manual declare does NOT hand-write incident status fields. It calls
 * the native manual-override operation, which appends a high-weight `manual`-source
 * observation and opens a human-owned (auto=false) incident through the SAME
 * quorum engine the monitors use. The engine, not this route, owns existence.
 */



import type { APIRoute } from 'astro';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { nanoid } from 'nanoid';
import { declaredIncidentID, incidentProjection, legacyIncident, newOwnerCommand, ownerFailure, ownerIncident, publishIncidentCommand, } from '@/lib/incident-owner';
import { monitorOwnerProjection } from '@/lib/admin/monitor-owner';
export const GET: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    {
        try {
            const projection = await incidentProjection();
            const rows = (projection.incidents ?? [])
                .map(legacyIncident)
                .sort((left, right) => Date.parse(right.startedAt ?? '') - Date.parse(left.startedAt ?? ''))
                .slice(0, 100);
            return ok(rows);
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
export const POST: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    const body = await ctx.request.json().catch(() => null);
    if (!body)
        return err('bad_request', 'Invalid JSON body.', 400);
    // Every affected id must resolve to a real LEAF component (service/host), or
    // the incident would be invisible on the public surface (the invisible-outage
    // bug) / declared up the tree where status is derived, not observed.
    const affects: string[] = Array.isArray(body.affects)
        ? body.affects
        : (body.componentId ? [body.componentId] : []);
    if (!affects.length)
        return err('bad_request', 'A componentId (affected component) is required.', 400);
    {
        try {
            const projection = await monitorOwnerProjection(true);
            const components = new Map(projection.components.map(({ component }) => [component.id, component]));
            for (const a of affects) {
                const component = components.get(a);
                if (!component || component.archived)
                    return err('bad_request', `Unknown component "${a}".`, 400);
                if (component.kind !== 'service' && component.kind !== 'host') {
                    return err('bad_request', `Component "${a}" is not a leaf (declare on a service or host).`, 400);
                }
            }
            const id = nanoid();
            const nowMillis = Date.now();
            const now = Math.floor(nowMillis / 1000);
            // Legacy sends a high-weight manual observation: major becomes an outage,
            // while every other human declaration is the notable degraded state.
            const severity = body.severity === 'major' ? 'major' : 'moderate';
            const summary: string = body.summary || body.title || 'Investigating an issue.';
            const title: string = body.title || summary;
            const command = newOwnerCommand('open', id, {
                author: who,
                at_unix: now, at_unix_micros: nowMillis * 1000,
                incident: {
                    id, title, summary, severity, affects,
                    status: 'investigating', auto: false,
                    started_at_unix: now, started_at_unix_millis: nowMillis, created_at_unix: now, created_at_unix_millis: nowMillis,
                },
            });
            const result = await publishIncidentCommand(command, {
                eventId: `${id}:opened`,
                subject: `Investigating: ${title}`,
                body: summary,
            });
            const created = await ownerIncident(declaredIncidentID(result.monitor));
            if (!created)
                return ownerFailure(new Error('owner did not return declared incident'));
            return ok(legacyIncident(created.incident), 201);
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
