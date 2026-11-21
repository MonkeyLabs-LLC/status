/**
 * DELETE /api/admin/subscribers/:id — remove a subscriber endpoint.
 */



import type { APIRoute } from 'astro';
import { requireAdmin, ok } from '@/lib/admin-api';
import { deleteSubscriberWithOwner, statusOwnerRequestID } from '@/lib/status-client';
export const DELETE: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    {
        const id = ctx.params.id!;
        await deleteSubscriberWithOwner(statusOwnerRequestID('subscriber-admin-delete', id), id);
        return ok({ deleted: true });
    }
};
