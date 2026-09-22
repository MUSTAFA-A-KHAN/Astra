import * as THREE from 'three';

// The supplied model batches whole streets and several houses into each mesh.
// Derive footprints from its triangles: a mesh-wide box would seal the roads.
export function createCityNavigation(layout, bounds, { cellSize = .75 } = {}) {
  const minX = Math.floor(bounds.minX / cellSize) * cellSize;
  const minZ = Math.floor(bounds.minZ / cellSize) * cellSize;
  const width = Math.ceil((bounds.maxX - minX) / cellSize);
  const depth = Math.ceil((bounds.maxZ - minZ) / cellSize);
  const tops = new Float32Array(width * depth);
  const surfaceTiles = new Map(), tileSize = 8;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  let triangleCount = 0, surfaceCount = 0;

  function mark(x, z, top) {
    const ix = Math.floor((x - minX) / cellSize), iz = Math.floor((z - minZ) / cellSize);
    if (ix >= 0 && iz >= 0 && ix < width && iz < depth) {
      const i = iz * width + ix; tops[i] = Math.max(tops[i], top);
    }
  }
  function edge(p, q, top) {
    const steps = Math.ceil(Math.max(Math.abs(p.x - q.x), Math.abs(p.z - q.z)) / (cellSize * .45));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      mark(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t, top);
    }
  }
  function footprint(top) {
    edge(a, b, top); edge(b, c, top); edge(c, a, top);
    const denominator = (b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    if (Math.abs(denominator) < 1e-8) return;
    const x0 = Math.max(0, Math.floor((Math.min(a.x,b.x,c.x)-minX)/cellSize));
    const x1 = Math.min(width-1, Math.floor((Math.max(a.x,b.x,c.x)-minX)/cellSize));
    const z0 = Math.max(0, Math.floor((Math.min(a.z,b.z,c.z)-minZ)/cellSize));
    const z1 = Math.min(depth-1, Math.floor((Math.max(a.z,b.z,c.z)-minZ)/cellSize));
    for (let iz=z0; iz<=z1; iz++) for (let ix=x0; ix<=x1; ix++) {
      const x=minX+(ix+.5)*cellSize, z=minZ+(iz+.5)*cellSize;
      const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/denominator;
      const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/denominator;
      if (u>=0 && v>=0 && u+v<=1) {
        const i=iz*width+ix; tops[i]=Math.max(tops[i],top);
      }
    }
  }
  function addSurface() {
    const denominator=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    if(Math.abs(denominator)<1e-8) return;
    const t=[a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,1/denominator];
    for(let x=Math.floor(Math.min(a.x,b.x,c.x)/tileSize);x<=Math.floor(Math.max(a.x,b.x,c.x)/tileSize);x++) {
      for(let z=Math.floor(Math.min(a.z,b.z,c.z)/tileSize);z<=Math.floor(Math.max(a.z,b.z,c.z)/tileSize);z++) {
        const key=`${x},${z}`;
        if(!surfaceTiles.has(key)) surfaceTiles.set(key,[]);
        surfaceTiles.get(key).push(t);
      }
    }
    surfaceCount++;
  }
  layout.updateMatrixWorld(true);
  layout.traverse(mesh => {
    if (!mesh.isMesh) return;
    const building = mesh.name.includes('houses');
    const terrain = /streets|floor|earth|canals/.test(mesh.name);
    const positions=mesh.geometry.attributes.position, indices=mesh.geometry.index;
    const count=indices ? indices.count : positions.count;
    triangleCount+=count/3;
    for(let i=0;i<count;i+=3) {
      a.fromBufferAttribute(positions,indices ? indices.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions,indices ? indices.getX(i+1) : i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions,indices ? indices.getX(i+2) : i+2).applyMatrix4(mesh.matrixWorld);
      const low=Math.min(a.y,b.y,c.y), high=Math.max(a.y,b.y,c.y);
      if(building && high>.75) footprint(Math.ceil(high/4)*4);
      // Street batches include cars, bins, posts and lamps as well as asphalt.
      // Keep their lower solid parts; overhead lamp arms remain passable.
      else if(terrain && low<5 && high>.95) footprint(Math.ceil(Math.min(high,8)/2)*2);
      if(terrain && high<1.15) {
        normal.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a)).normalize();
        if(normal.y>.45) addSurface();
      }
    }
  });

  function sampleHeight(x,z) {
    const triangles=surfaceTiles.get(`${Math.floor(x/tileSize)},${Math.floor(z/tileSize)}`);
    let y=-Infinity;
    if(triangles) for(const t of triangles) {
      const u=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))*t[9];
      const v=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))*t[9];
      if(u>=-.00001 && v>=-.00001 && u+v<=1.00001) y=Math.max(y,u*t[1]+v*t[4]+(1-u-v)*t[7]);
    }
    return y;
  }
  // Seal open water and the irregular edge of the model. These cells never
  // obstruct the camera, and prevent walking off the supplied pavement.
  for(let iz=0;iz<depth;iz++) for(let ix=0;ix<width;ix++) {
    const i=iz*width+ix;
    if(!tops[i] && sampleHeight(minX+(ix+.5)*cellSize,minZ+(iz+.5)*cellSize)<-1.1) tops[i]=-1;
  }
  function clear(x,z,radius=.8) {
    if(x-radius<bounds.minX || x+radius>bounds.maxX || z-radius<bounds.minZ || z+radius>bounds.maxZ) return false;
    const ix0=Math.max(0,Math.floor((x-radius-minX)/cellSize)), ix1=Math.min(width-1,Math.floor((x+radius-minX)/cellSize));
    const iz0=Math.max(0,Math.floor((z-radius-minZ)/cellSize)), iz1=Math.min(depth-1,Math.floor((z+radius-minZ)/cellSize));
    for(let iz=iz0;iz<=iz1;iz++) for(let ix=ix0;ix<=ix1;ix++) {
      if(!tops[iz*width+ix]) continue;
      const dx=x-THREE.MathUtils.clamp(x,minX+ix*cellSize,minX+(ix+1)*cellSize);
      const dz=z-THREE.MathUtils.clamp(z,minZ+iz*cellSize,minZ+(iz+1)*cellSize);
      if(dx*dx+dz*dz<radius*radius+.00001) return false;
    }
    return true;
  }
  const reachable=new Uint8Array(width*depth);
  function findClear(x,z,radius,requireReachable) {
    let best=null,bestDistance=Infinity;
    for(let iz=0;iz<depth;iz++) for(let ix=0;ix<width;ix++) {
      if(tops[iz*width+ix] || (requireReachable && !reachable[iz*width+ix])) continue;
      const px=minX+(ix+.5)*cellSize,pz=minZ+(iz+.5)*cellSize,d=(px-x)**2+(pz-z)**2;
      if(d<bestDistance && clear(px,pz,radius)) { best={x:px,z:pz}; bestDistance=d; }
    }
    if(!best) throw new Error('The city model has no reachable street at the requested clearance.');
    return {...best,y:sampleHeight(best.x,best.z)};
  }
  const spawn=findClear(0,18,3.5,false);
  const start=Math.floor((spawn.z-minZ)/cellSize)*width+Math.floor((spawn.x-minX)/cellSize);
  const queue=new Int32Array(width*depth); queue[0]=start; reachable[start]=1;
  let count=1;
  for(let head=0;head<count;head++) {
    const i=queue[head],ix=i%width,iz=Math.floor(i/width);
    for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx=ix+dx,nz=iz+dz,ni=nz*width+nx;
      if(nx<0 || nz<0 || nx>=width || nz>=depth || reachable[ni] || tops[ni]) continue;
      if(!clear(minX+(nx+.5)*cellSize,minZ+(nz+.5)*cellSize,.78)) continue;
      reachable[ni]=1;queue[count++]=ni;
    }
  }
  function isWalkable(x,z,radius=.8) {
    const ix=Math.floor((x-minX)/cellSize),iz=Math.floor((z-minZ)/cellSize);
    return ix>=0 && iz>=0 && ix<width && iz<depth && !!reachable[iz*width+ix] && clear(x,z,radius);
  }
  function findWalkable(x,z,radius=1.5) {
    return isWalkable(x,z,radius) ? {x,y:sampleHeight(x,z),z} : findClear(x,z,radius,true);
  }
  const colliders=[], active=new Map();
  for(let iz=0;iz<depth;iz++) {
    const next=new Map();
    for(let ix=0;ix<width;) {
      const top=tops[iz*width+ix];
      if(!top) { ix++; continue; }
      const startX=ix;
      while(ix<width && tops[iz*width+ix]===top) ix++;
      const key=`${startX}:${ix}:${top}`;
      const previous=active.get(key);
      if(previous) { previous.d+=cellSize;previous.z+=cellSize/2;next.set(key,previous); }
      else {
        const box={x:minX+(startX+ix)*cellSize/2,z:minZ+(iz+.5)*cellSize,w:(ix-startX)*cellSize,d:cellSize,bottom:-10,top:top<0?5:top,noCamera:top<0};
        colliders.push(box);next.set(key,box);
      }
    }
    active.clear();for(const [key,value] of next) active.set(key,value);
  }
  return {
    colliders, spawn, isWalkable, findWalkable,
    getHeight(x,z) { const h=sampleHeight(x,z);return Number.isFinite(h)?h:0; },
    getNormal(x,z,out) {
      const dx=sampleHeight(x-.12,z)-sampleHeight(x+.12,z), dz=sampleHeight(x,z-.12)-sampleHeight(x,z+.12);
      out.x=Number.isFinite(dx)?dx:0;out.y=.24;out.z=Number.isFinite(dz)?dz:0;
      const length=Math.hypot(out.x,out.y,out.z);out.x/=length;out.y/=length;out.z/=length;return out;
    },
    diagnostics:{triangleCount,surfaceCount,colliderCount:colliders.length,reachableCells:count},
  };
}
