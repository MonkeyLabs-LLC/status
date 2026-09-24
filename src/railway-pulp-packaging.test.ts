import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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
    expect(config.build.dockerfilePath).toBe('/railway-pulp/Dockerfile');
    expect(config.deploy.healthcheckPath).toBe('/healthz');
    expect(config.deploy.healthcheckTimeout).toBe(120);
  });

  it.each(['Dockerfile.pulp', 'railway-pulp/Dockerfile'])('%s qualifies timeline IDs without corrupting other imports', (file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const expression = source.match(/sed -i "([^"]*incident_timeline\.id AS import_sort_key[^"]*)"/)?.[1];
    expect(expression).toBeDefined();
    const component = "SELECT tree.*, lpad(import_depth::text,10,'0') || ':' || id AS import_sort_key FROM tree";
    const observation = "to_char(observed_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISS.US') || ':' || id AS import_sort_key";
    const timeline = "to_char(at AT TIME ZONE 'UTC','YYYYMMDDHH24MISS.US') || ':' || id AS import_sort_key";
    const output = execFileSync('sed', [expression!], {
      input: [component, observation, timeline].join('\n'), encoding: 'utf8', timeout: 2000,
    }).split('\n');
    expect(output[0]).toBe(component);
    expect(output[1]).toBe(observation);
    expect(output[2]).toBe(timeline.replace('|| id AS', '|| incident_timeline.id AS'));
  });
});
