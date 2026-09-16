import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('self-hosted status scheduler contract', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/scheduler.ts'), 'utf8');

  it('probes the customer-facing Sessions backend aggregate', () => {
    expect(source).toContain("https://api.sessions.gg/api/queue/status");
    expect(source).not.toContain("https://api.sessions.gg/health");
  });

  it('runs and ingests the independent functional probe on the node adapter', () => {
    expect(source).toContain('void runStatusProbe()');
    expect(source).toContain('/api/v1/ingest/status-probe?key=');
    expect(source).toContain('setInterval(() => void runStatusProbe(), STATUS_PROBE_INTERVAL_MS)');
  });
});
