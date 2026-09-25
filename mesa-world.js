import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { chunkMeshes } from './streaming.js';
import { bank } from './bank.js';

// The sixth district: "Worldmachine Terrain", by Hannes Delbeke
// (https://sketchfab.com/han), used under CC-BY-4.0. A wind-carved butte on a
// plain of red sand, moored off the city's south quay, west of the yard.
// Loaded as supplied, and only once the player turns it on in the settings:
// world-map.js imports this module then.
export const MESA_ASSET = 'map/worldmachine_terrain.glb';
// The model stands some kilometres from its own origin: it is first brought
// home, its middle over the origin and its lowest sand at nought. At 8 the
// plain is some two hundred strides across and the butte stands five houses
// high. Turned about, the gully that climbs its southern face runs down to the
// city, and x and z land the foot of that gully just across the harbour wall
// from an open stretch of the south quay, clear of its trees. The lowest sand
// is left level with the harbour's floor, clear of what the navigator reads
// as water.
export const MESA_TRANSFORM = { scale:8, rotation:Math.PI, x:-5, y:0, z:223.4 };
// How the navigator reads these meshes. See createNavigation for the terms.
// The whole model is one sculpted surface, cliffs and all: nothing on it
// stands in the way but its own slopes, which the controller climbs or slides
// down by their steepness.
export const MESA_TERRAIN = { ground:/mesa-ground/, sheer:true, walkable:Infinity };
// The foot of the gully, on the plain's edge, in the model's units once
// brought home: the jetty lands here.
const GULLY_FOOT = { x:0, z:13.3 };

// The model's one material is written in the specular-glossiness extension,
// which three.js no longer reads: without it the sand loads as bare, fully
// metallic grey. A standard material can show its colour and its sheen.
function specularGlossiness(parser) {
  const name = 'KHR_materials_pbrSpecularGlossiness';
  return {
    name,
    extendMaterialParams(index, params) {
      const extension = parser.json.materials[index].extensions?.[name];
      if (!extension) return Promise.resolve();
      params.color.setRGB(...(extension.diffuseFactor ?? [1,1,1]).slice(0, 3), THREE.LinearSRGBColorSpace);
      params.metalness = 0; params.roughness = 1 - (extension.glossinessFactor ?? 1);
      return extension.diffuseTexture ? parser.assignTexture(params, 'map', extension.diffuseTexture, THREE.SRGBColorSpace) : Promise.resolve();
    },
  };
}

export async function loadMesaDistrict({ lowPower = false, waterline = 0 } = {}) {
  const assetURL = new URL(MESA_ASSET, import.meta.url);
  const model = (await new GLTFLoader().register(specularGlossiness).loadAsync(assetURL.href)).scene;
  const home = new THREE.Box3().setFromObject(model), middle = home.getCenter(new THREE.Vector3());
  model.position.set(-middle.x, -home.min.y, -middle.z);
  const layout = new THREE.Group(); layout.add(model);
  layout.position.set(MESA_TRANSFORM.x, MESA_TRANSFORM.y, MESA_TRANSFORM.z);
  layout.rotation.y = MESA_TRANSFORM.rotation;
  layout.scale.setScalar(MESA_TRANSFORM.scale);
  layout.updateMatrixWorld(true);
  const meshes = [], materials = new Set();
  model.traverse(mesh => { if (mesh.isMesh) meshes.push(mesh); });
  if (!meshes.length) throw new Error('The mesa model has no ground.');
  for (const mesh of meshes) {
    mesh.name = 'mesa-ground'; mesh.receiveShadow = mesh.castShadow = true;
    materials.add(mesh.material);
    if (mesh.material.map) mesh.material.map.anisotropy = lowPower ? 1 : 4;
  }
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  // Red sand under the plain's edge, darkening to wet at the waterline.
  const footing = bank(meshes, { waterline, turf:'#b48b62', wet:'#4a3526', name:'mesa-bank' });
  // Where the gully's foot lies on the supplied ground, before that ground is
  // merged away.
  const landing = new THREE.Vector3(GULLY_FOOT.x, 0, GULLY_FOOT.z).applyMatrix4(layout.matrixWorld);
  const hit = new THREE.Raycaster(new THREE.Vector3(landing.x, box.max.y + 5, landing.z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes, false)[0];
  if (!hit) throw new Error('The mesa has no ground at the foot of its gully.');
  landing.y = hit.point.y;
  // The plain comes as three great meshes: cut into chunks, only those near the
  // player are drawn, and only those in the sun's small frustum cast shadow.
  const chunks = chunkMeshes(layout, meshes);
  const root = new THREE.Group(); root.name = 'Red Mesa'; root.add(layout, footing);
  const bounds = { minX:box.min.x, maxX:box.max.x, minZ:box.min.z, maxZ:box.max.z };
  return {
    root, layout, bounds, landing,
    meshes:[...chunks, footing],
    terrain:{ ...MESA_TERRAIN, layout },
    asset:MESA_ASSET,
    setQuality(low) {
      for (const chunk of chunks) chunk.castShadow = !low;
      for (const material of materials) if (material.map) material.map.anisotropy = low ? 1 : 4;
    },
  };
}
