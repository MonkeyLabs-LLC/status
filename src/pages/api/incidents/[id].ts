import { decodeIncidentID } from '@/lib/incident-path';
import type { APIRoute } from 'astro';
import { requireApiToken } from '@/lib/api-tokens';
import { componentExists, isLeafComponent } from '@/lib/components';
import { legacyIncident, legacyTimeline, newOwnerCommand, ownerFailure, ownerIncident, publishIncidentCommand, sendIncidentCommand, } from '@/lib/incident-owner';
const VALID_SEVERITY = ['minor', 'moderate', 'major'];
const VALID_STATUS = ['investigating', 'identified', 'monitoring', 'resolved'];
export const GET: APIRoute = async ({ request, params }) => {
    const token = await requireApiToken(request, 'read');
    if (!token)
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });
    {
        try {
            const owned = await ownerIncident(decodeIncidentID(params.id));
            if (!owned)
                return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Incident not found.' } }), { status: 404 });
            return new Response(JSON.stringify({ data: {
                    ...legacyIncident(owned.incident),
                    timeline: owned.timeline
                        .sort((left, right) => (right.at_unix_millis ?? right.at_unix * 1000) - (left.at_unix_millis ?? left.at_unix * 1000))
                        .map(legacyTimeline),
                } }), { headers: { 'Content-Type': 'application/json' } });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
export const PATCH: APIRoute = async ({ request, params }) => {
    const token = await requireApiToken(request, 'write');
    if (!token)
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });

    let owned: Awaited<ReturnType<typeof ownerIncident>> | null = null;
    {
        try {
            owned = await ownerIncident(decodeIncidentID(params.id));
        }
        catch (error) {
            return ownerFailure(error);
        }
        if (!owned)
            return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Incident not found.' } }), { status: 404 });
    }
    const body = await request.json();
    if (body.severity !== undefined && !VALID_SEVERITY.includes(body.severity)) {
        return new Response(JSON.stringify({ error: { code: 'bad_request', message: `severity must be one of ${VALID_SEVERITY.join(', ')}.` } }), { status: 400 });
    }
    if (body.status !== undefined && !VALID_STATUS.includes(body.status)) {
        return new Response(JSON.stringify({ error: { code: 'bad_request', message: `status must be one of ${VALID_STATUS.join(', ')}.` } }), { status: 400 });
    }
    if (body.affects !== undefined) {
        if (!Array.isArray(body.affects) || !body.affects.length) {
            return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'affects must be a non-empty array.' } }), { status: 400 });
        }
        for (const a of body.affects) {
            if (!(await componentExists(a))) {
                return new Response(JSON.stringify({ error: { code: 'bad_request', message: `Unknown component "${a}".` } }), { status: 400 });
            }
            if (!(await isLeafComponent(a))) {
                return new Response(JSON.stringify({ error: { code: 'bad_request', message: `Component "${a}" is not a leaf (declare on a service or host).` } }), { status: 400 });
            }
        }
    }
    if (owned) {
        try {
            const nowMillis = Date.now();
            const now = Math.floor(nowMillis / 1000);
            if (body.status === 'resolved') {
                const command = newOwnerCommand('resolve', `${decodeIncidentID(params.id)}:${JSON.stringify(body)}`, {
                    author: token.name || token.id,
                    note: typeof body.note === 'string' ? body.note : undefined,
                    at_unix: now, at_unix_micros: nowMillis * 1000,
                    incident: { id: decodeIncidentID(params.id) },
                });
                // Legacy notification is conditional on a notable incident transition.
                // Keep that boundary, but make intent creation durable and sequenced by the native service.
                if (['moderate', 'major'].includes(owned.incident.severity)) {
                    await publishIncidentCommand(command, {
                        eventId: `${decodeIncidentID(params.id)}:resolved:${command.id}`,
                        subject: `Resolved: ${owned.incident.title}`,
                        body: body.note || 'Monitoring reports recovery.',
                    });
                }
                else {
                    await sendIncidentCommand(command);
                }
            }
            const patch: Record<string, unknown> = { id: decodeIncidentID(params.id), at_unix: now, author: token.name };
            if (body.status !== undefined && body.status !== 'resolved')
                patch.status = body.status;
            if (body.severity !== undefined)
                patch.severity = body.severity;
            if (body.affects !== undefined)
                patch.affects = body.affects;
            if (body.title !== undefined)
                patch.title = body.title;
            if (body.summary !== undefined)
                patch.summary = body.summary;
            if (Object.keys(patch).length > 3) {
                await sendIncidentCommand(newOwnerCommand('edit', `${decodeIncidentID(params.id)}:edit:${JSON.stringify(body)}`, {
                    author: token.name || token.id,
                    at_unix: now, at_unix_micros: nowMillis * 1000,
                    incident_patch: patch,
                }));
            }
            const updated = await ownerIncident(decodeIncidentID(params.id));
            if (!updated)
                return ownerFailure(new Error('owner did not return updated incident'));
            return new Response(JSON.stringify({ data: legacyIncident(updated.incident) }), { headers: { 'Content-Type': 'application/json' } });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
    return ownerFailure(new Error('owner incident lookup was incomplete'));
};
export const DELETE: APIRoute = async ({ request, params }) => {
    const token = await requireApiToken(request, 'full');
    if (!token)
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });
    {
        try {
            // Legacy DELETE is idempotent: deleting an absent row still returns true.
            const existing = await ownerIncident(decodeIncidentID(params.id));
            if (existing) {
                await sendIncidentCommand(newOwnerCommand('delete', decodeIncidentID(params.id), { incident_id: decodeIncidentID(params.id) }));
            }
            return new Response(JSON.stringify({ data: { deleted: true } }), { headers: { 'Content-Type': 'application/json' } });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
