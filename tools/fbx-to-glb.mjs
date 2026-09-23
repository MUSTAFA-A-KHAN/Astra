// Converts a supplied FBX diorama and its loose texture folder into a single
// GLB, so the game keeps one loader and downloads a few megabytes instead of
// sixty. Runs the three.js FBX loader and glTF exporter inside headless
// Chromium, which has the image decoders and the canvas the exporter needs.
//
//   node tools/fbx-to-glb.mjs <source.fbx> <output.glb> [textures/]
//   MAX_TEXTURE=2048 INSPECT=1 node tools/fbx-to-glb.mjs …   (report only)
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [sourceArg, outputArg, textureArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: node tools/fbx-to-glb.mjs <source.fbx> <output.glb> [textures/]');
const source = resolve(root, sourceArg), output = resolve(root, outputArg);
const textures = resolve(root, textureArg || dirname(sourceArg));
const maxTextureSize = Number(process.env.MAX_TEXTURE || 1024);
const inspect = !!process.env.INSPECT;
const url = path => '/' + relative(root, path).split(sep).map(encodeURIComponent).join('/');

const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.fbx': 'application/octet-stream', '.wasm': 'application/wasm' };
const page = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// glTF has no separate alpha map: a cut-out reads its alpha from the base
// colour texture, so fold the supplied opacity mask into one RGBA image. Masks
// carry no detail worth a full-size page, so they are composed at half size.
function compose(map, mask, size = 512) {
  const source = map.image, width = Math.min(size, source.width), height = Math.min(size, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, width, height);
  const colour = context.getImageData(0, 0, width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(mask.image, 0, 0, width, height);
  const opacity = context.getImageData(0, 0, width, height);
  for (let i = 0; i < colour.data.length; i += 4) colour.data[i + 3] = opacity.data[i];
  context.putImageData(colour, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = map.name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = map.wrapS; texture.wrapT = map.wrapT;
  texture.repeat.copy(map.repeat); texture.offset.copy(map.offset);
  texture.flipY = map.flipY;
  texture.userData.mimeType = 'image/png';
  return texture;
}

// Pull one material's triangles out of a source mesh, already in world space.
function part(mesh, group) {
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const total = source.attributes.position.count;
  const start = Math.min(group.start, total), count = Math.min(group.count, total - start);
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array.slice(start * attribute.itemSize, (start + count) * attribute.itemSize), attribute.itemSize));
  }
  geometry.applyMatrix4(mesh.matrixWorld);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  return geometry;
}

