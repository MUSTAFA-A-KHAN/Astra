import * as THREE from 'three';
import { readTerrainConfig } from './terrain-config.js';
import { POND, WORLD_CIRCUMFERENCE, clamp, lerp, noise2, hash2, smoothstep, proceduralHeight, pondDistance, decodeTerrarium, mercatorFromDegrees, triangleHeight } from './terrain-math.js';

export class TerrainProvider {
  constructor(name) { this.name = name; this.status = 'idle'; this.revision = 0; this.disposed = false; }
  getHeight() { return null; }
  update() {}
  setQuality() {}
  getStats() { return { provider: this.name, status: this.status, loadedTiles: 0 }; }
  dispose() { this.disposed = true; }
}

export class ProceduralTerrainProvider extends TerrainProvider {
  constructor() { super('procedural'); this.status = 'ready'; }
  getHeight(x, z) { return proceduralHeight(x, z); }
}

// The fallback is kept alive for the lifetime of the world. A remote failure
// never removes the rendered ground or propagates into character startup.
export class FallbackTerrainProvider extends TerrainProvider {
  constructor(primary, fallback = new ProceduralTerrainProvider()) {
    super(primary?.name || 'procedural'); this.primary = primary; this.fallback = fallback; this.status = 'ready';
  }
  getHeight(x, z) {
    const value = this.primary?.getHeight(x, z);
    return Number.isFinite(value) ? value : this.fallback.getHeight(x, z);
  }
  update(dt, time, position) { this.primary?.update(dt, time, position); this.revision = this.primary?.revision || 0; }
  setQuality(level) { this.primary?.setQuality(level); }
  getStats() { return this.primary?.getStats() || this.fallback.getStats(); }
  dispose() { super.dispose(); this.primary?.dispose(); this.fallback.dispose(); }
}

async function decodeImage(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < 2 || bitmap.height < 2 || bitmap.width > 1024 || bitmap.height > 1024) throw new Error('Unexpected elevation tile dimensions');
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(bitmap.width, bitmap.height) : document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Elevation image decoder is unavailable');
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const data = new Float32Array(bitmap.width * bitmap.height);
    for (let i = 0; i < data.length; i++) data[i] = decodeTerrarium(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    return { data, width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); }
}

// A real DEM service, not a procedural stand-in. Mapzen Terrarium PNGs encode
// surveyed/SRTM elevations in RGB; Three.js renders these same sampled heights.
// Injecting fetch/decode makes timeout, malformed data and retry behavior testable.
export class RealWorldTerrainProvider extends TerrainProvider {
  constructor(config, dependencies = {}) {
    super('terrarium');
    this.config = config;
    this.fetch = dependencies.fetch || globalThis.fetch.bind(globalThis);
    this.decode = dependencies.decode || decodeImage;
    this.tiles = new Map(); this.queue = new Map(); this.pending = new Map(); this.failed = new Map();
    this.clock = 0; this.lastSchedule = -Infinity; this.active = 0; this.failures = 0;
    this.maxConcurrent = 3; this.cacheLimit = config.maxCachedTiles;
    this.origin = mercatorFromDegrees(config.latitude, config.longitude);
    this.metresPerWorld = WORLD_CIRCUMFERENCE * Math.cos(config.latitude * Math.PI / 180);
    this.elevationOffset = config.elevationOffset;
    this.position = { x: 0, z: 18 }; this.previous = { x: 0, z: 18 };
    this.radius = 384; this.error = ''; this.zoom = Math.round(config.zoom);
  }

  key(zoom, x, y) { return `${zoom}/${x}/${y}`; }
  coordinates(x, z, zoom, target) {
    const count = 2 ** zoom;
    target.x = (this.origin.x + x / this.metresPerWorld) * count;
    target.y = (this.origin.y + z / this.metresPerWorld) * count;
    return target;
  }

  enqueue(zoom, tx, ty, priority) {
    const count = 2 ** zoom;
    if (ty < 0 || ty >= count) return;
    tx = ((tx % count) + count) % count;
    const key = this.key(zoom, tx, ty), failure = this.failed.get(key);
    if (this.tiles.has(key) || this.pending.has(key) || (failure && (failure.attempt > this.config.maxRetries || failure.retryAt > this.clock))) return;
    const previous = this.queue.get(key);
    if (!previous || priority < previous.priority) this.queue.set(key, { key, zoom, x: tx, y: ty, priority, attempt: failure?.attempt || 0 });
  }

