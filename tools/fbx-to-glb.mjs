// Converts a supplied FBX diorama and its loose texture folder into a single
// GLB, so the game keeps one loader and downloads a few megabytes instead of
// sixty. Runs the three.js FBX loader and glTF exporter inside headless
// Chromium, which has the image decoders and the canvas the exporter needs.
//
//   node tools/fbx-to-glb.mjs <source.fbx> <output.glb> [textures/] [materials.json]
//   MAX_TEXTURE=2048 INSPECT=1 node tools/fbx-to-glb.mjs …   (report only)
//   MESHOPT=1 node tools/fbx-to-glb.mjs …   (quantize and meshopt-compress)
//   CHUNK=32 node tools/fbx-to-glb.mjs …   (tile each batch every 32 source units)
//   FOOTPRINT=21 node tools/fbx-to-glb.mjs …   (also write <output>-footprint.glb)
//
// A footprint is what a game needs to walk the model before it has drawn it:
// every triangle, positions alone, that reaches below the given source height
// and does not face down. It is a fraction of the size of the whole model.
//
// A source too large to commit may be stored brotli-compressed (.fbx.br).
//
// Some exports name their materials but link no textures at all. A materials
// manifest supplies them, by material name, from the texture folder:
//   { "stone": { "map": "atlas.png", "normalMap": "atlas_n.jpg",
//                "emissiveMap": "bake.jpg", "emissiveChannel": 1,
//                "pixelated": true, "flat": true, "cutout": false, "blend": false } }
// A channel of 1 reads the source's second UV set, as a lightmap bake does.
// pixelated keeps texels crisp up close; flat drops the normals of a model
// made of planes; cutout alpha-tests the colour map's alpha, blend blends it.
import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { createBrotliDecompress } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [sourceArg, outputArg, textureArg, manifestArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: node tools/fbx-to-glb.mjs <source.fbx> <output.glb> [textures/] [materials.json]');
const source = resolve(root, sourceArg), output = resolve(root, outputArg);
const textures = resolve(root, textureArg || dirname(sourceArg));
const manifest = manifestArg ? JSON.parse(await readFile(resolve(root, manifestArg), 'utf8')) : {};
const maxTextureSize = Number(process.env.MAX_TEXTURE || 1024);
const inspect = !!process.env.INSPECT;
const meshopt = !!process.env.MESHOPT;
const chunk = Number(process.env.CHUNK || 0);
const url = path => '/' + relative(root, path).split(sep).map(encodeURIComponent).join('/');
const footprint = Number(process.env.FOOTPRINT || 0);
const outputs = { model: output, ...(footprint ? { footprint: output.replace(/\.glb$/i, '') + '-footprint.glb' } : {}) };
// The export can run to hundreds of megabytes before it is packed: the page
// posts it back here rather than returning it through the DevTools protocol.
const exported = Object.fromEntries(Object.entries(outputs).map(([kind, path]) => [kind, meshopt ? path + '.unpacked.glb' : path]));

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
// The second UV set comes along only for a material that reads it: batches
// merge, and every geometry in a batch has to carry the same attributes. A
// flat material drops its normals: every face of it is a plane, and a glTF
// mesh without them is shaded flat by the loader, at no cost in the download.
function part(mesh, group, { lightmapped = false, flat = false } = {}) {
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const total = source.attributes.position.count;
  const start = Math.min(group.start, total), count = Math.min(group.count, total - start);
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', ...(flat ? [] : ['normal']), 'uv', ...(lightmapped ? ['uv1'] : [])]) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array.slice(start * attribute.itemSize, (start + count) * attribute.itemSize), attribute.itemSize));
  }
  geometry.applyMatrix4(mesh.matrixWorld);
  if (!flat && !geometry.getAttribute('normal')) geometry.computeVertexNormals();
  for (const name of ['uv', ...(lightmapped ? ['uv1'] : [])])
    if (!geometry.getAttribute(name)) geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  return geometry;
}

