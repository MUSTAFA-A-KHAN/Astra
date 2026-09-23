import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const isPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
const blend = (rate, dt) => 1 - Math.exp(-rate * dt);
const MODES = new Set(['follow', 'combat', 'aim', 'cinematic', 'mount']);

/** Third-person camera. All positions are world coordinates; pitch may look above the horizon. */
export class FollowCamera {
  constructor(camera, terrain, collision) {
    this.camera = camera;
    this.terrain = terrain;
    this.collision = collision;
    this.pivot = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.candidate = new THREE.Vector3();
    this.anchor = new THREE.Vector3();
    this.previous = new THREE.Vector3();
    this.lockPoint = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = .36;
    this.distance = 12;
    this.safeDistance = 12;
    this.radius = .42;
    this.mode = 'follow';
    this.locked = false;
    this.targetId = null;
    this.colliding = false;
    this.initialized = false;
    this.cinematicTime = 0;
  }

  reset(position, yaw = 0, pitch = .36, distance = 12) {
    if (!isPoint(position)) return;
    this.pivot.copy(position).y += 2.05;
    this.target.copy(this.pivot);
    this.yaw = finite(yaw, 0);
    this.pitch = clamp(finite(pitch, .36), -1.35, 1.45);
    this.distance = clamp(finite(distance, 12), 3, 28);
    this.safeDistance = this.distance;
    this.colliding = false;
    this.locked = false;
    this.targetId = null;
    this.mode = 'follow';
    this.cinematicTime = 0;
    this.initialized = false;
  }

  floorHeight(x, z) {
    // A sphere must clear the terrain around its centre as well as directly below it.
    const r = this.radius * .7;
    return Math.max(
      this.terrain.getHeight(x, z), this.terrain.getHeight(x + r, z),
      this.terrain.getHeight(x - r, z), this.terrain.getHeight(x, z + r),
      this.terrain.getHeight(x, z - r),
    ) + this.radius;
  }

