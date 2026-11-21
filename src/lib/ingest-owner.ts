import { randomUUID } from 'node:crypto';
import { postStatus, ownerClock, statusOwnerRequestID, type MonitorSignal } from './status-client';

interface NativeIngestInput {
  namespace: string;
  sourceId: string;
  target: string;
  signal: MonitorSignal;
  detail: string | null;
  observedAt?: Date | null;
  expiresAt?: Date | null;
  ttlSeconds?: number | null;
  componentPatch?: Record<string, unknown>;
}

// Delivery identity and source-event identity have different jobs. A fresh
// arrival must reach the owner's reassertion/TTL logic; retrying this constructed
// command keeps its ID. Source events retain exact JavaScript millisecond time.
export function ingestWithNativeOwner<Result>(input: NativeIngestInput): Promise<Result> {
  const clock = ownerClock();
  const observed = input.observedAt?.getTime() ?? clock.at_unix_micros! / 1000;
  const expires = input.expiresAt?.getTime();
  if (!Number.isSafeInteger(observed) || (expires != null && !Number.isSafeInteger(expires))) {
    throw new TypeError('Observation timestamps must be valid JavaScript dates.');
  }
  if (input.ttlSeconds != null && (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 0)) {
    throw new TypeError('Observation TTL must be a nonnegative integer.');
  }
  const eventKey = `${input.sourceId}\0${input.target}\0${input.signal}\0${observed}`;
  return postStatus<Record<string, unknown>, Result>('/internal/monitor/observations', {
    version: 'monitor.v1',
    id: statusOwnerRequestID(`${input.namespace}-arrival`, randomUUID()),
    kind: 'ingest_observation',
    ...clock,
    ...(input.componentPatch ? { component_patch: input.componentPatch } : {}),
    ingest: {
      observation_id: statusOwnerRequestID('observation', eventKey),
      source_id: input.sourceId,
      raw_label: input.target,
      signal: input.signal,
      detail: input.detail ?? '',
      observed_at_unix: Math.floor(observed / 1000),
      observed_at_unix_micros: observed * 1000,
      ...(expires == null ? {} : { expires_at_unix: Math.floor(expires / 1000), expires_at_unix_micros: expires * 1000 }),
      ...(input.ttlSeconds == null ? {} : { ttl_seconds: input.ttlSeconds }),
    },
  });
}
