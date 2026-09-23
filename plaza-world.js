import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The third district: a lamplit market street and its cathedral, built block
// by block, standing on a plinth in the harbour east of the city. It arrives
// in two parts. tools/fbx-to-glb.mjs bakes the supplied FBX, its atlas and its
// night-time lightmap into the model, tiled so the renderer can skip what is
// out of view, and writes beside it a footprint of everything at street level.
// The footprint is under a megabyte: the plaza can be walked, and is drawn in
// outline, from the moment the world opens, while the model streams in after.
// Both are rebuilt from the supplied source with:
//   MESHOPT=1 CHUNK=24 FOOTPRINT=21 MAX_TEXTURE=2048 node tools/fbx-to-glb.mjs \
//     plaza-night-time/source/plaza01_night.fbx.br plaza-night-time/plaza-night.glb \
//     plaza-night-time/textures plaza-night-time/materials.json
export const PLAZA_ASSET = 'plaza-night-time/plaza-night.glb';
export const PLAZA_FOOTPRINT = 'plaza-night-time/plaza-night-footprint.glb';
// The model measures in blocks. At 1.8 a block a hero stands as tall as the
// player the street was built around. A quarter turn runs the market street
// east, on the line of the road out of the spawn; y puts the plinth's rim at
// the height of the city pavement it is reached from.
export const PLAZA_TRANSFORM = { scale:1.8, rotation:-Math.PI/2, x:360, y:-34.65, z:-5.4 };
// Its streets are laid at block 19, the pavements and the plinth's rim half a
// block higher, and the market square and shop floors a block higher still.
// A half-block step is a stair to climb here, not a wall; a whole block is.
export const PLAZA_STEP = .95;
const LEVEL = { floor:20.5, footing:.75, step:.55 };
// On the rim at the end of the market street, in blocks: the crossing lands here.
const STREET_END = { x:13, z:87.6 };
// How far from the player a tile is still drawn, by quality. The fog has
// swallowed it long before the camera's far plane on the higher settings.
const RANGE = { low:180, balanced:260, high:Infinity };

// The footprint is the model's faces below block 21 that do not face down.
// Walk it into the terms the navigator reads. A floor is an upward face no
// higher than the market square; a wall is an upright face, rising from that
// height or below, at least three quarters of a block tall. Slab edges and
// kerbs are neither. Water and glass carry no floor, but a pane is a wall.
// A bench or a planter is a floor too, on top: what makes it an obstacle is
// the rise to it, and the faces that rise can be modelled in half blocks. So
// the floors are laid on a half-block grid, and wherever two neighbours differ
// by more than a half-block step, the edge between them is a wall. The grid
// also hands the navigator its floors as a few thousand rectangles rather
// than every block's face, which it reads in a fraction of the time.
function readFootprint(scene) {
  const faces = [], wall = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const solid = mesh.material.name === 'opaque';
    for (let i = 0; i < (index ? index.count : position.count); i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
      n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
      const low = Math.min(a.y, b.y, c.y), high = Math.max(a.y, b.y, c.y);
      if (solid && n.y > .9 && high <= LEVEL.floor) faces.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      else if (Math.abs(n.y) < .1 && low < LEVEL.floor && high - low >= LEVEL.footing) wall.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    }
  });
  const grid = floorGrid(faces);
  for (const value of grid.walls) wall.push(value);
  const group = new THREE.Group();
  for (const [name, points] of [['plaza-floor', grid.floors], ['plaza-wall', wall]]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const mesh = new THREE.Mesh(geometry);
    mesh.name = name; group.add(mesh);
  }
  return group;
}

