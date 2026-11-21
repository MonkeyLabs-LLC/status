import { createHash, createHmac } from 'node:crypto';
const MONITOR_VERSION = 'monitor.v1';
const SUBSCRIBER_VERSION = 'bananapulse.subscribers/v1';
export const STATUS_ENDPOINTS = {
    monitorCommand: '/internal/monitor/commands',
    monitorAdminCommand: '/internal/monitor/admin/commands',
    monitorMigrationImport: '/internal/monitor/import',
    monitorIngestAuthenticated: '/internal/monitor/observations',
    monitorSweep: '/internal/monitor/sweep',
    monitorQuery: '/internal/monitor/query',
    monitorProjection: '/internal/monitor/projection',
    subscriberSubscribe: '/internal/subscribers/subscribe',
    subscriberConfirm: '/internal/subscribers/confirm',
    subscriberUnsubscribe: '/internal/subscribers/unsubscribe',
    subscriberProjection: '/internal/subscribers/projection',
    subscriberConfirmationResend: '/internal/subscribers/confirmation/resend',
    subscriberAdminList: '/internal/subscribers/admin/list',
    subscriberAdminGet: '/internal/subscribers/admin/get',
    subscriberAdminDelete: '/internal/subscribers/admin/delete',
    subscriberAdminStateSet: '/internal/subscribers/admin/state',
    subscriberMigrationImport: '/internal/subscribers/import',
    incidentPublish: '/internal/incidents/publish',
    maintenancePublish: '/internal/maintenance/publish',
    emailOutboxClaim: '/internal/deliveries/claim',
    emailReceiptApply: '/internal/deliveries/receipts',
} as const;
export type MonitorStatus = 'operational' | 'degraded' | 'outage';
export type MonitorSignal = 'ok' | 'degraded' | 'down';
export interface MonitorComponent {
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
    } | string>;
    sort_order?: number;
    fallback_status: MonitorStatus;
    critical: boolean;
    launched?: boolean;
    created_at_unix?: number;
    archived: boolean;
    archived_at_unix?: number;
    archive_batch_id?: string;
}
export interface MonitorEvaluation {
    component_id: string;
    status: MonitorStatus;
    state: string;
    level?: string;
    reads: Array<{
        source_id: string;
        source_name: string;
        weight: number;
        trusted: boolean;
        kind: string;
        signal: MonitorSignal;
        observed_at_unix: number;
        expires_at_unix?: number;
        stale: boolean;
    }> | null;
    non_ok_count: number;
    non_ok_weight: number;
    trusted_non_ok_count: number;
    stale_count: number;
    reduced_coverage: boolean;
    has_live_reads: boolean;
}
export interface MonitorProjection {
    version: typeof MONITOR_VERSION;
    revision: number;
    components: Array<{
        component: MonitorComponent;
        own_evaluation: MonitorEvaluation;
        evaluation: MonitorEvaluation;
    }>;
    sources: Array<{
        id: string;
        name: string;
        weight: number;
        kind: string;
        trusted: boolean;
        direct_targets?: boolean;
        default_ttl_seconds: number | null;
        created_at_unix?: number;
        revoked: boolean;
        revoked_at_unix?: number;
    }>;
    observations?: Array<{
        id: string;
        source_id: string;
        component_id: string;
        signal: MonitorSignal;
        detail?: string;
        observed_at_unix: number;
        observed_at_unix_micros?: number;
        expires_at_unix?: number;
        expires_at_unix_micros?: number;
    }>;
    mappings: Array<{
        id: string;
        source_id: string;
        raw_label: string;
        component_id: string;
    }>;
    incidents: Array<{
        id: string;
        title: string;
        summary: string;
        status: string;
        severity: string;
        affects: string[];
        auto: boolean;
        started_at_unix: number;
        started_at_unix_millis?: number;
        resolved_at_unix?: number;
        resolved_at_unix_millis?: number;
        created_at_unix?: number;
        created_at_unix_millis?: number;
    }> | null;
    incident_updates: Array<{
        id: string;
        incident_id: string;
        at_unix: number;
        at_unix_millis?: number;
        created_at_unix_millis?: number;
        label: string;
        body: string;
        author: string;
    }> | null;
    maintenance: Array<{
        id: string;
        title: string;
        summary: string;
        kind: string;
        scheduled_start_unix: number;
        scheduled_start_unix_millis?: number;
        scheduled_end_unix: number;
        scheduled_end_unix_millis?: number;
        affects: string[];
        created_at_unix?: number;
        created_at_unix_millis?: number;
        cancelled: boolean;
        cancelled_at_unix?: number;
    }>;
}
export interface MonitorCommand {
    version: typeof MONITOR_VERSION;
    id: string;
    kind: string;
    at_unix: number;
    at_unix_micros?: number;
    author?: string;
    note?: string;
    component?: MonitorComponent;
    component_id?: string;
    source?: MonitorProjection['sources'][number];
    source_id?: string;
    mapping?: MonitorProjection['mappings'][number];
    observation?: {
        id: string;
        source_id: string;
        component_id: string;
        signal: MonitorSignal;
        detail?: string;
        observed_at_unix: number;
        expires_at_unix?: number;
    };
    incident?: NonNullable<MonitorProjection['incidents']>[number];
    update?: NonNullable<MonitorProjection['incident_updates']>[number];
    maintenance?: MonitorProjection['maintenance'][number];
    maintenance_id?: string;
}
export interface MonitorCommandResult {
    version: typeof MONITOR_VERSION;
    command_id: string;
    revision: number;
    deduped: boolean;
}
export interface SubscriberCommandResult {
    version: typeof SUBSCRIBER_VERSION;
    subscriber_id?: string;
    created?: boolean;
    confirmed?: boolean;
    unsubscribed?: boolean;
    intent_count?: number;
}
export interface SubscriberAdminRow {
    id: string;
    email: string;
    state: 'pending' | 'confirmed' | 'unsubscribed';
    confirmedAt: string | null;
    createdAt: string;
}
export class StatusServiceError extends Error {
    constructor(message: string, readonly status: number, readonly detail = '') {
        super(message);
    }
}

