import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVendor } from './vendor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, '_site');
if (!destination.startsWith(root + sep) || destination === root) throw new Error('Invalid build output');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await prepareVendor();

const runtimeExtensions = new Set(['.html', '.js', '.css', '.glb', '.svg', '.png', '.jpg', '.webp', '.ico']);
// The diorama, plaza and yard folders also hold the supplied model and its
// loose texture pages, which the game never fetches: ship the converted models alone.
const runtimeFiles = ['forest-loner-diorama/forest-loner-diorama.glb', 'plaza-night-time/plaza-night.glb', 'plaza-night-time/plaza-night-footprint.glb', 'plaza-night-time/plaza-navigation.json', 'map-79-void/skibidi-toilet-79.glb'];
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (['runtime-config.js', 'config.js'].includes(entry.name)) continue;
  if ((entry.isFile() && runtimeExtensions.has(extname(entry.name))) ||
      (entry.isDirectory() && ['assets', 'vendor', 'City_Set_-_Proto_Series'].includes(entry.name))) {
    await cp(resolve(root, entry.name), resolve(destination, entry.name), { recursive: true });
  }
}
for (const file of runtimeFiles) {
  await mkdir(dirname(resolve(destination, file)), { recursive: true });
  await cp(resolve(root, file), resolve(destination, file));
}
// A production artifact must never capture the developer's environment or tokens.
await writeFile(resolve(destination, 'config.js'), 'window.ASTRA_CONFIG = window.ASTRA_CONFIG || {};\n');
await writeFile(resolve(destination, '.nojekyll'), '');
console.log('Static game packaged in _site/');
