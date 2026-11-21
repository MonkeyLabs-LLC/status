/**
 * POST /api/admin/sources/:id/map — add a raw_label → component mapping.
 * GET — list this source's mappings.
 * Uses lib/sources.ts mapTarget so vendor vocabulary only ever enters via the
 * source_target_map, as the engine expects.
 */



import type { APIRoute } from 'astro';
import { requireAdmin, ok, err } from '@/lib/admin-api';
import { nanoid } from 'nanoid';
import { mappingAdminRow, monitorAdminCommand, monitorOwnerProjection, ownerError, ownerRequestID } from '@/lib/admin/monitor-owner';
export const GET: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    {
        try {
            const projection = await monitorOwnerProjection(true);
            return ok(projection.mappings
                .filter((mapping) => mapping.source_id === ctx.params.id!)
                .map(mappingAdminRow));
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
    if (!b?.rawLabel || !b?.componentId)
        return err('bad_request', 'rawLabel and componentId are required.', 400);
    {
        try {
            const projection = await monitorOwnerProjection(true);
            const component = projection.components.find(({ component: value }) => value.id === b.componentId)?.component;
            if (!component || component.archived)
                return err('bad_request', `Unknown component "${b.componentId}".`, 400);
            const existing = projection.mappings.find((mapping) => mapping.source_id === ctx.params.id! && mapping.raw_label === b.rawLabel);
            const id = existing?.id ?? nanoid();
            await monitorAdminCommand({
                id: ownerRequestID('source-map', ctx.request, id),
                kind: 'map_source_target',
                mapping: {
                    id,
                    source_id: ctx.params.id!,
                    raw_label: b.rawLabel,
                    component_id: b.componentId,
                },
            });
            return ok({ id }, 201);
        }
        catch (error) {
            const failure = ownerError(error);
            return err('owner_rejected', failure.message, failure.status);
        }
    }
};
export const DELETE: APIRoute = async (ctx) => {
    const who = await requireAdmin(ctx);
    if (who instanceof Response)
        return who;
    const mapId = new URL(ctx.request.url).searchParams.get('mapId') ?? '';
    if (!mapId)
        return err('bad_request', 'mapId is required.', 400);
    {
        try {
            const projection = await monitorOwnerProjection(true);
            // Legacy delete is a successful no-op for a missing mapping.
            if (projection.mappings.some((mapping) => mapping.id === mapId)) {
                await monitorAdminCommand({
                    id: ownerRequestID('source-unmap', ctx.request, mapId),
                    kind: 'unmap_source_target',
                    mapping_id: mapId,
                });
            }
            return ok({ removed: mapId });
        }
        catch (error) {
            const failure = ownerError(error);
            return err('owner_rejected', failure.message, failure.status);
        }
    }
};
