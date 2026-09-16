import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const root = new URL('../', import.meta.url);
const lock = JSON.parse(readFileSync(new URL('bananapulse.lock.json', root), 'utf8'));
const dockerfile = readFileSync(new URL('Dockerfile', root), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('instance/manifest.json', root), 'utf8'));

describe('versioned Bananapulse composition', () => {
  test('pins an immutable source payload in the production build', () => {
    expect(lock).toMatchObject({
      schemaVersion: 1,
      version: expect.stringMatching(/^source-v\d+\.\d+\.\d+$/),
      revision: expect.stringMatching(/^[a-f0-9]{40}$/),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const releaseUrl = `https://github.com/BananaLabs-OSS/Bananapulse/releases/download/${lock.version}/bananapulse-source.tar.gz`;
    const commitUrl = `https://codeload.github.com/BananaLabs-OSS/Bananapulse/tar.gz/${lock.revision}`;
    expect([releaseUrl, commitUrl]).toContain(lock.url);
    expect(dockerfile).toContain(`ADD --checksum=sha256:${lock.sha256} ${lock.url}`);
  });

  test('keeps branding, adapters, and host integration in the instance seam', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.overlays).toContain('src/status.profile.ts');
    expect(manifest.overlays).toContain('src/styles/brand.css');
    expect(manifest.overlays).toContain('public/brand');
    expect(manifest.overlays).toContain('src/lib/sessions-alert.ts');
    expect(manifest.overlays).not.toContain('src/lib/components.ts');
    expect(manifest.overlays).not.toContain('src/pages/api/v1/incidents/owner.ts');
  });
});