// Rasterises floor triangles onto a grid of `cells` to the block, keeping the
// highest floor in each cell. Returns the floors merged into level rectangles,
// and upright quads, merged into runs, along every edge where the floors on
// either side differ by more than a step. Each quad stands two blocks above
// the higher floor, so the navigator reads it as a wall even below sea level.
function floorGrid(faces, cells = 2) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < faces.length; i += 3) {
    minX = Math.min(minX, faces[i]); maxX = Math.max(maxX, faces[i]);
    minZ = Math.min(minZ, faces[i + 2]); maxZ = Math.max(maxZ, faces[i + 2]);
  }
  const width = Math.ceil((maxX - minX) * cells), depth = Math.ceil((maxZ - minZ) * cells);
  const top = new Float32Array(width * depth).fill(-Infinity);
  for (let t = 0; t < faces.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = faces.slice(t, t + 9);
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-9) continue;
    const y = Math.max(ay, by, cy);
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) * cells)), x1 = Math.min(width - 1, Math.floor((Math.max(ax, bx, cx) - minX) * cells));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) * cells)), z1 = Math.min(depth - 1, Math.floor((Math.max(az, bz, cz) - minZ) * cells));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const x = minX + (ix + .5) / cells, z = minZ + (iz + .5) / cells;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6 && y > top[iz * width + ix]) top[iz * width + ix] = y;
    }
  }
  const gx = ix => minX + ix / cells, gz = iz => minZ + iz / cells;

  // Greedy rectangles of one height: as wide as the row allows, then as deep
  // as every row below matches it.
  const floors = [], taken = new Uint8Array(width * depth);
  for (let iz = 0; iz < depth; iz++) for (let ix = 0; ix < width; ix++) {
    const k = iz * width + ix, h = top[k];
    if (taken[k] || !Number.isFinite(h)) continue;
    let w = 1, d = 1;
    while (ix + w < width && !taken[k + w] && top[k + w] === h) w++;
    rows: for (; iz + d < depth; d++) for (let j = 0; j < w; j++) {
      const q = (iz + d) * width + ix + j;
      if (taken[q] || top[q] !== h) break rows;
    }
    for (let r = 0; r < d; r++) taken.fill(1, (iz + r) * width + ix, (iz + r) * width + ix + w);
    const [x0, x1, z0, z1] = [gx(ix), gx(ix + w), gz(iz), gz(iz + d)];
    floors.push(x0, h, z0, x0, h, z1, x1, h, z1, x0, h, z0, x1, h, z1, x1, h, z0);
  }

  const walls = [];
  const rise = (h, g) => Number.isFinite(h) && Number.isFinite(g) && Math.abs(h - g) > LEVEL.step ? [Math.min(h, g), Math.max(h, g) + 2] : null;
  const same = (p, q) => p && q && p[0] === q[0] && p[1] === q[1];
  function quad(x0, z0, x1, z1, [low, high]) {
    walls.push(x0, low, z0, x0, high, z0, x1, high, z1, x0, low, z0, x1, high, z1, x1, low, z1);
  }
  // Between columns, merged down the rows; then between rows, merged along them.
  for (let ix = 0; ix + 1 < width; ix++) {
    let run = null, start = 0;
    for (let iz = 0; iz <= depth; iz++) {
      const r = iz < depth ? rise(top[iz * width + ix], top[iz * width + ix + 1]) : null;
      if (run && !same(run, r)) { quad(gx(ix + 1), gz(start), gx(ix + 1), gz(iz), run); run = null; }
      if (r && !run) { run = r; start = iz; }
    }
  }
  for (let iz = 0; iz + 1 < depth; iz++) {
    let run = null, start = 0;
    for (let ix = 0; ix <= width; ix++) {
      const r = ix < width ? rise(top[iz * width + ix], top[(iz + 1) * width + ix]) : null;
      if (run && !same(run, r)) { quad(gx(start), gz(iz + 1), gx(ix), gz(iz + 1), run); run = null; }
      if (r && !run) { run = r; start = ix; }
    }
  }
  return { floors, walls };
}

function place(object) {
  object.position.set(PLAZA_TRANSFORM.x, PLAZA_TRANSFORM.y, PLAZA_TRANSFORM.z);
  object.rotation.y = PLAZA_TRANSFORM.rotation;
  object.scale.setScalar(PLAZA_TRANSFORM.scale);
  object.updateMatrixWorld(true);
  return object;
}

