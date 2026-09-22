import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCityNavigation } from './city-navigation.js';

export const CITY_ASSET = 'City_Set_-_Proto_Series/City_Set_-_Proto_Series.gltf';
// Source geometry uses Y-up centimetres. Its principal road intersection is
// (-3300, 2000); this places that crossing at the game's arrival point (0,18).
export const CITY_TRANSFORM = { scale:.018, x:59.4, y:.45, z:-18 };

export async function createCityWorld(scene, { lowPower = false } = {}) {
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
  const navigation=createCityNavigation(layout,bounds);
  const landmarks=[
    {id:'shrine',name:'Moonwell Sanctuary',...navigation.findWalkable(0,-50,4),color:'#83e6ee'},
    {id:'camp',name:'Wanderer’s Camp',...navigation.findWalkable(-45,25,3),color:'#ffc681'},
    {id:'watch',name:'Sunstone Watch',...navigation.findWalkable(50,-20,3),color:'#f1d087'},
  ];
  const markerGeometry=new THREE.OctahedronGeometry(1);
  const ringGeometry=new THREE.TorusGeometry(2,.055,6,48);
  const markers=[];
  for(const landmark of landmarks) {
    const group=new THREE.Group();group.name=landmark.name;group.position.set(landmark.x,landmark.y,landmark.z);root.add(group);
    const mat=new THREE.MeshStandardMaterial({color:landmark.color,emissive:landmark.color,emissiveIntensity:.9,metalness:.2,roughness:.3});
    const crystal=new THREE.Mesh(markerGeometry,mat);crystal.position.y=landmark.id==='shrine'?3.4:2.6;
    crystal.scale.set(landmark.id==='shrine'?.95:.6,landmark.id==='shrine'?1.7:1,.7);group.add(crystal);
    const ring=new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:landmark.color,transparent:true,opacity:.8,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.position.y=.12;group.add(ring);
    const light=new THREE.PointLight(landmark.color,5,10,2);light.position.y=2.6;group.add(light);
    markers.push({crystal,ring,light,baseHeight:crystal.position.y});
  }
  // The original model includes canal banks, but no water surface. The level
  // sits inside those banks, below the supplied roads and sidewalks.
  const water=new THREE.Mesh(new THREE.PlaneGeometry(1600,1600),new THREE.MeshStandardMaterial({color:'#355a64',roughness:.34,metalness:.25}));
  water.name='Canal water';water.rotation.x=-Math.PI/2;water.position.y=-6.65;water.receiveShadow=true;root.add(water);
  let daylight=1;
  function setTime(hour) {
    daylight=THREE.MathUtils.clamp(Math.sin((hour-6)/12*Math.PI)*1.4,0,1);
    for(const material of materials) if(material.emissiveMap) material.emissiveIntensity=.08+(1-daylight)*.85;
    for(const marker of markers) {marker.crystal.material.emissiveIntensity=.75+(1-daylight)*.65;marker.light.intensity=2+(1-daylight)*7;}
  }
  function setQuality(level) {
    const low=level==='low'||level==='performance'||level===0;
    for(const mesh of meshes) mesh.castShadow=mesh.userData.cityShadow&&!low;
    for(const marker of markers) marker.light.visible=!low;
    for(const material of materials) if(material.map) material.map.anisotropy=low?1:4;
  }
  function update(dt,time) {
    for(let i=0;i<markers.length;i++) {
      const marker=markers[i];marker.crystal.rotation.y=time*.35+i;
      marker.crystal.position.y=marker.baseHeight+Math.sin(time*1.2+i)*.16;
      marker.ring.material.opacity=.6+Math.sin(time*.9+i)*.12;
    }
  }
  setQuality(lowPower?'low':'high');setTime(15.5);scene.add(root);
  const diagnostics={ready:true,provider:'city-set-proto-series',asset:CITY_ASSET,meshCount:meshes.length,...navigation.diagnostics};
  return {
    ...navigation,bounds,landmarks,update,setTime,setQuality,diagnostics,
    dispose() {
      const geometries=new Set(),usedMaterials=new Set(),textures=new Set();
      root.traverse(object=>{
        if(object.geometry) geometries.add(object.geometry);
        for(const material of Array.isArray(object.material)?object.material:object.material?[object.material]:[]) usedMaterials.add(material);
      });
      for(const material of usedMaterials) for(const value of Object.values(material)) if(value?.isTexture) textures.add(value);
      for(const geometry of geometries) geometry.dispose();
      for(const material of usedMaterials) material.dispose();
      for(const texture of textures) texture.dispose();
      scene.remove(root);
    },
  };
}
