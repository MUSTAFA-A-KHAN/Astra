import * as THREE from 'three';

// The Reach is drawn in chunks: only what stands within the draw distance of
// the player is handed to the renderer, and the fog closes in at that same
// distance, so whatever leaves the world has already faded into the haze.
//
// How far out the world is drawn, by quality. The fog is complete here.
export const DRAW_DISTANCE = { low: 210, balanced: 270, high: 340, ultra: 460 };
// Where the fog begins, as a share of the draw distance: about where it began
// before the world was streamed, so what is near looks as it always did.
export const FOG_START = .55;
// How far each kind of thing is drawn, as a share of the draw distance:
// buildings and districts to the fog's edge, props and people until they are
// a few pixels deep in its haze.
export const REACH = { scenery: 1, props: .75 };
// The side of a chunk, in world units. The imported districts batch a whole
// district into each mesh; cut into chunks this size, the renderer can skip
// what is out of view or out of range, and the shadow map what is outside the
// sun's small frustum around the player.
export const CHUNK_SIZE = 48;
// The visible set is only reworked once the player has moved this far, and a
// chunk on the edge is only put away again this far past it, so walking along
// the boundary never flickers.
const STEP = 2, MARGIN = 8;

/**
 * Cuts static meshes into chunks of `size`: every triangle goes to the chunk
 * its centre falls in, and triangles of meshes that share a `key` (by default,
 * a material) and a chunk are merged into one mesh. The chunks replace the
 * meshes under `parent`, in its space. Returns them.
 */
export function chunkMeshes(parent, meshes, { size = CHUNK_SIZE, key = mesh => mesh.material.uuid } = {}) {
  parent.updateMatrixWorld(true);
  const inverse = parent.matrixWorld.clone().invert();
  const groups = new Map(), centre = new THREE.Vector3();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material) || mesh.isSkinnedMesh || mesh.isInstancedMesh) throw new Error(`${mesh.name} cannot be cut into chunks.`);
    const { position } = mesh.geometry.attributes, index = mesh.geometry.index;
    const corner = i => index ? index.getX(i) : i;
    // Only meshes built alike can be merged.
    const layout = Object.entries(mesh.geometry.attributes).map(([name, a]) => `${name}${a.itemSize}`).sort().join();
    const group = `${key(mesh)}|${layout}|${mesh.castShadow}|${mesh.receiveShadow}`;
    let cells = groups.get(group);
    if (!cells) groups.set(group, cells = new Map());
    for (let i = 0, count = index ? index.count : position.count; i < count; i += 3) {
      const a = corner(i), b = corner(i + 1), c = corner(i + 2);
      centre.set(position.getX(a) + position.getX(b) + position.getX(c), position.getY(a) + position.getY(b) + position.getY(c), position.getZ(a) + position.getZ(b) + position.getZ(c))
        .divideScalar(3).applyMatrix4(mesh.matrixWorld);
      const cell = (Math.floor(centre.x / size) + 32768) * 65536 + Math.floor(centre.z / size) + 32768;
      let bucket = cells.get(cell);
      if (!bucket) cells.set(cell, bucket = { template: mesh, parts: new Map() });
      let corners = bucket.parts.get(mesh);
      if (!corners) bucket.parts.set(mesh, corners = []);
      corners.push(a, b, c);
    }
  }
  // Each source vertex is copied into a chunk once, however many of that
  // chunk's triangles share it: `last` is the chunk that last took it.
  const seen = new Map(meshes.map(mesh => [mesh, { last: new Int32Array(mesh.geometry.attributes.position.count).fill(-1), slot: new Uint32Array(mesh.geometry.attributes.position.count) }]));
  const chunks = [], toParent = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), vector = new THREE.Vector3();
  let chunkId = 0;
  for (const { template, parts } of [...groups.values()].flatMap(cells => [...cells.values()])) {
    // First number the chunk's vertices, then copy them into arrays that size.
    const sources = [];
    let vertices = 0, corners = 0;
    for (const [mesh, list] of parts) {
      const { last, slot } = seen.get(mesh), taken = [];
      for (const v of list) if (last[v] !== chunkId) { last[v] = chunkId; slot[v] = vertices++; taken.push(v); }
      sources.push([mesh, taken]); corners += list.length;
    }
    const indices = new (vertices > 65535 ? Uint32Array : Uint16Array)(corners);
    let n = 0;
    for (const [mesh, list] of parts) { const { slot } = seen.get(mesh); for (const v of list) indices[n++] = slot[v]; }
    const geometry = new THREE.BufferGeometry();
    for (const [name, { itemSize }] of Object.entries(template.geometry.attributes)) {
      const out = new Float32Array(vertices * itemSize);
      let at = 0;
      for (const [mesh, taken] of sources) {
        const attribute = mesh.geometry.attributes[name];
        toParent.multiplyMatrices(inverse, mesh.matrixWorld); normalMatrix.getNormalMatrix(toParent);
        for (const v of taken) {
          if (name === 'position') vector.fromBufferAttribute(attribute, v).applyMatrix4(toParent).toArray(out, at);
          else if (name === 'normal') vector.fromBufferAttribute(attribute, v).applyMatrix3(normalMatrix).normalize().toArray(out, at);
          else if (name === 'tangent') { vector.fromBufferAttribute(attribute, v).transformDirection(toParent).toArray(out, at); out[at + 3] = attribute.getW(v); }
          else for (let k = 0; k < itemSize; k++) out[at + k] = attribute.getComponent(v, k);
          at += itemSize;
        }
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
    }
    chunkId++;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const chunk = new THREE.Mesh(geometry, template.material);
    chunk.name = template.name;
    chunk.castShadow = template.castShadow; chunk.receiveShadow = template.receiveShadow;
    chunk.renderOrder = template.renderOrder; chunk.userData = { ...template.userData };
    chunks.push(chunk);
  }
  for (const mesh of meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); }
  parent.add(...chunks);
  parent.updateMatrixWorld(true);
  return chunks;
}

