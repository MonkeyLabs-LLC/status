// Seed / re-sync the Banana Pulse component tree. This file IS the source of
// truth for the tree (pre-launch: no migrations — wipe + reseed on live).
//
// IDEMPOTENT: UPSERTs every node in T and prunes any component no longer in T.
// It deliberately does NOT touch `sources` or `source_target_map` (the
// operational ingest wiring: Evolution / Sessions Resolver / Grafana /
// UptimeRobot tokens + label maps) nor `observations` (live history), so
// re-running only reshapes the tree and never breaks the live data feeds.
//
// Hierarchy rule: a service node names the SERVICE; its provider(s) sit
// underneath it (Provisioner → Bananagine, Payments → Stripe, Email → Resend).
// A service can hold many providers.
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { ssl: (process.env.DATABASE_URL || '').includes('localhost') ? false : 'require' });

// New components start with NO uptime history (honest — real {date,status} days
// accrue from the ingest adapters). The renderer shows unrecorded days as "No data",
// never invented "ok". (Existing rows are untouched: the upsert below doesn't set
// uptime_90d on conflict.)
const allOk = JSON.stringify([]);

// [id, parent, name, kind, tag(display), status, sort, brand, domain]
const T = [
  ['monkeylabs', null,         'Monkey Labs', 'organization', 'company',     'ok', 0, null,         'status.monkeylabs.gg'],
  ['sessions',   'monkeylabs', 'Sessions.gg', 'product',      'product',     'ok', 0, 'sessions',   'status.sessions.gg'],
  ['bananalabs', 'monkeylabs', 'Banana Labs', 'product',      'open source', 'ok', 1, 'bananalabs', 'status.bananalabs.gg'],

  // ── Sessions.gg → Frontend + Backend ──
  // kind 'critical' = this node's OUTAGE takes its parent fully down (uncapped).
  // Everything else floors: its outage only DEGRADES the parent (the node itself
  // still shows its own real status). Edit `kind` in the seed to retune — no code.
  // Frontend + Backend are each critical to Sessions (either down ⇒ Sessions down).
  ['frontend', 'sessions', 'Frontend', 'critical', 'sessions.gg · cf pages',      'ok', 0, null, null],
  ['backend',  'sessions', 'Backend',  'critical', 'api.sessions.gg · evolution', 'ok', 1, null, null],

  // Machines = the physical hosts. Machine down ⇒ nothing plays (critical). Inside a
  // machine sits its Provisioner (Bananagine): host up but provisioner down ⇒ the
  // Provisioner node reads Major, but only DEGRADES upward (existing servers play on).
  ['machines',               'backend',                 'Machines',        'critical', 'physical hosts', 'ok', 0, null, null],
  ['machine-sessions-game-1','machines',                'sessions-game-1', 'critical', 'ovh host',       'ok', 0, null, null],
  ['provisioner',            'machine-sessions-game-1', 'Provisioner',     'service',  'bananagine',     'ok', 0, null, null],

  ['payments', 'backend', 'Payments', 'service',  'stripe', 'ok', 1, null, null],
  ['email',    'backend', 'Email',    'critical', 'resend', 'ok', 2, null, null],   // comms + sign-in ⇒ critical

  // Game Services → Minecraft → the upstream APIs (no Resolver-API wrapper).
  ['gameserver', 'backend',    'Game Services', 'service', 'apis', 'ok', 3, null, null],
  ['minecraft',  'gameserver', 'Minecraft',     'service', 'game', 'ok', 0, null, null],
  ['mc-dep-mojang',  'minecraft', 'Mojang',   'critical', 'auth · manifest · whitelist', 'ok', 0, null, null],
  ['mc-dep-paper',   'minecraft', 'Paper',    'critical', 'server + plugin api',         'ok', 1, null, null],
  ['mc-dep-geyser',  'minecraft', 'Geyser',   'critical', 'bedrock · version check',     'ok', 2, null, null],
  ['mc-dep-hangar',  'minecraft', 'Hangar',   'critical', 'plugin index (geyser)',       'ok', 3, null, null],
  ['mc-dep-modrinth','minecraft', 'Modrinth', 'service',  'mods · cdn',                  'ok', 4, null, null],
  ['mc-dep-fabric',  'minecraft', 'Fabric',   'service',  'modded',                      'ok', 5, null, null],

  // ── Banana Labs — just Bananadoro for now (the app on bananalabs.cloud) ──
  ['bananadoro', 'bananalabs', 'Bananadoro', 'service', 'bananadoro.bananalabs.cloud', 'ok', 0, null, null],
];

const ids = T.map((r) => r[0]);

