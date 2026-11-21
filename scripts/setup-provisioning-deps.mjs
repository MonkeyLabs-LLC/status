/** Idempotent explicit setup against the Go Status API. Never runs during build. */
import { randomBytes, randomUUID } from 'node:crypto';
const SESSIONS_PRODUCT = 'sessions';
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
const GROUP_ID = `prov-deps-${GAME.id}`;
const leafId = key => `dep-${GAME.id}-${key}`;
async function post(path, body) {
  const origin = process.env.STATUS_API_URL;
  const token = process.env.STATUS_API_TOKEN;
  if (!origin || !token) throw new Error('STATUS_API_URL and STATUS_API_TOKEN are required');
  const response = await fetch(new URL(path, origin), {
    method: 'POST', headers: {'Content-Type':'application/json', Authorization:`Bearer ${token}`},
    body:JSON.stringify(body), redirect:'error', signal:AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Status API rejected setup (${response.status})`);
  return response.json();
}
async function main() {
  const state = await post('/internal/monitor/query', {version:'monitor.v1', include_archived:true});
  const components = new Map((state.components ?? []).map(row => [row.component.id, row.component]));
  if (!components.has(SESSIONS_PRODUCT)) throw new Error('Sessions root is missing; check the configured API');
  async function command(body) {
    const now = Date.now();
    return post('/internal/monitor/admin/commands', {version:'monitor.v1', id:randomUUID(), at_unix:Math.floor(now/1000), at_unix_micros:now*1000, ...body});
  }
  async function ensureComponent(component) {
    if (components.has(component.id)) return;
    await command({kind:'upsert_component', component:{fallback_status:'operational', critical:false, ...component}});
    components.set(component.id, component);
  }
  await ensureComponent({id:GROUP_ID,name:GAME.label,kind:'service',parent_id:SESSIONS_PRODUCT,sort_order:50,tag:'provisioning-deps'});
  for (const [sort_order,leaf] of GAME.leaves.entries()) await ensureComponent({id:leafId(leaf.key),name:leaf.name,kind:'service',parent_id:GROUP_ID,sort_order});
  let source = (state.sources ?? []).find(row => row.name === GAME.sourceName);
  if (!source) {
    const id = randomBytes(12).toString('hex');
    const token = randomBytes(32).toString('hex');
    source = {id,name:GAME.sourceName,kind:'push',weight:1,trusted:true,default_ttl_seconds:null};
    await post('/internal/sources/create', {version:'bananapulse.host.source/v1',request_id:randomUUID(),source,credential_id:randomUUID(),token,created_at:new Date().toISOString()});
    console.log(`STATUS_INGEST_TOKEN for ${GAME.label} (shown once): ${token}`);
  } else console.log('Source exists; its token is not retrieved or reshown.');
  for (const leaf of GAME.leaves) for (const raw_label of leaf.labels) {
    const existing = (state.mappings ?? []).find(row => row.source_id === source.id && row.raw_label === raw_label);
    await command({kind:'map_source_target',mapping:{id:existing?.id ?? randomBytes(12).toString('hex'),source_id:source.id,raw_label,component_id:leafId(leaf.key)}});
  }
  console.log('Dependency health components and mappings configured.');
}
main().catch(() => { console.error('Status dependency setup failed; check the API configuration and source state.'); process.exitCode=1; });
