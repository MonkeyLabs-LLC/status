/**
 * POST /api/admin/incidents/:id/resolve — force-resolve.
 *
 * Routes through the native manual-override operation with signal 'ok' so the resolution flows
 * through the same engine (the manual source clears its non-ok read and the
 * incident is closed with a human-authored RESOLVED update). We do not hand-set
 * status='resolved' on the row directly.
 */



import { decodeIncidentID } from '@/lib/incident-path';
import type { APIRoute } from 'astro';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { legacyIncident, newOwnerCommand, ownerFailure, ownerIncident, publishIncidentCommand, sendIncidentCommand, } from '@/lib/incident-owner';
export const POST: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    const id = decodeIncidentID(ctx.params.id);
    {
        try {
            const owned = await ownerIncident(id);
            if (!owned)
                return err('not_found', 'Incident not found.', 404);
            const body = await ctx.request.json().catch(() => ({}));
            const command = newOwnerCommand('resolve', `${id}:resolve:${JSON.stringify(body)}`, {
                author: who,
                note: typeof body?.body === 'string' ? body.body : undefined,
                incident: { id },
            });
            if (['moderate', 'major'].includes(owned.incident.severity)) {
                await publishIncidentCommand(command, {
                    eventId: `${id}:resolved:${command.id}`,
                    subject: `Resolved: ${owned.incident.title}`,
                    body: body?.body || `Resolved by ${who}.`,
                });
            }
            else {
                await sendIncidentCommand(command);
            }
            const updated = await ownerIncident(id);
            if (!updated)
                return ownerFailure(new Error('owner did not return resolved incident'));
            return ok(legacyIncident(updated.incident));
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