// Cut a batch into square tiles across the ground, by where each triangle's
// centre falls, so the renderer can skip the tiles out of view. A small batch
// stays whole: skipping part of it saves less than the extra draw calls cost.
function tiles(geometry, size) {
  if (!size || geometry.attributes.position.count / 3 < 50000) return [geometry];
  const position = geometry.attributes.position, cells = new Map();
  for (let t = 0; t < position.count; t += 3) {
    const x = (position.getX(t) + position.getX(t + 1) + position.getX(t + 2)) / 3;
    const z = (position.getZ(t) + position.getZ(t + 1) + position.getZ(t + 2)) / 3;
    const key = Math.floor(x / size) + ',' + Math.floor(z / size);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(t);
  }
  return [...cells.values()].map(triangles => {
    const tile = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const width = attribute.itemSize * 3, array = new Float32Array(triangles.length * width);
      triangles.forEach((t, i) => array.set(attribute.array.subarray(t * attribute.itemSize, t * attribute.itemSize + width), i * width));
      tile.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
    }
    return tile;
  });
}

window.convert = async ({ source, textures, maxTextureSize, inspect, supplied, manifest, upload, chunk, footprint }) => {
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

  // Textures the manifest names, one texture per file however many materials
  // share it. Each keeps its supplied format: a PNG is usually one for its alpha.
  const loaded = new Map();
  async function supply(name, { colour = true, channel = 0, pixelated = false } = {}) {
    if (!name) return null;
    const key = [name, channel, pixelated].join('|');
    if (!loaded.has(key)) loaded.set(key, new THREE.TextureLoader(manager).loadAsync(textures + encodeURIComponent(name)).then(texture => {
      texture.name = name.replace(/\\.[^.]+$/, '');
      texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.channel = channel;
      texture.userData.mimeType = /\\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
      // Pixel art stays crisp up close; it still mips with distance.
      if (pixelated) { texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestMipmapLinearFilter; }
      return texture;
    }));
    return loaded.get(key);
  }
  const assigned = {};
  for (const [name, entry] of Object.entries(manifest)) {
    const pixelated = !!entry.pixelated;
    assigned[name] = {
      map: await supply(entry.map, { pixelated }),
      normalMap: await supply(entry.normalMap, { colour: false, pixelated }),
      emissiveMap: await supply(entry.emissiveMap, { channel: entry.emissiveChannel ?? 0 }),
    };
  }

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
      const entry = manifest[material.name];
      if (!seen.has(material.uuid) && entry) {
        seen.add(material.uuid);
        const { map, normalMap, emissiveMap } = assigned[material.name];
        material.userData.exported = new THREE.MeshStandardMaterial({
          name: material.name, map, normalMap, emissiveMap, color: 0xffffff, roughness: .88, metalness: 0,
          emissive: emissiveMap ? 0xffffff : 0x000000,
          alphaTest: entry.cutout ? .5 : 0, transparent: !!entry.blend, depthWrite: !entry.blend,
          side: entry.cutout || entry.blend ? THREE.DoubleSide : THREE.FrontSide,
        });
        material.userData.lightmapped = [map, normalMap, emissiveMap].some(texture => texture?.channel === 1);
        material.userData.flat = !!entry.flat;
        report.materials.push({ name: material.name, from: 'manifest', textured: !!map, emissive: !!emissiveMap, normal: !!normalMap, lightmapped: material.userData.lightmapped, flat: !!entry.flat, cutout: !!entry.cutout, blend: !!entry.blend });
      }
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
      batches.get(material.name).geometries.push(part(mesh, group, material.userData));
    }
  });

  // One draw call per material instead of one per prop — or per tile of it,
  // given CHUNK: the diorama is static scenery, so its thousand nodes carry
  // nothing worth keeping them apart for.
  const merged = new THREE.Group();
  merged.name = model.name || 'diorama';
  for (const [name, batch] of batches) {
    const geometry = batch.geometries.length === 1 ? batch.geometries[0] : mergeGeometries(batch.geometries, false);
    if (!geometry) { report.missing.push('unmergeable: ' + name); continue; }
    const mesh = new THREE.Mesh(geometry, batch.material);
    mesh.name = name;
    geometry.computeBoundingBox();
    const round = v => Math.round(v * 10) / 10;
    // The range of each UV set says which page it was laid out for: an atlas
    // repeats within its tiles, a bake covers its own sheet once.
    const range = name => {
      const attribute = geometry.getAttribute(name);
      if (!attribute) return undefined;
      const box = new THREE.Box2().setFromPoints(Array.from({ length: attribute.count }, (_, i) => new THREE.Vector2(attribute.getX(i), attribute.getY(i))));
      return [...box.min.toArray(), ...box.max.toArray()].map(v => Math.round(v * 1000) / 1000);
    };
    const pieces = tiles(geometry, chunk);
    report.batches.push({ name, triangles: geometry.attributes.position.count / 3, tiles: pieces.length, min: geometry.boundingBox.min.toArray().map(round), max: geometry.boundingBox.max.toArray().map(round), uv: range('uv'), uv1: range('uv1') });
    if (pieces.length === 1) { merged.add(mesh); continue; }
    for (const piece of pieces) {
      const tile = new THREE.Mesh(piece, batch.material);
      tile.name = name;
      merged.add(tile);
    }
  }
  const box = new THREE.Box3().setFromObject(merged);
  report.bounds = { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
  report.triangles = report.batches.reduce((total, batch) => total + batch.triangles, 0);
  if (inspect) return report;
  // In slices: the browser's protocol carries every request body it sends.
  async function send(kind, scene) {
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize, onlyVisible: false });
    for (let offset = 0; offset < glb.byteLength; offset += 1 << 24) {
      const response = await fetch(upload + '?kind=' + kind + '&offset=' + offset, { method: 'POST', body: glb.slice(offset, offset + (1 << 24)) });
      if (!response.ok) throw new Error('The converted ' + kind + ' could not be written: ' + response.status);
    }
  }
  await send('model', merged);
  if (footprint) {
    const ground = new THREE.Group(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
    ground.name = merged.name + ' footprint';
    report.footprint = {};
    for (const [name, batch] of batches) {
      const geometry = batch.geometries.length === 1 ? batch.geometries[0] : mergeGeometries(batch.geometries, false);
      const position = geometry.attributes.position, kept = [];
      for (let t = 0; t < position.count; t += 3) {
        a.fromBufferAttribute(position, t); b.fromBufferAttribute(position, t + 1); c.fromBufferAttribute(position, t + 2);
        if (Math.min(a.y, b.y, c.y) >= footprint) continue;
        n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
        if (n.y < -.5) continue;
        kept.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
      if (!kept.length) continue;
      const piece = new THREE.BufferGeometry();
      piece.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
      const mesh = new THREE.Mesh(piece, new THREE.MeshBasicMaterial({ name }));
      mesh.name = name; ground.add(mesh);
      report.footprint[name] = kept.length / 9;
    }
    await send('footprint', ground);
  }
  return report;
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
    if (pathname === '/upload' && request.method === 'POST') {
      const query = new URL(request.url, 'http://localhost').searchParams, offset = Number(query.get('offset'));
      await pipeline(request, createWriteStream(exported[query.get('kind')], { flags: offset ? 'r+' : 'w', start: offset }));
      response.writeHead(204).end(); return;
    }
    if (pathname === LOADER) { response.writeHead(200, { 'Content-Type': mime['.js'] }).end(await patchedLoader()); return; }
    const file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep)) throw new Error('Forbidden');
    const info = await stat(file);
    if (extname(file) === '.br') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      await pipeline(createReadStream(file), createBrotliDecompress(), response); return;
    }
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
  const report = await tab.evaluate(args => window.convert(args), {
    source: origin + url(source), textures: origin + url(textures) + '/', maxTextureSize, inspect,
    supplied: await readdir(textures), manifest, upload: origin + '/upload', chunk, footprint,
  });
  if (meshopt && !inspect) {
    // Quantized, indexed and meshopt-compressed, which three.js decodes with
    // the small MeshoptDecoder. UVs keep two bits more than the largest page
    // has texels across: a lightmap bake addresses single texels of its sheet,
    // and must land within an eighth of one.
    const gltfpack = createRequire(import.meta.url).resolve('gltfpack/cli.js');
    const uvBits = String(Math.max(12, Math.ceil(Math.log2(maxTextureSize)) + 2));
    for (const [kind, path] of Object.entries(outputs)) {
      const packed = spawnSync(process.execPath, [gltfpack, '-i', exported[kind], '-o', path, '-cc', '-ce', 'ext', '-kn', '-km', '-vt', uvBits], { stdio: 'inherit' });
      await rm(exported[kind]);
      if (packed.status !== 0) throw new Error('gltfpack could not compress the ' + kind);
    }
  }
  if (!inspect) report.bytes = Object.fromEntries(await Promise.all(Object.entries(outputs).map(async ([kind, path]) => [relative(root, path), (await stat(path)).size])));
  console.log(JSON.stringify(report, null, 1));
} finally { await browser.close(); server.close(); }
