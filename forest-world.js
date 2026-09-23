import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The second district: a wooded islet in the harbour west of the city, built
// from the Forest Loner diorama. tools/fbx-to-glb.mjs bakes the supplied FBX
// and its texture folder into this file, one mesh per material.
export const FOREST_ASSET = 'forest-loner-diorama/forest-loner-diorama.glb';
// The diorama models a clearing on its west side and a tree line on its east.
// Turning it about faces that clearing at the city, so the jetty lands in the
// open. Scale puts the cabin door at the height of a hero; y sinks the supplied
// ground until the clearing meets the quay it is moored to.
export const FOREST_TRANSFORM = { scale:.02, rotation:Math.PI, x:-119.5, y:-1.23, z:11.7 };
// How the navigator reads these meshes. See createNavigation for the terms.
// Only trunks and built things are obstacles: the footprint of every leaf would
// carpet the island, and a diorama's undergrowth is meant to be walked through.
// Its ground climbs from the shore to a wooded bank, so both limits are read
// against the turf: a metre of anything standing on it turns the player aside,
// while branches and eaves that never come down to it stay overhead.
export const FOREST_TERRAIN = {
  ground:/PathGround|Grass_|Hybrid|HorizontalGroundPlane|GroundPlanes/,
  solid:/TreeBark|Rocks|Building|Wood|RoofTile|Keg|Props3|Distillery|SawMachine|Saw_Fence|Banjo|FordF150/,
  relative:true, standing:1.2, reach:2, walkable:Infinity,
};

// How far below the surface the island's rock is carried, so no angle catches
// the plinth's underside from across the water.
const FOOTING_DEPTH = 1.35;

// A diorama is built to stand on a table: its rock plinth stops at a flat
// underside, which above open water leaves the island hovering. Carry the same
// silhouette down past the surface, in plain wet rock — stretching the supplied
// skirt instead would smear its texture over twice the height.
function seatPlinth(geometry, waterline) {
  const position = geometry.attributes.position, index = geometry.index;
  const at = i => (index ? index.getX(i) : i);
  const depth = (waterline - FOOTING_DEPTH - FOREST_TRANSFORM.y) / FOREST_TRANSFORM.scale;
  const underside = [];
  const point = (i, y) => underside.push(position.getX(i), y ?? position.getY(i), position.getZ(i));
  for (let t = 0; t < (index ? index.count : position.count); t += 3) {
    for (const [p, q] of [[at(t), at(t+1)], [at(t+1), at(t+2)], [at(t+2), at(t)]]) {
      // The underside's own edges are the outline to carry down.
      if (position.getY(p) > -90 || position.getY(q) > -90) continue;
      point(p); point(q, depth); point(q);
      point(p); point(p, depth); point(q, depth);
    }
  }
  const footing = new THREE.BufferGeometry();
  footing.setAttribute('position', new THREE.Float32BufferAttribute(underside, 3));
  footing.computeVertexNormals();
  const mesh = new THREE.Mesh(footing, new THREE.MeshStandardMaterial({ color:'#78736a', roughness:1, side:THREE.DoubleSide }));
  mesh.name = 'island-footing'; mesh.receiveShadow = true;
  return mesh;
}

export async function loadForestDistrict({ lowPower = false, waterline = 0 } = {}) {
  const assetURL=new URL(FOREST_ASSET,import.meta.url);
  const gltf=await new GLTFLoader().loadAsync(assetURL.href);
  const layout=gltf.scene;
  layout.position.set(FOREST_TRANSFORM.x,FOREST_TRANSFORM.y,FOREST_TRANSFORM.z);
  layout.rotation.y=FOREST_TRANSFORM.rotation;
  layout.scale.setScalar(FOREST_TRANSFORM.scale);
  const root=new THREE.Group();root.name='Forest Loner diorama';root.add(layout);
  const meshes=[],materials=new Set(),ground=[];
  let plinth=null;
  layout.traverse(mesh=>{
    if(!mesh.isMesh) return;
    meshes.push(mesh);
    const floor=FOREST_TERRAIN.ground.test(mesh.name);
    if(floor) ground.push(mesh);
    if(mesh.name==='SideGround_01_sh') plinth=mesh;
    mesh.receiveShadow=true;mesh.castShadow=!floor;
    mesh.userData.forestShadow=mesh.castShadow;
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
      materials.add(material);
      if(material.map) material.map.anisotropy=lowPower?1:4;
    }
  });
  if(!ground.length) throw new Error('The forest diorama is missing its ground planes.');
  if(!plinth) throw new Error('The forest diorama is missing its plinth.');
  layout.add(seatPlinth(plinth.geometry, waterline));
  layout.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(layout);
  const bounds={minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z};
  const raycaster=new THREE.Raycaster();
  const down=new THREE.Vector3(0,-1,0),from=new THREE.Vector3();
  return {
    root, layout, bounds, meshes,
    terrain:{...FOREST_TERRAIN,layout},
    asset:FOREST_ASSET,
    // Where the supplied ground actually lies, for anything moored to it.
    heightAt(x,z) {
      raycaster.set(from.set(x,box.max.y+5,z),down);
      const hit=raycaster.intersectObjects(ground,false)[0];
      return hit?hit.point.y:null;
    },
    setQuality(low) {
      for(const mesh of meshes) mesh.castShadow=mesh.userData.forestShadow&&!low;
      for(const material of materials) if(material.map) material.map.anisotropy=low?1:4;
    },
  };
}
