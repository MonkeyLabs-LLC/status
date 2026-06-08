/**
 * Idempotent setup for a game sidecar's dependency-health status surface.
 *
 * PER-GAME: each game gets its OWN group (tagged "provisioning-deps") under the
 * Sessions product, so the status page — and Evolution's banner — can state
 * exactly which game is struggling. Run once per game: edit the GAME block
 * below and re-run.
 *
 * Creates (if missing):
 *   - a "<Game>" group (tag provisioning-deps) under Sessions;
 *   - one consolidated leaf per upstream vendor (ids prefixed by game so two
 *     games sharing a vendor never collide);
 *   - a TRUSTED first-party source for the sidecar (mints the bearer token that
 *     goes in the sidecar's STATUS_INGEST_TOKEN);
 *   - source_target_map rows mapping each pushed `dep:<label>` to its leaf.
 *
 * Safe to re-run. The source token is only shown on first creation.
 *
 *   npx tsx --env-file=.env scripts/setup-provisioning-deps.ts
 */
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import * as schema from '../src/db/schema';

const { components, sources, sourceTargetMap } = schema;

const SESSIONS_PRODUCT = 'sessions'; // landing-root component id for the Sessions scope

// ── EDIT THIS BLOCK PER GAME, then re-run ───────────────────────────────────
const GAME = {
  id: 'minecraft',                 // url-safe; ids become dep-<id>-<leaf>, group prov-deps-<id>
  label: 'Minecraft',              // shown on the status page + named in the banner
  sourceName: 'Minecraft Resolver', // the sidecar's source row (mints its token)
  // One consolidated leaf per vendor; raw `dep:<label>` pushes fan in via the map.
  leaves: [
    { key: 'mojang',   name: 'Mojang',                      labels: ['dep:mojang', 'dep:mojang-cdn'] },
    { key: 'modrinth', name: 'Modrinth',                    labels: ['dep:modrinth', 'dep:modrinth-cdn'] },
    { key: 'paper',    name: 'PaperMC',                     labels: ['dep:paper', 'dep:paper-api'] },
    { key: 'geyser',   name: 'GeyserMC',                    labels: ['dep:geyser', 'dep:geyser-github', 'dep:geyser-docs'] },
    { key: 'hangar',   name: 'Hangar',                      labels: ['dep:hangar'] },
    { key: 'fabric',   name: 'Fabric',                      labels: ['dep:fabric'] },
    { key: 'identity', name: 'Player identity (whitelist)', labels: ['dep:mojang-profile', 'dep:geyser-uuid', 'dep:mcprofile'] },
  ],
};
// ────────────────────────────────────────────────────────────────────────────

const GROUP_ID = `prov-deps-${GAME.id}`;
const leafId = (key: string) => `dep-${GAME.id}-${key}`;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (the status-prod Crunchy connection string).');
  process.exit(1);
}
const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
const client = postgres(url, { idle_timeout: 20, max: 5, ssl: isLocal ? false : 'require' });
const db = drizzle(client, { schema });

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

async function componentExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: components.id }).from(components).where(eq(components.id, id));
  return rows.length > 0;
}

async function ensureComponent(c: { id: string; name: string; kind: string; parentId: string | null; sortOrder: number; tag?: string | null }) {
  if (await componentExists(c.id)) {
    console.log(`  · component ${c.id} exists`);
    return;
  }
  await db.insert(components).values({
    id: c.id, name: c.name, kind: c.kind, parentId: c.parentId,
    tag: c.tag ?? null, brand: null, domain: null, sortOrder: c.sortOrder, status: 'ok',
  });
  console.log(`  + created component ${c.id} (${c.name})`);
}

async function ensureSource(): Promise<string> {
  const existing = await db.select().from(sources).where(eq(sources.name, GAME.sourceName));
  if (existing[0]) {
    console.log(`  · source "${GAME.sourceName}" already exists (id ${existing[0].id}) — token NOT reshown; rotate via admin if lost`);
    return existing[0].id;
  }
  const id = randomBytes(12).toString('hex');
  const token = randomBytes(32).toString('hex');
  await db.insert(sources).values({
    id, name: GAME.sourceName, tokenHash: hashToken(token),
    kind: 'push', weight: 1, trusted: true, defaultTtl: null,
  });
  console.log(`  + created TRUSTED source "${GAME.sourceName}" (id ${id})`);
  console.log('\n  ┌─────────────────────────────────────────────────────────────');
  console.log(`  │ STATUS_INGEST_TOKEN for ${GAME.label} (set on its sidecar, shown ONCE):`);
  console.log(`  │   ${token}`);
  console.log('  └─────────────────────────────────────────────────────────────\n');
  return id;
}

async function ensureMapping(sourceId: string, rawLabel: string, componentId: string) {
  const existing = await db.select({ id: sourceTargetMap.id }).from(sourceTargetMap)
    .where(and(eq(sourceTargetMap.sourceId, sourceId), eq(sourceTargetMap.rawLabel, rawLabel)));
  if (existing[0]) {
    await db.update(sourceTargetMap).set({ componentId }).where(eq(sourceTargetMap.id, existing[0].id));
    console.log(`  · mapping ${rawLabel} → ${componentId} (updated)`);
    return;
  }
  await db.insert(sourceTargetMap).values({
    id: randomBytes(12).toString('hex'), sourceId, rawLabel, componentId,
  });
  console.log(`  + mapped ${rawLabel} → ${componentId}`);
}

async function main() {
  if (!(await componentExists(SESSIONS_PRODUCT))) {
    console.error(`Root product "${SESSIONS_PRODUCT}" not found — is this the right DB?`);
    process.exit(1);
  }

  console.log(`Setting up "${GAME.label}" (${GAME.id}):\nComponents:`);
  // Per-game group, tagged 'provisioning-deps' so it surfaces with that kind in
  // summary.json — Evolution's banner names the game from THIS node's status.
  await ensureComponent({ id: GROUP_ID, name: GAME.label, kind: 'service', parentId: SESSIONS_PRODUCT, sortOrder: 50, tag: 'provisioning-deps' });
  let i = 0;
  for (const leaf of GAME.leaves) {
    await ensureComponent({ id: leafId(leaf.key), name: leaf.name, kind: 'service', parentId: GROUP_ID, sortOrder: i++ });
  }

  console.log('\nSource:');
  const sourceId = await ensureSource();

  console.log('\nMappings:');
  for (const leaf of GAME.leaves) {
    for (const label of leaf.labels) {
      await ensureMapping(sourceId, label, leafId(leaf.key));
    }
  }

  console.log(`\nDone. Next: set on the ${GAME.label} sidecar and redeploy:`);
  console.log('  STATUS_INGEST_URL=https://status.monkeylabs.gg/api/v1/ingest');
  console.log('  STATUS_INGEST_TOKEN=<the token above>');
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