/**
 * Keeps track of what stands where, and shows only what is within reach of
 * the player. Everything added belongs to the streamer: nothing else may set
 * its `visible`. A model whose visibility the story also changes is added
 * inside a holder of its own.
 */
export function createStreamer({ quality = 'high' } = {}) {
  const items = [], player = new THREE.Vector2(), nearest = new THREE.Vector2(), box = new THREE.Box3();
  let distance = DRAW_DISTANCE[quality] ?? DRAW_DISTANCE.high, placed = false, stale = true;
  const last = new THREE.Vector2(Infinity, Infinity);
  function apply(item) {
    if (!placed) return;
    const gap = nearest.copy(player).clamp(item.min, item.max).distanceTo(player);
    const limit = distance * item.reach;
    item.object.visible = gap < (item.object.visible ? limit + MARGIN : limit);
  }
  return {
    /**
     * Streams `object` by its footprint, or by `bounds` ({ x, z, radius }) for
     * something that moves about within a known stretch. `kind` is a REACH.
     */
    add(object, { kind = 'scenery', bounds } = {}) {
      object.traverse(child => { if (child.isLight) throw new Error(`${object.name || 'An object'} holds a light: hiding it would rebuild every shader in the Reach.`); });
      let min, max;
      if (bounds) {
        min = new THREE.Vector2(bounds.x - bounds.radius, bounds.z - bounds.radius);
        max = new THREE.Vector2(bounds.x + bounds.radius, bounds.z + bounds.radius);
      } else {
        object.updateWorldMatrix(true, true);
        box.setFromObject(object);
        if (box.isEmpty()) box.setFromCenterAndSize(object.getWorldPosition(new THREE.Vector3()), new THREE.Vector3());
        min = new THREE.Vector2(box.min.x, box.min.z); max = new THREE.Vector2(box.max.x, box.max.z);
      }
      const item = { object, min, max, reach: REACH[kind] ?? REACH.scenery };
      items.push(item); apply(item);
      return object;
    },
    setQuality(level) { distance = DRAW_DISTANCE[level] ?? DRAW_DISTANCE.high; stale = true; },
    update(position) {
      if (!position) return;
      player.set(position.x, position.z);
      if (!stale && player.distanceTo(last) < STEP) return;
      placed = true; stale = false; last.copy(player);
      for (const item of items) apply(item);
    },
    /** How far out a kind of thing is drawn at the current quality. */
    reach(kind = 'scenery') { return distance * (REACH[kind] ?? REACH.scenery); },
    get diagnostics() {
      return { distance, items: items.length, drawn: items.filter(item => item.object.visible).length };
    },
  };
}
