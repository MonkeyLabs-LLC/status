import { afterEach, expect, test, vi } from 'vitest';
import { sendConfirmationEmail, sendIncidentEmail, sendMagicLinkEmail } from './email';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test.each(['', 'false'])('holds all direct email when delivery is %j', async (enabled) => {
  vi.stubEnv('STATUS_DELIVERY_ENABLED', enabled);
  vi.stubEnv('RESEND_API_KEY', 'fixture-only-key');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);

  await expect(sendConfirmationEmail('fixture@example.test', 'https://status.example.test/confirm'))
    .rejects.toThrow('Status email delivery is disabled');
  await expect(sendMagicLinkEmail('fixture@example.test', 'https://status.example.test/login'))
    .rejects.toThrow('Status email delivery is disabled');
  await expect(sendIncidentEmail('fixture@example.test', 'Fixture', 'Fixture', '<p>Fixture</p>'))
    .rejects.toThrow('Status email delivery is disabled');
  expect(fetcher).not.toHaveBeenCalled();
});