  safeFraction(from, to, radius = this.radius) {
    let safe = clamp(finite(this.collision.cameraFraction(from, to, radius), 0), 0, 1);
    const length = from.distanceTo(to), steps = Math.max(1, Math.ceil(length / .25));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (t > safe) break;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      if (y < this.floorHeight(x, z)) {
        safe = Math.max(0, (i - 1) / steps);
        break;
      }
    }
    return safe;
  }

  clip(from, to, radius = this.radius) {
    const fraction = this.safeFraction(from, to, radius);
    if (fraction < 1) {
      // Keep a small clearance without imposing a minimum boom length through a wall.
      const padding = .04 / Math.max(.04, from.distanceTo(to));
      to.lerpVectors(from, to, Math.max(0, fraction - padding));
      this.colliding = true;
    }
    return fraction;
  }

  /**
   * options: mode, lockTarget (Vector3, {position}, or {group}), height, shoulder,
   * fov, speed (mount), cinematicTime. Dead, hidden or distant lock targets release.
   */
  update(dt, position, yaw, pitch, distance, options = {}) {
    if (!isPoint(position)) return this.getStats();
    dt = clamp(finite(dt, 0), 0, 1);
    if (this.initialized && dt === 0) return this.getStats();
    const first = !this.initialized;
    const snap = first || this.pivot.distanceToSquared(position) > 60 * 60;
    let mode = MODES.has(options.mode) ? options.mode : 'follow';
    const lock = options.lockTarget;
    const lockPosition = lock?.group?.position || lock?.position || lock;
    const lockValid = isPoint(lockPosition) && lock?.alive !== false && lock?.visible !== false && lock?.group?.visible !== false
      && Math.hypot(lockPosition.x - position.x, lockPosition.y - position.y, lockPosition.z - position.z) <= 45;
    this.locked = Boolean(lockValid && (mode === 'follow' || mode === 'combat'));
    if (this.locked) mode = 'combat';
    else if (mode === 'combat') mode = 'follow';
    this.targetId = this.locked ? (lock.id ?? lock.index ?? null) : null;
    if (mode !== this.mode && mode === 'cinematic') this.cinematicTime = 0;
    this.mode = mode;
    this.colliding = false;

    let desiredYaw = finite(yaw, this.yaw);
    let desiredPitch = clamp(finite(pitch, this.pitch), -1.35, 1.45);
    let desiredDistance = clamp(finite(distance, this.distance), 3, 28);
    let height = finite(options.height, 2.05), shoulder = finite(options.shoulder, .4);
    let fov = clamp(finite(options.fov, 55), 30, 90);
    if (mode === 'combat') {
      const dx = position.x - lockPosition.x, dz = position.z - lockPosition.z;
      if (Math.hypot(dx, dz) > .01) desiredYaw = Math.atan2(dx, dz);
      desiredPitch = .3;
      desiredDistance = clamp(Math.hypot(dx, dz) * .65 + 7, 9, 22);
      shoulder = .4;
      fov = 60;
    } else if (mode === 'aim') {
      desiredDistance = clamp(desiredDistance, 3, 4.8);
      shoulder = .95;
      height = 2.15;
      fov = 43;
    } else if (mode === 'mount') {
      const speed = clamp(finite(options.speed, 0), 0, 24);
      height = 3.2;
      shoulder = .3;
      desiredDistance = clamp(desiredDistance + 3 + speed * .08, 13, 28);
      fov = 62 + speed * .45;
    } else if (mode === 'cinematic') {
      this.cinematicTime = finite(options.cinematicTime, this.cinematicTime + dt);
      desiredYaw += this.cinematicTime * .16;
      desiredPitch = .3 + Math.sin(this.cinematicTime * .24) * .08;
      desiredDistance = clamp(desiredDistance, 15, 25);
      shoulder = 0;
      height = 2.1;
      fov = 48;
    }

    const yawDifference = Math.atan2(Math.sin(desiredYaw - this.yaw), Math.cos(desiredYaw - this.yaw));
    this.yaw += yawDifference * (snap ? 1 : blend(mode === 'cinematic' ? 3 : 14, dt));
    this.pitch = snap ? desiredPitch : THREE.MathUtils.damp(this.pitch, desiredPitch, 15, dt);
    this.distance = snap ? desiredDistance : THREE.MathUtils.damp(this.distance, desiredDistance, 9, dt);
    this.anchor.copy(position).y += height;
    this.anchor.y = Math.max(this.anchor.y, this.floorHeight(this.anchor.x, this.anchor.z));
    if (snap) this.pivot.copy(this.anchor);
    else this.pivot.lerp(this.anchor, blend(18, dt));
    // The delayed follow pivot cannot remain across a wall after the player rounds a corner.
    this.clip(this.anchor, this.pivot);
    this.candidate.copy(this.pivot);
    this.candidate.x += Math.cos(this.yaw) * shoulder;
    this.candidate.z -= Math.sin(this.yaw) * shoulder;
    this.clip(this.pivot, this.candidate);
    this.anchor.copy(this.candidate);

    this.target.copy(this.anchor);
    if (this.locked) {
      this.lockPoint.copy(lockPosition).y += 1.35;
      this.target.lerp(this.lockPoint, .42);
    }
    // Looking up tilts the lens instead of moving the boom through the ground.
    const orbitPitch = Math.max(.08, this.pitch), cp = Math.cos(orbitPitch);
    this.desired.set(
      this.anchor.x + Math.sin(this.yaw) * cp * this.distance,
      this.anchor.y + Math.sin(orbitPitch) * this.distance,
      this.anchor.z + Math.cos(this.yaw) * cp * this.distance,
    );
    const fraction = this.safeFraction(this.anchor, this.desired);
    const safeDistance = Math.max(0, this.distance * fraction - (fraction < 1 ? .04 : 0));
    if (fraction < 1) this.colliding = true;
    // Retract immediately; ease back out so pillars and doorways do not make the camera pump.
    this.safeDistance = snap || safeDistance < this.safeDistance ? safeDistance : THREE.MathUtils.damp(this.safeDistance, safeDistance, 5, dt);
    this.desired.sub(this.anchor).normalize().multiplyScalar(this.safeDistance).add(this.anchor);
    this.previous.copy(this.camera.position);
    if (snap) this.camera.position.copy(this.desired);
    else this.camera.position.lerp(this.desired, blend(mode === 'cinematic' ? 5 : 19, dt));
    // Both the boom and the actual smoothed travel need a sweep: interpolating safe
    // endpoints alone can still cut through the inside corner of a building.
    this.clip(this.anchor, this.camera.position);
    if (!snap && this.collision.cameraFraction(this.previous, this.previous, this.radius) === 1) {
      this.clip(this.previous, this.camera.position);
    }
    this.camera.position.y = Math.max(this.camera.position.y, this.floorHeight(this.camera.position.x, this.camera.position.z));
    this.clip(this.anchor, this.camera.position);
    this.camera.lookAt(this.target);
    if (!this.locked && this.pitch < .08) this.camera.rotateX(.08 - this.pitch);
    const nextFov = snap ? fov : THREE.MathUtils.damp(this.camera.fov, fov, 9, dt);
    if (Math.abs(this.camera.fov - nextFov) > .0001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    this.initialized = true;
    return this.getStats();
  }

  getStats() {
    return {
      mode: this.mode, locked: this.locked, targetId: this.targetId, colliding: this.colliding,
      distance: this.camera.position.distanceTo(this.anchor), requestedDistance: this.distance,
      yaw: this.yaw, pitch: this.pitch, fov: this.camera.fov,
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      target: { x: this.target.x, y: this.target.y, z: this.target.z },
    };
  }
}