window.convert = async ({ source, textures, maxTextureSize, inspect, supplied }) => {
  const report = { missing: [], renamed: [], sourceMeshes: 0, materials: [], batches: [] };
  const manager = new THREE.LoadingManager();
  manager.onError = asset => report.missing.push(asset.split('/').pop());
  // An asset pack's texture folder rarely matches the paths baked into the FBX
  // character for character; match on the stem instead of importing it untextured.
  const key = name => name.toLowerCase().replace(/[0-9]+/g, '').replace(/[^a-z]/g, '');
  const byKey = new Map(supplied.map(name => [key(name), name]));
  const lower = new Map(supplied.map(name => [name.toLowerCase(), name]));
  manager.setURLModifier(requested => {
    if (!requested.startsWith(textures)) return requested;
    const name = decodeURIComponent(requested.slice(textures.length));
    if (supplied.includes(name)) return requested;
    const match = lower.get(name.toLowerCase()) ?? byKey.get(key(name));
    if (!match) { report.missing.push(name); return requested; }
    report.renamed.push(name + ' -> ' + match);
    return textures + encodeURIComponent(match);
  });
  // The loader resolves as soon as the geometry is parsed, while its textures
  // are still decoding, and a texture with no pixels yet exports as untextured.
  // The manager keeps its counters private, so count the items here.
  let outstanding = 0, settled = null;
  const itemStart = manager.itemStart.bind(manager), itemEnd = manager.itemEnd.bind(manager);
  manager.itemStart = asset => { outstanding++; itemStart(asset); };
  manager.itemEnd = asset => { outstanding--; itemEnd(asset); if (outstanding <= 0 && settled) settled(); };
  const model = await new FBXLoader(manager).setResourcePath(textures).loadAsync(source);
  await new Promise(done => { settled = done; setTimeout(done, 120000); if (outstanding <= 0) done(); });
  model.updateMatrixWorld(true);

  const seen = new Set(), batches = new Map();
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    report.sourceMeshes++;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const vertices = mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count;
    const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: vertices, materialIndex: 0 }];
    for (const group of groups) {
      const material = list[group.materialIndex] ?? list[0];
      if (!material) continue;
      if (!seen.has(material.uuid)) {
        seen.add(material.uuid);
        const usable = texture => (texture?.image?.width ? texture : null);
        const colour = usable(material.map), mask = usable(material.alphaMap);
        const cutout = !!(mask || material.transparent);
        let map = colour;
        if (colour && mask) map = compose(colour, mask);
        else if (colour) {
          // The exporter writes every texture as a PNG unless told otherwise,
          // and an opaque colour page costs four times as much stored that way.
          colour.userData.mimeType = 'image/jpeg';
          colour.colorSpace = THREE.SRGBColorSpace;
        }
        // Cut-outs are alpha tested rather than blended: foliage sorted per
        // draw call flickers against itself once the batches are this large.
        material.userData.exported = new THREE.MeshStandardMaterial({
          name: material.name, map, color: material.color ?? 0xffffff, roughness: .88, metalness: 0,
          alphaTest: cutout ? .5 : 0, side: cutout ? THREE.DoubleSide : THREE.FrontSide,
        });
        report.materials.push({ name: material.name, from: material.type, textured: !!map, masked: !!(colour && mask), cutout });
      }
      if (!batches.has(material.name)) batches.set(material.name, { material: material.userData.exported, geometries: [] });
      batches.get(material.name).geometries.push(part(mesh, group));
    }
  });

  // One draw call per material instead of one per prop: the diorama is static
  // scenery, so its thousand nodes carry nothing worth keeping them apart for.
  const merged = new THREE.Group();
  merged.name = model.name || 'diorama';
  for (const [name, batch] of batches) {
    const geometry = batch.geometries.length === 1 ? batch.geometries[0] : mergeGeometries(batch.geometries, false);
    if (!geometry) { report.missing.push('unmergeable: ' + name); continue; }
    const mesh = new THREE.Mesh(geometry, batch.material);
    mesh.name = name;
    geometry.computeBoundingBox();
    const round = v => Math.round(v * 10) / 10;
    report.batches.push({ name, triangles: geometry.attributes.position.count / 3, min: geometry.boundingBox.min.toArray().map(round), max: geometry.boundingBox.max.toArray().map(round) });
    merged.add(mesh);
  }
  const box = new THREE.Box3().setFromObject(merged);
  report.bounds = { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
  report.triangles = report.batches.reduce((total, batch) => total + batch.triangles, 0);
  if (inspect) return { report, glb: [] };
  const glb = await new GLTFExporter().parseAsync(merged, { binary: true, maxTextureSize, onlyVisible: false });
  report.bytes = glb.byteLength;
  return { report, glb: [...new Uint8Array(glb)] };
};
window.ready = true;
</script>`;

// Maya's aiStandardSurface writes its colour and opacity maps under names the
// stock loader skips, which would import this diorama untextured. Teach the
// served copy those two relationships rather than fork the loader into vendor/.
const LOADER = '/node_modules/three/examples/jsm/loaders/FBXLoader.js';
const patches = [
  ["case 'Maya|TEX_color_map':", "case 'Maya|TEX_color_map':\n\t\t\t\tcase 'Maya|baseColor':"],
  ["case 'TransparentColor':", "case 'Maya|opacity':\n\t\t\t\tcase 'TransparentColor':"],
];
async function patchedLoader() {
  let text = await readFile(resolve(root, '.' + LOADER), 'utf8');
  for (const [from, to] of patches) {
    if (!text.includes(from)) throw new Error(`FBXLoader no longer contains ${from}; update tools/fbx-to-glb.mjs`);
    text = text.replace(from, to);
  }
  return text;
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') { response.writeHead(200, { 'Content-Type': mime['.html'] }).end(page); return; }
    if (pathname === LOADER) { response.writeHead(200, { 'Content-Type': mime['.js'] }).end(await patchedLoader()); return; }
    const file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep)) throw new Error('Forbidden');
    const info = await stat(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': info.size });
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(0, '127.0.0.1');
await new Promise(done => server.once('listening', done));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-swiftshader'] });
try {
  const tab = await browser.newPage();
  tab.on('pageerror', error => console.error('page error:', error.message));
  await tab.goto(origin, { waitUntil: 'load' });
  await tab.waitForFunction('window.ready === true', null, { timeout: 30000 });
  const { report, glb } = await tab.evaluate(args => window.convert(args), {
    source: origin + url(source), textures: origin + url(textures) + '/', maxTextureSize, inspect,
    supplied: await readdir(textures),
  });
  if (!inspect) await writeFile(output, Buffer.from(glb));
  console.log(JSON.stringify({ ...report, output: inspect ? null : relative(root, output) }, null, 1));
} finally { await browser.close(); server.close(); }
