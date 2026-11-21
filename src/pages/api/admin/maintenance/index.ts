/**
 * Admin maintenance endpoints (admin-session auth).
 *   GET  /api/admin/maintenance   list
 *   POST /api/admin/maintenance   schedule a planned window
 */



import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { ownerCommandID, ownerMaintenanceRows, ownerNowUnix, sendOwnerMaintenanceCommand, toUnixSeconds, validateOwnerAffects, } from '@/lib/maintenance-owner';
export const GET: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    return ok(await ownerMaintenanceRows());
};
export const POST: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    const b = await ctx.request.json().catch(() => null);
    if (!b?.title || !b?.summary || !b?.scheduledStart || !b?.scheduledEnd || !Array.isArray(b.affects) || !b.affects.length) {
        return err('bad_request', 'title, summary, scheduledStart, scheduledEnd and at least one affected component are required.', 400);
    }
    const startMs = new Date(b.scheduledStart).getTime();
    const endMs = new Date(b.scheduledEnd).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return err('bad_request', 'scheduledStart and scheduledEnd must be valid date-times.', 400);
    }
    if (endMs <= startMs) {
        return err('bad_request', 'scheduledEnd must be after scheduledStart.', 400);
    }
    {
        const validation = await validateOwnerAffects(b.affects, (id) => `Component "${id}" is not a leaf (schedule on a service or host).`);
        if (validation)
            return err('bad_request', validation, 400);
        const id = nanoid();
        const now = ownerNowUnix();
        await sendOwnerMaintenanceCommand({
            version: 'monitor.v1', id: ownerCommandID('maintenance-admin-create', id), kind: 'schedule_maintenance', at_unix: now,
            maintenance: {
                id, title: b.title, summary: b.summary, kind: b.kind ?? 'scheduled',
                scheduled_start_unix: toUnixSeconds(new Date(b.scheduledStart)),
                scheduled_end_unix: toUnixSeconds(new Date(b.scheduledEnd)),
                affects: b.affects, created_at_unix: now,
            },
        });
        return ok({ id }, 201);
    }
};
