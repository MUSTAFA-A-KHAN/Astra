import * as THREE from 'three';

export class FollowCamera {
  constructor(camera, terrain, collision) {
    this.camera=camera;this.terrain=terrain;this.collision=collision;
    this.target=new THREE.Vector3();this.desired=new THREE.Vector3();this.candidate=new THREE.Vector3();
    this.yaw=0;this.pitch=.36;this.distance=12;this.safeDistance=12;this.colliding=false;this.initialized=false;
  }
  reset(position,yaw=0,pitch=.36,distance=12) {
    this.target.copy(position);this.target.y+=2.05;
    this.yaw=yaw;this.pitch=pitch;this.distance=distance;this.safeDistance=distance;this.initialized=false;
  }
  safeFraction(from,to) {
    let safe=this.collision.cameraFraction(from,to,.42);
    const length=from.distanceTo(to),steps=Math.max(1,Math.ceil(length/.35));
    for(let i=1;i<=steps;i++) {
      const t=i/steps;if(t>=safe)break;
      const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t,z=from.z+(to.z-from.z)*t;
      const h=Math.max(this.terrain.getHeight(x,z),this.terrain.getHeight(x+.3,z),this.terrain.getHeight(x-.3,z),this.terrain.getHeight(x,z+.3),this.terrain.getHeight(x,z-.3));
      if(y<h+.42) {safe=Math.max(0,(i-1)/steps);break;}
    }
    return safe;
  }
  update(dt,position,yaw,pitch,distance) {
    const a=1-Math.exp(-14*dt);
    this.yaw+=Math.atan2(Math.sin(yaw-this.yaw),Math.cos(yaw-this.yaw))*a;
    this.pitch=THREE.MathUtils.damp(this.pitch,pitch,15,dt);
    this.distance=THREE.MathUtils.damp(this.distance,THREE.MathUtils.clamp(distance,5,24),9,dt);
    this.candidate.copy(position);this.candidate.y+=2.05;
    this.target.lerp(this.candidate,1-Math.exp(-18*dt));
    // Modest shoulder framing; do not move the pivot through a wall.
    this.candidate.copy(this.target);this.candidate.x+=Math.cos(this.yaw)*.55;this.candidate.z-=Math.sin(this.yaw)*.55;
    if(this.collision.cameraFraction(this.target,this.candidate,.3)===1)this.target.copy(this.candidate);
    const cp=Math.cos(this.pitch);
    this.desired.set(this.target.x+Math.sin(this.yaw)*cp*this.distance,this.target.y+Math.sin(this.pitch)*this.distance,this.target.z+Math.cos(this.yaw)*cp*this.distance);
    const fraction=this.safeFraction(this.target,this.desired);
    const safe=Math.max(.18,this.distance*fraction-.15);
    this.colliding=fraction<.999;
    this.safeDistance=safe<this.safeDistance?safe:THREE.MathUtils.damp(this.safeDistance,safe,5,dt);
    this.desired.sub(this.target).normalize().multiplyScalar(this.safeDistance).add(this.target);
    if(!this.initialized) {this.camera.position.copy(this.desired);this.initialized=true;}
    else this.camera.position.lerp(this.desired,1-Math.exp(-19*dt));
    // A smoothed endpoint can cut the inside of a corner; sweep it again.
    const final=this.safeFraction(this.target,this.camera.position);
    if(final<1) {this.camera.position.lerpVectors(this.target,this.camera.position,Math.max(0,final-.025));this.colliding=true;}
    this.camera.position.y=Math.max(this.camera.position.y,this.terrain.getHeight(this.camera.position.x,this.camera.position.z)+.42);
    this.camera.lookAt(this.target);
  }
  getStats() { return {colliding:this.colliding,distance:this.safeDistance,requestedDistance:this.distance,yaw:this.yaw,pitch:this.pitch,position:{x:this.camera.position.x,y:this.camera.position.y,z:this.camera.position.z}}; }
}
