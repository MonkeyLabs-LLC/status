/**
 * Translates incident HTTP payloads to the native monitor owner's contract.
 */
import {
  postStatus,
  ownerClock,
  STATUS_ENDPOINTS,
  StatusServiceError,
  statusOwnerRequestID,
} from '@/lib/status-client';

export const MONITOR_VERSION = 'monitor.v1';
const SUBSCRIBER_VERSION = 'bananapulse.subscribers/v1';
const MONITOR_INCIDENT_COMMANDS: Record<string, string> = {
  open: 'open_incident',
  edit: 'edit_incident',
  update: 'update_incident',
  resolve: 'resolve_incident',
  delete: 'delete_incident',
};

export type OwnerIncident = {
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
};

export type OwnerTimeline = {
  id: string;
  incident_id: string;
  at_unix: number;
  at_unix_millis?: number;
  created_at_unix_millis?: number;
  label: string;
  body: string;
  author: string;
};

type OwnerProjection = {
  incidents?: OwnerIncident[] | null;
  incident_updates?: OwnerTimeline[] | null;
};

export type OwnerCommand = Record<string, unknown> & {
  version: typeof MONITOR_VERSION;
  id: string;
  kind: string;
  at_unix: number;
  at_unix_micros?: number;
  author?: string;
  note?: string;
};

function iso(unix?: number, millis?: number): string | null {
  if (millis !== undefined) return new Date(millis).toISOString();
  return unix && unix > 0 ? new Date(unix * 1_000).toISOString() : null;
}

/** Convert the owner projection to the JSON emitted by the old Drizzle rows. */
export function legacyIncident(incident: OwnerIncident) {
  return {
    id: incident.id,
    title: incident.title,
    summary: incident.summary,
    status: incident.status,
    severity: incident.severity,
    affects: incident.affects,
    auto: incident.auto,
    startedAt: iso(incident.started_at_unix, incident.started_at_unix_millis),
    resolvedAt: iso(incident.resolved_at_unix, incident.resolved_at_unix_millis),
    createdAt: iso(incident.created_at_unix ?? incident.started_at_unix, incident.created_at_unix_millis),
  };
}

export function legacyTimeline(update: OwnerTimeline) {
  const at = iso(update.at_unix, update.at_unix_millis);
  return {
    id: update.id,
    incidentId: update.incident_id,
    at,
    label: update.label,
    body: update.body,
    author: update.author,
    createdAt: iso(undefined, update.created_at_unix_millis) ?? at,
  };
}

export async function incidentProjection(incidentId?: string): Promise<OwnerProjection> {
  return postStatus<unknown, OwnerProjection>(STATUS_ENDPOINTS.monitorQuery, {
    version: MONITOR_VERSION,
    incident_id: incidentId ?? '',
    ...ownerClock(),
  });
}

export async function ownerIncident(incidentId: string): Promise<{ incident: OwnerIncident; timeline: OwnerTimeline[] } | null> {
  // Query the projection and filter locally. Asking the cell for an absent id
  // is rightly a domain error, but the privacy-preserving bridge maps owner
  // errors and transport errors to the same HTTP class. This keeps "not found"
  // distinct from an unavailable owner, which must fail closed.
  const projection = await incidentProjection();
  const incident = projection.incidents?.find((candidate) => candidate.id === incidentId);
  if (!incident) return null;
  return {
    incident,
    timeline: (projection.incident_updates ?? []).filter((update) => update.incident_id === incidentId),
  };
}

export function newOwnerCommand(kind: string, identity: string, payload: Record<string, unknown> = {}): OwnerCommand {
  return {
    version: MONITOR_VERSION,
    id: statusOwnerRequestID(`incident-${kind}`, identity),
    kind: MONITOR_INCIDENT_COMMANDS[kind] ?? kind,
    ...ownerClock(typeof payload.at_unix === 'number' ? payload.at_unix : undefined),
    ...payload,
  };
}

export interface IncidentCommandResult { incident_id?: string; }
export function declaredIncidentID(result: IncidentCommandResult): string {
  if (!result.incident_id) throw new Error('Native owner did not return the declared incident identity.');
  return result.incident_id;
}
export function sendIncidentCommand(command: OwnerCommand): Promise<IncidentCommandResult> {
  return postStatus<OwnerCommand, IncidentCommandResult>(STATUS_ENDPOINTS.monitorAdminCommand, command);
}

/**
 * Commit monitor state first, then create durable subscriber intents through
 * the native service composition.  The request/event IDs are deterministic so a retry
 * cannot duplicate either the state command or an outbox intent.
 */
export function publishIncidentCommand(command: OwnerCommand, notification: {
  eventId: string;
  subject: string;
  body: string;
}): Promise<{ monitor: IncidentCommandResult }> {
  const statusBaseURL = process.env.PUBLIC_STATUS_URL?.trim().replace(/\/$/, '');
  return postStatus(STATUS_ENDPOINTS.incidentPublish, {
    monitor_request: command,
    notification_request: {
      version: SUBSCRIBER_VERSION,
      request_id: statusOwnerRequestID('incident-notification', notification.eventId),
      event_id: notification.eventId,
      subject: notification.subject,
      body: notification.body,
      // The subscriber owner validates this as an absolute URL. Leaving it
      // absent is valid for a local/preview composition; a relative fallback
      // would make an otherwise durable incident command fail after commit.
      ...(statusBaseURL ? { unsubscribe_base_url: `${statusBaseURL}/api/unsubscribe` } : {}),
      occurred_at: new Date(command.at_unix_micros !== undefined ? Math.floor(command.at_unix_micros / 1000) : command.at_unix * 1_000).toISOString(),
    },
  });
}

export function ownerFailure(error: unknown): Response {
  // Do not surface bridge or owner internals to the public API. A selected
  // owner path is authoritative: it is unavailable rather than falling back
  // to the legacy database.
  const message = error instanceof StatusServiceError && error.status === 503
    ? 'Incident owner is unavailable.'
    : 'Incident owner request failed.';
  return new Response(JSON.stringify({ error: { code: 'owner_unavailable', message } }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}