// Vendor-label → component routing. Updates EXISTING source_target_map rows so
// the live ingest (Sessions Resolver dep-health, Grafana/UptimeRobot probes)
// follows the tree when nodes move. Does NOT create sources or touch tokens; a
// label/source that doesn't exist yet (e.g. fresh live wipe) is a 0-row no-op.
const REMAP = [
  // Resolver dep-health → grouped upstream-API nodes under the Resolver API.
  ['dep:mojang', 'mc-dep-mojang'], ['dep:mojang-cdn', 'mc-dep-mojang'], ['dep:mojang-profile', 'mc-dep-mojang'],
  ['dep:paper', 'mc-dep-paper'], ['dep:paper-api', 'mc-dep-paper'],
  ['dep:modrinth', 'mc-dep-modrinth'], ['dep:modrinth-cdn', 'mc-dep-modrinth'],
  ['dep:geyser', 'mc-dep-geyser'], ['dep:geyser-docs', 'mc-dep-geyser'], ['dep:geyser-github', 'mc-dep-geyser'], ['dep:geyser-uuid', 'mc-dep-geyser'],
  ['dep:fabric', 'mc-dep-fabric'], ['dep:hangar', 'mc-dep-hangar'],
  // Probes follow the new homes.
  ['integrations/blackbox/mc_java', 'minecraft'],
  ['integrations/blackbox/bananagine', 'provisioner'], // bananagine port probe = the provisioner's health
  // Site health → Frontend; API health → Backend.
  ['integrations/blackbox/sessions_site', 'frontend'],
  ['integrations/blackbox/api_sessions', 'backend'],
  ['803229639', 'frontend'], // UptimeRobot Storefront (sessions.gg)
  ['803229632', 'backend'],  // UptimeRobot API (api.sessions.gg)
];

await sql.begin(async (sql) => {
  // Upsert every node in the tree (parent-first ordering satisfies the FK).
  for (const [id, parent, name, kind, tag, status, sort, brand, domain] of T) {
    await sql`INSERT INTO components (id, parent_id, name, kind, tag, status, uptime_90d, sort_order, brand, domain)
      VALUES (${id}, ${parent}, ${name}, ${kind}, ${tag}, ${status}, ${allOk}::jsonb, ${sort}, ${brand}, ${domain})
      ON CONFLICT (id) DO UPDATE SET
        parent_id   = EXCLUDED.parent_id,
        name        = EXCLUDED.name,
        kind        = EXCLUDED.kind,
        tag         = EXCLUDED.tag,
        status      = EXCLUDED.status,
        sort_order  = EXCLUDED.sort_order,
        brand       = EXCLUDED.brand,
        domain      = EXCLUDED.domain`;
  }

  // Re-point ingest labels onto their (possibly moved) target components BEFORE
  // pruning, so stale nodes carry no mappings when deleted.
  for (const [label, comp] of REMAP) {
    await sql`UPDATE source_target_map SET component_id = ${comp} WHERE raw_label = ${label}`;
  }

  // Host-down vantage: the Grafana HostMetricsMissing alerts now declare a `target`
  // label (alerts.yaml) → map those to the host nodes. These are NEW mappings (not
  // re-points), so insert them on the Grafana source. host-down → machine node.
  const [graf] = await sql`SELECT id FROM sources WHERE name = ${'Grafana Cloud'}`;
  if (graf) {
    for (const [label, comp] of [['host-gameserver', 'machine-sessions-game-1'], ['host-vps', 'backend']]) {
      await sql`DELETE FROM source_target_map WHERE source_id = ${graf.id} AND raw_label = ${label}`;
      await sql`INSERT INTO source_target_map (id, source_id, raw_label, component_id)
        VALUES (${'stm-' + label}, ${graf.id}, ${label}, ${comp})`;
    }
  }

  // Prune components no longer in the tree (e.g. identity, bananaauth, old mc-java/mc-bedrock).
  const stale = await sql`SELECT id FROM components WHERE id NOT IN ${sql(ids)}`;
  if (stale.length) {
    const staleIds = stale.map((r) => r.id);
    await sql`DELETE FROM source_target_map WHERE component_id IN ${sql(staleIds)}`;
    await sql`DELETE FROM observations WHERE component_id IN ${sql(staleIds)}`;
    await sql`DELETE FROM components WHERE id IN ${sql(staleIds)}`;
    console.log('pruned stale components:', staleIds.join(', '));
  }

  // Drop the old demo incident so the live page reflects reality, not a mock.
  await sql`DELETE FROM incident_timeline WHERE incident_id = 'inc-prov-1'`;
  await sql`DELETE FROM incidents WHERE id = 'inc-prov-1'`;
});

console.log('\n=== TREE AFTER SEED ===');
const t = await sql`SELECT id, parent_id, name, tag, status FROM components ORDER BY parent_id NULLS FIRST, sort_order`;
for (const c of t) console.log(`${(c.parent_id || '(root)').padEnd(22)} -> ${c.id.padEnd(24)} | ${c.name}  [${c.tag}] (${c.status})`);
await sql.end();
