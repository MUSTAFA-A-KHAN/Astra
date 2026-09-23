import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The fourth district: the container yard of the "Skibidi toilet 79 map", by
// MysteriousTV (https://sketchfab.com/Mystv), used under CC-BY-4.0. Shipping
// containers, toppled and stacked, radiation crates and generators, moored on
// a pier off the city's south-east corner. tools/fbx-to-glb.mjs packs the
// supplied glTF and its textures into this one file, rebuilt with:
//   MESHOPT=1 MAX_TEXTURE=1024 node tools/fbx-to-glb.mjs \
//     map-79-void/source/skibidi_toilet_79_map/scene.gltf map-79-void/skibidi-toilet-79.glb
export const YARD_ASSET = 'map-79-void/skibidi-toilet-79.glb';
// The map measures in metres. At 1.8 a metre its containers stand to the
// city's scale. y lays the pier level with the quay it is reached from, and x
// and z bring the jetty's landing to the open paving between the corner's two
// trees, at x 170.
export const YARD_TRANSFORM = { scale:1.8, rotation:0, x:163.7, y:.45, z:137.8 };
// How the navigator reads these meshes. See createNavigation for the terms.
// The pier is the only floor; everything standing on it is in the way.
export const YARD_TERRAIN = { ground:/yard-floor/, solid:/./, walkable:Infinity };
// The map stands the yard in a void: a slab 256 metres across and ten deep.
// Moored in a harbour, only a pier of it is kept, a dozen metres clear of the
// stacks on every side, in metres. Its texture tiles every four, as the slab's did.
const FLOOR = 'material_3';
const PIER = { minX:-21, maxX:32, minZ:-6, maxZ:46, depth:10, tile:4 };
// A metre in from the pier's north edge, between the radiation crates and the
// generators: the crossing lands here.
const JETTY_END = { x:3.5, z:PIER.minZ + 1 };

function pier(material) {
  const { minX, maxX, minZ, maxZ, depth, tile } = PIER;
  // The packed slab's texture transform undoes the quantising of its UVs; the
  // pier's are plain, so its map is read untransformed.
  material.map.offset.set(0, 0); material.map.repeat.set(1, 1); material.map.rotation = 0;
  const geometry = new THREE.BoxGeometry(maxX - minX, depth, maxZ - minZ).translate((minX + maxX) / 2, -depth / 2, (minZ + maxZ) / 2);
  const { position, normal, uv } = geometry.attributes;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const [u, v] = Math.abs(normal.getY(i)) > .5 ? [x, z] : Math.abs(normal.getX(i)) > .5 ? [z, y] : [x, y];
    uv.setXY(i, u / tile, v / tile);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'yard-floor'; mesh.receiveShadow = true;
  return mesh;
}

export async function loadYardDistrict({ lowPower = false } = {}) {
  const assetURL = new URL(YARD_ASSET, import.meta.url);
  const layout = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(assetURL.href)).scene;
  let slab = null;
  layout.traverse(mesh => { if (mesh.isMesh && mesh.material.name === FLOOR) slab = mesh; });
  if (!slab) throw new Error('The container yard is missing its floor.');
  // The slab's node carries the dequantisation of its own vertices, so the
  // pier replaces it at the root of the model rather than inside that node.
  const floor = pier(slab.material);
  slab.removeFromParent(); slab.geometry.dispose();
  layout.add(floor);
  layout.position.set(YARD_TRANSFORM.x, YARD_TRANSFORM.y, YARD_TRANSFORM.z);
  layout.rotation.y = YARD_TRANSFORM.rotation;
  layout.scale.setScalar(YARD_TRANSFORM.scale);
  layout.updateMatrixWorld(true);
  const root = new THREE.Group(); root.name = 'Skibidi Yard'; root.add(layout);
  const meshes = [], materials = new Set();
  layout.traverse(mesh => {
    if (!mesh.isMesh) return;
    meshes.push(mesh);
    mesh.receiveShadow = true; mesh.castShadow = mesh !== floor;
    materials.add(mesh.material);
    if (mesh.material.map) mesh.material.map.anisotropy = lowPower ? 1 : 4;
  });
  const box = new THREE.Box3().setFromObject(floor);
  const bounds = { minX:box.min.x, maxX:box.max.x, minZ:box.min.z, maxZ:box.max.z };
  const landing = new THREE.Vector3(JETTY_END.x, 0, JETTY_END.z).applyMatrix4(layout.matrixWorld);
  return {
    root, layout, bounds, meshes, landing,
    terrain:{ ...YARD_TERRAIN, layout },
    asset:YARD_ASSET,
    setQuality(low) {
      for (const mesh of meshes) mesh.castShadow = mesh !== floor && !low;
      for (const material of materials) if (material.map) material.map.anisotropy = low ? 1 : 4;
    },
  };
}