function loader() {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

export async function loadPlazaDistrict({ lowPower = false } = {}) {
  const footprintURL = new URL(PLAZA_FOOTPRINT, import.meta.url), assetURL = new URL(PLAZA_ASSET, import.meta.url);
  const outline = (await loader().loadAsync(footprintURL.href)).scene;
  const root = new THREE.Group(); root.name = 'Lantern Plaza';
  // The navigator reads floors and walls from its own copy, which never
  // reaches the renderer. Until the model arrives, the footprint stands in
  // for it, in plain stone: the streets and the foot of every wall.
  const layout = place(readFootprint(outline));
  const stone = new THREE.MeshStandardMaterial({ color:'#595d63', roughness:.95, flatShading:true, side:THREE.DoubleSide });
  outline.traverse(mesh => { if (mesh.isMesh) { mesh.material.dispose(); mesh.material = stone; mesh.receiveShadow = true; } });
  place(outline); outline.name = 'Lantern Plaza footprint';
  root.add(outline);
  const box = new THREE.Box3().setFromObject(outline);
  const bounds = { minX:box.min.x, maxX:box.max.x, minZ:box.min.z, maxZ:box.max.z };
  const landing = new THREE.Vector3(STREET_END.x, 19.5, STREET_END.z).applyMatrix4(outline.matrixWorld);

  const tiles = [], materials = new Set(), nearest = new THREE.Vector2(), player = new THREE.Vector2();
  let daylight = 1, level = lowPower ? 'balanced' : 'high', state = 'waiting', loading = null;
  function applyTime() {
    // The lightmap is the street as it looks at night, lamps and all. It is
    // the light the plaza is seen by after dark, and a faint warmth by day.
    for (const material of materials) if (material.emissiveMap) material.emissiveIntensity = .1 + (1 - daylight) * .9;
  }
  function applyQuality() {
    for (const tile of tiles) tile.mesh.castShadow = level === 'high';
    for (const material of materials) if (material.map) material.map.anisotropy = level === 'low' ? 1 : 4;
  }
  return {
    root, bounds, landing, asset:PLAZA_ASSET,
    terrain:{ layout, ground:/plaza-floor/, solid:/plaza-wall/, standing:-Infinity, walkable:Infinity },
    // Fetches the model and puts it in place of the footprint, once prepare
    // (given the model, before it is shown) has finished. Safe to call again.
    load(prepare) {
      loading ??= (async () => {
        state = 'loading';
        const model = place((await loader().loadAsync(assetURL.href)).scene);
        model.traverse(mesh => {
          if (!mesh.isMesh) return;
          mesh.receiveShadow = true;
          materials.add(mesh.material);
          const extent = new THREE.Box3().setFromObject(mesh);
          tiles.push({ mesh, min:new THREE.Vector2(extent.min.x, extent.min.z), max:new THREE.Vector2(extent.max.x, extent.max.z) });
        });
        applyTime(); applyQuality();
        await prepare?.(model);
        root.add(model); outline.removeFromParent();
        outline.traverse(mesh => mesh.geometry?.dispose()); stone.dispose();
        state = 'ready';
      })().catch(error => { state = 'failed'; loading = null; throw error; });
      return loading;
    },
    setTime(value) { daylight = value; applyTime(); },
    setQuality(value) { level = RANGE[value] !== undefined ? value : 'high'; applyQuality(); },
    update(position) {
      if (!position) return;
      const range = RANGE[level];
      player.set(position.x, position.z);
      for (const tile of tiles) tile.mesh.visible = nearest.copy(player).clamp(tile.min, tile.max).distanceTo(player) < range;
    },
    get diagnostics() {
      return { state, tiles:tiles.length, drawn:tiles.filter(tile => tile.mesh.visible).length };
    },
  };
}
