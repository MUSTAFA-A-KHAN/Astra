import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const CITY_ASSET = 'City_Set_-_Proto_Series/City_Set_-_Proto_Series.gltf';
// Source geometry uses Y-up centimetres. Its principal road intersection is
// (-3300, 2000); this places that crossing at the game's arrival point (0,18).
export const CITY_TRANSFORM = { scale:.018, x:59.4, y:.45, z:-18 };
// Where the player lands, and so the ground every reachable place leads back to.
export const CITY_ARRIVAL = { x:0, z:18, radius:3.5 };
// How the navigator reads these meshes. See createNavigation for the terms.
export const CITY_TERRAIN = { ground:/streets|floor|earth|canals/, solid:/houses/, standing:.75, clutter:[5,.95], walkable:1.15 };

export async function loadCityDistrict({ lowPower = false } = {}) {
  const assetURL=new URL(CITY_ASSET,import.meta.url);
  const gltf=await new GLTFLoader().loadAsync(assetURL.href);
  const layout=gltf.scene.getObjectByName('RootNode');
  if(!layout) throw new Error('City terrain is missing its original layout.');
  // Both parents are Sketchfab viewer transforms, including an arbitrary tilt
  // and a translation nearly ten kilometres away. The modelling root is level.
  layout.removeFromParent();layout.position.set(CITY_TRANSFORM.x,CITY_TRANSFORM.y,CITY_TRANSFORM.z);
  layout.quaternion.identity();layout.scale.setScalar(CITY_TRANSFORM.scale);
  const root=new THREE.Group();root.name='City Set — Proto Series';root.add(layout);
  const meshes=[],materials=new Set();
  let floor=null;
  layout.traverse(mesh=>{
    if(!mesh.isMesh) return;
    meshes.push(mesh);mesh.receiveShadow=true;mesh.castShadow=!/floor|earth/.test(mesh.name);
    mesh.userData.cityShadow=mesh.castShadow;
    if(mesh.name.includes('floor') && !floor) floor=mesh;
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
      materials.add(material);
      // Keep the supplied atlas and glow maps. Static architecture does not
      // require the more expensive specular extension used by the viewer export.
      material.roughness=Math.max(material.roughness,.72);
      material.metalness=Math.min(material.metalness,.18);
      if(material.map) material.map.anisotropy=lowPower?1:4;
    }
  });
  if(!floor) throw new Error('City terrain is missing its pavement.');
  layout.updateMatrixWorld(true);
  const floorBox=new THREE.Box3().setFromObject(floor);
  const bounds={minX:floorBox.min.x+.75,maxX:floorBox.max.x-.75,minZ:floorBox.min.z+.75,maxZ:floorBox.max.z-.75};
  return {
    root, layout, bounds, meshes,
    terrain:{...CITY_TERRAIN,layout},
    asset:CITY_ASSET,
    setTime(daylight) {
      for(const material of materials) if(material.emissiveMap) material.emissiveIntensity=.08+(1-daylight)*.85;
    },
    setQuality(low) {
      for(const mesh of meshes) mesh.castShadow=mesh.userData.cityShadow&&!low;
      for(const material of materials) if(material.map) material.map.anisotropy=low?1:4;
    },
  };
}
