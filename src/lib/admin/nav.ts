/**
 * Sidebar nav counts + property scope list for the admin shell.
 * Kept tiny and decoupled so the shell stays product-agnostic.
 */
import { COMPANY } from '@/pulse.config';
import { monitorOwnerProjection } from '@/lib/admin/monitor-owner';
export async function navCounts(): Promise<Record<string, number>> {
    {
        const projection = await monitorOwnerProjection(true);
        return {
            incidents: (projection.incidents ?? []).filter((incident) => incident.status !== 'resolved').length,
            components: (projection.components ?? []).filter(({ component }) => !component.archived).length,
            sources: (projection.sources ?? []).filter((source) => !source.revoked).length,
        };
    }
}
/** Property scope selector options — product nodes + root. */
export async function propertyOptions(): Promise<{
    value: string;
    label: string;
}[]> {
    {
        const projection = await monitorOwnerProjection(false);
        return [
            { value: 'all', label: `All â€” ${COMPANY} root` },
            ...(projection.components ?? []).map(({ component }) => component)
                .filter((c) => !c.archived && c.kind === 'product').map((c) => ({ value: c.id, label: c.name })),
        ];
    }
}
/** Static fallback used where an await is undesirable; resolved list preferred. */
export const PROPERTIES = [{ value: 'all', label: `All — ${COMPANY} root` }];
