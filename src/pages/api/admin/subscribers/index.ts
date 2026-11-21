/**
 * Admin subscriber endpoints (admin-session auth). Mostly read.
 *   GET /api/admin/subscribers   list
 */



import type { APIRoute } from 'astro';
import { requireAdmin, ok } from '@/lib/admin-api';
import { listSubscribersWithOwner } from '@/lib/status-client';
export const GET: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    {
        const result = await listSubscribersWithOwner();
        return ok(result.subscribers.map(({ state: _state, ...subscriber }) => subscriber));
    }
};
