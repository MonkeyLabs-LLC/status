import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const root = new URL('../', import.meta.url);
const dockerfile = readFileSync(new URL('Dockerfile', root), 'utf8');
const compose = readFileSync(new URL('deploy/status/docker-compose.yml', root), 'utf8');

describe('native Status packaging', () => {
  test('builds the checked-in Astro instance', () => {
    expect(dockerfile).toContain('COPY package.json package-lock.json ./');
    expect(dockerfile).toContain('COPY . .');
    expect(dockerfile).toContain('STATUS_ADAPTER=node npm run build');
    expect(dockerfile).not.toContain('STATUS_REQUIRE_NATIVE_OWNERS');
    expect(dockerfile).not.toContain('compose-bananapulse.mjs');
  });

  test('starts the native owners, retains their databases, and holds client delivery', () => {
    expect(compose).toContain('dockerfile: deployment/Dockerfile.status-native');
    expect(compose).toContain('STATUS_API_URL=${STATUS_API_URL:-http://owners:8788}');
    expect(compose).toContain('STATUS_API_TOKEN=${STATUS_API_TOKEN:?Set STATUS_API_TOKEN}');
    expect(compose).not.toContain('DATABASE_URL');
    expect(compose).not.toContain('STATUS_REQUIRE_NATIVE_OWNERS');
    expect(compose).toContain('STATUS_DELIVERY_ENABLED: "false"');
    expect(compose).toContain('RESEND_API_KEY=');
    expect(compose).toContain('STATUS_MONITOR_DB: /data/monitor.db');
    expect(compose).toContain('STATUS_SUBSCRIBER_DB: /data/subscribers.db');
    expect(compose).toContain('STATUS_AUTH_DB: /data/auth.db');
  });
});
