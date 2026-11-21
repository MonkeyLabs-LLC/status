import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postStatus: vi.fn(),
  ownerConfigured: vi.fn(),
  resolveSourceByToken: vi.fn(),
  resolveTarget: vi.fn(),
  appendObservation: vi.fn(),
  snapshotComponent: vi.fn(),
  notifyForComponent: vi.fn(),
  BridgeError: class BridgeError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly detail = '',
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/status-client', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/status-client')>()),
  postStatus: mocks.postStatus,
  StatusServiceError: mocks.BridgeError,
  statusOwnerRequestID: (prefix: string) => `${prefix}_stable`,
  statusOwnerRouteFamilyConfigured: mocks.ownerConfigured,
}));
const legacySideEffectTrap0=vi.hoisted(() => ({
  resolveSourceByToken: mocks.resolveSourceByToken,
  resolveTarget: mocks.resolveTarget,
}));
vi.mock("../../lib/sources",()=>legacySideEffectTrap0);
vi.mock('../../lib/quorum', () => ({ appendObservation: mocks.appendObservation }));
vi.mock('../../lib/notify', () => ({
  snapshotComponent: mocks.snapshotComponent,
  notifyForComponent: mocks.notifyForComponent,
}));

import { POST } from './ingest';

function context(body: unknown, token = 'source-token') {
  return {
    request: new Request('https://status.example/api/ingest', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as Parameters<typeof POST>[0];
}

describe('POST /api/ingest native owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ownerConfigured.mockReturnValue(true);
  });

  it('validates the bearer token privately, then sends one native monitor command', async () => {
    mocks.postStatus
      .mockResolvedValueOnce({ valid: true, source_id: 'source-a' })
      .mockResolvedValueOnce({
        command_id: 'ingest-command',
        evaluation: {
          observation_id: 'observation-a', component_id: 'component-a', state: 'declared', level: 'major',
          non_ok: 2, sources: 3, reduced_coverage: false,
        },
      });

    const response = await POST(context({ target: 'payments', signal: 'down', detail: 'probe failed' }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      data: {
        observation_id: 'observation-a', component_id: 'component-a', state: 'declared', level: 'major',
        non_ok: 2, sources: 3, reduced_coverage: false,
      },
    });
    expect(mocks.postStatus).toHaveBeenNthCalledWith(1,
      '/internal/auth/source-credentials/validate', expect.objectContaining({ token: 'source-token' }));
    expect(mocks.postStatus).toHaveBeenNthCalledWith(2,
      '/internal/monitor/observations', expect.objectContaining({
        kind: 'ingest_observation',
        ingest: expect.objectContaining({ source_id: 'source-a', raw_label: 'payments', signal: 'down' }),
      }));
    expect(mocks.resolveSourceByToken).not.toHaveBeenCalled();
    expect(mocks.appendObservation).not.toHaveBeenCalled();
    expect(mocks.notifyForComponent).not.toHaveBeenCalled();
  });

  it('ignores retired owner optouts without activating the legacy backend', async () => {
    mocks.ownerConfigured.mockReturnValue(false);
    mocks.postStatus.mockResolvedValueOnce({valid:true,source_id:'source-a'}).mockResolvedValueOnce({evaluation:{state:'ok',level:null,non_ok:0,sources:1,reduced_coverage:false}});
    const response = await POST(context({target:'payments',signal:'ok'}));
    expect(response.status).toBe(202);
    expect(mocks.postStatus).toHaveBeenCalledTimes(2);
    expect(mocks.resolveSourceByToken).not.toHaveBeenCalled();
    expect(mocks.appendObservation).not.toHaveBeenCalled();
  });

  it('does not fall back after an attempted owner mutation', async () => {
    mocks.postStatus
      .mockResolvedValueOnce({ valid: true, source_id: 'source-a' })
      .mockRejectedValueOnce(new mocks.BridgeError('unmapped', 422, JSON.stringify({
        code: 'unmapped_target', error: 'source target is not mapped',
      })));

    const response = await POST(context({ target: 'payments', signal: 'down' }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'unmapped_target',
        message: 'No mapping for target "payments" on this source. Add a source_target_map row.',
      },
    });
    expect(mocks.resolveSourceByToken).not.toHaveBeenCalled();
    expect(mocks.appendObservation).not.toHaveBeenCalled();
  });
});
