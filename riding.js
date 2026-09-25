import * as THREE from 'three';

// Author contact points in fitted character units, then let their bones carry
// them through animation (including rigs exported with different units/axes).
export function createRidingAnchor(group, holder, point) {
  const anchor = new THREE.Object3D();
  anchor.name = 'Riding contact';
  anchor.position.copy(holder.worldToLocal(group.localToWorld(point.clone())));
  holder.add(anchor);
  return anchor;
}

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// Turn rates in radians per second: wheeling round from a stand, and at a gallop.
const PIVOT_TURN = 2.4, GALLOP_TURN = 1.1, GALLOP_SPEED = 14;

/** The fastest a mount can swing round at this ground speed. */
export function maxTurnRate(speed) {
  return GALLOP_TURN + (PIVOT_TURN - GALLOP_TURN) * THREE.MathUtils.clamp((GALLOP_SPEED - speed) / (GALLOP_SPEED - 2), 0, 1);
}

/**
 * Reins for a mount. A horse cannot face a new way on the spot: it swings its
 * heading round at a limited rate, tighter at a walk than at a gallop, and
 * always travels the way it faces. Asked to go back the way it came, it eases
 * off and wheels round in an arc.
 *
 * Headings match `rotation.y`: 0 faces +z, and a rising heading turns left.
 */
export class MountSteering {
  constructor(heading = 0) { this.reset(heading); }
  reset(heading = 0) {
    this.heading = wrap(heading);
    /** Radians per second, positive to the left. */
    this.turnRate = 0;
  }
  /**
   * x, z: the way the rider asks to go, up to length 1. speed: ground speed.
   * Returns the way to travel, along the mount's heading, and how hard to push.
   */
  update(dt, { x = 0, z = 0, speed = 0 } = {}) {
    const asked = Math.min(1, Math.hypot(x, z));
    let target = 0, throttle = 0;
    if (asked > .05) {
      let off = wrap(Math.atan2(x, z) - this.heading);
      // Asked straight back, keep wheeling the way it already is rather than
      // dithering between the two equally short ways round.
      if (Math.abs(off) > 2.6 && off * this.turnRate < 0) off += Math.sign(this.turnRate) * Math.PI * 2;
      const limit = maxTurnRate(speed);
      target = THREE.MathUtils.clamp(off * 3, -limit, limit);
      // Ease off through a sharp turn, so it tightens instead of swinging wide.
      throttle = asked * Math.max(.35, Math.cos(off / 2) ** 2);
    }
    // Leaning into and out of a turn takes a moment.
    this.turnRate += (target - this.turnRate) * (1 - Math.exp(-8 * dt));
    this.heading = wrap(this.heading + this.turnRate * dt);
    return { x: Math.sin(this.heading) * throttle, z: Math.cos(this.heading) * throttle, magnitude: throttle, heading: this.heading };
  }
}

const riderPoint = new THREE.Vector3();
const saddlePoint = new THREE.Vector3();

export function alignRider(avatar, riderAnchor, saddle) {
  riderAnchor.getWorldPosition(riderPoint);
  saddle.getWorldPosition(saddlePoint);
  // Convert both points to the avatar parent's space before translating it.
  if (avatar.parent) {
    avatar.parent.worldToLocal(riderPoint);
    avatar.parent.worldToLocal(saddlePoint);
  }
  avatar.position.add(saddlePoint.sub(riderPoint));
  avatar.updateWorldMatrix(false, true);
}
