import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postStatus: vi.fn(),
  configured: vi.fn(),
  sweepQuorum: vi.fn(),
  snapshotAllOpenIncidents: vi.fn(),
  notifyForComponent: vi.fn(),
  BridgeError: class BridgeError extends Error {
    constructor(message: string, readonly status: number, readonly detail = '') { super(message); }
  },
}));

vi.mock('@/lib/status-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/status-client')>(),
  postStatus: mocks.postStatus,
  StatusServiceError: mocks.BridgeError,
  statusOwnerRouteFamilyConfigured: mocks.configured,
}));
vi.mock('@/lib/quorum', () => ({ sweepQuorum: mocks.sweepQuorum }));
vi.mock('@/lib/notify', () => ({
  snapshotAllOpenIncidents: mocks.snapshotAllOpenIncidents,
  notifyForComponent: mocks.notifyForComponent,
}));

import { POST } from './sweep';

function context(secret = 'timer-secret') {
  return {
    request: new Request('https://status.example/api/sweep', {
      method: 'POST', headers: { 'X-Uptime-Hook-Secret': secret },
    }),
  } as Parameters<typeof POST>[0];
}

describe('POST /api/sweep native owner authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.UPTIME_HOOK_SECRET = 'timer-secret';
  });

  it('uses the native sweep event and never runs the legacy notifier when gated', async () => {
    mocks.configured.mockReturnValue(true);
    mocks.postStatus.mockResolvedValue({
      sweep: { components: 4, declared: 1, watch: 2, reduced_coverage: 3 },
    });

    const response = await POST(context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { components: 4, declared: 1, watch: 2, reducedCoverage: 3 },
    });
    expect(mocks.postStatus).toHaveBeenCalledWith('/internal/monitor/sweep', expect.objectContaining({
      version: 'monitor.v1', kind: 'sweep_reconcile',
    }));
    expect(mocks.sweepQuorum).not.toHaveBeenCalled();
    expect(mocks.notifyForComponent).not.toHaveBeenCalled();
  });

  it('ignores retired optouts and always uses the native sweep', async () => {
    mocks.configured.mockReturnValue(false);
    mocks.postStatus.mockResolvedValue({sweep:{components:2,declared:1,watch:1,reduced_coverage:1}});
    const response = await POST(context());
    expect(response.status).toBe(200);
    expect(mocks.postStatus).toHaveBeenCalledOnce();
    expect(mocks.sweepQuorum).not.toHaveBeenCalled();
    expect(mocks.notifyForComponent).not.toHaveBeenCalled();
  });

  it('does not fall back after a failed owner sweep', async () => {
    mocks.configured.mockReturnValue(true);
    mocks.postStatus.mockRejectedValue(new mocks.BridgeError('failed', 503));

    const response = await POST(context());

    expect(response.status).toBe(503);
    expect(mocks.sweepQuorum).not.toHaveBeenCalled();
  });
});
