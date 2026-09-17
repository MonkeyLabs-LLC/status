import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Railway Pulp service packaging', () => {
  const root = process.cwd();
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.pulp'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'railway.pulp.json'), 'utf8'));

  it('uses immutable source inputs without repository credentials', () => {
    const remoteAdds = dockerfile.match(/^ADD --checksum=sha256:[a-f0-9]{64} https:\/\/codeload\.github\.com\/.+$/gm) ?? [];
    expect(remoteAdds).toHaveLength(9);
    expect(dockerfile).not.toMatch(/git clone|GITHUB_TOKEN|\.netrc/);
    expect(dockerfile).not.toContain('codeload.github.com/BananaLabs-OSS/Pulp-ext-oauth');
    expect(dockerfile).not.toContain('codeload.github.com/BananaLabs-OSS/Fiber');
  });

  it('runs the bridge privately with persistent state under /data', () => {
    expect(dockerfile).toContain('PULP_BRIDGE_ADDR=0.0.0.0:8788');
    expect(dockerfile).toContain('PULP_STORAGE_ROOT=/data');
    expect(dockerfile).toContain('chown -R bananapulse:bananapulse /data');
    expect(dockerfile).toContain('exec gosu bananapulse ./bananapulse-pulp-host');
    expect(config.build.dockerfilePath).toBe('Dockerfile.pulp');
    expect(config.deploy.healthcheckPath).toBe('/healthz');
  });
});
