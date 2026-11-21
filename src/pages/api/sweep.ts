/**
 * POST /api/sweep — run the quorum engine across every known component.
 *
 * This is the timer/dead-man path: TTL expiry (a source going silent past its
 * expires_at / default_ttl) only changes the derived state when something
 * re-evaluates the component. New observations re-evaluate on arrival; this
 * sweep re-evaluates everything on a schedule so a silent source flips
 * coverage and any auto-incident state settles even with no inbound traffic.
 *
 * Wire a Netlify scheduled function (or any cron) to POST here. Protected by
 * the same UPTIME_HOOK_SECRET shared secret to keep it internal.
 */



import type { APIRoute } from 'astro';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ownerClock, postStatus, StatusServiceError } from '@/lib/status-client';
const MONITOR_SWEEP_EVENT = '/internal/monitor/sweep';
interface OwnerSweepResult {
    sweep?: {
        components: number;
        declared: number;
        watch: number;
        reduced_coverage: number;
    };
}
function json(body: unknown, status: number) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function ownerFailure(error: unknown): Response {
    // Never call sweepQuorum after an owner attempt: replaying the same timer in
    // the legacy writer could create a divergent incident/notification history.
    if (error instanceof StatusServiceError && error.detail) {
        try {
            return json(JSON.parse(error.detail), error.status);
        }
        catch {
        }
    }
    const status = error instanceof StatusServiceError && error.status < 500 ? error.status : 503;
    return json({ error: { code: 'owner_unavailable', message: 'Sweep owner is unavailable.' } }, status);
}
export const POST: APIRoute = async ({ request }) => {
    const secret = process.env.UPTIME_HOOK_SECRET;
    if (!secret) {
        return new Response(JSON.stringify({ error: { code: 'not_configured', message: 'Sweep not configured.' } }), { status: 503 });
    }
    const provided = request.headers.get('X-Uptime-Hook-Secret') ?? '';
    if (provided.length !== secret.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) {
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid secret.' } }), { status: 401 });
    }
    {
        try {
            // The native service commits monitor reconciliation then applies subscriber
            // transition delivery intents. A fresh command ID preserves the legacy
            // scheduler semantics: two separately received ticks are two sweeps.
            const result = await postStatus<{
                version: string;
                id: string;
                kind: string;
                at_unix: number;
                at_unix_micros?: number;
            }, OwnerSweepResult>(MONITOR_SWEEP_EVENT, {
                version: 'monitor.v1',
                id: `sweep_${randomUUID()}`,
                kind: 'sweep_reconcile',
                ...ownerClock(),
            });
            if (!result.sweep) {
                return json({ error: { code: 'owner_unavailable', message: 'Sweep owner returned an invalid response.' } }, 503);
            }
            return json({
                data: {
                    components: result.sweep.components,
                    declared: result.sweep.declared,
                    watch: result.sweep.watch,
                    reducedCoverage: result.sweep.reduced_coverage,
                },
            }, 200);
        }
        catch (error) {
            return ownerFailure(error);
        }
    }
};
