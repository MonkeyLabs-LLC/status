/**
 * Admin maintenance item (admin-session auth).
 *   PATCH  /api/admin/maintenance/:id
 *   DELETE /api/admin/maintenance/:id
 */



import type { APIRoute } from 'astro';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { ownerCommandID, ownerMaintenanceByID, ownerNowUnix, sendOwnerMaintenanceCommand, toUnixSeconds, validateOwnerAffects, } from '@/lib/maintenance-owner';
export const PATCH: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    const id = ctx.params.id!;
    const b = await ctx.request.json().catch(() => null);
    if (!b)
        return err('bad_request', 'Invalid JSON body.', 400);
    {
        const existing = await ownerMaintenanceByID(id);
        // The legacy endpoint is a successful no-op for a missing id.
        if (!existing || existing.cancelled)
            return ok({ id });
        const patch: NonNullable<Parameters<typeof sendOwnerMaintenanceCommand>[0]['maintenance_patch']> = { id };
        if (b.title)
            patch.title = b.title;
        if (b.summary)
            patch.summary = b.summary;
        if (b.scheduledStart)
            patch.scheduled_start_unix = toUnixSeconds(new Date(b.scheduledStart));
        if (b.scheduledEnd)
            patch.scheduled_end_unix = toUnixSeconds(new Date(b.scheduledEnd));
        if (Array.isArray(b.affects)) {
            const validation = await validateOwnerAffects(b.affects, (componentID) => `Component "${componentID}" is not a leaf (schedule on a service or host).`);
            if (validation)
                return err('bad_request', validation, 400);
            patch.affects = b.affects;
        }
        if (Object.keys(patch).length > 1) {
            await sendOwnerMaintenanceCommand({
                version: 'monitor.v1', id: ownerCommandID('maintenance-admin-edit', `${id}\0${JSON.stringify(b)}`),
                kind: 'edit_maintenance', at_unix: ownerNowUnix(), maintenance_patch: patch,
            });
        }
        return ok({ id });
    }
};
export const DELETE: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    {
        const id = ctx.params.id!;
        const existing = await ownerMaintenanceByID(id);
        if (existing && !existing.cancelled) {
            await sendOwnerMaintenanceCommand({
                version: 'monitor.v1', id: ownerCommandID('maintenance-admin-delete', id),
                kind: 'delete_maintenance', at_unix: ownerNowUnix(), maintenance_id: id,
            });
        }
        return ok({ deleted: true });
    }
};
