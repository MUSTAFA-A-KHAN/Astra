// Build compact, layered collision surfaces from the complete supplied plaza.
// Run with: node tools/plaza-navigation.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const asset = new URL('../plaza-night-time/plaza-night.glb', import.meta.url);
const bytes = await readFile(asset), jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength));
const binary = bytes.subarray(28 + jsonLength);
// Collision extraction needs geometry only; keep it independent of browser image APIs.
json.images = []; json.textures = [];
json.materials = json.materials.map(material => ({ name: material.name }));
json.buffers = [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }];
globalThis.ProgressEvent ??= class ProgressEvent {};
const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json), '');
scene.updateMatrixWorld(true);
const planes = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
const CELLS = 2, snap = value => Math.round(value * 16) / 16;
let triangles = 0;
function raster(axis, plane, u0, v0, u1, v1, u2, v2) {
  const denominator = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
  if (Math.abs(denominator) < 1e-8) return;
  const key = `${axis}:${plane}`;
  let cells = planes.get(key);
  if (!cells) planes.set(key, cells = new Set());
  const minU = Math.floor(Math.min(u0, u1, u2) * CELLS), maxU = Math.ceil(Math.max(u0, u1, u2) * CELLS);
  const minV = Math.floor(Math.min(v0, v1, v2) * CELLS), maxV = Math.ceil(Math.max(v0, v1, v2) * CELLS);
  for (let v = minV; v < maxV; v++) for (let u = minU; u < maxU; u++) {
    const x = (u + .5) / CELLS, y = (v + .5) / CELLS;
    const s = ((v1 - v2) * (x - u2) + (u2 - u1) * (y - v2)) / denominator;
    const t = ((v2 - v0) * (x - u2) + (u0 - u2) * (y - v2)) / denominator;
    if (s >= -1e-5 && t >= -1e-5 && s + t <= 1.00001) cells.add(`${u},${v}`);
  }
}
scene.traverse(mesh => {
  if (!mesh.isMesh || mesh.material.name === 'plaque') return;
  const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
  for (let t = 0; t < (indices ? indices.count : positions.count); t += 3) {
    a.fromBufferAttribute(positions, indices ? indices.getX(t) : t).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(positions, indices ? indices.getX(t + 1) : t + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(positions, indices ? indices.getX(t + 2) : t + 2).applyMatrix4(mesh.matrixWorld);
    n.subVectors(b, a).cross(e.subVectors(c, a)).normalize(); triangles++;
    for (const p of [a, b, c]) p.set(snap(p.x), snap(p.y), snap(p.z));
    if (n.y > .99 && mesh.material.name === 'opaque') raster('floor', snap((a.y + b.y + c.y) / 3), a.x, a.z, b.x, b.z, c.x, c.z);
    else if (n.y < -.99 && mesh.material.name === 'opaque') raster('ceiling', snap((a.y + b.y + c.y) / 3), a.x, a.z, b.x, b.z, c.x, c.z);
    else if (Math.abs(n.x) > .99) raster('x', snap((a.x + b.x + c.x) / 3), a.z, a.y, b.z, b.y, c.z, c.y);
    else if (Math.abs(n.z) > .99) raster('z', snap((a.z + b.z + c.z) / 3), a.x, a.y, b.x, b.y, c.x, c.y);
  }
});
// Merge every coplanar surface independently, preserving rooms beneath roofs.
const floors = [], walls = [], ceilings = [];
for (const [key, cells] of planes) {
  const [axis, level] = key.split(':'), plane = Number(level);
  const ordered = [...cells].map(key => key.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [u, v] of ordered) {
    if (!cells.has(`${u},${v}`)) continue;
    let w = 1, h = 1;
    while (cells.has(`${u + w},${v}`)) w++;
    rows: for (;; h++) for (let x = 0; x < w; x++) if (!cells.has(`${u + x},${v + h}`)) break rows;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.delete(`${u + x},${v + y}`);
    const rect = [plane, u / CELLS, v / CELLS, (u + w) / CELLS, (v + h) / CELLS];
    if (axis === 'floor') floors.push(rect);
    else if (axis === 'ceiling') ceilings.push(rect);
    else walls.push([axis === 'x' ? 0 : 1, ...rect]);
  }
}
const output = { version: 1, sourceSha256: createHash('sha256').update(bytes).digest('hex'), cellsPerBlock: CELLS, floors, walls, ceilings };
await writeFile(new URL('../plaza-night-time/plaza-navigation.json', import.meta.url), JSON.stringify(output));
console.log(JSON.stringify({ triangles, floors: floors.length, walls: walls.length, ceilings: ceilings.length, bytes: JSON.stringify(output).length }));
