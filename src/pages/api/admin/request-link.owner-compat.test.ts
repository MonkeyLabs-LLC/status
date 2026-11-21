import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  createMagicLink: vi.fn(),
  issueMagicLinkWithOwner: vi.fn(),
}));
const bridge = vi.hoisted(() => ({ StatusServiceError: class extends Error { constructor(message:string,readonly status:number){super(message);} } }));
const email = vi.hoisted(() => ({ sendMagicLinkEmail: vi.fn() }));

vi.mock('@/lib/admin-auth', () => auth);
vi.mock('@/lib/status-client', () => bridge);
vi.mock('@/lib/email', () => email);

import { POST } from './request-link';

const originalAdminEmail = process.env.ADMIN_EMAIL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_EMAIL = 'admin@example.test';
});

afterEach(() => {
  if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = originalAdminEmail;
});

describe('admin request-link owner cutover', () => {
  it('keeps unknown owner identities indistinguishable and does not send email', async () => {
    auth.issueMagicLinkWithOwner.mockResolvedValue({ token: 'opaque', deliver: false });
    const response = await POST({
      request: new Request('https://status.example.test/api/admin/request-link', {
        method: 'POST', body: JSON.stringify({ email: 'admin@example.test' }),
      }),
      url: new URL('https://status.example.test/api/admin/request-link'),
    } as any);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { sent: true } });
    expect(email.sendMagicLinkEmail).not.toHaveBeenCalled();
    expect(auth.createMagicLink).not.toHaveBeenCalled();
  });

  it('uses the owner token and never falls back after an owner write', async () => {
    auth.issueMagicLinkWithOwner.mockResolvedValue({ token: 'owner-token', deliver: true });
    email.sendMagicLinkEmail.mockResolvedValue(undefined);
    const response = await POST({
      request: new Request('https://status.example.test/api/admin/request-link', {
        method: 'POST', body: JSON.stringify({ email: 'ADMIN@example.test' }),
      }),
      url: new URL('https://status.example.test/api/admin/request-link'),
    } as any);

    expect(response.status).toBe(200);
    expect(auth.createMagicLink).not.toHaveBeenCalled();
    expect(email.sendMagicLinkEmail).toHaveBeenCalledWith(
      'admin@example.test',
      'https://status.example.test/admin/verify?token=owner-token',
    );
  });

  it('fails closed when the selected owner cannot accept the command', async () => {
    auth.issueMagicLinkWithOwner.mockRejectedValue(new bridge.StatusServiceError('owner unavailable',503));
    const response = await POST({
      request: new Request('https://status.example.test/api/admin/request-link', {
        method: 'POST', body: JSON.stringify({ email: 'admin@example.test' }),
      }),
      url: new URL('https://status.example.test/api/admin/request-link'),
    } as any);

    expect(response.status).toBe(503);
    expect(auth.createMagicLink).not.toHaveBeenCalled();
    expect(email.sendMagicLinkEmail).not.toHaveBeenCalled();
  });
});