  schedule() {
    this.queue.clear();
    const center = { x: 0, y: 0 }, edge = { x: 0, y: 0 };
    // Fetch the origin first so geography is expressed in local metres, not
    // kilometres above the player while an altitude reference is missing.
    this.coordinates(0, 18, this.zoom, center);
    this.anchorKey = this.key(this.zoom, Math.floor(center.x), Math.floor(center.y));
    this.enqueue(this.zoom, Math.floor(center.x), Math.floor(center.y), -1000);
    for (const zoom of [this.zoom, this.zoom - 2]) {
      this.coordinates(this.position.x, this.position.z, zoom, center);
      this.coordinates(this.position.x + this.radius + 80, this.position.z + this.radius + 80, zoom, edge);
      const ring = Math.max(1, Math.ceil(Math.max(edge.x - center.x, edge.y - center.y)));
      for (let y = -ring; y <= ring; y++) for (let x = -ring; x <= ring; x++) {
        // Only request tiles intersecting the active area, plus its immediate
        // successor in the movement direction. This bounds bandwidth at boot.
        const tx = Math.floor(center.x) + x, ty = Math.floor(center.y) + y;
        const dx = Math.max(tx - center.x, 0, center.x - tx - 1), dy = Math.max(ty - center.y, 0, center.y - ty - 1);
        const metres = Math.hypot(dx, dy) * this.metresPerWorld / (2 ** zoom);
        if (metres > this.radius + 110) continue;
        const forward = x * (this.position.x - this.previous.x) + y * (this.position.z - this.previous.z);
        this.enqueue(zoom, tx, ty, metres + (zoom === this.zoom ? 0 : 25) - clamp(forward, -10, 10));
      }
    }
    this.previous.x = this.position.x; this.previous.z = this.position.z;
    this.trim(); this.pump();
  }

  pump() {
    if (this.disposed) return;
    while (this.active < this.maxConcurrent && this.queue.size) {
      let job;
      for (const candidate of this.queue.values()) if (!job || candidate.priority < job.priority) job = candidate;
      this.queue.delete(job.key);
      this.load(job);
    }
  }