export type StatusOwnerRouteFamily = 'monitor-admin' | 'ingest' | 'incidents' | 'maintenance' | 'sweep' | 'subscriber-admin' | 'auth';




function stableID(prefix: string, value: string): string {
    return `${prefix}_${createHash('sha256').update(value).digest('base64url')}`;
}
export function statusOwnerRequestID(prefix: string, value: string): string {
    return stableID(prefix, value);
}
export function subscriberOwnerIdentity(email: string) {
    const secret = process.env.STATUS_SUBSCRIBER_LINK_SECRET?.trim();
    if (!secret)
        throw new StatusServiceError('Subscriber link secret is not configured.', 503);
    const normalized = email.toLowerCase().trim();
    const token = (purpose: string) => createHmac('sha256', secret).update(`${purpose}\0${normalized}`).digest('base64url');
    return {
        requestId: stableID('subscribe', normalized),
        confirmationToken: token('confirmation'),
        unsubscribeToken: token('unsubscribe'),
    };
}
export function subscriberTokenRequestID(purpose: 'confirm' | 'unsubscribe', token: string): string {
    return stableID(purpose, token);
}
export async function postStatus<Request, Result>(path: string, request: Request): Promise<Result> {
    const origin = process.env.STATUS_API_URL?.trim();
    const token = process.env.STATUS_API_TOKEN?.trim();
    if (!origin || !token)
        throw new StatusServiceError('Native status owner configuration is incomplete.', 503);
    let response: Response;
    try {
        response = await fetch(new URL(path, origin), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(request ?? {}),
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
        });
    }
    catch {
        throw new StatusServiceError('Native status owner is unavailable.', 503);
    }
    const text = await response.text();
    if (!response.ok)
        throw new StatusServiceError('Native status owner rejected the request.', response.status, text.slice(0, 512));
    let result;
    try {
        result = JSON.parse(text);
    }
    catch {
        throw new StatusServiceError('Native status owner returned invalid JSON.', 502);
    }
    if (path.startsWith('/internal/monitor/') && result?.version !== MONITOR_VERSION) {
        throw new StatusServiceError('Invalid monitor service version.', 502);
    }
    return result as Result;
}
/** Capture one JS clock reading; explicit historical seconds remain exact. */
export function ownerClock(atUnix?: number): { at_unix: number; at_unix_micros?: number } {
    if (atUnix !== undefined) return { at_unix: atUnix };
    const nowMillis = Date.now();
    return { at_unix: Math.floor(nowMillis / 1000), at_unix_micros: nowMillis * 1000 };
}
export function getMonitorProjection(): Promise<MonitorProjection> {
    return postStatus(STATUS_ENDPOINTS.monitorProjection, ownerClock());
}
export function sendMonitorCommand(command: MonitorCommand): Promise<MonitorCommandResult> {
    return postStatus<MonitorCommand, MonitorCommandResult>(STATUS_ENDPOINTS.monitorCommand, command);
}
export function queryMonitor(componentId?: string, atUnix?: number): Promise<MonitorProjection> {
    return postStatus(STATUS_ENDPOINTS.monitorQuery, {
        version: MONITOR_VERSION,
        component_id: componentId ?? '',
        ...ownerClock(atUnix),
    });
}
async function callSubscriberOwner<Result>(event: string, request: Record<string, unknown>): Promise<Result> {
    const result = await postStatus<object, {
        version?: string;
    }>(event, { ...request, version: 'subscription-outbox/v1' });
    if (result?.version !== 'subscription-outbox/v1') {
        throw new StatusServiceError('Invalid subscriber owner version.', 502);
    }
    return { ...result, version: SUBSCRIBER_VERSION } as Result;
}
export function subscribeWithOwner(request: {
    request_id: string;
    email: string;
    confirmation_token: string;
    unsubscribe_token: string;
    confirmation_subject: string;
    confirmation_body: string;
    requested_at: string;
}): Promise<SubscriberCommandResult> {
    return callSubscriberOwner(STATUS_ENDPOINTS.subscriberSubscribe, {
        version: SUBSCRIBER_VERSION,
        ...request,
    });
}
export function confirmWithOwner(requestId: string, token: string): Promise<SubscriberCommandResult> {
    return callSubscriberOwner(STATUS_ENDPOINTS.subscriberConfirm, {
        version: SUBSCRIBER_VERSION,
        request_id: requestId,
        token,
    });
}
export function unsubscribeWithOwner(requestId: string, token: string): Promise<SubscriberCommandResult> {
    return callSubscriberOwner(STATUS_ENDPOINTS.subscriberUnsubscribe, {
        version: SUBSCRIBER_VERSION,
        request_id: requestId,
        token,
    });
}
export function listSubscribersWithOwner(): Promise<{
    version: string;
    subscribers: SubscriberAdminRow[];
}> {
    return callSubscriberOwner(STATUS_ENDPOINTS.subscriberAdminList, {
        version: SUBSCRIBER_VERSION,
    });
}
export function deleteSubscriberWithOwner(requestId: string, subscriberId: string): Promise<{
    version: string;
    found: boolean;
    changed: boolean;
    state?: string;
}> {
    return callSubscriberOwner(STATUS_ENDPOINTS.subscriberAdminDelete, {
        version: SUBSCRIBER_VERSION,
        request_id: requestId,
        subscriber_id: subscriberId,
    });
}
