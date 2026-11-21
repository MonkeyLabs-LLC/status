import type { APIRoute } from 'astro';
import { subscriberTokenRequestID, unsubscribeWithOwner } from '@/lib/status-client';
/**
 * GET /api/unsubscribe?token=<subscriber-id>
 * Deletes the subscriber row. Link is included in all incident emails.
 */
export const GET: APIRoute = async ({ url }) => {
    const token = url.searchParams.get('token')?.trim() ?? '';
    if (!token) {
        return new Response('Missing token.', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    }
    {
        try {
            await unsubscribeWithOwner(subscriberTokenRequestID('unsubscribe', token), token);
        }
        catch {
        }
    }
    // Redirect to status page — idempotent (ok even if row was already gone).
    return new Response(null, {
        status: 302,
        headers: { Location: '/?unsubscribed=1' },
    });
};
