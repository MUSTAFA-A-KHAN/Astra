import * as THREE from 'three';

// How far below the surface a bank is carried, so no angle catches its foot
// from across the water.
const FOOTING_DEPTH = 1.35;

/**
 * A district modelled as a sheet of ground with nothing beneath it: moored in
 * the harbour, its edge would hang over the water like a rug. This carries
 * that edge down past the surface as a bank of bare earth, `turf` under the
 * ground and darkening to `wet` at its foot. Built in world space, from the
 * ground as it stands; the ground may be cut into several meshes.
 */
export function bank(grounds, { waterline, turf, wet, name }) {
  const point = new THREE.Vector3();
  const key = p => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
  // An edge that only one face uses is the rim of the ground. Vertices are
  // matched by where they stand, not their index: a seam in the texture, or
  // between two of the meshes, splits a vertex without opening the ground.
  const edges = new Map();
  for (const ground of grounds) {
    const { position } = ground.geometry.attributes, index = ground.geometry.index;
    const at = i => point.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(ground.matrixWorld).clone();
    for (let t = 0; t < (index ? index.count : position.count); t += 3) {
      const face = [at(t), at(t+1), at(t+2)];
      for (const [p, q] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]]) {
        const a = key(p), b = key(q), id = a < b ? `${a}|${b}` : `${b}|${a}`;
        const edge = edges.get(id);
        if (edge) edge.count++; else edges.set(id, { p, q, count:1 });
      }
    }
  }
  const depth = waterline - FOOTING_DEPTH, wall = [], shade = [];
  const top = new THREE.Color(turf), foot = new THREE.Color(wet);
  for (const { p, q, count } of edges.values()) {
    if (count !== 1) continue;
    wall.push(p.x,p.y,p.z, q.x,depth,q.z, q.x,q.y,q.z, p.x,p.y,p.z, p.x,depth,p.z, q.x,depth,q.z);
    for (const high of [true, false, true, true, false, false]) shade.push(...(high ? top : foot).toArray());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(shade, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors:true, roughness:1, side:THREE.DoubleSide }));
  mesh.name = name; mesh.receiveShadow = true;
  return mesh;
}
