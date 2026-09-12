import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing --${name}`);
  return resolve(process.argv[index + 1]);
}

const engineRoot = argument('engine');
const instanceRoot = argument('instance');
const outputRoot = argument('output');
const manifestPath = resolve(instanceRoot, 'instance/manifest.json');

if (existsSync(outputRoot)) throw new Error(`output already exists: ${outputRoot}`);
const enginePackage = JSON.parse(readFileSync(resolve(engineRoot, 'package.json'), 'utf8'));
if (enginePackage.name !== 'bananapulse') throw new Error('engine is not Bananapulse');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.overlays)) {
  throw new Error('unsupported instance manifest');
}

cpSync(engineRoot, outputRoot, { recursive: true });
for (const entry of manifest.overlays) {
  if (typeof entry !== 'string' || !entry || isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) {
    throw new Error(`unsafe overlay path: ${String(entry)}`);
  }
  const source = resolve(instanceRoot, entry);
  const target = resolve(outputRoot, entry);
  if (relative(instanceRoot, source).split(sep).includes('..') || !existsSync(source)) {
    throw new Error(`missing overlay: ${entry}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: statSync(source).isDirectory(), force: true });
}

console.log(`composed Bananapulse with ${manifest.overlays.length} instance overlays`);
