import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { chunkMeshes } from './streaming.js';
import { bank } from './bank.js';

// The fifth district: "a forest (3) with a road at night for game", by dasy444
// (https://sketchfab.com/dasy444), used under CC-BY-4.0. A square of wooded
// hillside with a dirt road winding through its valley, moored off the city's
// north quay, across the city from the yard. Loaded as supplied, and only once
// the player turns it on in the settings: world-map.js imports this module then.
export const NIGHTWOOD_ASSET = 'map/a_forest_3_with_a_road_at_night_for_game.glb';
// The model is built small: its road is half a unit wide and its tallest pine
// under three. At 14 the road takes a hero and a horse abreast, and the pines
// stand twice the height of the city's houses. Turned about, the road's
// northern end, where it runs straight between its banks, faces the city; x
// and z bring that end due north of the arrival point, on the line of the main
// road. y lifts the valley floor clear of the harbour: the navigator reads
// any ground more than a metre or so below the quay as open water.
export const NIGHTWOOD_TRANSFORM = { scale:14, rotation:Math.PI, x:33.6, y:3, z:-225.9 };
// How the navigator reads these meshes. See createNavigation for the terms.
// As on the Pine Islet, only trunks stand in the way: the undergrowth, and the
// cards the smaller trees are drawn on, are walked through. The ground climbs
// from the road to its banks, so both limits are read against the turf.
export const NIGHTWOOD_TERRAIN = {
  ground:/nightwood-ground/, solid:/nightwood-trunk/,
  relative:true, standing:1.2, reach:2, walkable:Infinity,
};
// Which of the model's three materials is which.
const ROLES = { 'Material.003':'nightwood-ground', 'Material.004':'nightwood-trunk', 'Material':'nightwood-foliage' };
// The road's end at the model's northern edge, in the model's units: the jetty
// lands here.
const ROAD_END = { x:2.4, z:-3.9 };
export async function loadNightwoodDistrict({ lowPower = false, waterline = 0 } = {}) {
  const assetURL = new URL(NIGHTWOOD_ASSET, import.meta.url);
  const layout = (await new GLTFLoader().loadAsync(assetURL.href)).scene;
  layout.position.set(NIGHTWOOD_TRANSFORM.x, NIGHTWOOD_TRANSFORM.y, NIGHTWOOD_TRANSFORM.z);
  layout.rotation.y = NIGHTWOOD_TRANSFORM.rotation;
  layout.scale.setScalar(NIGHTWOOD_TRANSFORM.scale);
  layout.updateMatrixWorld(true);
  let ground = null;
  const found = [];
  layout.traverse(mesh => { if (mesh.isMesh) found.push(mesh); });
  for (const mesh of found) {
    const role = ROLES[mesh.material.name];
    if (!role) throw new Error(`The night wood has a material it does not know: ${mesh.material.name}.`);
    mesh.name = role;
    if (role === 'nightwood-ground') ground = mesh;
  }
  if (!ground) throw new Error('The night wood is missing its ground.');
  // Beside the square, the model keeps a row of its trees and grasses laid out
  // one of each, as a palette to plant from. Only what stands on the ground
  // belongs to the wood.
  const box = new THREE.Box3().setFromObject(ground), centre = new THREE.Vector3(), part = new THREE.Box3();
  const meshes = found.filter(mesh => {
    part.setFromObject(mesh).getCenter(centre);
    if (centre.x >= box.min.x && centre.x <= box.max.x && centre.z >= box.min.z && centre.z <= box.max.z) return true;
    mesh.removeFromParent(); mesh.geometry.dispose();
    return false;
  });
  const materials = new Set(meshes.map(mesh => mesh.material));
  for (const material of materials) {
    // The ground is exported perfectly smooth, which shines like wet glass.
    if (material.name === 'Material.003') material.roughness = 1;
    // The foliage is photographs cut out by their alpha. Blended, a thousand
    // overlapping cards cannot be drawn in order; tested, they need no order,
    // and they cast the shadows of their leaves rather than of their cards.
    if (material.name === 'Material') { material.transparent = false; material.alphaTest = .5; material.depthWrite = true; }
    if (material.map) material.map.anisotropy = lowPower ? 1 : 4;
  }
  for (const mesh of meshes) { mesh.receiveShadow = true; mesh.castShadow = mesh !== ground; }
  // Dry earth under the turf, darkening to wet at the waterline.
  const footing = bank([ground], { waterline, turf:'#6b5946', wet:'#2a231d', name:'nightwood-bank' });
  // Where the road's end lies on the supplied ground, before that ground is
  // merged away.
  const landing = new THREE.Vector3(ROAD_END.x, 0, ROAD_END.z).applyMatrix4(layout.matrixWorld);
  const hit = new THREE.Raycaster(new THREE.Vector3(landing.x, box.max.y + 5, landing.z), new THREE.Vector3(0, -1, 0)).intersectObject(ground, false)[0];
  if (!hit) throw new Error('The night wood has no ground at the end of its road.');
  landing.y = hit.point.y;
  // Some fifteen hundred small meshes: merged into chunks, a few dozen draws,
  // and only the chunks near the player among them.
  const chunks = chunkMeshes(layout, meshes, { key:mesh => `${mesh.material.uuid}|${mesh.name}` });
  const root = new THREE.Group(); root.name = 'Nightwood'; root.add(layout, footing);
  const bounds = { minX:box.min.x, maxX:box.max.x, minZ:box.min.z, maxZ:box.max.z };
  return {
    root, layout, bounds, landing,
    meshes:[...chunks, footing],
    terrain:{ ...NIGHTWOOD_TERRAIN, layout },
    asset:NIGHTWOOD_ASSET,
    setQuality(low) {
      for (const chunk of chunks) chunk.castShadow = chunk.name !== 'nightwood-ground' && !low;
      for (const material of materials) if (material.map) material.map.anisotropy = low ? 1 : 4;
    },
  };
}
