import * as THREE from 'three';

// Helpers for standing a downloaded model in the Reach, shared by the story's
// chapters: fitting it to a size, finding its meshes and materials, and the
// soft glows drawn beside it.

// Scales a model so one measure of its visible bounds comes out at `size`
// ('height', or 'length' for the longer footprint side), and sets it on a pivot
// with that footprint centred on the origin and its base at y = 0.
export function fit(scene, size, measure = 'height', only = object => object.visible) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  scene.traverse(object => { if (object.isMesh && only(object)) box.expandByObject(object); });
  const extent = box.getSize(new THREE.Vector3());
  const scale = size / (measure === 'height' ? extent.y : Math.max(extent.x, extent.z));
  const pivot = new THREE.Group();
  scene.scale.setScalar(scale);
  scene.position.set(-(box.min.x + box.max.x) / 2 * scale, -box.min.y * scale, -(box.min.z + box.max.z) / 2 * scale);
  pivot.add(scene);
  return pivot;
}
export const meshes = (object, test = () => true) => { const found = []; object.traverse(o => { if (o.isMesh && test(o)) found.push(o); }); return found; };
export const materialsOf = object => [...new Set(meshes(object).flatMap(mesh => [mesh.material].flat()))];
export function shadows(object, cast = true) { for (const mesh of meshes(object)) { mesh.castShadow = cast; mesh.receiveShadow = true; } }
// A soft white disc, or a soft ring `ring` of the way out, for a glow to take
// its colour from. Worked out pixel by pixel rather than drawn on a canvas, so
// the story stands up outside a browser too.
export function softTexture(ring = 0, size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x + .5 - size / 2, y + .5 - size / 2) / (size / 2);
    const alpha = ring ? Math.exp(-(((r - ring) / .07) ** 2)) : Math.max(0, 1 - r * r) ** 2;
    data.set([255, 255, 255, Math.round(255 * alpha)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
// Round footprints for whatever stands on the ground of a model: the pillars
// of the stone circle are found as clusters of its lowest vertices, measured
// up from the model's own foot, however high the ground it stands on.
export function footprints(object, height = .6, join = .9, test = () => true) {
  object.updateMatrixWorld(true);
  const points = [], vertex = new THREE.Vector3();
  const foot = vertex.setFromMatrixPosition(object.matrixWorld).y;
  for (const mesh of meshes(object, test)) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (vertex.y < foot + height) points.push([vertex.x, vertex.z]);
    }
  }
  const clusters = [];
  for (const [x, z] of points) {
    const near = clusters.find(c => Math.hypot(c.x - x, c.z - z) < join);
    if (near) { near.n++; near.x += (x - near.x) / near.n; near.z += (z - near.z) / near.n; near.points.push([x, z]); }
    else clusters.push({ x, z, n: 1, points: [[x, z]] });
  }
  return clusters.filter(c => c.n > 8).map(c => ({ x: c.x, z: c.z, r: Math.max(.3, ...c.points.map(([x, z]) => Math.hypot(x - c.x, z - c.z))) }));
}
