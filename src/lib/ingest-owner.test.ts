import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ingestWithNativeOwner } from './ingest-owner';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T10:00:00.456Z'));
  vi.stubEnv('STATUS_API_URL', 'http://owner.internal:8788');
  vi.stubEnv('STATUS_API_TOKEN', 'fixture-owner-token');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function capture() {
  const payloads: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, options: RequestInit) => {
    expect(url.pathname).toBe('/internal/monitor/observations');
    payloads.push(JSON.parse(options.body as string));
    return Response.json({ version: 'monitor.v1', deduped: false });
  }));
  return payloads;
}
const event = { namespace: 'grafana', sourceId: 'source', target: 'component', signal: 'down' as const, detail: 'detail', observedAt: new Date('2026-11-18T09:00:00.123Z'), ttlSeconds: 600 };
it('new arrivals reach owner refresh while retaining exact source-event identity', async () => {
  const rows = capture();
  await ingestWithNativeOwner(event);
  vi.setSystemTime(new Date('2026-11-18T10:00:10.789Z'));
  await ingestWithNativeOwner(event);
  expect(rows[0].id).not.toBe(rows[1].id);
  expect(rows[0].ingest.observation_id).toBe(rows[1].ingest.observation_id);
  expect(rows[0].ingest.observed_at_unix_micros).toBe(event.observedAt.getTime() * 1000);
  expect(rows[0].at_unix_micros).toBe(new Date('2026-11-18T10:00:00.456Z').getTime() * 1000);
  expect(rows[1].at_unix_micros).toBe(new Date('2026-11-18T10:00:10.789Z').getTime() * 1000);
  expect(rows[0].ingest.ttl_seconds).toBe(600);
  expect(rows[0].ingest).not.toHaveProperty('expires_at_unix');
  expect(rows[0].ingest).not.toHaveProperty('expires_at_unix_micros');
});
it('distinct milliseconds within one second and changed signals remain distinct events', async () => {
  const rows = capture();
  await ingestWithNativeOwner(event);
  await ingestWithNativeOwner({ ...event, observedAt: new Date(event.observedAt.getTime() + 1) });
  await ingestWithNativeOwner({ ...event, signal: 'ok' });
  expect(new Set(rows.map(row => row.ingest.observation_id)).size).toBe(3);
  expect(rows[0].ingest.observed_at_unix).toBe(rows[1].ingest.observed_at_unix);
  expect(rows[1].ingest.observed_at_unix_micros - rows[0].ingest.observed_at_unix_micros).toBe(1000);
});
it('actual explicit expiry stays distinct from TTL, including an already-stale valid date', async () => {
  const rows = capture();
  const expiresAt = new Date(event.observedAt.getTime() - 1000);
  await ingestWithNativeOwner({ ...event, expiresAt });
  expect(rows[0].ingest.expires_at_unix_micros).toBe(expiresAt.getTime() * 1000);
  expect(rows[0].ingest.ttl_seconds).toBe(600);
});
it('generic arrivals use one captured millisecond clock and leave source TTL policy to Go', async () => {
  const rows = capture();
  await ingestWithNativeOwner({ namespace: 'generic', sourceId: 'source', target: 'component', signal: 'ok', detail: null });
  expect(rows[0].ingest.observed_at_unix_micros).toBe(rows[0].at_unix_micros);
  expect(rows[0].ingest.observed_at_unix).toBe(rows[0].at_unix);
  expect(rows[0].ingest.detail).toBe('');
  expect(rows[0].ingest).not.toHaveProperty('ttl_seconds');
});
it('explicit zero TTL is preserved and invalid timestamps fail before dispatch', async () => {
  const rows = capture();
  await ingestWithNativeOwner({ ...event, ttlSeconds: 0 });
  expect(rows[0].ingest.ttl_seconds).toBe(0);
  expect(() => ingestWithNativeOwner({ ...event, observedAt: new Date('invalid') })).toThrow(TypeError);
  expect(rows).toHaveLength(1);
});
