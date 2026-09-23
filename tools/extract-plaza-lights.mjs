// Rebuild the small runtime light-source list from the supplied plaza geometry:
//   node tools/extract-plaza-lights.mjs
// The atlas identifies actual torches, glowstone and lit lamps, not bright
// patches of the baked lightmap. No image decoding or browser is needed.
import * as THREE from 'three';
import { readFile, writeFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(() => ({
  name: 'plaza-source-texture-coordinates',
  loadTexture: () => Promise.resolve(Object.assign(new THREE.Texture(), { flipY: false })),
}));
const bytes = await readFile(new URL('../plaza-night-time/plaza-night.glb', import.meta.url));
const { scene } = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
scene.updateMatrixWorld(true);

const uv = new THREE.Vector2(), point = new THREE.Vector3(), faces = [];
const glowingTiles = new Set(['24,2', '3,1', '16,7']);
scene.traverse(mesh => {
  if (!mesh.isMesh || mesh.material.name !== 'opaque') return;
  const { position, uv: atlas } = mesh.geometry.attributes, index = mesh.geometry.index;
  mesh.material.map.updateMatrix();
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    uv.set((atlas.getX(a) + atlas.getX(b) + atlas.getX(c)) / 3, (atlas.getY(a) + atlas.getY(b) + atlas.getY(c)) / 3);
    mesh.material.map.transformUv(uv);
    // The 512px atlas uses 18px cells; glTF's embedded image is flipped from
    // the supplied PNG. Apply its quantized UV transform before reading it.
    const tile = `${Math.floor(uv.x * 512 / 18)},${Math.floor((1 - uv.y) * 512 / 18)}`;
    if (!glowingTiles.has(tile)) continue;
    point.set((position.getX(a) + position.getX(b) + position.getX(c)) / 3,
      (position.getY(a) + position.getY(b) + position.getY(c)) / 3,
      (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3).applyMatrix4(mesh.matrixWorld);
    if (tile === '24,2') point.y += .22; // flame, above the centre of the shaft
    faces.push(point.clone());
  }
});

// Multiple torch faces and torches around a single post share one source.
// The small 3D merge radius keeps lamps on different storeys separate.
const clusters = [];
for (const face of faces) {
  let cluster = clusters.find(value => value.centre.distanceToSquared(face) < 1.5 ** 2);
  if (!cluster) clusters.push(cluster = { centre: face.clone(), sum: new THREE.Vector3(), count: 0 });
  cluster.centre.copy(cluster.sum.add(face)).divideScalar(++cluster.count);
}
const sources = clusters.map(value => value.centre.toArray().map(n => +n.toFixed(3)))
  .sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
const rows = [];
for (let i = 0; i < sources.length; i += 5) rows.push('  ' + sources.slice(i, i + 5).map(value => JSON.stringify(value)).join(', ') + ',');
await writeFile(new URL('../plaza-light-sources.js', import.meta.url),
  '// Generated from plaza-night-time/plaza-night.glb by tools/extract-plaza-lights.mjs.\n' +
  '// Source-model coordinates, before PLAZA_TRANSFORM; one source per lamp cluster.\n' +
  'export const PLAZA_LIGHT_SOURCES = [\n' + rows.join('\n') + '\n];\n');
console.log(`Extracted ${sources.length} plaza lamps from ${faces.length} glowing faces.`);
