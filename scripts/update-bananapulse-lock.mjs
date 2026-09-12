import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = 'BananaLabs-OSS/Bananapulse';
const api = `https://api.github.com/repos/${repository}`;

function validLock(lock) {
  return lock?.schemaVersion === 1
    && /^source-v\d+\.\d+\.\d+$/.test(lock.version)
    && /^[a-f0-9]{40}$/.test(lock.revision)
    && /^[a-f0-9]{64}$/.test(lock.sha256)
    && lock.url === `https://github.com/${repository}/releases/download/${lock.version}/bananapulse-source.tar.gz`;
}

async function json(url) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

const root = resolve(new URL('../', import.meta.url).pathname);
const fileIndex = process.argv.indexOf('--lock-file');
let next;
if (fileIndex >= 0) {
  if (!process.argv[fileIndex + 1]) throw new Error('missing --lock-file value');
  next = JSON.parse(readFileSync(resolve(process.argv[fileIndex + 1]), 'utf8'));
} else {
  const releases = await json(`${api}/releases?per_page=20`);
  const release = releases.find((candidate) => /^source-v\d+\.\d+\.\d+$/.test(candidate.tag_name));
  if (!release) throw new Error('no Bananapulse source release found');
  const asset = release.assets.find((candidate) => candidate.name === 'bananapulse.lock.json');
  if (!asset) throw new Error(`${release.tag_name} has no bananapulse.lock.json asset`);
  next = await json(asset.browser_download_url);
  if (next.version !== release.tag_name) throw new Error('release and lock versions differ');
}
if (!validLock(next)) throw new Error('invalid Bananapulse lock asset');

const lockPath = resolve(root, 'bananapulse.lock.json');
const current = JSON.parse(readFileSync(lockPath, 'utf8'));
if (current.revision === next.revision && current.sha256 === next.sha256) {
  console.log(`already pinned to ${next.version} (${next.revision.slice(0, 12)})`);
  process.exit(0);
}

writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`);
const dockerfilePath = resolve(root, 'Dockerfile');
const dockerfile = readFileSync(dockerfilePath, 'utf8');
const add = `ADD --checksum=sha256:${next.sha256} ${next.url} /tmp/bananapulse-source.tar.gz`;
const updated = dockerfile.replace(/^ADD --checksum=sha256:[a-f0-9]{64} https:\/\/github\.com\/BananaLabs-OSS\/Bananapulse\/releases\/download\/source-v\d+\.\d+\.\d+\/bananapulse-source\.tar\.gz \/tmp\/bananapulse-source\.tar\.gz$/m, add);
if (updated === dockerfile) throw new Error('Dockerfile artifact pin was not updated');
writeFileSync(dockerfilePath, updated);
console.log(`updated Bananapulse ${current.version} -> ${next.version}`);
