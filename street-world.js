import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeMapResources } from './map-resources.js';

// Supplied Sketchfab scene by dasy444, under the Sketchfab Standard license.
export const STREET_ASSET = 'street_city_7_for_games_free.glb';
// Preserve the export's orientation and centimetre conversion. Four times its
// scene scale fits the shop doors and pavement to the game's three-unit hero.
export const STREET_TRANSFORM = Object.freeze({ scale:4, rotation:0, x:-400, y:.45, z:-320 });
export const STREET_ARRIVAL = Object.freeze({ x:-412, z:-300, radius:2 });
// Only these five meshes are asphalt and pavement. Other Plane meshes are
// storefronts, so treating every Plane as ground would put arrivals on roofs.
// The low reach keeps upstairs trim and lamp arms from closing the road below.
export const STREET_TERRAIN = {
  ground:/^Plane(?:003|005|006|007)?_Material009_0$/,
  solid:/./, standing:1.1, reach:4, walkable:1.2,
};

export async function loadStreetDistrict({ lowPower = false } = {}) {
  const layout = (await new GLTFLoader().loadAsync(new URL(STREET_ASSET, import.meta.url).href)).scene;
  const root = new THREE.Group(); root.name = 'Street City'; root.add(layout);
  try {
    // The artist's seven detached kit examples sit beyond the street with no
    // ground beneath them. Keep their placed copies; retire only the preview
    // row's geometry, since its materials and textures are shared by the town.
    const previews = [], unusedGeometry = new Set();
    layout.traverse(node => { if (/^(?:Cube00[123]|Plane00[1248])$/.test(node.name)) previews.push(node); });
    for (const node of previews) {
      node.traverse(mesh => { if (mesh.geometry) unusedGeometry.add(mesh.geometry); });
      node.removeFromParent();
    }
    layout.traverse(mesh => { if (mesh.geometry) unusedGeometry.delete(mesh.geometry); });
    for (const geometry of unusedGeometry) geometry.dispose();
    layout.position.set(STREET_TRANSFORM.x, STREET_TRANSFORM.y, STREET_TRANSFORM.z);
    layout.rotation.y = STREET_TRANSFORM.rotation;
    layout.scale.setScalar(STREET_TRANSFORM.scale);
    layout.updateMatrixWorld(true);
    const meshes = [], materials = new Set(), textures = new Set(), floorBox = new THREE.Box3();
    layout.traverse(mesh => {
      if (!mesh.isMesh) return;
      const floor = STREET_TERRAIN.ground.test(mesh.name);
      if (floor) floorBox.union(new THREE.Box3().setFromObject(mesh));
      meshes.push(mesh); mesh.receiveShadow = true;
      mesh.userData.streetShadow = !floor;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    if (floorBox.isEmpty()) throw new Error('Street City is missing its road and pavement.');
    // Background building shells extend beyond the pavement. The playable
    // boundary follows the street, with navigation sealing its irregular edge.
    const bounds = { minX:floorBox.min.x, maxX:floorBox.max.x, minZ:floorBox.min.z, maxZ:floorBox.max.z };
    const setQuality = low => {
      for (const mesh of meshes) mesh.castShadow = mesh.userData.streetShadow && !low;
      for (const texture of textures) texture.anisotropy = low ? 1 : 4;
    };
    setQuality(lowPower);
    return { root, layout, meshes, materials:[...materials], bounds,
      terrain:{ ...STREET_TERRAIN, layout }, asset:STREET_ASSET, setQuality,
    };
  } catch (error) {
    disposeMapResources(root);
    throw error;
  }
}
