import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/admin-api', () => ({
  requireAdmin: vi.fn(async () => 'admin@example.test'),
  ok: vi.fn((data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status })),
  err: vi.fn((code: string, message: string, status: number) => new Response(JSON.stringify({ error: { code, message } }), { status })),
}));
const legacySideEffectTrap0=vi.hoisted(() => ({
  createSource: vi.fn(),
  listSources: vi.fn(),
  revokeSource: vi.fn(),
  mapTarget: vi.fn(),
  removeMapping: vi.fn(),
}));
vi.mock("@/lib/sources",()=>legacySideEffectTrap0);
const legacySideEffectTrap1=vi.hoisted(() => ({ componentExists: vi.fn() }));
vi.mock("@/lib/components",()=>legacySideEffectTrap1);
vi.mock('@/db', () => ({ db: { select: vi.fn() } }));
vi.mock('@/db/schema', () => ({ sourceTargetMap: {} }));
vi.mock('@/lib/api-tokens', () => ({ generateToken: vi.fn(() => 'plaintext-token'), hashToken: vi.fn() }));
vi.mock('nanoid', () => ({ nanoid: vi.fn()
  .mockReturnValueOnce('source-1')
  .mockReturnValueOnce('credential-1') }));
vi.mock('@/lib/admin/monitor-owner', () => ({
  sourceOwnerConfigured: vi.fn(() => true),
  monitorOwnerProjection: vi.fn(async () => ({ components: [], sources: [], mappings: [] })),
  sourceAdminRow: vi.fn((value) => value),
  monitorAdminCommand: vi.fn(async () => ({})),
  createSourceWithOwnerSaga: vi.fn(async () => ({})),
  revokeSourceWithOwnerSaga: vi.fn(async () => ({})),
  importSourceCredential: vi.fn(async () => ({})),
  revokeSourceCredential: vi.fn(async () => ({})),
  ownerRequestID: vi.fn((operation: string) => `${operation}-request`),
  ownerError: vi.fn(() => ({ status: 502, message: 'owner failed' })),
}));

const {createSource,listSources,mapTarget}=legacySideEffectTrap0;
const {componentExists}=legacySideEffectTrap1;
import {
  createSourceWithOwnerSaga,
  monitorAdminCommand,
  monitorOwnerProjection,
  revokeSourceWithOwnerSaga,
} from '@/lib/admin/monitor-owner';
import { GET, POST } from './index';
import { DELETE } from './[id]';
import { POST as mapSource } from './[id]/map';

beforeEach(() => vi.clearAllMocks());

describe('source owner HTTP compatibility', () => {
  it('reads the projection rather than legacy source SQL', async () => {
    const response = await GET({
      request: new Request('https://pulse.test/api/admin/sources'),
      url: new URL('https://pulse.test/api/admin/sources'), locals: {},
    } as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
    expect(listSources).not.toHaveBeenCalled();
  });

  it('creates monitor state and one-time credential through the durable host saga', async () => {
    const response = await POST({
      request: new Request('https://pulse.test/api/admin/sources', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'probe', kind: 'probe', defaultTtl: 60 }),
      }),
      url: new URL('https://pulse.test/api/admin/sources'), locals: {},
    } as any);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: 'source-1', token: 'plaintext-token', name: 'probe' } });
    expect(createSourceWithOwnerSaga).toHaveBeenCalledWith(expect.objectContaining({
      request_id: 'source-lifecycle-create-request',
      source: expect.objectContaining({ id: 'source-1', default_ttl_seconds: 60 }),
      credential_id: 'credential-1', token: 'plaintext-token', actor_id: 'admin@example.test',
    }));
    expect(monitorAdminCommand).not.toHaveBeenCalled();
    expect(createSource).not.toHaveBeenCalled();
  });

  it('revokes monitor state and private credentials through the durable host saga', async () => {
    vi.mocked(monitorOwnerProjection).mockResolvedValueOnce({
      components: [], sources: [{ id: 'source-1' }], mappings: [],
    } as any);
    const response = await DELETE({
      request: new Request('https://pulse.test/api/admin/sources/source-1', { method: 'DELETE' }),
      url: new URL('https://pulse.test/api/admin/sources/source-1'), params: { id: 'source-1' }, locals: {},
    } as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { revoked: true } });
    expect(revokeSourceWithOwnerSaga).toHaveBeenCalledWith(expect.objectContaining({
      request_id: 'source-lifecycle-revoke-request',
      source_id: 'source-1',
      actor_id: 'admin@example.test',
    }));
    expect(monitorAdminCommand).not.toHaveBeenCalled();
  });

  it('validates source mappings from owner projection without legacy component or mapping queries', async () => {
    vi.mocked(monitorOwnerProjection).mockResolvedValueOnce({
      components: [{ component: { id: 'api', kind: 'service', archived: false } }],
      sources: [{ id: 'source-1' }],
      mappings: [],
    } as any);

    const response = await mapSource({
      request: new Request('https://pulse.test/api/admin/sources/source-1/map', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawLabel: 'api-prod', componentId: 'api' }),
      }),
      url: new URL('https://pulse.test/api/admin/sources/source-1/map'),
      params: { id: 'source-1' }, locals: {},
    } as any);

    expect(response.status).toBe(201);
    expect(monitorAdminCommand).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'map_source_target',
      mapping: expect.objectContaining({
        source_id: 'source-1', raw_label: 'api-prod', component_id: 'api',
      }),
    }));
    expect(componentExists).not.toHaveBeenCalled();
    expect(mapTarget).not.toHaveBeenCalled();
  });
});
