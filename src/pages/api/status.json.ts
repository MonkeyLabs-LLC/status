import type { APIRoute } from 'astro';
import { getMonitorProjection } from '../../lib/status-client';
import { buildMonitorStatusJSON } from '../../lib/monitor-projection';
export const GET: APIRoute = async ({ locals }) => {
    const scope = (locals as any).scope as string | null;
    try {
        {
            const owner = buildMonitorStatusJSON(await getMonitorProjection(), scope || null);
            return new Response(JSON.stringify(owner, null, 2), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
                    'Netlify-CDN-Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }
    }
    catch (_e) {
        // DB/derivation failure: fail CLOSED. Never synthesize 'operational' on an
        // error — emit 'unknown' + live:false with a 503 so badges/monitors treat us
        // as unverifiable, mirroring summary.json's dead-man rule.
        const body = {
            status: 'unknown',
            state: 'unknown',
            live: false,
            services: [],
            activeIncidents: [],
            scheduledMaintenance: [],
        };
        return new Response(JSON.stringify(body, null, 2), {
            status: 503,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=30',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }
};
