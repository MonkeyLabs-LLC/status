import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { STATUS_PROFILE } from './status.profile';
import {
  COMPANY,
  COMPANY_LEGAL,
  FOOTER_DOMAINS,
  SCOPES,
  STATUS_DOMAIN,
  SUPPORT_EMAIL,
  THEME_STORAGE_KEY,
  rootComponentId,
  scopeBrand,
  scopeForHost,
} from './pulse.config';

const statusRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function source(path: string): string {
  return readFileSync(path, 'utf8');
}

test('profile projects the exact existing Status brand and scope behavior', () => {
  expect(STATUS_PROFILE.schemaVersion).toBe(1);
  expect(STATUS_PROFILE.application.httpSource).toBe('bananapulse-native');
  expect(STATUS_PROFILE.deployment).toMatchObject({
    site: 'https://status.monkeylabs.gg',
    defaultAdapter: 'netlify',
    supportedAdapters: ['netlify', 'node'],
    nodeScheduler: true,
    sessionsAlertHostAdapter: true,
  });
  expect(COMPANY).toBe('Monkey Labs');
  expect(COMPANY_LEGAL).toBe('© 2026 Monkey Labs LLC');
  expect(FOOTER_DOMAINS).toEqual(['monkeylabs.gg', 'sessions.gg', 'bananalabs.gg']);
  expect(SUPPORT_EMAIL).toBe('hello@monkeylabs.gg');
  expect(THEME_STORAGE_KEY).toBe('ml-status-theme');
  expect(STATUS_DOMAIN).toBe('status.monkeylabs.gg');
  expect(SCOPES.map((scope) => scope.id)).toEqual(['monkeylabs', 'sessions', 'bananalabs']);
  expect(scopeForHost('status.monkeylabs.gg')).toBeNull();
  expect(scopeForHost('status.sessions.gg:443')).toBe('sessions');
  expect(rootComponentId('bananalabs')).toBe('bananalabs');
  expect(scopeBrand('sessions')).toMatchObject({
    wordmark: 'Sessions',
    logo: '/brand/sessions.png',
  });
});

test('Status-specific deployment and host adapters remain at the compatibility edge', () => {
  expect(source(resolve(statusRoot, 'astro.config.mjs'))).toContain("process.env.STATUS_ADAPTER ?? 'netlify'");
  expect(source(resolve(statusRoot, 'astro.config.mjs'))).toContain("node({ mode: 'standalone' })");
  expect(source(resolve(statusRoot, 'src/middleware.ts'))).toContain('startScheduler();');
  expect(source(resolve(statusRoot, 'src/middleware.ts'))).toContain('validateSessionWithOwner(sessionId)');
  expect(source(resolve(statusRoot, 'src/middleware.ts'))).toContain(
    'legacy admin cookies require one re-login at cutover',
  );
  expect(source(resolve(statusRoot, 'src/lib/scheduler.ts'))).toContain(
    "(process.env.STATUS_ADAPTER ?? 'netlify') !== 'node'",
  );
  expect(source(resolve(statusRoot, 'src/pages/admin/maintenance/new.astro'))).toContain(
    'setSessionsSiteAlert({ active: true',
  );
  expect(source(resolve(statusRoot, 'src/pages/admin/maintenance/[id].astro'))).toContain(
    'setSessionsSiteAlert({ active: false',
  );
  expect(existsSync(resolve(statusRoot, 'netlify/functions/sweep-cron.mjs'))).toBe(true);
  expect(existsSync(resolve(statusRoot, 'netlify/functions/uptimerobot-poll.mjs'))).toBe(true);
  expect(existsSync(resolve(statusRoot, 'netlify/functions/status-probe.mjs'))).toBe(true);
});

test('the Status projections and owner client use the native service contract', () => {
  expect(source(resolve(statusRoot, 'src/pages/api/status.json.ts'))).toContain(
    'getMonitorProjection()',
  );
  const ownerClient = source(resolve(statusRoot, 'src/lib/status-client.ts'));
  expect(ownerClient).toContain('Authorization: `Bearer ${token}`');
});
