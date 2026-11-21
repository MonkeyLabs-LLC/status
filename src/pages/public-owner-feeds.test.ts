import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacySideEffectTrap0=vi.hoisted(() => ({
  getAllIncidents: vi.fn(),
}));
vi.mock("../lib/db-incidents",()=>legacySideEffectTrap0);
vi.mock('../lib/status-client', () => ({
  getMonitorProjection: vi.fn(),
  statusMonitorProjectionConfigured: vi.fn(() => true),
}));
vi.mock('../lib/monitor-projection', () => ({
  buildMonitorIncidentHistory: vi.fn(),
}));

const {getAllIncidents}=legacySideEffectTrap0;
import { getMonitorProjection } from '../lib/status-client';
import { buildMonitorIncidentHistory } from '../lib/monitor-projection';
import { GET as getAtom } from './feed.atom';
import { GET as getJson } from './feed.json';
import { GET as getXml } from './feed.xml';

const incident = {
  id: 'incident-1',
  title: 'API <issue>',
  severity: 'major',
  status: 'monitoring',
  product: 'product',
  affects: ['api'],
  auto: true,
  started: '2027-01-15T08:00:00.000Z',
  timeline: [
    {
      status: 'monitoring',
      body: 'Latest update & recovery',
      timestamp: '2027-01-15T08:01:00.000Z',
    },
  ],
};

function context() {
  return { locals: { scope: null } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMonitorProjection).mockResolvedValue({ version: 'monitor.v1' } as any);
  vi.mocked(buildMonitorIncidentHistory).mockReturnValue({
    incidents: [incident] as any,
    total: 1,
  });
});

describe('public feeds use the native monitor owner projection', () => {
  it('preserves the Atom feed shape and escaping without touching legacy storage', async () => {
    const response = await getAtom(context());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/atom+xml');
    expect(body).toContain('<title>API &lt;issue&gt;</title>');
    expect(body).toContain('Latest update &amp; recovery');
    expect(getAllIncidents).not.toHaveBeenCalled();
  });

  it('preserves the JSON Feed 1.1 shape without touching legacy storage', async () => {
    const response = await getJson(context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe('https://jsonfeed.org/version/1.1');
    expect(body.items[0]).toMatchObject({
      title: 'API <issue>',
      content_text: 'Latest update & recovery',
      _status: {
        severity: 'major',
        status: 'monitoring',
        affects: ['api'],
        resolved: false,
      },
    });
    expect(getAllIncidents).not.toHaveBeenCalled();
  });

  it('preserves the XML alias feed without touching legacy storage', async () => {
    const response = await getXml(context());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('/feed.xml</id>');
    expect(body).toContain('<title>API &lt;issue&gt;</title>');
    expect(getAllIncidents).not.toHaveBeenCalled();
  });

  it.each([
    ['Atom', getAtom],
    ['JSON', getJson],
    ['XML', getXml],
  ])('fails closed when the %s owner read fails', async (_name, route) => {
    vi.mocked(getMonitorProjection).mockRejectedValueOnce(new Error('owner unavailable'));

    const response = await route(context());

    expect(response.status).toBe(503);
    expect(getAllIncidents).not.toHaveBeenCalled();
  });

  it('always reads native history without a legacy optout', async () => {
    vi.mocked(getAllIncidents).mockResolvedValue([incident] as any);

    const response = await getJson(context());

    expect(response.status).toBe(200);
    expect(getAllIncidents).not.toHaveBeenCalled();
    expect(getMonitorProjection).toHaveBeenCalledOnce();
  });
});
