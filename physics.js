// Metres, seconds, +Y up. Rendering and terrain providers do not own locomotion.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const approach = (a, b, amount) => a < b ? Math.min(b, a + amount) : Math.max(b, a - amount);

export class SpatialHash {
  constructor(cellSize = 16) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.entries = new Map();
    this.candidates = [];
    this.stamp = 0;
    this.lastChecks = 0;
  }
  insert(id, shape) {
    this.remove(id);
    const entry = { ...shape, id, cells: [], stamp: 0 };
    const rx = shape.r ?? shape.w / 2, rz = shape.r ?? shape.d / 2;
    for (let x = Math.floor((shape.x - rx) / this.cellSize); x <= Math.floor((shape.x + rx) / this.cellSize); x++) {
      for (let z = Math.floor((shape.z - rz) / this.cellSize); z <= Math.floor((shape.z + rz) / this.cellSize); z++) {
        const key = `${x},${z}`;
        if (!this.cells.has(key)) this.cells.set(key, new Set());
        this.cells.get(key).add(entry); entry.cells.push(key);
      }
    }
    this.entries.set(id, entry);
    return entry;
  }
  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const key of entry.cells) {
      const bucket = this.cells.get(key); bucket.delete(entry);
      if (!bucket.size) this.cells.delete(key);
    }
    this.entries.delete(id);
  }
  query(minX, minZ, maxX, maxZ) {
    this.candidates.length = 0; this.stamp++;
    for (let x = Math.floor(minX / this.cellSize); x <= Math.floor(maxX / this.cellSize); x++) {
      for (let z = Math.floor(minZ / this.cellSize); z <= Math.floor(maxZ / this.cellSize); z++) {
        const bucket = this.cells.get(`${x},${z}`);
        if (!bucket) continue;
        for (const entry of bucket) if (entry.stamp !== this.stamp) {
          entry.stamp = this.stamp; this.candidates.push(entry);
        }
      }
    }
    this.lastChecks = this.candidates.length;
    return this.candidates;
  }
  resolve(p, radius = .52, height = 3.3, ignore = null, stepHeight = 0) {
    // Requery after projection so corners spanning cell boundaries stay solid.
    for (let pass = 0; pass < 3; pass++) {
      const nearby = this.query(p.x - radius, p.z - radius, p.x + radius, p.z + radius);
      let hit = false;
      for (const c of nearby) {
        if (c.id === ignore || c.cameraOnly || c.ceilingOnly || (c.stepable && c.top <= p.y + stepHeight + .001) || p.y + height <= (c.bottom ?? -Infinity) || p.y > (c.top ?? Infinity) || (c.walkable && p.y >= c.top - .025)) continue;
        if (c.r !== undefined) {
          const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), limit = c.r + radius;
          if (d < limit) { p.x = c.x + (d > 1e-6 ? dx / d : 1) * limit; p.z = c.z + (d > 1e-6 ? dz / d : 0) * limit; hit = true; }
        } else {
          const nx = clamp(p.x, c.x - c.w / 2, c.x + c.w / 2), nz = clamp(p.z, c.z - c.d / 2, c.z + c.d / 2);
          const dx = p.x - nx, dz = p.z - nz, d = Math.hypot(dx, dz);
          if (d >= radius) continue;
          if (d > 1e-6) { p.x = nx + dx / d * radius; p.z = nz + dz / d * radius; }
          else {
            const px = c.w / 2 - Math.abs(p.x - c.x), pz = c.d / 2 - Math.abs(p.z - c.z);
            if (px < pz) p.x = c.x + (p.x >= c.x ? 1 : -1) * (c.w / 2 + radius);
            else p.z = c.z + (p.z >= c.z ? 1 : -1) * (c.d / 2 + radius);
          }
          hit = true;
        }
      }
      if (!hit) break;
    }
  }
  // `skip`, if given, passes over the colliders it answers true for: those of
  // the people a shot is framing, which the camera may look past at a hand's breadth.
  cameraFraction(from, to, radius = .4, skip) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    let nearest = 1;
    for (const c of this.query(Math.min(from.x,to.x)-radius, Math.min(from.z,to.z)-radius, Math.max(from.x,to.x)+radius, Math.max(from.z,to.z)+radius)) {
      if (c.noCamera || skip?.(c)) continue;
      let enter = 0, exit = nearest;
      // Camera uses conservative swept boxes for props and precise circular trunks.
      if (c.r !== undefined) {
        const ox=from.x-c.x, oz=from.z-c.z, r=c.r+radius, a=dx*dx+dz*dz;
        if (a < 1e-10) { if (ox*ox+oz*oz > r*r) continue; }
        else {
          const b=ox*dx+oz*dz, discriminant=b*b-a*(ox*ox+oz*oz-r*r);
          if (discriminant < 0) continue;
          const root=Math.sqrt(discriminant); enter=Math.max(0,(-b-root)/a); exit=Math.min(exit,(-b+root)/a);
        }
      } else {
        for (const [origin, delta, center, extent] of [[from.x,dx,c.x,c.w/2+radius],[from.z,dz,c.z,c.d/2+radius]]) {
          if (Math.abs(delta)<1e-10) { if (Math.abs(origin-center)>extent) { exit=-1; break; } }
          else { let a=(center-extent-origin)/delta,b=(center+extent-origin)/delta; if(a>b)[a,b]=[b,a]; enter=Math.max(enter,a);exit=Math.min(exit,b); }
        }
      }
      const bottom=(c.bottom ?? -10000)-radius, top=(c.top ?? 10000)+radius;
      if(Math.abs(dy)<1e-10) { if(from.y<bottom || from.y>top) continue; }
      else { let a=(bottom-from.y)/dy,b=(top-from.y)/dy;if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);exit=Math.min(exit,b); }
      if(enter<=exit && exit>=0 && enter>=0) nearest=Math.min(nearest,enter);
    }
    return nearest;
  }
  clear() { this.cells.clear(); this.entries.clear(); this.candidates.length=0; }
}

