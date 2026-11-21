/**
 * HTTP client for the monitor owner.
 *
 * Route handlers translate the owner's snake_case JSON into admin response shapes.
 */

import { ownerClock, StatusServiceError, postStatus, statusOwnerRequestID } from '@/lib/status-client';
export const MONITOR_VERSION = 'monitor.v1';
export const MONITOR_ADMIN_EVENT = '/internal/monitor/admin/commands';
export const MONITOR_QUERY_EVENT = '/internal/monitor/query';
export const AUTH_SOURCE_IMPORT_EVENT = '/internal/auth/source-credentials/import';
export const AUTH_SOURCE_ROTATE_EVENT = '/internal/auth/source-credentials/rotate';
export const AUTH_SOURCE_REVOKE_EVENT = '/internal/auth/source-credentials/revoke';
export const HOST_SOURCE_ADMIN_CREATE_EVENT = '/internal/sources/create';
export const HOST_SOURCE_ADMIN_ROTATE_EVENT = '/internal/sources/rotate';
export const HOST_SOURCE_ADMIN_REVOKE_EVENT = '/internal/sources/revoke';
export const HOST_SOURCE_VERSION = 'bananapulse.host.source/v1';
export interface OwnerComponent {
    id: string;
    parent_id?: string;
    name: string;
    kind: string;
    tag?: string;
    brand?: string;
    domain?: string;
    uptime_90d?: Array<{
        date: string;
        status: string;
    }>;
    sort_order?: number;
    fallback_status?: 'operational' | 'degraded' | 'outage';
    critical?: boolean;
    launched?: boolean;
    created_at_unix?: number;
    created_at_unix_micros?: number;
    archived?: boolean;
    archived_at_unix?: number;
    archived_at_unix_micros?: number;
}
export interface OwnerSource {
    id: string;
    name: string;
    weight: number;
    kind: string;
    trusted: boolean;
    direct_targets?: boolean;
    default_ttl_seconds: number | null;
    created_at_unix?: number;
    created_at_unix_micros?: number;
    revoked: boolean;
    revoked_at_unix?: number;
    revoked_at_unix_micros?: number;
}
export interface OwnerMapping {
    id: string;
    source_id: string;
    raw_label: string;
    component_id: string;
}
export interface OwnerProjection {
    version: string;
    revision: number;
    components: Array<{
        component: OwnerComponent;
    }>;
    sources: OwnerSource[];
    mappings: OwnerMapping[];
    observations?: Array<{
        id: string;
        source_id: string;
        component_id: string;
        signal: string;
        detail?: string;
        observed_at_unix: number;
        observed_at_unix_micros?: number;
        expires_at_unix?: number;
        expires_at_unix_micros?: number;
    }>;
    incidents: Array<{
        id: string;
        status: string;
    }> | null;
}
export interface OwnerCommandResult {
    version: string;
    command_id: string;
    revision: number;
    deduped: boolean;
    component_ids?: string[];
    mapping_id?: string;
}

/** Source writes create/rotate a credential as well as monitor state. */