  async load(job) {
    this.active++;
    const controller = new AbortController(); this.pending.set(job.key, controller);
    let timeout;
    try {
      const url = this.config.urlTemplate.replace('{z}', job.zoom).replace('{x}', job.x).replace('{y}', job.y).replace('{token}', encodeURIComponent(this.config.token || ''));
      const operation = async () => {
        const response = await this.fetch(url, { signal: controller.signal, mode: 'cors', cache: 'force-cache' });
        if (!response.ok) throw new Error(`Elevation service returned HTTP ${response.status}`);
        const decoded = await this.decode(await response.blob());
        if (!decoded?.data || decoded.data.length !== decoded.width * decoded.height) throw new Error('Invalid elevation tile');
        for (const value of decoded.data) if (!Number.isFinite(value) || value < -12000 || value > 12000) throw new Error('Invalid elevation value');
        return decoded;
      };
      const tile = await Promise.race([operation(), new Promise((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error('Elevation request timed out')); }, this.config.timeout);
      })]);
      if (this.disposed || controller.signal.aborted) return;
      this.tiles.set(job.key, { ...tile, zoom: job.zoom, x: job.x, y: job.y, lastUsed: this.clock });
      this.failed.delete(job.key); this.error = ''; this.revision++;
      if (this.elevationOffset === null && job.key === this.anchorKey) this.elevationOffset = this.sampleAtZoom(0, 18, this.zoom);
      this.status = this.elevationOffset === null ? 'loading' : 'ready'; this.trim();
    } catch (error) {
      if (!this.disposed) {
        this.failures++;
        this.failed.set(job.key, { attempt: job.attempt + 1, retryAt: this.clock + Math.min(12, 1.5 * 2 ** job.attempt) });
        // Do not print token-bearing URLs or repeat a message for every tile.
        this.error = error.message || 'Elevation data unavailable';
        if (!this.tiles.size) this.status = 'fallback';
      }
    } finally {
      clearTimeout(timeout); this.pending.delete(job.key); this.active--; this.pump();
    }
  }

  sampleAtZoom(x, z, zoom) {
    const count = 2 ** zoom;
    const fx = (this.origin.x + x / this.metresPerWorld) * count;
    const fy = (this.origin.y + z / this.metresPerWorld) * count;
    const tx = Math.floor(fx), ty = Math.floor(fy), wrapX = ((tx % count) + count) % count;
    const tile = this.tiles.get(this.key(zoom, wrapX, ty));
    if (!tile) return null;
    tile.lastUsed = this.clock;
    const px = (fx - tx) * tile.width - .5, py = (fy - ty) * tile.height - .5;
    const ix = Math.floor(px), iy = Math.floor(py);
    const pixel = (x, y) => {
      const ox = x < 0 ? -1 : x >= tile.width ? 1 : 0, oy = y < 0 ? -1 : y >= tile.height ? 1 : 0;
      const neighbour = ox || oy ? this.tiles.get(this.key(zoom, (wrapX + ox + count) % count, ty + oy)) : tile;
      if (neighbour) return neighbour.data[((y + tile.height) % tile.height) * neighbour.width + ((x + tile.width) % tile.width)];
      return tile.data[clamp(y, 0, tile.height - 1) * tile.width + clamp(x, 0, tile.width - 1)];
    };
    return lerp(lerp(pixel(ix, iy), pixel(ix + 1, iy), px - ix), lerp(pixel(ix, iy + 1), pixel(ix + 1, iy + 1), px - ix), py - iy);
  }

  getHeight(x, z) {
    if (this.elevationOffset === null) return null;
    for (const zoom of [this.zoom, this.zoom - 2]) {
      const value = this.sampleAtZoom(x, z, zoom);
      if (Number.isFinite(value)) return value - this.elevationOffset;
    }
    return null;
  }

  update(dt, time, position) {
    if (this.disposed) return;
    this.clock += dt; this.position.x = position.x; this.position.z = position.z;
    if (this.status === 'idle') this.status = 'loading';
    if (this.clock - this.lastSchedule > .6) { this.lastSchedule = this.clock; this.schedule(); }
  }

  trim() {
    if (this.tiles.size <= this.cacheLimit) return;
    const removable = [...this.tiles.entries()].filter(([key]) => key !== this.anchorKey).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of removable) { if (this.tiles.size <= this.cacheLimit) break; this.tiles.delete(key); }
    // Failure records are bounded too when exploring an unavailable service.
    while (this.failed.size > this.cacheLimit * 3) this.failed.delete(this.failed.keys().next().value);
  }
  setQuality(level) {
    this.radius = { low: 192, balanced: 256, high: 384, ultra: 512 }[level] || 384;
    this.cacheLimit = Math.min(this.config.maxCachedTiles, level === 'low' ? 16 : level === 'balanced' ? 28 : 64);
    this.maxConcurrent = level === 'low' ? 2 : 3; this.trim(); this.lastSchedule = -Infinity;
  }
  retry() { this.failed.clear(); this.lastSchedule = -Infinity; this.error = ''; this.status = 'loading'; }
  getStats() {
    let bytes = 0; for (const tile of this.tiles.values()) bytes += tile.data.byteLength;
    return { provider: 'terrarium', status: this.status, loadedTiles: this.tiles.size, pendingTiles: this.pending.size,
      queuedTiles: this.queue.size, cachedBytes: bytes, failures: this.failures, message: this.error,
      elevationOffset: this.elevationOffset, latitude: this.config.latitude, longitude: this.config.longitude,
      attribution: 'Terrain: Mapzen / AWS Open Data · SRTM and other open elevation sources' };
  }
  dispose() { super.dispose(); for (const request of this.pending.values()) request.abort(); this.queue.clear(); this.tiles.clear(); this.failed.clear(); }
}

const CHUNK_SIZE = 128;
const LEVELS = {
  low: { radius: 192, near: 32, middle: 16, far: 8, budget: 1 },
  balanced: { radius: 256, near: 64, middle: 16, far: 8, budget: 1 },
  high: { radius: 384, near: 64, middle: 32, far: 8, budget: 2 },
  ultra: { radius: 512, near: 64, middle: 32, far: 16, budget: 2 },
};

