import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUDIT REGRESSION (MASTER H1 / I3 fail-closed): status.json must NEVER
// synthesize 'operational' on a DB/derivation error. On any failure it emits
// status:'unknown' + live:false with HTTP 503, so badges/monitors treat us as
// unverifiable rather than green.
//
// We mock the data-layer modules status.json.ts imports so we can force the
// success path and the error path deterministically (no DB).

const legacySideEffectTrap0=vi.hoisted(() => ({
  getPublicLeafComponents: vi.fn(),
  buildSummaryTree: vi.fn(),
}));
vi.mock("../../lib/components",()=>legacySideEffectTrap0);
const legacySideEffectTrap1=vi.hoisted(() => ({ getActiveIncidents: vi.fn(async () => []) }));
vi.mock("../../lib/db-incidents",()=>legacySideEffectTrap1);
const legacySideEffectTrap2=vi.hoisted(() => ({ getUpcomingMaintenance: vi.fn(async () => []) }));
vi.mock("../../lib/db-maintenance",()=>legacySideEffectTrap2);
vi.mock('../../lib/status-client', () => ({
  statusMonitorProjectionConfigured: vi.fn(() => false),
  getMonitorProjection: vi.fn(),
}));
vi.mock('../../lib/monitor-projection', () => ({ buildMonitorStatusJSON: vi.fn() }));

const {getPublicLeafComponents}=legacySideEffectTrap0;
import { getMonitorProjection } from '../../lib/status-client';
import { buildMonitorStatusJSON } from '../../lib/monitor-projection';
import { GET } from './status.json';

const mockLeaves = vi.mocked(getPublicLeafComponents);
const mockTree = vi.mocked(buildMonitorStatusJSON);

function ctx() {
  return { locals: { scope: null }, url: new URL('http://s.local/api/status.json') } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getMonitorProjection).mockResolvedValue({version: "monitor.v1"} as any);
});

describe('GET /api/status.json fail-closed (audit H1 regression)', () => {
  it('success path: 200 with derived overall status', async () => {
    mockLeaves.mockResolvedValue([{ id: 'svc', name: 'Svc', product: 'p', status: 'operational' }] as any);
    mockTree.mockReturnValue({status:'operational',services:[{id:'svc'}]} as any);
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('operational');
    expect(body.services).toHaveLength(1);
  });

  it('REGRESSION: derivation throwing => 503 + status:unknown + live:false (never operational)', async () => {
    vi.mocked(getMonitorProjection).mockRejectedValue(new Error('owner down'));
    const res = await GET(ctx());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unknown');
    expect(body.state).toBe('unknown');
    expect(body.live).toBe(false);
    expect(body.status).not.toBe('operational');
    expect(body.services).toEqual([]);
  });

  it('REGRESSION: buildSummaryTree throwing also fails closed (503/unknown)', async () => {
    mockLeaves.mockResolvedValue([] as any);
    mockTree.mockImplementation(() => { throw new Error('projection invalid'); });
    const res = await GET(ctx());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unknown');
    expect(body.live).toBe(false);
  });

  it('REGRESSION: a missing scope root fails closed instead of treating an empty tree as operational', async () => {
    mockLeaves.mockResolvedValue([] as any);
    mockTree.mockImplementation(() => { throw new Error('missing scope root'); });
    const res = await GET(ctx());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unknown');
    expect(body.live).toBe(false);
  });

  it('uses the composed owner projection without any backend optout', async () => {
    vi.mocked(getMonitorProjection).mockResolvedValue({ version: 'monitor.v1' } as any);
    vi.mocked(buildMonitorStatusJSON).mockReturnValue({
      status: 'degraded',
      state: 'degraded',
      services: [],
      activeIncidents: [],
      scheduledMaintenance: [],
    });
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('degraded');
    expect(getPublicLeafComponents).not.toHaveBeenCalled();
  });
});