export function ownerRequestID(operation: string, request: Request, subject = ''): string {
    // A caller can make a retried mutation durable by supplying Idempotency-Key.
    // Existing clients have no such header, so each independently submitted form
    // gets a distinct command instead of accidentally deduping a later edit.
    const key = request.headers.get('Idempotency-Key')?.trim() || crypto.randomUUID();
    return statusOwnerRequestID(`bananapulse-${operation}`, `${subject}\0${key}`);
}
export async function monitorOwnerProjection(includeArchived = true, observationLimit?: number): Promise<OwnerProjection> {
    if (observationLimit !== undefined && (!Number.isInteger(observationLimit) || observationLimit < 1 || observationLimit > 100)) throw new RangeError('Observation limit must be from 1 to 100.');
    return postStatus(MONITOR_QUERY_EVENT, {
        version: MONITOR_VERSION,
        include_archived: includeArchived,
        ...(observationLimit !== undefined ? { include_observations: true, observation_limit: observationLimit } : {}),
        ...ownerClock(),
    });
}
export async function monitorAdminCommand(command: Record<string, unknown>): Promise<OwnerCommandResult> {
    return postStatus(MONITOR_ADMIN_EVENT, {
        version: MONITOR_VERSION,
        ...ownerClock(typeof command.at_unix === 'number' ? command.at_unix : undefined),
        ...command,
    });
}
export async function importSourceCredential(request: Record<string, unknown>) {
    return postStatus(AUTH_SOURCE_IMPORT_EVENT, {
        version: 'credential-registry/v1',
        ...request,
    });
}
export async function rotateSourceCredential(request: Record<string, unknown>) {
    return postStatus(HOST_SOURCE_ADMIN_ROTATE_EVENT, {
        version: 'credential-registry/v1',
        ...request,
    });
}
export async function revokeSourceCredential(request: Record<string, unknown>) {
    return postStatus(AUTH_SOURCE_REVOKE_EVENT, {
        version: 'credential-registry/v1',
        ...request,
    });
}
export async function createSourceWithOwnerSaga(request: Record<string, unknown>) {
    return postStatus(HOST_SOURCE_ADMIN_CREATE_EVENT, {
        version: HOST_SOURCE_VERSION,
        ...request,
    });
}
export async function revokeSourceWithOwnerSaga(request: Record<string, unknown>) {
    return postStatus(HOST_SOURCE_ADMIN_REVOKE_EVENT, {
        version: HOST_SOURCE_VERSION,
        ...request,
    });
}
function isoAt(unix?: number, micros?: number): string | null {
    if (micros !== undefined)
        return new Date(Math.floor(micros / 1000)).toISOString();
    return unix && unix > 0 ? new Date(unix * 1000).toISOString() : null;
}
function legacyStatus(status?: string): string {
    return status === 'operational' ? 'ok' : status ?? 'ok';
}
export function componentAdminRow(component: OwnerComponent) {
    return {
        id: component.id,
        parentId: component.parent_id || null,
        name: component.name,
        kind: component.kind,
        tag: component.tag || null,
        status: legacyStatus(component.fallback_status),
        uptime90d: component.uptime_90d ?? [],
        sortOrder: component.sort_order ?? 0,
        brand: component.brand || null,
        domain: component.domain || null,
        launched: component.launched ?? true,
        createdAt: isoAt(component.created_at_unix, component.created_at_unix_micros) ?? new Date(0).toISOString(),
        archivedAt: isoAt(component.archived_at_unix, component.archived_at_unix_micros),
    };
}
export function sourceAdminRow(source: OwnerSource) {
    return {
        id: source.id,
        name: source.name,
        weight: source.weight,
        kind: source.kind,
        trusted: source.trusted,
        defaultTtl: source.default_ttl_seconds,
        createdAt: isoAt(source.created_at_unix, source.created_at_unix_micros) ?? new Date(0).toISOString(),
        revokedAt: isoAt(source.revoked_at_unix, source.revoked_at_unix_micros),
    };
}
export function mappingAdminRow(mapping: OwnerMapping) {
    return {
        id: mapping.id,
        sourceId: mapping.source_id,
        rawLabel: mapping.raw_label,
        componentId: mapping.component_id,
    };
}
export function ownerError(error: unknown): {
    status: number;
    message: string;
} {
    if (!(error instanceof StatusServiceError)) {
        return { status: 502, message: 'Status service request failed.' };
    }
    let message = error.message;
    try {
        const detail = JSON.parse(error.detail) as {
            error?: string | {
                message?: string;
            };
        };
        if (typeof detail.error === 'string')
            message = detail.error;
        else if (detail.error?.message)
            message = detail.error.message;
    }
    catch {
    }
    return { status: error.status, message };
}
