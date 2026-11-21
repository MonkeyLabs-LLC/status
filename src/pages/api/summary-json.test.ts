import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUDIT REGRESSION (MASTER H1 / I3 fail-closed): summary.json powers the
// marketing "● Live now" badge. On a DB/derivation error — OR a null root
// (vanished/archived/wrong-scope tree, a data-integrity failure, NOT an "all
// clear") — it must emit status:'unknown' + live:false + tree:null with HTTP
// 503, never 'operational'+live:true.

const legacySideEffectTrap0=vi.hoisted(() => ({ buildSummaryTree: vi.fn() }));
vi.mock("../../lib/components",()=>legacySideEffectTrap0);
vi.mock('../../lib/status-client', () => ({
  statusMonitorProjectionConfigured: vi.fn(() => false),
  getMonitorProjection: vi.fn(),
}));
vi.mock('../../lib/monitor-projection', () => ({ buildMonitorSummaryTree: vi.fn() }));

const {buildSummaryTree}=legacySideEffectTrap0;
import { getMonitorProjection } from '../../lib/status-client';
import { buildMonitorSummaryTree } from '../../lib/monitor-projection';
import { GET } from './summary.json';

const mockTree = vi.mocked(buildMonitorSummaryTree);

function ctx(scope: string | null = null) {
  const url = new URL('http://s.local/api/summary.json' + (scope ? `?scope=${scope}` : ''));
  return { locals: { scope }, url } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getMonitorProjection).mockResolvedValue({version: "monitor.v1"} as any);
});

describe('GET /api/summary.json fail-closed (audit H1 regression)', () => {
  it('success path: 200 + live:true + the derived tree status', async () => {
    mockTree.mockReturnValue({ id: 'root', status: 'operational', children: [] } as any);
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.live).toBe(true);
    expect(body.status).toBe('operational');
    expect(body.tree).not.toBeNull();
  });

  it('REGRESSION: null root => 503 + unknown + live:false + tree:null (not an all-clear)', async () => {
    mockTree.mockReturnValue(null as any);
    const res = await GET(ctx('sessions'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unknown');
    expect(body.state).toBe('unknown');
    expect(body.live).toBe(false);
    expect(body.tree).toBeNull();
    expect(body.status).not.toBe('operational');
  });

  it('REGRESSION: derivation throwing => 503 + unknown + live:false', async () => {
    mockTree.mockImplementation(() => { throw new Error('owner projection invalid'); });
    const res = await GET(ctx());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unknown');
    expect(body.live).toBe(false);
  });

  it('propagates a degraded/outage root status on the success path', async () => {
    mockTree.mockReturnValue({ id: 'root', status: 'outage', children: [] } as any);
    const res = await GET(ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('outage');
    expect(body.live).toBe(true);
  });

  it('uses the composed owner projection without any backend optout', async () => {
    vi.mocked(getMonitorProjection).mockResolvedValue({ version: 'monitor.v1' } as any);
    vi.mocked(buildMonitorSummaryTree).mockReturnValue({
      id: 'root',
      name: 'Root',
      kind: 'organization',
      status: 'degraded',
      issueCount: 1,
      incidents: [],
      children: [],
    });
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('degraded');
    expect(buildSummaryTree).not.toHaveBeenCalled();
  });
});
