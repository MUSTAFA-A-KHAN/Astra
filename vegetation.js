import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise, hash } from './biomes.js';
import { QUALITY } from './quality.js';

function seeded(seed) {return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function leafTexture() {
  const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const r=seeded(814);
  // A cluster of individual serrated leaves, with open air between branches.
  for(let i=0;i<55;i++) {
    const x=64+(r()-.5)*99,y=64+(r()-.5)*100,a=r()*Math.PI*2,l=7+r()*14;
    g.save();g.translate(x,y);g.rotate(a);g.beginPath();g.moveTo(0,-l);
    for(let j=0;j<9;j++){const t=j/8;g.lineTo(Math.sin(t*Math.PI)*(j%2?l*.47:l*.38),-l+t*l*2);}
    for(let j=8;j>=0;j--){const t=j/8;g.lineTo(-Math.sin(t*Math.PI)*(j%2?l*.47:l*.38),-l+t*l*2);}
    g.closePath();const v=130+Math.floor(r()*100);g.fillStyle=`rgb(${v},${v},${Math.floor(v*.8)})`;g.fill();
    g.strokeStyle='#7e826880';g.lineWidth=.6;g.beginPath();g.moveTo(0,-l);g.lineTo(0,l);g.stroke();g.restore();
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
function barkMaterial() {
  const m=new THREE.MeshStandardMaterial({color:'#797465',roughness:.97});
  m.onBeforeCompile=s=>{
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vBarkPosition;');
    s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBarkPosition=position;');
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vBarkPosition;');
    s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat bark=sin(vBarkPosition.x*49.0+sin(vBarkPosition.y*1.8)*2.0)*sin(vBarkPosition.z*53.0+vBarkPosition.y*.5);diffuseColor.rgb*=.75+.25*bark;');
  };return m;
}
function windMaterial(map,color,uniforms,grass=false) {
  const m=new THREE.MeshStandardMaterial({color,map,alphaTest:map?.42:0,side:THREE.DoubleSide,roughness:.91,vertexColors:false});
  m.onBeforeCompile=s=>{
    Object.assign(s.uniforms,uniforms);
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float uWindTime;uniform vec3 uObserver;varying float vPlantDistance;');
    s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vec4 plantWorld=modelMatrix*instanceMatrix*vec4(position,1.0);
      vPlantDistance=distance(plantWorld.xz,uObserver.xz);
      float bend=${grass?'pow(clamp(position.y,0.0,1.0),2.0)*.14':'clamp(position.y*.08,0.0,1.0)*.17'};
      transformed.x+=sin(uWindTime*1.7+plantWorld.x*.23+plantWorld.z*.16)*bend;
      transformed.z+=cos(uWindTime*1.2+plantWorld.z*.21)*bend*.5;`);
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float uPlantDistance;varying float vPlantDistance;');
    s.fragmentShader=s.fragmentShader.replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nfloat fade=clamp((uPlantDistance-vPlantDistance)/14.0,0.0,1.0);float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);if(grain>fade)discard;');
  };
  m.customProgramCacheKey=()=>grass?'astra-grass':'astra-leaf';return m;
}
function treeGeometry(variant) {
  const trunks=[],leaves=[],r=seeded(55+variant*18),up=new THREE.Vector3(0,1,0),direction=new THREE.Vector3();
  function branch(ax,ay,az,bx,by,bz,width) {
    direction.set(bx-ax,by-ay,bz-az);const g=new THREE.CylinderGeometry(width*.38,width,direction.length(),variant===2?5:7,2);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up,direction.clone().normalize()));g.translate((ax+bx)/2,(ay+by)/2,(az+bz)/2);trunks.push(g);
  }
  const height=variant===1?12:9;
  branch(0,0,0,.14,height,0,variant===2?.18:.32);
  for(let i=0;i<(variant===1?16:11);i++) {
    const a=i*2.4+r()*.6,y=variant===1?3+i*.5:3+r()*4.3;
    const reach=variant===1?(1-(y-3)/10)*3:1.8+r()*1.7;
    const x=Math.sin(a)*reach,z=Math.cos(a)*reach,by=y+(variant===1?.1:1+r());
    branch(0,y,0,x,by,z,.07+(1-y/height)*.1);
    for(let k=0;k<4;k++) {
      const g=new THREE.PlaneGeometry(variant===1?2.6:3.1,variant===1?1.2:2.6);
      g.rotateX((r()-.5)*Math.PI);g.rotateY(a+k*1.9);g.rotateZ(r()*.4);
      g.translate(x*.8+(r()-.5)*1.3,by+(r()-.5)*1.2,z*.8+(r()-.5)*1.3);leaves.push(g);
    }
  }
  for(let k=0;k<6;k++){const g=new THREE.PlaneGeometry(2.6,2.8);g.rotateY(k*1.05);g.rotateX(k*.7);g.translate(0,height-.5,0);leaves.push(g);}
  const trunk=mergeGeometries(trunks),canopy=mergeGeometries(leaves);trunks.forEach(g=>g.dispose());leaves.forEach(g=>g.dispose());
  return {trunk,canopy};
}
function grassGeometry() {
  const p=[];
  for(let i=0;i<5;i++) {const a=i*2.4,c=Math.cos(a),s=Math.sin(a),h=.48+i*.105,x=Math.sin(i*4)*.16,z=Math.cos(i*4)*.16,w=.045;
    p.push(x-c*w,0,z-s*w,x+c*w,0,z+s*w,x+.07,h*.6,z+.025,x+.07,h*.6,z+.025,x+c*w,0,z+s*w,x+.17,h,z+.06);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();return g;
}

export class WorldStreamer {
  constructor(root,terrain,biomes,collision,{lowPower=false,distanceToPaths=()=>999,nearLandmark=()=>false}={}) {
    this.root=root;this.terrain=terrain;this.biomes=biomes;this.collision=collision;this.distanceToPaths=distanceToPaths;this.nearLandmark=nearLandmark;
    this.chunks=new Map();this.queue=[];this.size=64;this.quality=lowPower?'low':'high';this.elapsed=1;this.rebuildTime=0;this.created=0;this.unloaded=0;
    this.dummy=new THREE.Object3D();this.tint=new THREE.Color();this.sample={};this.observer=new THREE.Vector3();
    this.leafMap=leafTexture();this.wind={uWindTime:{value:0},uObserver:{value:this.observer},uPlantDistance:{value:220}};
    this.grassWind={uWindTime:this.wind.uWindTime,uObserver:this.wind.uObserver,uPlantDistance:{value:65}};
    this.bark=barkMaterial();this.leaf=windMaterial(this.leafMap,'#a9b58c',this.wind);
    this.grass=windMaterial(null,'#8e9566',this.grassWind,true);
    this.rock=new THREE.MeshStandardMaterial({color:'#9b9b8c',roughness:.98});
    this.flower=new THREE.MeshStandardMaterial({color:'#ddd6b1',roughness:.9});
    this.treeTypes=[0,1,2].map(treeGeometry);this.blades=grassGeometry();
    this.rockGeo=new THREE.IcosahedronGeometry(1,1);
    const pos=this.rockGeo.attributes.position;for(let i=0;i<pos.count;i++){const n=.87+noise(pos.getX(i)*3,pos.getZ(i)*3,7)*.22;pos.setXYZ(i,pos.getX(i)*n,pos.getY(i)*n*.7,pos.getZ(i)*n);}this.rockGeo.computeVertexNormals();
    this.flowerGeo=new THREE.IcosahedronGeometry(.12,0);this.branchGeo=new THREE.CylinderGeometry(.055,.12,2.4,5);this.branchGeo.rotateZ(Math.PI/2);
    this.farLeaf=this.leaf.clone();this.farLeaf.onBeforeCompile=this.leaf.onBeforeCompile;this.farLeaf.customProgramCacheKey=this.leaf.customProgramCacheKey;
    // Coarse crowns retain porous foliage silhouettes at distance.
    const cards=[];for(let i=0;i<5;i++){const g=new THREE.PlaneGeometry(6,7);g.rotateY(i*Math.PI/5);g.translate(0,7,0);cards.push(g);}this.farGeo=mergeGeometries(cards);cards.forEach(g=>g.dispose());
  }
  setQuality(level) {
    if(this.quality!==level) {this.quality=level;for(const chunk of this.chunks.values())chunk.lod=-1;this.elapsed=1;}
    const q=QUALITY[level];this.wind.uPlantDistance.value=q.drawDistance*.75;this.grassWind.uPlantDistance.value=level==='low'?38:level==='balanced'?58:level==='high'?80:100;
  }
  makeInstances(group,geometry,material,items,kind,shadow=false) {
    if(!items.length)return;
    const mesh=new THREE.InstancedMesh(geometry,material,items.length);mesh.castShadow=shadow;mesh.receiveShadow=true;
    for(let i=0;i<items.length;i++) {
      const item=items[i];this.dummy.position.set(item.x,this.terrain.getHeight(item.x,item.z)+(item.offset||0),item.z);
      this.dummy.rotation.set(item.rx||0,item.yaw,0);this.dummy.scale.set(item.sx||item.scale,item.sy||item.scale,item.sz||item.scale);this.dummy.updateMatrix();mesh.setMatrixAt(i,this.dummy.matrix);
      this.tint.set(kind==='leaf'?['#6e8250','#7e895c','#819172'][item.type%3]:kind==='grass'?['#7b8652','#8d9062','#687749'][item.type%3]:kind==='rock'?'#929285':'#e2d1aa');
      this.tint.multiplyScalar(item.shade);mesh.setColorAt(i,this.tint);
    }
    mesh.computeBoundingSphere();group.add(mesh);group.userData.batches.push({mesh,items});
  }
  build(cx,cz,lod) {
    const key=`${cx},${cz}`;this.unload(key);
    const group=new THREE.Group();group.name=`Environment ${key} LOD${lod}`;group.userData.batches=[];
    const r=seeded((Math.imul(cx,73856093)^Math.imul(cz,19349663)^73277)>>>0),q=QUALITY[this.quality];
    const trees=[[],[],[]],rocks=[],grass=[],flowers=[],branches=[],ids=[],positions=[];
    const x0=cx*this.size,z0=cz*this.size;
    // Tree positions and colliders never change with quality or visible LOD.
    for(let i=0;i<105;i++) {
      const x=x0+r()*this.size,z=z0+r()*this.size,b=this.biomes.sample(x,z,this.sample),roll=r();
      if(roll>b.trees*.27 || b.slope>.24 || this.nearLandmark(x,z,4) || this.distanceToPaths(x,z)<6 || Math.hypot(x,z-18)<12)continue;
      if(positions.some(p=>Math.hypot(x-p.x,z-p.z)<5.3))continue;
      const type=b.key==='mountain'?1:roll>.12?2:noise(x*.03,z*.03,24)>.5?0:1,scale=.82+r()*.62;
      const item={x,z,yaw:r()*6.28,scale,type,shade:.85+r()*.24};trees[type].push(item);positions.push(item);
      const id=`tree:${key}:${i}`;ids.push(id);this.collision.insert(id,{x,z,r:.35*scale,bottom:b.height-.3,top:b.height+(type===1?12:10)*scale,chunk:key});
    }
    for(let i=0;i<36;i++) {
      const x=x0+r()*this.size,z=z0+r()*this.size,b=this.biomes.sample(x,z,this.sample),roll=r();
      if(roll>b.rocks*.53||this.distanceToPaths(x,z)<4.5||this.nearLandmark(x,z,2)||b.key==='lake'||positions.some(p=>Math.hypot(x-p.x,z-p.z)<2))continue;
      const scale=.65+r()*2.5,item={x,z,yaw:r()*6.28,scale,sy:scale*(.5+r()*.8),type:0,offset:scale*.15,shade:.85+r()*.2};rocks.push(item);
      const id=`rock:${key}:${i}`;ids.push(id);this.collision.insert(id,{x,z,r:scale*.85,bottom:b.height-.5,top:b.height+scale*.8,chunk:key});
    }
    if(lod===0) for(let i=0;i<Math.floor(3100*q.vegetation);i++) {
      const x=x0+r()*this.size,z=z0+r()*this.size,b=this.biomes.sample(x,z,this.sample),cluster=noise(x*.09,z*.09,87),roll=r();
      if(roll>b.vegetation*.82 || cluster<.28 || this.distanceToPaths(x,z)<3.9 || this.nearLandmark(x,z,-3)||b.slope>.27)continue;
      const scale=.4+r()*.8,item={x,z,yaw:r()*6.28,scale,type:i%3,shade:.7+r()*.45};grass.push(item);
      if(i%13===0 && r()<b.flowers)flowers.push({...item,offset:scale*.64,scale:.65+r()*.6});
      if(i%160===0 && b.key==='forest')branches.push({...item,offset:.12,scale:.6+r()});
    }
    trees.forEach((items,type)=>{
      if(lod<2) {this.makeInstances(group,this.treeTypes[type].trunk,this.bark,items,'wood',lod===0);this.makeInstances(group,this.treeTypes[type].canopy,this.leaf,items,'leaf',lod===0&&this.quality!=='low');}
      else this.makeInstances(group,this.farGeo,this.farLeaf,items,'leaf');
    });
    this.makeInstances(group,this.rockGeo,this.rock,rocks,'rock',lod===0);
    this.makeInstances(group,this.blades,this.grass,grass,'grass');this.makeInstances(group,this.flowerGeo,this.flower,flowers,'flower');this.makeInstances(group,this.branchGeo,this.bark,branches,'wood');
    this.root.add(group);this.chunks.set(key,{group,lod,cx,cz,ids,revision:this.terrain.revision});this.created++;
  }
  unload(key) {
    const c=this.chunks.get(key);if(!c)return;
    c.ids.forEach(id=>this.collision.remove(id));this.root.remove(c.group);
    c.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});this.chunks.delete(key);this.unloaded++;
  }
  update(dt,time,position,camera=null) {
    this.observer.copy(position);this.wind.uWindTime.value=time;this.elapsed+=dt;this.rebuildTime+=dt;
    const cx=Math.floor(position.x/this.size),cz=Math.floor(position.z/this.size);
    if(this.elapsed>.4) {
      this.elapsed=0;const radius=this.quality==='low'?2:this.quality==='balanced'?3:this.quality==='high'?4:5;
      this.queue.length=0;
      for(let x=cx-radius;x<=cx+radius;x++)for(let z=cz-radius;z<=cz+radius;z++) {
        const dx=x-cx,dz=z-cz,d=Math.hypot(dx,dz);if(d>radius+.2)continue;
        const lod=d<1.7?0:d<2.9?1:2,key=`${x},${z}`,existing=this.chunks.get(key);
        if(!existing||existing.lod!==lod)this.queue.push({cx:x,cz:z,lod,priority:d});
      }
      this.queue.sort((a,b)=>a.priority-b.priority);
      for(const [key,c] of this.chunks)if(Math.hypot(c.cx-cx,c.cz-cz)>radius+1)this.unload(key);
    }
    // At most one content chunk per frame. Spawn neighborhood has priority.
    if(this.queue.length){const next=this.queue.shift();this.build(next.cx,next.cz,next.lod);}
    // Reanchor batches when DEM vertices morph, amortized across frames.
    if(this.terrain.revision && this.rebuildTime>.08) {
      this.rebuildTime=0;
      for(const c of this.chunks.values()) {
        if(c.revision===this.terrain.revision)continue;
        for(const {mesh,items} of c.group.userData.batches)for(let i=0;i<items.length;i++) {
          const item=items[i];mesh.getMatrixAt(i,this.dummy.matrix);this.dummy.matrix.elements[13]=this.terrain.getHeight(item.x,item.z)+(item.offset||0);mesh.setMatrixAt(i,this.dummy.matrix);
        }
        c.group.userData.batches.forEach(({mesh})=>{mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();});
        for(const id of c.ids){const shape=this.collision.entries.get(id),h=this.terrain.getHeight(shape.x,shape.z),height=shape.top-shape.bottom;shape.bottom=h-.3;shape.top=shape.bottom+height;}
        c.revision=this.terrain.revision;break;
      }
    }
  }
  getStats() {return {activeChunks:this.chunks.size,queued:this.queue.length,created:this.created,unloaded:this.unloaded,instances:[...this.chunks.values()].reduce((n,c)=>n+c.group.userData.batches.reduce((a,b)=>a+b.mesh.count,0),0)};}
  dispose() {for(const key of [...this.chunks.keys()])this.unload(key);this.treeTypes.forEach(t=>{t.trunk.dispose();t.canopy.dispose();});[this.blades,this.rockGeo,this.flowerGeo,this.branchGeo,this.farGeo].forEach(g=>g.dispose());[this.bark,this.leaf,this.farLeaf,this.grass,this.rock,this.flower].forEach(m=>m.dispose());this.leafMap.dispose();}
}
