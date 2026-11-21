import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  postStatus,
  confirmWithOwner,
  getMonitorProjection,
  subscriberOwnerIdentity,
} from './status-client';

const base = 'http://status.internal:8788';
const token = 'fixture-status-owner';
const ownerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

beforeEach(() => {
  vi.stubEnv('STATUS_API_URL', base);
  vi.stubEnv('STATUS_API_TOKEN', token);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Native owner route selection', () => {
  it('fails before transport when API URL is missing', async () => {
    vi.stubEnv('STATUS_API_TOKEN', '');
    const fetchOwner = vi.fn();
    vi.stubGlobal('fetch', fetchOwner);
    await expect(getMonitorProjection()).rejects.toMatchObject({ status: 503 });
    expect(fetchOwner).not.toHaveBeenCalled();

    vi.stubEnv('STATUS_API_URL', base);
  });

  it('fails before transport when API credentials are missing', async () => {
    vi.stubEnv('STATUS_API_TOKEN', '');
    const fetchOwner = vi.fn();
    vi.stubGlobal('fetch', fetchOwner);

    await expect(confirmWithOwner('fixture', 'token')).rejects.toMatchObject({ status: 503 });
    expect(fetchOwner).not.toHaveBeenCalled();
  });
});

it('uses the credential contract for source rotation', async () => {
  const result = { version: 'credential-registry/v1', source_id: 'source-1', credential_id: 'key-2' };
  const fetchOwner = vi.fn(async () => Response.json(result));
  vi.stubGlobal('fetch', fetchOwner);

  const command = {
    version: 'credential-registry/v1',
    request_id: 'rotation-1',
    source_id: 'source-1',
    credential_id: 'key-2',
    token: 'new-key-fixture',
    rotated_at: '2026-11-14T18:00:00Z',
  };
  const event = '/internal/sources/rotate';
  expect(await postStatus(event, command)).toEqual({ ...result, version: 'credential-registry/v1' });
  expect(fetchOwner).toHaveBeenCalledExactlyOnceWith(
    new URL(event, base),
    expect.objectContaining({
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ ...command, version: 'credential-registry/v1' }),
      redirect: 'error',
    }),
  );
});

it.each(['create', 'revoke'])('routes source %s through the native lifecycle owner', async operation => {
  const version = 'bananapulse.host.source/v1';
  const command = { version, request_id: 'request-1' };
  const result = { ...command, source_id: 'source-1', credential_id: 'key-1', completed: true };
  const fetchOwner = vi.fn(async () => Response.json(result));
  vi.stubGlobal('fetch', fetchOwner);

  const event = `/internal/sources/${operation}`;
  expect(await postStatus(event, command)).toEqual(result);
  expect(fetchOwner).toHaveBeenCalledExactlyOnceWith(
    new URL(event, base),
    expect.objectContaining({ method: 'POST', headers: ownerHeaders, body: JSON.stringify(command) }),
  );
});

it('validates the native subscriber owner response', async () => {
  const owner = vi.fn()
    .mockResolvedValueOnce(Response.json({ version: 'subscription-outbox/v1', confirmed: true }))
    .mockResolvedValueOnce(Response.json({ version: 'unexpected', confirmed: true }));
  vi.stubGlobal('fetch', owner);

  await expect(confirmWithOwner('confirm-1', 'token-fixture')).resolves.toEqual({
    version: 'bananapulse.subscribers/v1',
    confirmed: true,
  });
  expect(owner).toHaveBeenCalledWith(
    new URL('/internal/subscribers/confirm', base),
    expect.objectContaining({
      headers: ownerHeaders,
      body: JSON.stringify({ version: 'subscription-outbox/v1', request_id: 'confirm-1', token: 'token-fixture' }),
    }),
  );
  await expect(confirmWithOwner('confirm-2', 'token-fixture')).rejects.toMatchObject({ status: 502 });
});

it('preserves monitor availability and contract errors', async () => {
  const monitor = vi.fn()
    .mockResolvedValueOnce(Response.json({ version: 'monitor.v1', revision: 3 }))
    .mockResolvedValueOnce(Response.json({ version: 'unexpected' }))
    .mockRejectedValueOnce(new Error('connection unavailable'));
  vi.stubGlobal('fetch', monitor);

  await expect(getMonitorProjection()).resolves.toEqual({ version: 'monitor.v1', revision: 3 });
  expect(monitor).toHaveBeenCalledWith(
    new URL('/internal/monitor/projection', base),
    expect.objectContaining({ body: expect.stringMatching(/\"at_unix_micros\":\d+/), headers: ownerHeaders }),
  );
  await expect(getMonitorProjection()).rejects.toMatchObject({ status: 502 });
  await expect(getMonitorProjection()).rejects.toMatchObject({ status: 503 });
});

it('requires the native signing secret for subscriber links', () => {
  vi.stubEnv('STATUS_SUBSCRIBER_LINK_SECRET', undefined);
  expect(() => subscriberOwnerIdentity('reader@example.test')).toThrow('Subscriber link secret is not configured.');

  vi.stubEnv('STATUS_SUBSCRIBER_LINK_SECRET', 'native-secret');
  const link = subscriberOwnerIdentity(' Reader@example.test ');
  expect(link).toEqual(subscriberOwnerIdentity('reader@example.test'));
  expect(link.confirmationToken).not.toBe(link.unsubscribeToken);
});

it.each(['incident', 'maintenance'])('commits %s publication through the native owners', async family => {
  const event = `/internal/${family === 'incident' ? 'incidents' : 'maintenance'}/publish`;
  const command = {
    monitor_request: { version: 'monitor.v1', id: 'publication-fixture', at_unix: 1234567890 },
    notification_request: { subject: 'supplied text' },
  };
  const result = { monitor: { version: 'monitor.v1', revision: 4 }, notification: {} };
  const fetchOwner = vi.fn(async () => Response.json(result));
  vi.stubGlobal('fetch', fetchOwner);
  await expect(postStatus(event, command)).resolves.toEqual(result);
  expect(fetchOwner).toHaveBeenCalledExactlyOnceWith(
    new URL(event, base),
    expect.objectContaining({ body: JSON.stringify(command), redirect: 'error' }),
  );
});

// A retired endpoint must never be treated as an acknowledged owner mutation.
it('surfaces canonical owner rejection without retrying a retired route', async () => {
  const owner = vi.fn(async (_url: URL) => new Response('not found', { status: 404 }));
  vi.stubGlobal('fetch', owner);
  await expect(confirmWithOwner('confirmation-replay', 'fixture-token')).rejects.toMatchObject({ status: 404 });
  expect(owner).toHaveBeenCalledTimes(1);
  expect(String(owner.mock.calls[0][0])).toBe(base + '/internal/subscribers/confirm');
});
