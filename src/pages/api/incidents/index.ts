import type { APIRoute } from 'astro';
import { requireApiToken } from '@/lib/api-tokens';
import { componentExists, isLeafComponent } from '@/lib/components';
import { nanoid } from 'nanoid';
import { declaredIncidentID, incidentProjection, legacyIncident, newOwnerCommand, ownerFailure, sendIncidentCommand, } from '@/lib/incident-owner';
const VALID_SEVERITY = ['minor', 'moderate', 'major'];
const VALID_STATUS = ['investigating', 'identified', 'monitoring', 'resolved'];
export const GET: APIRoute = async ({ request, url }) => {
    const token = await requireApiToken(request, 'read');
    if (!token)
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });
    const status = url.searchParams.get('status');
    const product = url.searchParams.get('product');
    const limit = parseInt(url.searchParams.get('limit') ?? '50');
    const offset = parseInt(url.searchParams.get('offset') ?? '0');
    {
        try {
            const projection = await incidentProjection();
            let rows = (projection.incidents ?? []).map(legacyIncident);
            if (status)
                rows = rows.filter((incident) => incident.status === status);
            if (product)
                rows = rows.filter((incident) => incident.affects.includes(product));
            rows.sort((left, right) => Date.parse(right.startedAt ?? '') - Date.parse(left.startedAt ?? ''));
            return new Response(JSON.stringify({ data: rows.slice(offset, offset + limit) }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
export const POST: APIRoute = async ({ request }) => {
    const token = await requireApiToken(request, 'write');
    if (!token)
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid or insufficient API token.' } }), { status: 401 });
    const body = await request.json();
    const { title, summary, severity, affects, status: incStatus } = body;
    if (!title || !summary || !severity || !affects?.length) {
        return new Response(JSON.stringify({ error: { code: 'bad_request', message: 'title, summary, severity, and affects are required.' } }), { status: 400 });
    }
    if (!VALID_SEVERITY.includes(severity)) {
        return new Response(JSON.stringify({ error: { code: 'bad_request', message: `severity must be one of ${VALID_SEVERITY.join(', ')}.` } }), { status: 400 });
    }
    if (incStatus != null && !VALID_STATUS.includes(incStatus)) {
        return new Response(JSON.stringify({ error: { code: 'bad_request', message: `status must be one of ${VALID_STATUS.join(', ')}.` } }), { status: 400 });
    }
    // Every affected id must resolve to a real LEAF component (service/host), or
    // the incident is invisible / declared up the tree.
    for (const a of affects) {
        if (!(await componentExists(a))) {
            return new Response(JSON.stringify({ error: { code: 'bad_request', message: `Unknown component "${a}".` } }), { status: 400 });
        }
        if (!(await isLeafComponent(a))) {
            return new Response(JSON.stringify({ error: { code: 'bad_request', message: `Component "${a}" is not a leaf (declare on a service or host).` } }), { status: 400 });
        }
    }
    {
        const id = nanoid();
        const nowMillis = Date.now();
            const now = Math.floor(nowMillis / 1000);
        const command = newOwnerCommand('open', id, {
            author: token.name || token.id,
            at_unix: now, at_unix_micros: nowMillis * 1000,
            incident: {
                id,
                title,
                summary,
                severity,
                affects,
                status: incStatus ?? 'investigating',
                auto: false,
                started_at_unix: now, started_at_unix_millis: nowMillis,
                created_at_unix: now, created_at_unix_millis: nowMillis,
            },
        });
        // The old public API creates the row only; it deliberately does not page
        // subscribers. Keep that behavioral boundary while moving its state owner.
        try {
            const result = await sendIncidentCommand(command);
            const created = await ownerIncidentForResponse(declaredIncidentID(result));
            if (!created)
                return ownerFailure(new Error('owner did not return created incident'));
            return new Response(JSON.stringify({ data: created }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
async function ownerIncidentForResponse(id: string) {
    const projection = await incidentProjection();
    const incident = projection.incidents?.find((candidate) => candidate.id === id);
    return incident ? legacyIncident(incident) : null;
}
