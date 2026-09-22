import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, '_site');
if (!destination.startsWith(root + sep) || destination === root) throw new Error('Invalid build output');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

const runtimeExtensions = new Set(['.html', '.js', '.css', '.glb', '.svg', '.png', '.jpg', '.webp', '.ico']);
for (const entry of await readdir(root, { withFileTypes: true })) {
  if ((entry.isFile() && runtimeExtensions.has(extname(entry.name))) ||
      (entry.isDirectory() && ['assets', 'vendor'].includes(entry.name))) {
    await cp(resolve(root, entry.name), resolve(destination, entry.name), { recursive: true });
  }
}
await writeFile(resolve(destination, '.nojekyll'), '');
console.log('Static game packaged in _site/');
