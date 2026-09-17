import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
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
const configuredBananapulseRoot = process.env[STATUS_PROFILE.application.localRootEnvironmentKey];
// Engine-copy parity is an explicit artifact/update gate. Ordinary instance
// tests must not accidentally compare against whichever branch happens to be
// checked out in a sibling developer directory.
const bananapulseRoot = configuredBananapulseRoot
  ? resolve(statusRoot, configuredBananapulseRoot)
  : resolve(statusRoot, '.bananapulse-artifact-not-configured');

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

function filesUnder(root: string, directory: string): string[] {
  const start = resolve(root, directory);
  if (!existsSync(start)) return [];
  const files: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = resolve(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(normalizedRelative(root, full));
    }
  };
  walk(start);
  return files.sort();
}

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function digest(path: string): string {
  // Composition compares source semantics, not checkout-specific CRLF or
  // redundant blank lines at EOF.
  const normalized = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trimEnd() + '\n';
  return createHash('sha256').update(normalized).digest('hex');
}

test('profile projects the exact existing Status brand and scope behavior', () => {
  expect(STATUS_PROFILE.schemaVersion).toBe(1);
  expect(STATUS_PROFILE.application.httpSource).toBe('legacy-copy');
  expect(STATUS_PROFILE.application.legacyCompatibilityOverrides).toEqual([]);
  expect(STATUS_PROFILE.application.pendingEnginePaths).toEqual([]);
  expect(STATUS_PROFILE.application.bridge).toEqual({
    urlEnvironmentKey: 'PULP_BRIDGE_URL',
    tokenEnvironmentKey: 'PULP_BRIDGE_TOKEN',
    eventPath: '/internal/v1/events/',
  });
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

describe.runIf(existsSync(bananapulseRoot))('local Bananapulse composition compatibility', () => {
  test('targets the expected Pulp application and complete Lua event surface', () => {
    const manifest = source(resolve(bananapulseRoot, STATUS_PROFILE.application.manifest));
    expect(manifest).toMatch(/^name = "bananapulse"$/m);
    expect(manifest).toMatch(/^require_wasm_sha256 = true$/m);
    expect(manifest).toContain('lua-orchestrator.cell.toml');

    const lua = source(resolve(bananapulseRoot, 'application/bananapulse.lua'));
    for (const event of STATUS_PROFILE.application.events) {
      expect(lua, `missing Bananapulse event ${event}`).toContain(`"${event}"`);
    }
  });

  test('keeps the complete HTTP route surface with Pulp as the active owner', () => {
    const statusRoutes = filesUnder(statusRoot, 'src/pages')
      .filter((path) => !path.endsWith('.test.ts'))
      .map((path) => path.slice('src/pages/'.length));
    const bananapulseRoutes = filesUnder(bananapulseRoot, 'src/pages')
      .filter((path) => !path.endsWith('.test.ts'))
      .map((path) => path.slice('src/pages/'.length));
    expect(bananapulseRoutes).toEqual(statusRoutes);

    expect(source(resolve(statusRoot, 'src/pages/api/status.json.ts'))).toContain(
      'pulpMonitorProjectionConfigured',
    );
    expect(source(resolve(statusRoot, 'src/lib/pulp-bridge.ts'))).toContain(
      "STATUS_PROFILE.application.httpSource === 'bananapulse-pulp'",
    );
    expect(source(resolve(bananapulseRoot, 'src/pages/api/v1/summary.json.ts'))).toContain(
      'buildPulpSummaryTree',
    );
  });

  test('makes every remaining engine-copy difference explicit', () => {
    const allowed = new Set([
      ...STATUS_PROFILE.application.profileOwnedPaths,
      ...STATUS_PROFILE.application.legacyCompatibilityOverrides,
      ...STATUS_PROFILE.application.pendingEnginePaths,
    ]);
    const statusFiles = filesUnder(statusRoot, 'src');
    const bananapulseFiles = filesUnder(bananapulseRoot, 'src');
    const union = new Set([...statusFiles, ...bananapulseFiles]);
    const unexpected: string[] = [];

    for (const path of union) {
      if (allowed.has(path)) continue;
      const statusPath = resolve(statusRoot, path);
      const bananapulsePath = resolve(bananapulseRoot, path);
      if (!existsSync(statusPath) || !existsSync(bananapulsePath)) {
        unexpected.push(`${path}: missing from one side`);
        continue;
      }
      if (digest(statusPath) !== digest(bananapulsePath)) {
        unexpected.push(`${path}: source differs`);
      }
    }
    expect(unexpected).toEqual([]);
  });
});
