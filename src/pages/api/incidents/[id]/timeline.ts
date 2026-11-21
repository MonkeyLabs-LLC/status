import { decodeIncidentID } from '@/lib/incident-path';
import type { APIRoute } from 'astro';
import { requireApiToken } from '@/lib/api-tokens';
import { nanoid } from 'nanoid';
import { newOwnerCommand, ownerFailure, ownerIncident, publishIncidentCommand, } from '@/lib/incident-owner';
export const POST: APIRoute = async ({ request, params }) => {
    const token = await requireApiToken(request, 'write');
    if (!token)
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });
    const body = await request.json();
    const { label, body: entryBody } = body;
    if (!label || !entryBody) {
        return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'label and body are required.' } }), { status: 400 });
    }
    {
        try {
            const owned = await ownerIncident(decodeIncidentID(params.id));
            if (!owned)
                return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Incident not found.' } }), { status: 404 });
            const id = nanoid();
            const upperLabel = label.toUpperCase();
            const nowMillis = Date.now();
            const now = Math.floor(nowMillis / 1000);
            const command = newOwnerCommand('update', `${decodeIncidentID(params.id)}:${id}`, {
                author: token.name || token.id,
                at_unix: now, at_unix_micros: nowMillis * 1000,
                update: {
                    id,
                    incident_id: decodeIncidentID(params.id),
                    at_unix: now, at_unix_millis: nowMillis, at_unix_micros: nowMillis * 1000,
                    label: upperLabel,
                    body: entryBody,
                    author: token.name || token.id,
                },
            });
            // A timeline post is an intentional human event, and legacy always
            // fanned it out. The native service commits owner state before durable intent creation.
            await publishIncidentCommand(command, {
                eventId: `${decodeIncidentID(params.id)}:timeline:${id}`,
                subject: `${upperLabel === 'RESOLVED' ? 'Resolved' : 'Update'}: ${owned.incident.title}`,
                body: entryBody,
            });
            return new Response(JSON.stringify({ data: { id, incidentId: decodeIncidentID(params.id), label: upperLabel, body: entryBody } }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
