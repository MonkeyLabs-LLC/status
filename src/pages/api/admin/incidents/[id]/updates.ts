/**
 * POST /api/admin/incidents/:id/updates — post a human update.
 *
 * Pure narration: appends a timeline entry attributed to the admin. Does not
 * touch the incident's existence (engine-owned). May carry a status label.
 */



import { decodeIncidentID } from '@/lib/incident-path';
import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { newOwnerCommand, ownerFailure, ownerIncident, publishIncidentCommand, } from '@/lib/incident-owner';
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
            const body = await ctx.request.json().catch(() => null);
            if (!body?.body)
                return err('bad_request', 'An update body is required.', 400);
            const label = (body.label || owned.incident.status || 'update').toString().toUpperCase();
            const updateId = nanoid();
            const nowMillis = Date.now();
            const now = Math.floor(nowMillis / 1000);
            const command = newOwnerCommand('update', `${id}:${updateId}`, {
                author: who,
                at_unix: now, at_unix_micros: nowMillis * 1000,
                update: { id: updateId, incident_id: id, at_unix: now, at_unix_millis: nowMillis, at_unix_micros: nowMillis * 1000, label, body: body.body, author: who },
            });
            await publishIncidentCommand(command, {
                eventId: `${id}:update:${updateId}`,
                subject: `${label === 'RESOLVED' ? 'Resolved' : 'Update'}: ${owned.incident.title}`,
                body: body.body,
            });
            return ok({ id: updateId, incidentId: id, label, body: body.body }, 201);
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
