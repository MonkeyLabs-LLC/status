/**
 * Admin single-incident endpoints (admin-session auth).
 *
 *   GET   /api/admin/incidents/:id     incident + timeline
 *   PATCH /api/admin/incidents/:id     human-owned status move, or level override
 *
 * Status (investigating→identified→monitoring→resolved) is human-owned, so a
 * status move writes the field + a timeline entry directly (that is narration,
 * not status-flipping the engine's truth). A LEVEL override, by contrast, is an
 * engine concern — it routes through the native manual-override operation so the read model and
 * the incident agree, and the incident becomes human-owned (auto=false).
 */



import { decodeIncidentID } from '@/lib/incident-path';
import type { APIRoute } from 'astro';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { legacyIncident, legacyTimeline, newOwnerCommand, ownerFailure, ownerIncident, publishIncidentCommand, sendIncidentCommand, } from '@/lib/incident-owner';
export const GET: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    const id = decodeIncidentID(ctx.params.id);
    {
        try {
            const owned = await ownerIncident(id);
            if (!owned)
                return err('not_found', 'Incident not found.', 404);
            return ok({
                ...legacyIncident(owned.incident),
                timeline: owned.timeline.sort((left, right) => (right.at_unix_millis ?? right.at_unix * 1000) - (left.at_unix_millis ?? left.at_unix * 1000)).map(legacyTimeline),
            });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
export const PATCH: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    const id = decodeIncidentID(ctx.params.id);

    let owned: Awaited<ReturnType<typeof ownerIncident>> | null = null;
    {
        try {
            owned = await ownerIncident(id);
        }
        catch (error) {
            return ownerFailure(error);
        }
        if (!owned)
            return err('not_found', 'Incident not found.', 404);
    }
    const body = await ctx.request.json().catch(() => null);
    if (!body)
        return err('bad_request', 'Invalid JSON body.', 400);
    if (owned) {
        try {
            const nowMillis = Date.now();
            const now = Math.floor(nowMillis / 1000);
            const statusChanged = Boolean(body.status && body.status !== owned.incident.status);
            const severityChanged = Boolean(body.severity && body.severity !== owned.incident.severity);
            const nextSeverity = body.severity === 'major' ? 'major' : 'moderate';
            if (body.status === 'resolved' && statusChanged) {
                const command = newOwnerCommand('resolve', `${id}:resolve:${JSON.stringify(body)}`, {
                    author: who,
                    note: typeof body.note === 'string' ? body.note : undefined,
                    at_unix: now, at_unix_micros: nowMillis * 1000, incident: { id },
                });
                if (['moderate', 'major'].includes(owned.incident.severity)) {
                    await publishIncidentCommand(command, {
                        eventId: `${id}:resolved:${command.id}`,
                        subject: `Resolved: ${owned.incident.title}`,
                        body: body.note || `Resolved by ${who}.`,
                    });
                }
                else {
                    await sendIncidentCommand(command);
                }
            }
            const patch: Record<string, unknown> = { id, at_unix: now, author: who };
            if (body.severity && severityChanged)
                patch.severity = nextSeverity;
            if (body.status && body.status !== 'resolved' && statusChanged) {
                patch.status = body.status;
                patch.note = body.note || `Status moved to ${body.status}.`;
            }
            if (body.title)
                patch.title = body.title;
            if (body.summary)
                patch.summary = body.summary;
            if (Object.keys(patch).length > 3) {
                const command = newOwnerCommand('edit', `${id}:edit:${JSON.stringify(body)}`, {
                    author: who,
                    at_unix: now, at_unix_micros: nowMillis * 1000, incident_patch: patch,
                });
                if (statusChanged && body.status !== 'resolved') {
                    await publishIncidentCommand(command, {
                        eventId: `${id}:status:${command.id}`,
                        subject: `Update: ${body.title || owned.incident.title}`,
                        body: body.note || `Status moved to ${body.status}.`,
                    });
                }
                else if (severityChanged && ['moderate', 'major'].includes(nextSeverity)) {
                    await publishIncidentCommand(command, {
                        eventId: `${id}:severity:${command.id}`,
                        subject: `Update: ${body.title || owned.incident.title}`,
                        body: body.note || `Level overridden to ${body.severity} by ${who}.`,
                    });
                }
                else {
                    await sendIncidentCommand(command);
                }
            }
            const updated = await ownerIncident(id);
            if (!updated)
                return ownerFailure(new Error('owner did not return updated incident'));
            return ok(legacyIncident(updated.incident));
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
    return ownerFailure(new Error('owner incident lookup was incomplete'));
};
