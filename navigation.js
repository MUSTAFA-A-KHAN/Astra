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
//   sheer     its ground is one sculpted hillside: even the faces too steep
//             to stand on are floor, for the controller to slide down, where
//             they would otherwise be holes in the mountain to fall through
// A mesh matching neither pattern is scenery: no footprint, no floor.
export function createNavigation(districts, bounds, { cellSize = .75, openings = [], arrival }) {
  const minX = Math.floor(bounds.minX / cellSize) * cellSize;
  const minZ = Math.floor(bounds.minZ / cellSize) * cellSize;
  const width = Math.ceil((bounds.maxX - minX) / cellSize);
  const depth = Math.ceil((bounds.maxZ - minZ) / cellSize);
  const tops = new Float32Array(width * depth);
  // What really stands in each blocked cell, for the camera. `tops` rounds up
  // so that neighbouring cells share a box, which is harmless underfoot but
  // turns a waist-high fence into a four-metre wall across the camera's view.
  const heights = new Float32Array(width * depth);
  // The highest solid thing over each cell, down to the ground or not: the
  // roof over a cabin's walls, the crown over a trunk.
  const overhead = new Float32Array(width * depth);
  let covering = false;
  const surfaceTiles = new Map(), tileSize = 8;
  const layeredColliders = districts.flatMap(district => district.colliders ?? []);
  const layeredBlocked = new Uint8Array(width * depth);
  let readingLayered = false, readingFloorLimit = Infinity;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  let triangleCount = 0, surfaceCount = 0;

  function raise(i, top, height) {
    if (covering) overhead[i] = Math.max(overhead[i], height);
    else { tops[i] = Math.max(tops[i], top); heights[i] = Math.max(heights[i], height); }
  }
  function mark(x, z, top, height) {
    const ix = Math.floor((x - minX) / cellSize), iz = Math.floor((z - minZ) / cellSize);
    if (ix >= 0 && iz >= 0 && ix < width && iz < depth) raise(iz * width + ix, top, height);
  }
  // The camera's height in each cell is the face's own height there, not its
  // highest point: one long sloping face of a stone wall would otherwise
  // stand at its tallest end all the way along.
  function edge(p, q, top, high) {
    const steps = Math.ceil(Math.max(Math.abs(p.x - q.x), Math.abs(p.z - q.z)) / (cellSize * .45));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0, next = steps ? Math.min(1, (i + 1) / steps) : 1;
      mark(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t, top, Math.min(high, p.y + (q.y - p.y) * next));
    }
  }
  function footprint(top, high) {
    // Edges are walked from their low end, so each sample covers the rise to the next.
    for (const [p, q] of [[a, b], [b, c], [c, a]]) p.y < q.y ? edge(p, q, top, high) : edge(q, p, top, high);
    const denominator = (b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    if (Math.abs(denominator) < 1e-8) return;
    // The face's slope: its highest point within a cell lies this far above
    // its height at the cell's centre.
    const ux=(b.z-c.z)/denominator, uz=(c.x-b.x)/denominator, vx=(c.z-a.z)/denominator, vz=(a.x-c.x)/denominator;
    const rise=cellSize/2*(Math.abs(ux*(a.y-c.y)+vx*(b.y-c.y))+Math.abs(uz*(a.y-c.y)+vz*(b.y-c.y)));
    const x0 = Math.max(0, Math.floor((Math.min(a.x,b.x,c.x)-minX)/cellSize));
    const x1 = Math.min(width-1, Math.floor((Math.max(a.x,b.x,c.x)-minX)/cellSize));
    const z0 = Math.max(0, Math.floor((Math.min(a.z,b.z,c.z)-minZ)/cellSize));
    const z1 = Math.min(depth-1, Math.floor((Math.max(a.z,b.z,c.z)-minZ)/cellSize));
    for (let iz=z0; iz<=z1; iz++) for (let ix=x0; ix<=x1; ix++) {
      const x=minX+(ix+.5)*cellSize, z=minZ+(iz+.5)*cellSize;
      const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/denominator;
      const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/denominator;
      if (u>=0 && v>=0 && u+v<=1) raise(iz*width+ix,top,Math.min(high,u*a.y+v*b.y+(1-u-v)*c.y+rise));
    }
  }
  function cover(high) { covering = true; footprint(0, high); covering = false; }
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
    const { layout, ground = null, solid = null, standing = .75, reach = Infinity, clutter = null, walkable = Infinity, relative = false, sheer = false } = district;
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
        if(obstacle) cover(high);
        if(obstacle && high>standing && low<reach) footprint(Math.ceil(high/4)*4,high);
        // Street batches include cars, bins, posts and lamps as well as asphalt.
        // Keep their lower solid parts; overhead lamp arms remain passable.
        else if(floor && clutter && low<clutter[0] && high>clutter[1]) footprint(Math.ceil(Math.min(high,8)/2)*2,Math.min(high,8));
        if(floor && high<walkable) {
          normal.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a)).normalize();
          if(normal.y>.45 || sheer && normal.y>0) addSurface();
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
        cover(high);
        if(Number.isFinite(turf) && high>turf+standing && low<turf+reach) footprint(Math.ceil(high/4)*4,high);
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
  // The way on foot between two points, over ground the player can reach: a
  // breadth-first search across the reachable cells, then pulled taut into as
  // few straight legs as stay on that ground. Each end that stands off it,
  // such as a player who has jumped a fence into a yard the flood never
  // reached, joins the nearest reachable cell within thirty units. Null when
  // either end has none, or no way joins them.
  const cellOf=(x,z,reach=Math.ceil(30/cellSize))=>{
    const cx=Math.floor((x-minX)/cellSize),cz=Math.floor((z-minZ)/cellSize);
    let best=-1,bestDistance=Infinity;
    for(let r=0;r<=reach&&best<0;r++) for(let iz=cz-r;iz<=cz+r;iz++) for(let ix=cx-r;ix<=cx+r;ix++) {
      if(Math.max(Math.abs(ix-cx),Math.abs(iz-cz))!==r||ix<0||iz<0||ix>=width||iz>=depth||!reachable[iz*width+ix]) continue;
      const d=(ix-cx)**2+(iz-cz)**2; if(d<bestDistance){best=iz*width+ix;bestDistance=d;}
    }
    return best;
  };
  const onGround=(x,z)=>{const ix=Math.floor((x-minX)/cellSize),iz=Math.floor((z-minZ)/cellSize);return ix>=0&&iz>=0&&ix<width&&iz<depth&&!!reachable[iz*width+ix];};
  const inSight=(a,b)=>{
    const steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/(cellSize*.4));
    for(let s=1;s<steps;s++) if(!onGround(a.x+(b.x-a.x)*s/steps,a.z+(b.z-a.z)*s/steps)) return false;
    return true;
  };
  let parents=null;
  function route(from,to) {
    const start=cellOf(from.x,from.z),goal=cellOf(to.x,to.z);
    if(start<0||goal<0) return null;
    parents??=new Int32Array(width*depth);parents.fill(-1);parents[start]=start;
    queue[0]=start;let count=1;
    for(let head=0;head<count&&parents[goal]<0;head++) {
      const i=queue[head],ix=i%width,iz=(i-ix)/width;
      for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++) {
        const nx=ix+dx,nz=iz+dz,ni=nz*width+nx;
        if((!dx&&!dz)||nx<0||nz<0||nx>=width||nz>=depth||parents[ni]>=0||!reachable[ni]) continue;
        // A diagonal step never squeezes between two blocked cells.
        if(dx&&dz&&(!reachable[iz*width+nx]||!reachable[nz*width+ix])) continue;
        parents[ni]=i;queue[count++]=ni;
      }
    }
    if(parents[goal]<0) return null;
    const cells=[];for(let i=goal;;i=parents[i]){cells.push(i);if(i===start)break;}
    const centre=i=>({x:minX+(i%width+.5)*cellSize,z:minZ+(Math.floor(i/width)+.5)*cellSize});
    const path=[{x:from.x,z:from.z},...cells.reverse().map(centre),{x:to.x,z:to.z}];
    const legs=[path[0]];
    for(let at=0;at<path.length-1;) {
      let next=at+1;
      while(next+1<path.length&&inSight(path[at],path[next+1])) next++;
      legs.push(path[next]);at=next;
    }
    return legs.map(({x,z})=>({x,y:sampleHeight(x,z),z}));
  }
  // What stands over the hero's head reaches up to whatever it holds up: a
  // cabin's walls to its roof. Anything lower keeps its own height, so a
  // fence beneath a branch is still a fence to the camera.
  const slender=new Uint8Array(width*depth);
  for(let i=0;i<width*depth;i++) if(tops[i]>0) {
    const turf=sampleHeight(minX+(i%width+.5)*cellSize,minZ+(Math.floor(i/width)+.5)*cellSize);
    if(Number.isFinite(turf) && heights[i]>turf+2.5) { slender[i]=1; heights[i]=Math.max(heights[i],overhead[i]); }
  }
  // Trunks, posts and pillars: a tall column no wider than a stride. The
  // follow camera looks past these rather than diving in at each one it
  // swings behind, which in a wood is every step.
  for(let i=0;i<width*depth;i++) if(slender[i]===1) {
    let found=0,x0=i%width,x1=x0,z0=Math.floor(i/width),z1=z0;
    queue[found++]=i;slender[i]=2;
    for(let head=0;head<found;head++) {
      const j=queue[head],jx=j%width,jz=Math.floor(j/width);
      x0=Math.min(x0,jx);x1=Math.max(x1,jx);z0=Math.min(z0,jz);z1=Math.max(z1,jz);
      for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx=jx+dx,nz=jz+dz,n=nz*width+nx;
        if(nx>=0 && nz>=0 && nx<width && nz<depth && slender[n]===1) { slender[n]=2;queue[found++]=n; }
      }
    }
    const thin=x1-x0<3 && z1-z0<3 ? 3 : 4;
    for(let k=0;k<found;k++) slender[queue[k]]=thin;
  }
  // A box covers a run of cells the walker meets alike, whose heights to the
  // camera lie close together: it stands at their tallest. Close means a
  // hand's breadth among things a hero stands beside, and a metre up among
  // eaves and rooftops, which no camera grazes to within a hand.
  const colliders=[], active=new Map();
  for(let iz=0;iz<depth;iz++) {
    const next=new Map();
    for(let ix=0;ix<width;) {
      const i=iz*width+ix,top=tops[i];
      if(!top) { ix++; continue; }
      const startX=ix,thin=slender[i]===3,span=top>4?1:.25;
      let low=heights[i],high=heights[i];
      for(;ix<width && tops[iz*width+ix]===top && (slender[iz*width+ix]===3)===thin;ix++) {
        const h=heights[iz*width+ix];
        if(Math.max(high,h)-Math.min(low,h)>span) break;
        low=Math.min(low,h);high=Math.max(high,h);
      }
      const key=`${startX}:${ix}:${top}:${thin}`;
      const previous=active.get(key);
      if(previous && Math.max(previous.high,high)-Math.min(previous.low,low)<=span) {
        const {box}=previous;box.d+=cellSize;box.z+=cellSize/2;
        previous.low=Math.min(previous.low,low);previous.high=Math.max(previous.high,high);
        if(top>0) box.cameraTop=previous.high;
        next.set(key,previous);
      } else {
        const box={x:minX+(startX+ix)*cellSize/2,z:minZ+(iz+.5)*cellSize,w:(ix-startX)*cellSize,d:cellSize,bottom:-10,top:top<0?5:top,noCamera:top<0};
        if(top>0) box.cameraTop=high;
        if(thin) box.slender=true;
        colliders.push(box);next.set(key,{box,low,high});
      }
    }
    active.clear();for(const [key,value] of next) active.set(key,value);
  }
  for (const collider of layeredColliders) colliders.push(collider);
  return {
    colliders, spawn, isWalkable, findWalkable, route,
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
