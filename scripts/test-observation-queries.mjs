// Real PostgreSQL parity checks, isolated from every production network.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/lib/quorum.ts', import.meta.url), 'utf8');
function queryAfter(marker) {
  const query = source.slice(source.indexOf(marker)).match(/\(sql`([\s\S]*?)`\)/)?.[1];
  assert.ok(query, `missing query: ${marker}`);
  return query.replaceAll('${observations}', 'observations')
    .replaceAll('${sources}', 'sources').replaceAll('${components}', 'components')
    .replaceAll('${componentId}', "'c1'");
}
const latest = queryAfter('export async function evaluateComponent(');
const observed = queryAfter('export async function derivedComponentStatuses(');
const container = execFileSync('docker', ['run', '--rm', '--detach', '--network', 'none',
  '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'], { encoding: 'utf8' }).trim();
try {
  for (let attempt = 0; ; attempt++) {
    try {
      execFileSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { stdio: 'pipe' });
      break;
    } catch {
      if (attempt === 59) throw new Error('test database did not start');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const sql = `
    CREATE TABLE sources(id text PRIMARY KEY,name text,weight int,kind text,trusted bool,revoked_at timestamptz);
    CREATE TABLE components(id text PRIMARY KEY);
    CREATE TABLE observations(source_id text,component_id text,signal text,detail text,observed_at timestamptz,expires_at timestamptz);
    CREATE INDEX latest ON observations(source_id,component_id,observed_at);
    CREATE INDEX by_component ON observations(component_id,observed_at);
    INSERT INTO components VALUES ('c1'),('c2'),('unobserved');
    INSERT INTO sources VALUES ('monitor','Monitor',1,'monitor',true,null),
      ('manual','Manual',1,'manual',true,null),('revoked','Revoked',1,'monitor',false,now()),
      ('empty','No observations',1,'monitor',false,null);
    INSERT INTO observations SELECT 'monitor','c1','ok',null,
      '2026-01-01'::timestamptz + n * interval '1 second',null FROM generate_series(1,50000) n;
    INSERT INTO observations VALUES
      ('monitor','c1','down','latest expired observation','2026-02-01','2026-02-02'),
      ('monitor','c2','ok','different component','2026-03-01',null),
      ('manual','c1','down','manual override','2026-03-01',null),
      ('revoked','c1','ok','revoked source','2026-03-01',null);
    ANALYZE sources;
    ANALYZE components;
    ANALYZE observations;
    DO $$ BEGIN
      IF EXISTS (
        WITH actual AS (${latest}), expected AS (
          SELECT DISTINCT ON(o.source_id) o.source_id,s.name,s.weight,s.kind,s.trusted,s.revoked_at,
            o.signal,o.detail,o.observed_at,o.expires_at
          FROM observations o JOIN sources s ON s.id=o.source_id
          WHERE o.component_id='c1' ORDER BY o.source_id,o.observed_at DESC
        ) SELECT * FROM ((SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
          UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) differences
      ) THEN RAISE EXCEPTION 'latest observation parity failed'; END IF;
      IF EXISTS (
        WITH actual AS (${observed}), expected AS (SELECT DISTINCT component_id FROM observations)
        SELECT * FROM ((SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
          UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) differences
      ) THEN RAISE EXCEPTION 'observed component parity failed'; END IF;
    END $$;
  `;
  execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
  for (const query of [latest, observed]) {
    const plan = JSON.parse(execFileSync('docker', ['exec', container, 'psql', '-X', '-U', 'postgres',
      '-At', '-c', `EXPLAIN (ANALYZE, FORMAT JSON) ${query}`], { encoding: 'utf8', timeout: 10000 }));
    let visited = 0;
    function walk(node) {
      if (node['Relation Name'] === 'observations') {
        assert.notEqual(node['Node Type'], 'Seq Scan', 'must not scan all observation history');
        visited += node['Actual Rows'] * node['Actual Loops'];
      }
      for (const child of node.Plans ?? []) walk(child);
    }
    walk(plan[0].Plan);
    assert.ok(visited <= 8, `expected indexed seeks, read ${visited} observation rows`);
  }
  console.log('PASS PostgreSQL parity: long history, latest expired row, manual/revoked sources, component isolation and unobserved components');
} finally {
  execFileSync('docker', ['rm', '--force', container], { stdio: 'pipe' });
}
