import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  postStatus: vi.fn(),
  statusOwnerRequestID: vi.fn((prefix: string) => `${prefix}-id`),
}));

vi.mock('@/lib/status-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/status-client')>('@/lib/status-client');
  return {
    ...actual,
    postStatus: bridge.postStatus,
    statusOwnerRequestID: bridge.statusOwnerRequestID,
  };
});

import {
  consumeMagicLinkWithOwner,
  createSessionWithOwner,
  destroySessionWithOwner,
  issueMagicLinkWithOwner,
  validateSessionWithOwner,
} from './admin-auth';

beforeEach(() => vi.clearAllMocks());

describe('Go authentication API contracts', () => {
  it('issues a 15-minute link and honors the anti-enumeration delivery decision', async () => {
    bridge.postStatus.mockResolvedValue({
      version: 'credential-registry/v1',
      accepted: true,
      deliver: false,
    });

    const issued = await issueMagicLinkWithOwner('admin@example.test');

    expect(issued.deliver).toBe(false);
    expect(issued.token).toMatch(/^[a-f0-9]{64}$/);
    expect(bridge.postStatus).toHaveBeenCalledWith(
      '/internal/auth/magic-links/issue',
      expect.objectContaining({
        version: 'credential-registry/v1',
        email: 'admin@example.test',
        token: issued.token,
      }),
    );
    const request = bridge.postStatus.mock.calls[0][1];
    expect(Date.parse(request.expires_at) - Date.parse(request.issued_at)).toBe(15 * 60 * 1000);
  });

  it('treats an invalid magic link as a normal unauthenticated result', async () => {
    bridge.postStatus.mockResolvedValue({
      version: 'credential-registry/v1',
      authenticated: false,
    });
    await expect(consumeMagicLinkWithOwner('opaque-link-token')).resolves.toBeNull();
    expect(bridge.postStatus).toHaveBeenCalledWith(
      '/internal/auth/magic-links/consume',
      expect.objectContaining({ token: 'opaque-link-token' }),
    );
  });

  it('creates a seven-day owner session while retaining the opaque cookie token locally', async () => {
    bridge.postStatus.mockResolvedValue({
      version: 'credential-registry/v1',
      session_id: 'session_owner_id',
      created: true,
    });

    const token = await createSessionWithOwner('challenge_1', 'identity_1');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const request = bridge.postStatus.mock.calls[0][1];
    expect(Date.parse(request.expires_at) - Date.parse(request.issued_at)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(request).toMatchObject({ challenge_id: 'challenge_1', identity_id: 'identity_1', token });
  });

  it('uses owner session validation and revocation events only', async () => {
    bridge.postStatus
      .mockResolvedValueOnce({ version: 'credential-registry/v1', valid: true, email: 'admin@example.test' })
      .mockResolvedValueOnce({ version: 'credential-registry/v1', revoked: true });

    await expect(validateSessionWithOwner('session-token')).resolves.toBe('admin@example.test');
    await expect(destroySessionWithOwner('session-token')).resolves.toBeUndefined();
    expect(bridge.postStatus.mock.calls.map((call) => call[0] as string)).toEqual([
      '/internal/auth/sessions/validate',
      '/internal/auth/sessions/revoke',
    ]);
  });
});
