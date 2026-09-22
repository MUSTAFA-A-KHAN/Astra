import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['build/three.module.js', 'three.module.js'],
  ['build/three.core.js', 'three.core.js'],
  ['examples/jsm/loaders/GLTFLoader.js', 'addons/loaders/GLTFLoader.js'],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'addons/utils/BufferGeometryUtils.js'],
  ['examples/jsm/utils/SkeletonUtils.js', 'addons/utils/SkeletonUtils.js'],
  ['LICENSE', 'LICENSE'],
];

// Ship precisely the rendering modules used by Astra; no runtime CDN dependency.
export async function prepareVendor() {
  for (const [source, destination] of files) {
    const target = resolve(root, 'vendor/three', destination);
    await mkdir(dirname(target), { recursive: true });
    await cp(resolve(root, 'node_modules/three', source), target);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareVendor();
