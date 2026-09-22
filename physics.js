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
  resolve(p, radius = .52, height = 3.3, ignore = null) {
    // Requery after projection so corners spanning cell boundaries stay solid.
    for (let pass = 0; pass < 3; pass++) {
      const nearby = this.query(p.x - radius, p.z - radius, p.x + radius, p.z + radius);
      let hit = false;
      for (const c of nearby) {
        if (c.id === ignore || c.cameraOnly || p.y + height < (c.bottom ?? -Infinity) || p.y > (c.top ?? Infinity)) continue;
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
  cameraFraction(from, to, radius = .4) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    let nearest = 1;
    for (const c of this.query(Math.min(from.x,to.x)-radius, Math.min(from.z,to.z)-radius, Math.max(from.x,to.x)+radius, Math.max(from.z,to.z)+radius)) {
      if (c.noCamera) continue;
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
  constructor(position, velocity, terrain, collision) {
    this.position=position; this.velocity=velocity; this.terrain=terrain; this.collision=collision;
    this.grounded=true; this.state='Idle'; this.verticalVelocity=0; this.normal={x:0,y:1,z:0};
    this.groundHeight=terrain.getHeight(position.x,position.z); this.position.y=this.groundHeight;
    this.coyote=.1; this.jumpBuffer=0; this.landTime=0; this.landingSpeed=0; this.distance=0;
    this.speed=0; this.slope=0; this.blocked=false; this.stateTime=0;
  }
  requestJump() { this.jumpBuffer=.14; }
  reset() {
    this.velocity.x=this.velocity.y=this.velocity.z=0; this.verticalVelocity=0;
    this.groundHeight=this.terrain.getHeight(this.position.x,this.position.z);this.position.y=this.groundHeight;
    this.grounded=true;this.state='Idle';this.jumpBuffer=0;this.landTime=0;this.coyote=.1;
  }
  update(dt, input) {
    const p=this.position, v=this.velocity, oldX=p.x, oldZ=p.z;
    this.jumpBuffer=Math.max(0,this.jumpBuffer-dt);this.landTime=Math.max(0,this.landTime-dt);
    this.coyote=this.grounded?.1:Math.max(0,this.coyote-dt);
    this.terrain.getNormal(p.x,p.z,this.normal);
    this.slope=Math.acos(clamp(this.normal.y,-1,1));
    const speedScale=clamp((input.heroSpeed||9)/9,.9,1.22);
    const pace=input.walk?2.2:input.sprint?8.5:4.7;
    let speed=pace*speedScale*(input.attacking?.45:input.hurt?.6:1);
    const uphill=-(this.normal.x*input.x+this.normal.z*input.z);
    speed*=clamp(1-uphill*.5,.55,1.12);
    const targetX=input.x*speed,targetZ=input.z*speed;
    const acceleration=(this.grounded?(input.magnitude>.03?18:26):5.5)*dt;
    const changeX=targetX-v.x,changeZ=targetZ-v.z,change=Math.hypot(changeX,changeZ);
    const factor=change>acceleration?acceleration/change:1;
    v.x+=changeX*factor;v.z+=changeZ*factor;
    p.x+=v.x*dt;p.z+=v.z*dt;
    const nextHeight=this.terrain.getHeight(p.x,p.z),previousHeight=this.terrain.getHeight(oldX,oldZ);
    this.blocked=false;
    if (this.grounded && ((this.slope>.82 && nextHeight>previousHeight+.002) || nextHeight-previousHeight>Math.max(.48,Math.hypot(v.x,v.z)*dt*1.1))) {
      p.x=oldX;p.z=oldZ;v.x*=.3;v.z*=.3;this.blocked=true;
    }
    this.collision.resolve(p,.52,3.25);
    // Report actual displacement, including sliding along collision surfaces.
    this.speed=Math.hypot(p.x-oldX,p.z-oldZ)/Math.max(dt,1e-6);this.distance+=this.speed*dt;
    if(this.speed<.01 && input.magnitude>.1) {v.x*=.5;v.z*=.5;}
    this.groundHeight=this.terrain.getHeight(p.x,p.z);
    if(this.jumpBuffer>0 && this.coyote>0) {
      this.verticalVelocity=8.2;this.grounded=false;this.coyote=0;this.jumpBuffer=0;
    }
    if(this.grounded) {
      const drop=p.y-this.groundHeight;
      if(drop>.6) {this.grounded=false;this.verticalVelocity=0;}
      else p.y=approach(p.y,this.groundHeight,Math.max(.09,this.speed*.9*dt+dt*5));
    }
    if(!this.grounded) {
      this.verticalVelocity=Math.max(-35,this.verticalVelocity-22*dt);p.y+=this.verticalVelocity*dt;
      if(p.y<=this.groundHeight && this.verticalVelocity<=0) {
        this.landingSpeed=-this.verticalVelocity;this.landTime=.14;this.grounded=true;
        this.verticalVelocity=0;p.y=this.groundHeight;
      }
    }
    // A smoothly arriving terrain tile cannot leave feet beneath its surface.
    if(this.grounded && p.y<this.groundHeight) p.y=this.groundHeight;
    v.y=this.verticalVelocity;
    let next=this.grounded?(this.landTime>0?'Land':this.speed<.12?'Idle':input.walk?'Walk':input.sprint?'Sprint':'Run'):(this.verticalVelocity>0?'Jump':'Fall');
    if(input.dead)next='Dead';else if(input.hurt)next='Hit';else if(input.attacking&&this.grounded)next='Attack';
    this.stateTime=next===this.state?this.stateTime+dt:0;this.state=next;
  }
  getStats() { return {state:this.state,grounded:this.grounded,speed:this.speed,verticalVelocity:this.verticalVelocity,groundHeight:this.groundHeight,slope:this.slope,blocked:this.blocked,velocity:{x:this.velocity.x,y:this.velocity.y,z:this.velocity.z}}; }
}