export class LocomotionController {
  constructor(position, velocity, terrain, collision, options = {}) {
    this.position=position; this.velocity=velocity; this.terrain=terrain; this.collision=collision;
    this.radius=options.radius ?? .52;this.height=options.height ?? 3.25;
    this.gravity=options.gravity ?? 22;this.stepHeight=options.stepHeight ?? .48;this.maxSlope=options.maxSlope ?? .82;
    this.waterZones=options.waterZones ?? terrain.waterZones ?? [];this.climbables=options.climbables ?? terrain.climbables ?? [];
    this.grounded=true; this.state='Idle'; this.verticalVelocity=0; this.normal={x:0,y:1,z:0};
    this.groundHeight=this.supportHeight(position.x,position.z,position.y); this.position.y=this.groundHeight;
    this.coyote=.1; this.jumpBuffer=0; this.landTime=0; this.landingSpeed=0; this.distance=0;
    this.speed=0; this.slope=0; this.blocked=false; this.stateTime=0;
    this.inWater=false;this.swimming=false;this.waterDepth=0;this.climbing=null;this.events=[];this.pendingEvents=[];
    // Seconds a full stamina bar sprints for, and seconds an empty one takes to refill.
    this.sprintTime=options.sprintTime ?? 15;this.staminaRecovery=options.staminaRecovery ?? 4;
    this.stamina=1;this.exhausted=false;this.sprinting=false;this.staminaRest=0;
  }
  requestJump() { this.jumpBuffer=.14; }
  waterAt(x,z) { return this.terrain.getWaterAt?.(x,z) ?? this.waterZones.find(zone=>contains(zone,x,z)) ?? null; }
  supportHeight(x,z,feetY=this.position.y) {
    const water=this.waterAt(x,z);
    const terrainHeight=this.terrain.getSupportHeight?.(x,z,feetY,this.terrain.stepHeightAt?.(x,z) ?? this.stepHeight) ?? this.terrain.getHeight(x,z);
    return Number.isFinite(water?.floor)?Math.min(terrainHeight,water.floor):terrainHeight;
  }
  startClimb(climbable) {
    if(!climbable || !(climbable.top>climbable.bottom) || this.climbing || this.state==='Dead')return false;
    if(Math.hypot(this.position.x-climbable.x,this.position.z-climbable.z)>(climbable.r ?? 2.2) || this.position.y<climbable.bottom-.8 || this.position.y>climbable.top+.8)return false;
    this.climbing=climbable;this.grounded=false;this.swimming=false;
    this.position.x=climbable.x;this.position.z=climbable.z;
    this.position.y=clamp(this.position.y,climbable.bottom,climbable.top);
    this.velocity.x=this.velocity.y=this.velocity.z=this.verticalVelocity=0;
    this.pendingEvents.push({type:'climb-start',id:climbable.id});
    return true;
  }
  stopClimb() {
    if(!this.climbing)return;
    this.pendingEvents.push({type:'climb-end',id:this.climbing.id});
    this.climbing=null;this.grounded=false;this.coyote=0;
  }
  reset() {
    this.velocity.x=this.velocity.y=this.velocity.z=0; this.verticalVelocity=0;
    this.groundHeight=this.supportHeight(this.position.x,this.position.z);this.position.y=this.groundHeight;
    this.grounded=true;this.state='Idle';this.jumpBuffer=0;this.landTime=0;this.coyote=.1;
    this.climbing=null;this.inWater=false;this.swimming=false;this.waterDepth=0;
    this.events.length=0;this.pendingEvents.length=0;this.landingSpeed=0;this.speed=0;this.blocked=false;this.stateTime=0;
    this.stamina=1;this.exhausted=false;this.sprinting=false;this.staminaRest=0;
  }
  update(dt, input = {}) {
    this.events.length=0;this.events.push(...this.pendingEvents);this.pendingEvents.length=0;
    this.landingSpeed=0;this.blocked=false;
    if(!(dt>0) || !Number.isFinite(dt))return;
    // Discard long background-tab time; spatial microsteps also prevent thin-wall tunnelling.
    dt=Math.min(dt,.12);
    const length=Math.hypot(input.x || 0,input.z || 0),scale=length>1?1/length:1;
    const controls={...input,x:(input.x || 0)*scale,z:(input.z || 0)*scale,magnitude:input.magnitude ?? Math.min(1,length)};
    if(input.dead) {
      this.stopClimb();this.velocity.x=this.velocity.y=this.velocity.z=this.verticalVelocity=0;
      this.speed=0;this.state='Dead';this.stateTime+=dt;return;
    }
    this.updateStamina(dt,input,controls);
    if(input.climb && !this.climbing) this.startClimb(this.climbables.find(c=>Math.hypot(this.position.x-c.x,this.position.z-c.z)<(c.r ?? 2.2)));
    const steps=Math.ceil(dt/(1/120)),step=dt/steps;
    let travelled=0;
    for(let i=0;i<steps;i++) {
      const x=this.position.x,z=this.position.z;
      this.step(step,controls);travelled+=Math.hypot(this.position.x-x,this.position.z-z);
    }
    this.events.push(...this.pendingEvents);this.pendingEvents.length=0;
    this.speed=travelled/dt;this.distance+=travelled;
    let next=this.climbing?'Climb':this.swimming?'Swim':this.grounded?(this.landTime>0?'Land':this.speed<.12?'Idle':this.inWater?'Wade':input.walk?'Walk':this.sprinting?'Sprint':'Run'):(this.verticalVelocity>0?'Jump':'Fall');
    if(input.hurt)next='Hit';else if(input.attacking&&this.grounded)next='Attack';
    this.stateTime=next===this.state?this.stateTime+dt:0;this.state=next;
  }
  updateStamina(dt,input,controls) {
    // Sprinting spends stamina and a short rest refills it. Run it dry and the
    // legs only jog until it is partly back. A horse carries the effort.
    this.sprinting=!!input.sprint && (input.mounted || !this.exhausted) && !this.climbing && controls.magnitude>.1;
    if(this.sprinting && !input.mounted) {
      this.stamina=Math.max(0,this.stamina-dt/this.sprintTime);this.staminaRest=.8;
      if(this.stamina===0)this.exhausted=true;
    } else if((this.staminaRest=Math.max(0,this.staminaRest-dt))===0) this.stamina=Math.min(1,this.stamina+dt/this.staminaRecovery);
    if(this.exhausted && this.stamina>=.4)this.exhausted=false;
    controls.sprint=this.sprinting;
  }
  step(dt,input) {
    const p=this.position, v=this.velocity, oldX=p.x, oldZ=p.z;
    this.landTime=Math.max(0,this.landTime-dt);
    if(this.climbing) {
      const ladder=this.climbing;
      if(this.jumpBuffer>0) {this.stopClimb();this.verticalVelocity=4.5;this.jumpBuffer=0;this.events.push({type:'jump'});}
      else {
        const direction=clamp(input.climbDirection ?? 1,-1,1);
        this.verticalVelocity=direction*(ladder.speed ?? 2.4);v.y=this.verticalVelocity;
        p.y=clamp(p.y+v.y*dt,ladder.bottom,ladder.top);
        if(p.y>=ladder.top && direction>0) {
          if(ladder.exit) {p.x=ladder.exit.x;p.z=ladder.exit.z;}
          this.stopClimb();this.verticalVelocity=v.y=0;
          this.groundHeight=this.supportHeight(p.x,p.z,p.y);
          this.grounded=Math.abs(p.y-this.groundHeight)<.1;
        } else if(p.y<=ladder.bottom && direction<0) {this.stopClimb();this.verticalVelocity=v.y=0;}
        return;
      }
    }
    this.coyote=this.grounded?.1:Math.max(0,this.coyote-dt);
    this.terrain.getNormal?.(p.x,p.z,this.normal,p.y,this.terrain.stepHeightAt?.(p.x,p.z) ?? this.stepHeight);
    this.slope=Math.acos(clamp(this.normal.y,-1,1));
    this.updateWater();
    const speedScale=clamp((input.heroSpeed||9)/9,.9,1.22)*clamp(input.speedScale ?? 1,.1,3);
    const pace=input.walk?3:input.sprint?8.5:4.7;
    let speed=pace*speedScale*(input.attacking?.45:input.hurt?.6:1);
    const uphill=-(this.normal.x*input.x+this.normal.z*input.z);
    speed*=clamp(1-uphill*.5,.55,1.12);
    if(this.inWater)speed*=this.swimming?.5:.62;
    const targetX=input.x*speed,targetZ=input.z*speed;
    const sliding=this.grounded && this.slope>this.maxSlope;
    const acceleration=(this.swimming?8:sliding?3:this.grounded?(input.magnitude>.03?18:26):5.5)*dt;
    const changeX=targetX-v.x,changeZ=targetZ-v.z,change=Math.hypot(changeX,changeZ);
    const factor=change>acceleration?acceleration/change:1;
    v.x+=changeX*factor;v.z+=changeZ*factor;
    if(sliding) {v.x+=this.normal.x*this.normal.y*this.gravity*dt;v.z+=this.normal.z*this.normal.y*this.gravity*dt;}
    moveWithCollision(p,v,dt,this.collision,this.radius,this.height,null,this.grounded ? (this.terrain.stepHeightAt?.(p.x,p.z) ?? this.stepHeight) : 0);
    const nextHeight=this.supportHeight(p.x,p.z),previousHeight=this.supportHeight(oldX,oldZ);
    // Some ground is built in taller steps than the default: a district can say so.
    const stepHeight=this.terrain.stepHeightAt?.(p.x,p.z) ?? this.stepHeight;
    if (this.grounded && ((this.slope>this.maxSlope && nextHeight>previousHeight+.002) || nextHeight-previousHeight>stepHeight)) {
      p.x=oldX;p.z=oldZ;v.x*=.3;v.z*=.3;this.blocked=true;
    }
    if(Math.hypot(p.x-oldX,p.z-oldZ)<.01*dt && input.magnitude>.1)this.blocked=true;
    this.groundHeight=this.supportHeight(p.x,p.z);this.updateWater();
    if(this.jumpBuffer>0 && (this.coyote>0 || this.swimming)) {
      this.verticalVelocity=this.swimming?3.5:8.2;this.grounded=false;this.coyote=0;this.jumpBuffer=0;
      this.events.push({type:'jump'});
    }
    this.jumpBuffer=Math.max(0,this.jumpBuffer-dt);
    if(this.swimming) {
      const water=this.waterAt(p.x,p.z),targetY=water.surface-this.height*.56;
      this.verticalVelocity+=((targetY-p.y)*24-this.verticalVelocity*8)*dt;
      this.verticalVelocity=clamp(this.verticalVelocity,-8,5);this.grounded=false;
    }
    if(this.grounded) {
      const drop=p.y-this.groundHeight;
      if(drop>.6) {this.grounded=false;this.verticalVelocity=0;}
      else p.y=approach(p.y,this.groundHeight,Math.max(.09,Math.hypot(v.x,v.z)*.9*dt+dt*5));
    }
    if(!this.grounded) {
      const previousY=p.y;
      if(!this.swimming)this.verticalVelocity=Math.max(-35,this.verticalVelocity-this.gravity*dt);
      p.y+=this.verticalVelocity*dt;
      if(this.verticalVelocity>0 && this.collision) {
        for(const c of this.collision.query(p.x-this.radius,p.z-this.radius,p.x+this.radius,p.z+this.radius)) {
          if(c.cameraOnly || !contains(c,p.x,p.z,this.radius*.7))continue;
          if(Number.isFinite(c.bottom) && previousY+this.height<=c.bottom && p.y+this.height>c.bottom) {p.y=c.bottom-this.height;this.verticalVelocity=0;}
        }
      }
      if(p.y<=this.groundHeight && this.verticalVelocity<=0) {
        const impact=-this.verticalVelocity;
        this.landingSpeed=Math.max(this.landingSpeed,impact);this.landTime=.14;this.grounded=true;
        if(impact>1)this.events.push({type:'land',speed:impact,inWater:this.inWater});
        this.verticalVelocity=0;p.y=this.groundHeight;
      }
    }
    // A smoothly arriving terrain tile cannot leave feet beneath its surface.
    if(this.grounded && p.y<this.groundHeight) p.y=this.groundHeight;
    v.y=this.verticalVelocity;
    this.updateWater();
  }
  updateWater() {
    const zone=this.waterAt(this.position.x,this.position.z);
    const depth=zone?Math.max(0,zone.surface-this.groundHeight):0;
    const wet=depth>.08 && this.position.y<zone.surface-.04;
    if(wet!==this.inWater)this.events.push({type:wet?'water-enter':'water-exit',speed:Math.abs(this.verticalVelocity)});
    this.inWater=wet;this.waterDepth=depth;
    this.swimming=wet && depth>this.height*.6 && this.position.y<zone.surface-.3;
  }
  getStats() { return {state:this.state,grounded:this.grounded,speed:this.speed,verticalVelocity:this.verticalVelocity,groundHeight:this.groundHeight,slope:this.slope,blocked:this.blocked,inWater:this.inWater,swimming:this.swimming,waterDepth:this.waterDepth,climbing:!!this.climbing,landingSpeed:this.landingSpeed,stamina:this.stamina,exhausted:this.exhausted,sprinting:this.sprinting,velocity:{x:this.velocity.x,y:this.velocity.y,z:this.velocity.z}}; }
}

