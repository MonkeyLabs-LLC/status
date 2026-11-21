/**
 * Admin component endpoints (admin-session auth). A "component" is a node in
 * the adjacency tree (organization | product | service | host).
 *   GET  /api/admin/components   list (active by default)
 *   POST /api/admin/components   define a component
 */



import type { APIRoute } from 'astro';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { COMPONENT_KIND_OPTIONS } from '@/lib/admin/resources';
import { componentAdminRow, monitorAdminCommand, monitorOwnerProjection, ownerError, ownerRequestID } from '@/lib/admin/monitor-owner';
const KINDS = COMPONENT_KIND_OPTIONS.map((o) => o.value);
export const GET: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    const archived = ctx.url.searchParams.get('archived') === 'true';
    {
        try {
            const projection = await monitorOwnerProjection(true);
            return ok(projection.components
                .map(({ component }) => component)
                .filter((component) => Boolean(component.archived) === archived)
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map(componentAdminRow));
        }
        catch (error) {
            const failure = ownerError(error);
            return err('owner_unavailable', failure.message, failure.status);
        }
    }
};
export const POST: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    const b = await ctx.request.json().catch(() => null);
    if (!b?.id || !b?.name || !b?.kind)
        return err('bad_request', 'id, name and kind are required.', 400);
    if (!/^[a-z0-9-]+$/.test(b.id))
        return err('bad_request', 'id must be lowercase letters, numbers and dashes.', 400);
    if (!KINDS.includes(b.kind))
        return err('bad_request', `kind must be one of: ${KINDS.join(', ')}.`, 400);
    {
        try {
            const projection = await monitorOwnerProjection(true);
            if (projection.components.some(({ component }) => component.id === b.id)) {
                return err('conflict', `component "${b.id}" already exists.`, 409);
            }
            if (b.parentId) {
                const parent = projection.components.find(({ component }) => component.id === b.parentId)?.component;
                if (!parent || parent.archived)
                    return err('bad_request', `Unknown parent component "${b.parentId}".`, 400);
            }
            await monitorAdminCommand({
                id: ownerRequestID('component-create', ctx.request, b.id),
                kind: 'upsert_component',
                component: {
                    id: b.id,
                    name: b.name,
                    kind: b.kind,
                    parent_id: b.parentId || '',
                    tag: b.tag || '',
                    brand: b.brand || '',
                    domain: b.domain || '',
                    sort_order: b.sortOrder != null ? Number(b.sortOrder) : 0,
                    fallback_status: 'operational',
                    critical: false,
                    launched: true,
                    launched_set: true,
                    archived: false,
                },
            });
            return ok({ id: b.id }, 201);
        }
        catch (error) {
            const failure = ownerError(error);
            return err('owner_rejected', failure.message, failure.status);
        }
    }
};
