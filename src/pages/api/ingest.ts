import { ingestWithNativeOwner } from '../../lib/ingest-owner';
/**
 * POST /api/ingest   Authorization: Bearer <source-token>
 *
 * The ONE inbound shape for the source-agnostic core. Body:
 *   { target, signal, detail?, expires_at? }
 *
 * - `source` is resolved from the bearer token (body value, if any, is a hint).
 * - `target` is a raw label resolved to a component via source_target_map.
 * - An append-only observation is written and quorum runs for the component.
 * - Unknown / revoked tokens are rejected with 401.
 *
 * Vendor-specific fixed payloads never hit this route directly; they hit a
 * thin adapter (e.g. /api/ingest/uptimerobot) that translates to this
 * same core path via appendObservation().
 */



import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';

import type { MonitorSignal as Signal } from '../../lib/status-client';

import { postStatus, StatusServiceError } from '@/lib/status-client';
const VALID_SIGNALS: Signal[] = ['ok', 'degraded', 'down'];
function json(body: unknown, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
const AUTH_VERSION = 'credential-registry/v1';
const MONITOR_VERSION = 'monitor.v1';
const AUTH_SOURCE_VALIDATE_EVENT = '/internal/auth/source-credentials/validate';
const MONITOR_INGEST_EVENT = '/internal/monitor/observations';
interface SourceCredentialValidation {
    valid: boolean;
    source_id?: string;
}
interface OwnerIngestResult {
    deduped?: boolean;
    evaluation?: {
        observation_id: string;
        component_id: string;
        state: string;
        level?: string;
        non_ok: number;
        sources: number;
        reduced_coverage: boolean;
    };
}
function ownerFailure(error: unknown, target?: string): Response {
    // The bridge's typed domain errors are already shaped for the public adapter.
    // Keep them intact instead of falling back to the legacy writer after an owner
    // command has been attempted; that would create split-brain state.
    if (error instanceof StatusServiceError) {
        if (error.detail) {
            try {
                const body = JSON.parse(error.detail) as {
                    code?: string;
                    error?: {
                        code?: string;
                    };
                };
                const code = body.code ?? body.error?.code;
                if (target && error.status === 422 && code === 'unmapped_target') {
                    return json({
                        error: {
                            code: 'unmapped_target',
                            message: `No mapping for target "${target}" on this source. Add a source_target_map row.`,
                        },
                    }, 422);
                }
            }
            catch {
            }
        }
        const status = error.status >= 500 ? 503 : error.status;
        return json({ error: { code: 'owner_unavailable', message: 'Ingest owner is unavailable.' } }, status);
    }
    return json({ error: { code: 'owner_unavailable', message: 'Ingest owner is unavailable.' } }, 503);
}
async function validateOwnerSource(token: string): Promise<string | null> {
    const result = await postStatus<{
        version: string;
        request_id: string;
        token: string;
        validated_at: string;
    }, SourceCredentialValidation>(AUTH_SOURCE_VALIDATE_EVENT, {
        version: AUTH_VERSION,
        request_id: `source-credential-validate_${randomUUID()}`,
        token,
        validated_at: new Date().toISOString(),
    });
    return result.valid && result.source_id ? result.source_id : null;
}
async function ingestWithOwner(input: {
    sourceId: string;
    target: string;
    signal: Signal;
    detail: string | null;
    expiresAt: Date | null;
}): Promise<OwnerIngestResult> {
    return ingestWithNativeOwner<OwnerIngestResult>({ namespace: 'generic', ...input });
}

export const POST: APIRoute = async ({ request }) => {
    // Bearer token.
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!token) {
        return json({ error: { code: 'unauthorized', message: 'Missing bearer token.' } }, 401);
    }

    let ownerSourceId: string | null = null;
    {
        try {
            ownerSourceId = await validateOwnerSource(token);
        }
        catch (error) {
            return ownerFailure(error);
        }
        if (!ownerSourceId) {
            return json({ error: { code: 'unauthorized', message: 'Unknown or revoked source token.' } }, 401);
        }
    }

    // Body.
    let body: any;
    try {
        body = await request.json();
    }
    catch {
        return json({ error: { code: 'bad_request', message: 'Body must be JSON.' } }, 400);
    }
    const target = typeof body?.target === 'string' ? body.target.trim() : '';
    const signal = body?.signal as Signal;
    const detail = typeof body?.detail === 'string' ? body.detail : null;
    if (!target) {
        return json({ error: { code: 'bad_request', message: '`target` is required.' } }, 400);
    }
    if (!VALID_SIGNALS.includes(signal)) {
        return json({ error: { code: 'bad_request', message: `\`signal\` must be one of: ${VALID_SIGNALS.join(', ')}.` } }, 400);
    }
    // expires_at: optional ISO timestamp enabling the dead-man for this source.
    let expiresAt: Date | null = null;
    if (body?.expires_at != null) {
        const d = new Date(body.expires_at);
        if (isNaN(d.getTime())) {
            return json({ error: { code: 'bad_request', message: '`expires_at` must be a valid ISO timestamp.' } }, 400);
        }
        expiresAt = d;
    }
    {
        try {
            const result = await ingestWithOwner({
                sourceId: ownerSourceId!,
                target,
                signal,
                detail,
                expiresAt,
            });
            const evaluation = result.evaluation;
            // A successful monitor command is required to include the compatibility
            // evaluation. Treat a malformed owner response as unavailable instead of
            // inventing a public state or falling back to Postgres.
            if (!evaluation) {
                return json({ error: { code: 'owner_unavailable', message: 'Ingest owner returned an invalid response.' } }, 503);
            }
            return json({
                data: {
                    observation_id: evaluation.observation_id,
                    component_id: evaluation.component_id,
                    state: evaluation.state,
                    level: evaluation.level || null,
                    non_ok: evaluation.non_ok,
                    sources: evaluation.sources,
                    reduced_coverage: evaluation.reduced_coverage,
                },
            }, 202);
        }
        catch (error) {
            return ownerFailure(error, target);
        }
    }
};
