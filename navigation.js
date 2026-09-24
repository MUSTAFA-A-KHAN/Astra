import * as THREE from 'three';

// The imported models batch whole streets, houses and whole hillsides into a
// handful of meshes. Derive footprints from their triangles: a mesh-wide box
// would seal the roads, and a single rule would not suit two different models.
//
// A district says how one model's meshes read as terrain:
//   ground    meshes whose upward faces are walked on
//   solid     meshes that are only ever obstacles
//   walkable  the height below which a ground face is floor rather than the
//             scenery standing on it (the city batches cars with its asphalt)
//   clutter   [floor, rise] for obstacles modelled inside those ground batches
//   standing  a solid face reaching above this blocks the way
//   reach     and only if it also comes down this low: branches overhead are
//             part of the same mesh as the trunk that holds them up
//   relative  measures those two from the ground beneath each face instead of
//             from sea level, for a district whose ground is not one level
// A mesh matching neither pattern is scenery: no footprint, no floor.
export function createNavigation(districts, bounds, { cellSize = .75, openings = [], arrival }) {
  const minX = Math.floor(bounds.minX / cellSize) * cellSize;
  const minZ = Math.floor(bounds.minZ / cellSize) * cellSize;
  const width = Math.ceil((bounds.maxX - minX) / cellSize);
  const depth = Math.ceil((bounds.maxZ - minZ) / cellSize);
  const tops = new Float32Array(width * depth);
  const surfaceTiles = new Map(), tileSize = 8;
  const layeredColliders = districts.flatMap(district => district.colliders ?? []);
  const layeredBlocked = new Uint8Array(width * depth);
  let readingLayered = false, readingFloorLimit = Infinity;
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
    const t=[a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,1/denominator,readingLayered,readingFloorLimit];
    for(let x=Math.floor(Math.min(a.x,b.x,c.x)/tileSize);x<=Math.floor(Math.max(a.x,b.x,c.x)/tileSize);x++) {
      for(let z=Math.floor(Math.min(a.z,b.z,c.z)/tileSize);z<=Math.floor(Math.max(a.z,b.z,c.z)/tileSize);z++) {
        const key=`${x},${z}`;
        if(!surfaceTiles.has(key)) surfaceTiles.set(key,[]);
        surfaceTiles.get(key).push(t);
      }
    }
    surfaceCount++;
  }
  function eachTriangle(mesh, visit) {
    const positions=mesh.geometry.attributes.position, indices=mesh.geometry.index;
    const count=indices ? indices.count : positions.count;
    triangleCount+=count/3;
    for(let i=0;i<count;i+=3) {
      a.fromBufferAttribute(positions,indices ? indices.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions,indices ? indices.getX(i+1) : i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions,indices ? indices.getX(i+2) : i+2).applyMatrix4(mesh.matrixWorld);
      visit(Math.min(a.y,b.y,c.y), Math.max(a.y,b.y,c.y));
    }
  }
  for (const district of districts) {
    const { layout, ground = null, solid = null, standing = .75, reach = Infinity, clutter = null, walkable = Infinity, relative = false } = district;
    readingLayered = district.layered === true; readingFloorLimit = district.floorLimit ?? Infinity;
    layout.updateMatrixWorld(true);
    layout.traverse(mesh => {
      if (!mesh.isMesh) return;
      const floor = !!ground?.test(mesh.name);
      const obstacle = !floor && !!solid?.test(mesh.name);
      if (!floor && !obstacle) return;
      // A district measured against its own ground has to wait for the second
      // pass: its floor is not known until every ground face has been read.
      if (obstacle && relative) return;
      eachTriangle(mesh, (low, high) => {
        if(obstacle && high>standing && low<reach) footprint(Math.ceil(high/4)*4);
        // Street batches include cars, bins, posts and lamps as well as asphalt.
        // Keep their lower solid parts; overhead lamp arms remain passable.
        else if(floor && clutter && low<clutter[0] && high>clutter[1]) footprint(Math.ceil(Math.min(high,8)/2)*2);
        if(floor && high<walkable) {
          normal.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a)).normalize();
          if(normal.y>.45) addSurface();
        }
      });
    });
  }

  function sampleHeight(x,z,maxHeight) {
    const triangles=surfaceTiles.get(`${Math.floor(x/tileSize)},${Math.floor(z/tileSize)}`);
    let y=-Infinity;
    if(triangles) for(const t of triangles) {
      const u=((t[5]-t[8])*(x-t[6])+(t[6]-t[3])*(z-t[8]))*t[9];
      const v=((t[8]-t[2])*(x-t[6])+(t[0]-t[6])*(z-t[8]))*t[9];
      if(u>=-.00001 && v>=-.00001 && u+v<=1.00001) {
        const height=u*t[1]+v*t[4]+(1-u-v)*t[7];
        if (!t[10] || height <= (maxHeight ?? t[11]) + .0001) y=Math.max(y,height);
      }
    }
    return y;
  }
  // Hillsides, banks and raised paths: on ground like that a height above sea
  // level says nothing about whether a thing is in the way. A fallen log lying
  // on a bank is not a wall, and a roof three storeys up is not a fence.
  for (const district of districts.filter(d => d.relative && d.solid)) {
    const { layout, ground = null, solid, standing = .75, reach = Infinity } = district;
    layout.traverse(mesh => {
      if (!mesh.isMesh || ground?.test(mesh.name) || !solid.test(mesh.name)) return;
      eachTriangle(mesh, (low, high) => {
        const turf = sampleHeight((a.x+b.x+c.x)/3, (a.z+b.z+c.z)/3);
        if(Number.isFinite(turf) && high>turf+standing && low<turf+reach) footprint(Math.ceil(high/4)*4);
      });
    });
  }
  // Street placement/reachability uses the floor under each wall. Upper-storey
  // walls still collide at their own elevations without closing roads below.
  for (const c of layeredColliders) {
    if (c.ceilingOnly) continue;
    const ix0=Math.max(0,Math.floor((c.x-c.w/2-minX)/cellSize)), ix1=Math.min(width-1,Math.floor((c.x+c.w/2-minX)/cellSize));
    const iz0=Math.max(0,Math.floor((c.z-c.d/2-minZ)/cellSize)), iz1=Math.min(depth-1,Math.floor((c.z+c.d/2-minZ)/cellSize));
    for (let iz=iz0;iz<=iz1;iz++) for (let ix=ix0;ix<=ix1;ix++) {
      const y=sampleHeight(minX+(ix+.5)*cellSize,minZ+(iz+.5)*cellSize);
      if (Number.isFinite(y) && c.bottom<y+3.25 && c.top>y+.95) layeredBlocked[iz*width+ix]=1;
    }
  }
  // Seal open water and the irregular edge of the models. An elevated floor
  // can be the only ground beneath a stair or landing: the street-height
  // placement limit must not turn that floor into an invisible wall.
  for(let iz=0;iz<depth;iz++) for(let ix=0;ix<width;ix++) {
    const i=iz*width+ix;
    if(tops[i]) continue;
    const x=minX+(ix+.5)*cellSize,z=minZ+(iz+.5)*cellSize;
    if(sampleHeight(x,z)<-1.1) {
      if(sampleHeight(x,z,Infinity)<-1.1) tops[i]=-1;
      // Keep street-level spawns and placements out of upper-only cells.
      else layeredBlocked[i]=1;
    }
  }
  // A crossing built between districts decides its own way through: the deck
  // of the jetty is the floor here, not the harbour wall it steps over. Each
  // opening must stay covered by that deck, or it would clear a hole instead.
  for(const opening of openings) {
    const ix0=Math.max(0,Math.floor((opening.x-opening.w/2-minX)/cellSize));
    const ix1=Math.min(width-1,Math.floor((opening.x+opening.w/2-minX)/cellSize));
    const iz0=Math.max(0,Math.floor((opening.z-opening.d/2-minZ)/cellSize));
    const iz1=Math.min(depth-1,Math.floor((opening.z+opening.d/2-minZ)/cellSize));
    for(let iz=iz0;iz<=iz1;iz++) for(let ix=ix0;ix<=ix1;ix++) tops[iz*width+ix]=0,layeredBlocked[iz*width+ix]=0;
  }
  function clear(x,z,radius=.8) {
    if(x-radius<bounds.minX || x+radius>bounds.maxX || z-radius<bounds.minZ || z+radius>bounds.maxZ) return false;
    const ix0=Math.max(0,Math.floor((x-radius-minX)/cellSize)), ix1=Math.min(width-1,Math.floor((x+radius-minX)/cellSize));
    const iz0=Math.max(0,Math.floor((z-radius-minZ)/cellSize)), iz1=Math.min(depth-1,Math.floor((z+radius-minZ)/cellSize));
    for(let iz=iz0;iz<=iz1;iz++) for(let ix=ix0;ix<=ix1;ix++) {
      if(!tops[iz*width+ix] && !layeredBlocked[iz*width+ix]) continue;
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
      if(tops[iz*width+ix] || layeredBlocked[iz*width+ix] || (requireReachable && !reachable[iz*width+ix])) continue;
      const px=minX+(ix+.5)*cellSize,pz=minZ+(iz+.5)*cellSize,d=(px-x)**2+(pz-z)**2;
      if(d<bestDistance && clear(px,pz,radius)) { best={x:px,z:pz}; bestDistance=d; }
    }
    if(!best) throw new Error('The world models have no reachable ground at the requested clearance.');
    return {...best,y:sampleHeight(best.x,best.z)};
  }
  // Everywhere the player can stand is somewhere they can walk to from here.
  const spawn=findClear(arrival.x,arrival.z,arrival.radius,false);
  const start=Math.floor((spawn.z-minZ)/cellSize)*width+Math.floor((spawn.x-minX)/cellSize);
  const queue=new Int32Array(width*depth); queue[0]=start; reachable[start]=1;
  let count=1;
  for(let head=0;head<count;head++) {
    const i=queue[head],ix=i%width,iz=Math.floor(i/width);
    for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx=ix+dx,nz=iz+dz,ni=nz*width+nx;
      if(nx<0 || nz<0 || nx>=width || nz>=depth || reachable[ni] || tops[ni] || layeredBlocked[ni]) continue;
      if(!clear(minX+(nx+.5)*cellSize,minZ+(nz+.5)*cellSize,.78)) continue;
      reachable[ni]=1;queue[count++]=ni;
    }
  }
  function clearAtHeight(x,z,radius,feetY) {
    const floor=sampleHeight(x,z,feetY+.95);
    if (!Number.isFinite(floor) || Math.abs(floor-feetY)>1) return false;
    if(x-radius<bounds.minX || x+radius>bounds.maxX || z-radius<bounds.minZ || z+radius>bounds.maxZ) return false;
    return !layeredColliders.some(c => !c.ceilingOnly && c.top>floor+.95 && c.bottom<floor+3.25 &&
      (x-THREE.MathUtils.clamp(x,c.x-c.w/2,c.x+c.w/2))**2+(z-THREE.MathUtils.clamp(z,c.z-c.d/2,c.z+c.d/2))**2<radius*radius);
  }
  function isWalkable(x,z,radius=.8,feetY) {
    if (Number.isFinite(feetY)) return clearAtHeight(x,z,radius,feetY);
    const ix=Math.floor((x-minX)/cellSize),iz=Math.floor((z-minZ)/cellSize);
    return ix>=0 && iz>=0 && ix<width && iz<depth && !!reachable[iz*width+ix] && clear(x,z,radius);
  }
  function findWalkable(x,z,radius=1.5,feetY) {
    if (Number.isFinite(feetY)) {
      if (clearAtHeight(x,z,radius,feetY)) return {x,y:sampleHeight(x,z,feetY+.95),z};
      for (let distance=.5;distance<=8;distance+=.5) for (let angle=0;angle<Math.PI*2;angle+=Math.PI/12) {
        const px=x+Math.cos(angle)*distance,pz=z+Math.sin(angle)*distance;
        if(clearAtHeight(px,pz,radius,feetY)) return {x:px,y:sampleHeight(px,pz,feetY+.95),z:pz};
      }
      return null;
    }
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
  for (const collider of layeredColliders) colliders.push(collider);
  return {
    colliders, spawn, isWalkable, findWalkable,
    getHeight(x,z) { const h=sampleHeight(x,z);return Number.isFinite(h)?h:0; },
    getSupportHeight(x,z,feetY,step=.48) { const h=sampleHeight(x,z,feetY+step);return Number.isFinite(h)?h:0; },
    getNormal(x,z,out,feetY,step=.48) {
      const limit=Number.isFinite(feetY)?feetY+step:undefined;
      const dx=sampleHeight(x-.12,z,limit)-sampleHeight(x+.12,z,limit), dz=sampleHeight(x,z-.12,limit)-sampleHeight(x,z+.12,limit);
      out.x=Number.isFinite(dx)?dx:0;out.y=.24;out.z=Number.isFinite(dz)?dz:0;
      const length=Math.hypot(out.x,out.y,out.z);out.x/=length;out.y/=length;out.z/=length;return out;
    },
    diagnostics:{triangleCount,surfaceCount,colliderCount:colliders.length,reachableCells:count},
  };
}