function createTerrainMaterial() {
  const pixels = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const i = (y * 128 + x) * 4, value = 100 + hash2(x, y, 18993) * 72;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value; pixels[i + 3] = 255;
  }
  const detail = new THREE.DataTexture(pixels, 128, 128, THREE.RGBAFormat);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping; detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.magFilter = THREE.LinearFilter; detail.generateMipmaps = true; detail.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .97, bumpMap: detail, bumpScale: .09 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vTerrainPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = `varying vec3 vTerrainPosition;
      float terrainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float terrainNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(terrainHash(i), terrainHash(i+vec2(1.0,0.0)),f.x),mix(terrainHash(i+vec2(0.0,1.0)),terrainHash(i+vec2(1.0)),f.x),f.y); }
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float macro = terrainNoise(vTerrainPosition.xz * .047) * .45 + terrainNoise(vTerrainPosition.xz * .23) * .22;
      float micro = terrainNoise(vTerrainPosition.xz * 3.9);
      diffuseColor.rgb *= .79 + macro * .49 + micro * .10;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor - terrainNoise(vTerrainPosition.xz * .6) * .12, .74, 1.0);');
  };
  material.customProgramCacheKey = () => 'astra-terrain-pbr-v1';
  material.userData.detailTexture = detail;
  return material;
}

export function createTerrain(scene, { lowPower = false, config = readTerrainConfig() } = {}) {
  // No promises, remote imports or requests on this critical startup path.
  const fallback = new ProceduralTerrainProvider();
  const useReal = config.provider === 'terrarium' || config.provider === 'real';
  const real = useReal ? new RealWorldTerrainProvider(config) : null;
  const provider = new FallbackTerrainProvider(real, fallback);
  const group = new THREE.Group(); group.name = 'Terrain · streamed surface'; scene.add(group);
  const material = createTerrainMaterial();
  const chunks = new Map(), buildQueue = [];
  let quality = lowPower ? 'low' : 'high', settings = LEVELS[quality];
  let revision = 0, providerRevision = -1, elapsed = 0, lastPlan = -1, lastRevisionTime = 0;
  let lastCenterX = Infinity, lastCenterZ = Infinity, disposed = false;
  const current = { x: 0, z: 18 }, prior = { x: 0, z: 18 };
  const sampleNormal = new THREE.Vector3();
  const grassColor = new THREE.Color('#677958'), dirtColor = new THREE.Color('#857861'), rockColor = new THREE.Color('#7c8179'), mudColor = new THREE.Color('#555c48'), snowColor = new THREE.Color('#c6cfcb'), color = new THREE.Color();

  function rawHeight(x, z) { return provider.getHeight(x, z); }
  function chunkHeight(chunk, x, z) {
    const u = clamp((x - chunk.x * CHUNK_SIZE) / CHUNK_SIZE * chunk.segments, 0, chunk.segments - 1e-7);
    const v = clamp((z - chunk.z * CHUNK_SIZE) / CHUNK_SIZE * chunk.segments, 0, chunk.segments - 1e-7);
    const ix = Math.floor(u), iz = Math.floor(v), stride = chunk.segments + 1, data = chunk.geometry.attributes.position.array;
    const index = iz * stride + ix;
    return triangleHeight(data[index * 3 + 1], data[(index + 1) * 3 + 1], data[(index + stride) * 3 + 1], data[(index + stride + 1) * 3 + 1], u - ix, v - iz);
  }
  function getHeight(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    const chunk = chunks.get(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`);
    return chunk ? chunkHeight(chunk, x, z) : rawHeight(x, z);
  }
  function getNormal(x, z, target = new THREE.Vector3()) {
    const step = .4;
    return target.set(getHeight(x - step, z) - getHeight(x + step, z), step * 2, getHeight(x, z - step) - getHeight(x, z + step)).normalize();
  }
  function getWaterLevel(x, z) {
    if (real?.elevationOffset !== null && real?.elevationOffset !== undefined && Number.isFinite(real.getHeight(x, z))) {
      const seaLevel = -real.elevationOffset;
      return getHeight(x, z) < seaLevel + 1 ? seaLevel : null;
    }
    return pondDistance(x, z) < 1.1 ? POND.level : null;
  }
  function sample(x, z, out = {}) {
    out.height = getHeight(x, z); out.normal = getNormal(x, z, out.normal || new THREE.Vector3());
    out.slope = Math.acos(clamp(out.normal.y, -1, 1));
    out.waterLevel = getWaterLevel(x, z); out.waterDepth = out.waterLevel === null ? 0 : Math.max(0, out.waterLevel - out.height);
    out.moisture = clamp(.52 + noise2(x * .014 + 20, z * .014 - 4) * .28 + (pondDistance(x, z) < 1.5 ? .3 : 0), 0, 1);
    out.material = out.waterDepth > .05 ? 'water' : out.normal.y < .78 ? 'rock' : out.waterLevel !== null ? 'mud' : out.moisture < .34 ? 'dirt' : 'grass';
    return out;
  }

  function colorGeometry(chunk) {
    const positions = chunk.geometry.attributes.position.array, normals = chunk.geometry.attributes.normal.array;
    const colors = chunk.geometry.attributes.color.array;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] + chunk.x * CHUNK_SIZE, z = positions[i + 2] + chunk.z * CHUNK_SIZE;
      const height = positions[i + 1], moisture = noise2(x * .021 + 20, z * .021 - 4) * .5 + .5;
      const stone = smoothstep(.22, .64, 1 - Math.max(0, normals[i + 1]));
      color.copy(grassColor).lerp(dirtColor, clamp(.6 - moisture, 0, .45)).lerp(rockColor, stone);
      if (!useReal && pondDistance(x, z) < 1.25) color.lerp(mudColor, .7);
      const altitude = height + (real?.elevationOffset || 0);
      if (useReal && altitude > 2200) color.lerp(snowColor, smoothstep(2200, 3000, altitude) * (1 - stone * .7));
      color.multiplyScalar(.92 + noise2(x * .051, z * .051) * .1);
      colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b;
    }
    chunk.geometry.attributes.color.needsUpdate = true;
  }

  function buildChunk(x, z, segments) {
    const key = `${x},${z}`, old = chunks.get(key), stride = segments + 1, baseCount = stride * stride;
    const vertexCount = baseCount + stride * 8;
    const positions = new Float32Array(vertexCount * 3), uvs = new Float32Array(vertexCount * 2), targets = new Float32Array(vertexCount);
    const colors = new Float32Array(vertexCount * 3), indices = [];
    for (let iz = 0; iz <= segments; iz++) for (let ix = 0; ix <= segments; ix++) {
      const index = iz * stride + ix, lx = ix / segments * CHUNK_SIZE, lz = iz / segments * CHUNK_SIZE;
      const wx = x * CHUNK_SIZE + lx, wz = z * CHUNK_SIZE + lz;
      const target = rawHeight(wx, wz), height = old ? chunkHeight(old, wx, wz) : target;
      positions[index * 3] = lx; positions[index * 3 + 1] = height; positions[index * 3 + 2] = lz;
      targets[index] = target; uvs[index * 2] = wx * .27; uvs[index * 2 + 1] = wz * .27;
      if (ix < segments && iz < segments) { const a = index, b = a + 1, c = a + stride, d = c + 1; indices.push(a, c, b, b, c, d); }
    }
    // Independent skirt vertices hide T junctions without corrupting the top
    // surface normals. Heights and collisions never sample the skirts.
    for (let edge = 0; edge < 4; edge++) for (let i = 0; i <= segments; i++) {
      const source = edge === 0 ? i : edge === 1 ? i * stride + segments : edge === 2 ? segments * stride + segments - i : (segments - i) * stride;
      const top = baseCount + edge * stride * 2 + i * 2, bottom = top + 1;
      for (const index of [top, bottom]) {
        positions[index * 3] = positions[source * 3]; positions[index * 3 + 1] = positions[source * 3 + 1] - (index === bottom ? 12 : 0); positions[index * 3 + 2] = positions[source * 3 + 2];
        targets[index] = targets[source] - (index === bottom ? 12 : 0); uvs[index * 2] = uvs[source * 2]; uvs[index * 2 + 1] = uvs[source * 2 + 1];
      }
      if (i < segments) indices.push(top, top + 2, bottom, bottom, top + 2, bottom + 2);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x * CHUNK_SIZE, 0, z * CHUNK_SIZE);
    mesh.name = `Terrain ${key} · ${segments}`; mesh.receiveShadow = true; mesh.castShadow = false;
    const chunk = { x, z, key, segments, geometry, mesh, targets, morphing: !!old, lastNormals: elapsed, version: provider.revision };
    colorGeometry(chunk); geometry.computeBoundingSphere(); group.add(mesh); chunks.set(key, chunk);
    if (old) { group.remove(old.mesh); old.geometry.dispose(); }
    return chunk;
  }

  function plan(force = false) {
    const cx = Math.floor(current.x / CHUNK_SIZE), cz = Math.floor(current.z / CHUNK_SIZE);
    if (!force && cx === lastCenterX && cz === lastCenterZ && elapsed - lastPlan < 1.2) return;
    lastCenterX = cx; lastCenterZ = cz; lastPlan = elapsed; buildQueue.length = 0;
    const ring = Math.ceil(settings.radius / CHUNK_SIZE), wanted = new Set();
    const moveX = current.x - prior.x, moveZ = current.z - prior.z;
    for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
      const x = cx + dx, z = cz + dz, distance = Math.max(Math.abs(dx), Math.abs(dz));
      const key = `${x},${z}`, segments = distance <= 1 ? settings.near : distance <= 2 ? settings.middle : settings.far;
      wanted.add(key); const previous = chunks.get(key);
      if (!previous || previous.segments !== segments) buildQueue.push({ x, z, segments, priority: Math.hypot(dx, dz) * 10 - clamp(dx * moveX + dz * moveZ, -3, 3) });
    }
    buildQueue.sort((a, b) => a.priority - b.priority);
    for (const [key, chunk] of chunks) if (!wanted.has(key)) { group.remove(chunk.mesh); chunk.geometry.dispose(); chunks.delete(key); }
    prior.x = current.x; prior.z = current.z;
  }

  function updateTargets(chunk) {
    const positions = chunk.geometry.attributes.position.array, baseCount = (chunk.segments + 1) ** 2;
    for (let i = 0; i < chunk.targets.length; i++) {
      const x = chunk.x * CHUNK_SIZE + positions[i * 3], z = chunk.z * CHUNK_SIZE + positions[i * 3 + 2];
      chunk.targets[i] = rawHeight(x, z) - (i >= baseCount && (i - baseCount) % 2 === 1 ? 12 : 0);
    }
    chunk.version = provider.revision; chunk.morphing = true;
  }

  function update(dt, time, playerPosition = current) {
    if (disposed) return;
    elapsed += dt; current.x = playerPosition.x; current.z = playerPosition.z;
    provider.update(dt, time, current); plan();
    let budget = settings.budget;
    while (budget-- > 0 && buildQueue.length) { const next = buildQueue.shift(); buildChunk(next.x, next.z, next.segments); }
    if (providerRevision !== provider.revision) { providerRevision = provider.revision; for (const chunk of chunks.values()) chunk.version = -1; }
    let retargets = 2, changed = false;
    for (const chunk of chunks.values()) {
      if (chunk.version !== provider.revision && retargets-- > 0) updateTargets(chunk);
      if (!chunk.morphing) continue;
      const positions = chunk.geometry.attributes.position.array;
      let remaining = false;
      // Smooth actual mesh elevation at a bounded physical rate. Ground queries
      // read this mesh, so players and props never sample unseen target heights.
      for (let i = 0; i < chunk.targets.length; i++) {
        const difference = chunk.targets[i] - positions[i * 3 + 1];
        if (Math.abs(difference) > .002) { positions[i * 3 + 1] += clamp(difference, -dt * 2, dt * 2); remaining = true; }
      }
      chunk.morphing = remaining;
      if (remaining) {
        changed = true; chunk.geometry.attributes.position.needsUpdate = true;
        if (elapsed - chunk.lastNormals > .2) { chunk.geometry.computeVertexNormals(); colorGeometry(chunk); chunk.geometry.computeBoundingSphere(); chunk.lastNormals = elapsed; }
      }
    }
    if (changed && elapsed - lastRevisionTime > .2) { revision++; lastRevisionTime = elapsed; }
  }

  function setQuality(level) { quality = LEVELS[level] ? level : 'balanced'; settings = LEVELS[quality]; provider.setQuality(quality); plan(true); }
  // Nine local chunks supply the entire lobby and its sight lines immediately.
  // Distant chunks and all external terrain load after the first rendered frame.
  for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) buildChunk(x, z, settings.near);
  provider.setQuality(quality); plan(true);

  return {
    group, provider, config, getHeight, getNormal, getWaterLevel, sample, update, setQuality,
    get ready() { return true; }, get revision() { return revision; },
    get status() { return config.provider === 'cesium' ? 'fallback' : provider.getStats().status; },
    retry() { real?.retry(); },
    getStats() {
      const stats = provider.getStats();
      if (config.provider === 'cesium') { stats.status = 'fallback'; stats.message = 'Cesium is not configured in this build. Use terrain=terrarium for supported real elevation streaming.'; }
      return { ...stats, requestedProvider: config.provider, activeChunks: chunks.size, pendingChunks: buildQueue.length, chunkSize: CHUNK_SIZE,
        lod: quality, nearSpacing: CHUNK_SIZE / settings.near, revision, ready: true, fallback: !real || real.status === 'fallback' || real.status === 'loading' };
    },
    dispose() {
      if (disposed) return; disposed = true; provider.dispose();
      for (const chunk of chunks.values()) chunk.geometry.dispose(); chunks.clear(); buildQueue.length = 0;
      material.userData.detailTexture.dispose(); material.dispose(); scene.remove(group);
    },
  };
}