function contains(shape,x,z,padding=0) {
  if(shape.r!==undefined)return Math.hypot(x-shape.x,z-shape.z)<=shape.r+padding;
  return Math.abs(x-shape.x)<=shape.w/2+padding && Math.abs(z-shape.z)<=shape.d/2+padding;
}

function moveWithCollision(position,velocity,dt,collision,radius,height,ignore=null,stepHeight=0) {
  const steps=Math.max(1,Math.ceil(Math.hypot(velocity.x,velocity.z)*dt/Math.max(.05,radius*.45)));
  for(let i=0;i<steps;i++) {
    const desiredX=position.x+velocity.x*dt/steps,desiredZ=position.z+velocity.z*dt/steps;
    position.x=desiredX;position.z=desiredZ;
    collision?.resolve(position,radius,height,ignore,stepHeight);
    const dx=position.x-desiredX,dz=position.z-desiredZ,length=Math.hypot(dx,dz);
    if(length>1e-6) {
      const nx=dx/length,nz=dz/length,into=velocity.x*nx+velocity.z*nz;
      if(into<0) {velocity.x-=nx*into;velocity.z-=nz*into;}
    }
  }
}

// Small gameplay props use spherical footprints and damped impulses, not an expensive rigid-body world.
export class PropPhysics {
  constructor(terrain,collision) {this.terrain=terrain;this.collision=collision;this.bodies=[];this.nextId=0;}
  addBody({id,position,radius=.55,height=1,mass=12,rotation=null}) {
    const body={id:id ?? `prop-${this.nextId++}`,position,radius,height,mass:Math.max(.1,mass),rotation,velocity:{x:0,y:0,z:0},sleeping:true};
    this.bodies.push(body);this.sync(body);return body;
  }
  sync(body) {
    this.collision?.insert(body.id,{x:body.position.x,z:body.position.z,r:body.radius,bottom:body.position.y,top:body.position.y+body.height,dynamic:true});
  }
  push(position,direction,strength=5,reach=2) {
    const length=Math.hypot(direction.x,direction.z);
    if(length<1e-6)return 0;
    let count=0;
    for(const body of this.bodies) {
      const dx=body.position.x-position.x,dz=body.position.z-position.z,distance=Math.hypot(dx,dz);
      if(distance>reach+body.radius || Math.abs(position.y-body.position.y)>body.height+1 || (distance>.1 && (dx*direction.x+dz*direction.z)/distance/length<.15))continue;
      const impulse=clamp(strength*12/body.mass,0,12);
      body.velocity.x+=direction.x/length*impulse;body.velocity.z+=direction.z/length*impulse;
      body.sleeping=false;count++;
    }
    return count;
  }
  update(dt) {
    if(!(dt>0) || !Number.isFinite(dt))return;
    dt=Math.min(dt,.12);const steps=Math.ceil(dt*120),step=dt/steps;
    for(let i=0;i<steps;i++)for(const body of this.bodies) {
      if(body.sleeping)continue;
      const p=body.position,v=body.velocity;
      moveWithCollision(p,v,step,this.collision,body.radius,body.height,body.id);
      const floor=this.terrain.getSupportHeight?.(p.x,p.z,p.y,.15) ?? this.terrain.getHeight(p.x,p.z);
      v.y=Math.max(-25,v.y-22*step);p.y+=v.y*step;
      if(p.y<floor) {p.y=floor;v.y=0;}
      const drag=Math.exp(-(p.y<=floor+.01?3.4:.2)*step);v.x*=drag;v.z*=drag;
      if(body.rotation)body.rotation.y+=Math.hypot(v.x,v.z)*step*.07;
      if(Math.hypot(v.x,v.y,v.z)<.04 && p.y<=floor+.01) {v.x=v.y=v.z=0;body.sleeping=true;}
      this.sync(body);
    }
  }
  remove(id) {this.bodies=this.bodies.filter(body=>body.id!==id);this.collision?.remove(id);}
  dispose() {for(const body of this.bodies)this.collision?.remove(body.id);this.bodies.length=0;}
}

// Bounded root-body death tumble. A renderer may apply the returned pose to a rig or a group.
export class RagdollController {
  constructor(position,terrain,collision,{rotation=null,radius=.65,height=.75}={}) {
    this.position=position;this.terrain=terrain;this.collision=collision;this.rotation=rotation;
    this.radius=radius;this.height=height;this.velocity={x:0,y:0,z:0};this.pose={x:0,z:0};
    this.active=false;this.settled=false;this.age=0;
  }
  start(impulse={x:0,y:2,z:0}) {
    this.velocity.x=clamp(impulse.x ?? 0,-10,10);this.velocity.y=clamp(impulse.y ?? 2,0,8);this.velocity.z=clamp(impulse.z ?? 0,-10,10);
    this.active=true;this.settled=false;this.age=0;this.pose.x=this.pose.z=0;
    this.fallSign=Math.abs(this.velocity.x)>.1?Math.sign(this.velocity.x):1;
  }
  update(dt) {
    if(!this.active || this.settled || !(dt>0) || !Number.isFinite(dt))return this.pose;
    dt=Math.min(dt,.12);const steps=Math.ceil(dt*120),step=dt/steps;
    for(let i=0;i<steps;i++) {
      this.age+=step;
      const p=this.position,v=this.velocity;
      moveWithCollision(p,v,step,this.collision,this.radius,this.height);
      const floor=this.terrain.getSupportHeight?.(p.x,p.z,p.y,.1) ?? this.terrain.getHeight(p.x,p.z);
      v.y=Math.max(-28,v.y-22*step);p.y+=v.y*step;
      if(p.y<floor) {p.y=floor;v.y=0;}
      const drag=Math.exp(-(p.y<=floor+.01?5:.8)*step);v.x*=drag;v.z*=drag;
      this.pose.x=approach(this.pose.x,Math.PI*.44,step*2.6);
      this.pose.z=approach(this.pose.z,this.fallSign*.2,step);
      if(this.age>.8 && p.y<=floor+.01 && Math.hypot(v.x,v.z)<.12) {this.settled=true;v.x=v.y=v.z=0;}
    }
    if(this.rotation) {this.rotation.x=this.pose.x;this.rotation.z=this.pose.z;}
    return this.pose;
  }
  reset() {
    this.active=false;this.settled=false;this.age=0;this.pose.x=this.pose.z=0;
    this.velocity.x=this.velocity.y=this.velocity.z=0;
    if(this.rotation)this.rotation.x=this.rotation.z=0;
  }
}
