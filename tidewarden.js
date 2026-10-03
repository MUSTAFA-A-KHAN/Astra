import * as THREE from 'three';
import { createRidingAnchor } from './riding.js';

// The Tidewarden, the great winged ray of the harbour, carries a rider
// through the sky.
//
// Left alone it circles the open water west of the city, breaking the
// surface as it goes. Called from the ferryman's quay it comes in low beside
// the kerb and waits there, a leap away. Ridden, it flies where its rider
// looks: the stick asks for a way to go and it swings round to it, the tilt
// of the view climbs or dives, and jump lifts it straight up. Asked to land,
// it sets its rider down on the nearest open ground and swims home.
//
// Every position here is the seat on its back. The whole ray turns about its
// rider, so a bank or a dive never throws the camera about.

const clamp = THREE.MathUtils.clamp;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const blend = (rate, dt) => 1 - Math.exp(-rate * dt);
const smooth = k => k * k * (3 - 2 * k);

/** Speeds in world units a second, angles in radians, heights in world units. */
export const FLIGHT = Object.freeze({
  // Under way with the stick held, and sprinting.
  cruise: 22, surge: 38,
  // How quickly it takes up a new speed, gathering way and easing off.
  gather: 1.1, ease: .7,
  // The fastest it swings round, hovering and at full cruise.
  hoverTurn: 1.8, turn: 1.1,
  // Its steepest climb and dive along the rider's look, and its climb
  // straight up with jump held.
  climb: .6, dive: .75, rise: 11,
  // The highest the seat goes, and how far the belly stays clear of a roof.
  ceiling: 160, clearance: 1,
  // A floor that stands this far above the next wingbeat is a wall.
  wall: 2.5,
  // How far the wings reach round the seat, in flight and when guided in.
  reach: 9, guided: 5,
});

/**
 * A winged mount's flight. Like a horse on its reins (riding.js) it cannot
 * face a new way on the spot: it swings round at a limited rate, quicker
 * hovering than at speed, and always flies the way it faces. Unlike a horse
 * it can hover, and it climbs and dives along its rider's look.
 *
 * Headings match `rotation.y`: 0 faces +z, and a rising heading turns left.
 */
export class WingFlight {
  constructor() { this.position = new THREE.Vector3(); this.reset(); }
  reset(position, heading = 0, speed = 0) {
    if (position) this.position.copy(position);
    this.heading = wrap(heading); this.speed = speed;
    /** Radians a second, positive to the left. */
    this.turnRate = 0;
    this.climb = 0; this.lift = 0; this.vertical = 0; this.pitch = 0; this.roll = 0;
    this.blocked = false;
  }
  /**
   * x, z: the way the rider asks to go, up to length 1. surge: sprint held.
   * rise: jump held. aim: the climb along the rider's look, up positive.
   * minimum(x, z): the lowest the seat may be there. bounds: where it may go.
   */
  update(dt, { x = 0, z = 0, surge = false, rise = false, aim = 0 } = {}, { minimum, bounds } = {}) {
    if (!(dt > 0)) return this;
    const asked = Math.min(1, Math.hypot(x, z));
    let turn = 0, throttle = 0;
    if (asked > .05) {
      let off = wrap(Math.atan2(x, z) - this.heading);
      // Asked straight back, it keeps wheeling the way it already is rather
      // than dithering between the two equally short ways round.
      if (Math.abs(off) > 2.6 && off * this.turnRate < 0) off += Math.sign(this.turnRate) * Math.PI * 2;
      const limit = FLIGHT.hoverTurn + (FLIGHT.turn - FLIGHT.hoverTurn) * clamp(this.speed / FLIGHT.cruise, 0, 1);
      turn = clamp(off * 2.5, -limit, limit);
      // A sharp turn is taken slowly, so it tightens instead of swinging wide.
      throttle = asked * Math.max(.3, Math.cos(off / 2) ** 2);
    }
    this.turnRate += (turn - this.turnRate) * blend(5, dt);
    this.heading = wrap(this.heading + this.turnRate * dt);
    const wanted = throttle * (surge ? FLIGHT.surge : FLIGHT.cruise);
    this.speed += (wanted - this.speed) * blend(wanted > this.speed ? FLIGHT.gather : FLIGHT.ease, dt);
    // It climbs and dives along the look only while it is under way.
    this.climb += ((throttle > .05 ? clamp(aim, -FLIGHT.dive, FLIGHT.climb) : 0) - this.climb) * blend(3, dt);
    this.lift += ((rise ? FLIGHT.rise : 0) - this.lift) * blend(4, dt);
    const p = this.position, across = this.speed * Math.cos(this.climb);
    const ahead = { x: Math.sin(this.heading), z: Math.cos(this.heading) };
    let nx = p.x + ahead.x * across * dt, nz = p.z + ahead.z * across * dt;
    let ny = p.y + (this.speed * Math.sin(this.climb) + this.lift) * dt;
    if (bounds) { nx = clamp(nx, bounds.minX, bounds.maxX); nz = clamp(nz, bounds.minZ, bounds.maxZ); }
    this.blocked = false;
    if (minimum) {
      // It pulls up for whatever stands ahead, as fast as its wings allow.
      // What it cannot clear in time is a wall: it slides along it, or holds
      // against it, still climbing.
      const look = Math.min(30, this.speed * .9);
      const clear = minimum(nx + ahead.x * look, nz + ahead.z * look);
      if (clear > ny) ny = Math.min(clear, ny + Math.max(FLIGHT.rise, this.speed) * 1.2 * dt);
      const wall = (wx, wz) => minimum(wx, wz) > ny + FLIGHT.wall;
      if (wall(nx, nz)) {
        this.blocked = true;
        if (!wall(nx, p.z)) nz = p.z;
        else if (!wall(p.x, nz)) nx = p.x;
        else { nx = p.x; nz = p.z; }
        this.speed *= Math.exp(-4 * dt);
      }
      ny = Math.max(ny, minimum(nx, nz));
    }
    ny = Math.min(ny, FLIGHT.ceiling);
    const moved = Math.hypot(nx - p.x, nz - p.z) / dt;
    this.vertical = (ny - p.y) / dt;
    p.set(nx, ny, nz);
    // It banks into a turn, and points its nose the way it is going.
    this.roll += (clamp(-this.turnRate * .5, -.6, .6) - this.roll) * blend(4, dt);
    this.pitch += (clamp(Math.atan2(this.vertical, Math.max(moved, 6)), -.6, .6) - this.pitch) * blend(4, dt);
    return this;
  }
}

/**
 * The highest thing within `r` of (x, z), for a flier to keep above: the
 * ground, the water, and every roof, wall and awning. Posts and trunks are
 * left out, as the camera leaves them, and so are the cells the navigator
 * sealed as water. Off the map there is only the water, but for any
 * `shores` ({ minX, maxX, minZ, maxZ, top }): what a map builds out past
 * the ground anyone walks on.
 */
export function surfaceBelow({ world, collision, waterline, shores = [] }) {
  const b = world.bounds;
  const gap = (x, z, c) => Math.hypot(Math.max(0, c.minX - x, x - c.maxX), Math.max(0, c.minZ - z, z - c.maxZ));
  return (x, z, r = FLIGHT.reach) => {
    let top = waterline;
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) top = Math.max(top, world.getHeight(x, z));
    for (const shore of shores) if (shore.top > top && gap(x, z, shore) < r) top = shore.top;
    for (const c of collision.query(x - r, z - r, x + r, z + r)) {
      if (c.noCamera || c.slender || c.dynamic) continue;
      // Someone standing about has no top: about a person's height.
      const height = c.cameraTop ?? c.top ?? (c.bottom ?? 0) + 4;
      if (!(height > top)) continue;
      const gap = c.r !== undefined ? Math.hypot(x - c.x, z - c.z) - c.r
        : Math.hypot(Math.max(0, Math.abs(x - c.x) - c.w / 2), Math.max(0, Math.abs(z - c.z) - c.d / 2));
      if (gap < r) top = height;
    }
    return top;
  };
}

/** The sky over a map, `margin` out past its edges. */
export function skyOver(bounds, margin = 150) {
  return { minX: bounds.minX - margin, maxX: bounds.maxX + margin, minZ: bounds.minZ - margin, maxZ: bounds.maxZ + margin };
}

// The point `k` of the way along a cubic curve through four points.
function curve(p, k, out) {
  const a = (1 - k) ** 3, b = 3 * (1 - k) ** 2 * k, c = 3 * (1 - k) * k * k, d = k ** 3;
  return out.set(p[0].x * a + p[1].x * b + p[2].x * c + p[3].x * d, p[0].y * a + p[1].y * b + p[2].y * c + p[3].y * d, p[0].z * a + p[1].z * b + p[2].z * c + p[3].z * d);
}

/**
 * The Tidewarden in the world. `model` is the fitted ray, its head toward
 * -z and its belly at 0; `action` is its swim. `seat` is where a rider sits
 * on its back, in the model's units, and `carrier` the bone under it, if it
 * has one. It
 * keeps to `water` ({ x, z, radius, period }) at `waterline`, comes to
 * `berth` ({ x, z, heading, call }) when called from the quay at `call`,
 * and flies within `bounds`. `floor(x, z, r)` is the highest surface within
 * r of (x, z) (surfaceBelow). `fade(k)`, if given, shows it at opacity k.
 *
 * The ray is shown in `rig`, which is what goes into the world.
 */
export function createTidewarden({ model, action, seat, carrier, water, waterline, berth, bounds, floor, fade }) {
  const rig = new THREE.Group(); rig.name = 'Tidewarden rig'; rig.rotation.order = 'YXZ';
  // Turned head first along the rig's heading, with the seat at its origin.
  model.rotation.y = Math.PI; model.position.set(seat.x, -seat.y, seat.z);
  rig.add(model);
  // The rider sits on the bone under the seat, through every wingbeat: the
  // seat is found on the swim's first pose, the one the bone starts from.
  action.play(); action.getMixer().update(0); rig.updateWorldMatrix(true, true);
  const saddle = createRidingAnchor(model, carrier ?? model, new THREE.Vector3(seat.x, seat.y, seat.z));
  saddle.name = 'Tidewarden seat';
  // Its body and wings round the seat, a little over: a camera in here sees
  // through it. Not its tail, which a camera following behind looks along.
  const body = new THREE.Box3().setFromObject(model);
  body.min.z = Math.max(body.min.z, seat.z); body.expandByScalar(1);
  let shown = 1;

  // The lowest the seat may be over (x, z): its belly just clear of a roof,
  // or awash in the harbour.
  const minimum = (x, z, r = FLIGHT.reach) => {
    const top = floor(x, z, r);
    return top + seat.y + (top <= waterline + .01 ? -.6 : FLIGHT.clearance);
  };
  // The berth is as low as the seat may fly there, so taking the reins
  // never lifts it with a jolt.
  const dock = new THREE.Vector3(berth.x, minimum(berth.x, berth.z), berth.z);

  const flight = new WingFlight();
  const pose = { position: new THREE.Vector3(), heading: 0, pitch: 0, roll: 0, speed: 0, turnRate: 0 };
  const at = new THREE.Vector3(), last = new THREE.Vector3();
  let mode = 'circling', route = null, spot = null, offset = 0, idle = 0, posed = false, clock = 0, swell = 0;

  // Takes up the pose for being at `point` now, facing the way it came.
  function settle(point, dt, heading) {
    if (!posed || !(dt > 0)) {
      pose.position.copy(point); pose.heading = heading ?? pose.heading; posed = true;
      return;
    }
    last.copy(pose.position); pose.position.copy(point);
    const dx = point.x - last.x, dz = point.z - last.z, across = Math.hypot(dx, dz) / dt;
    const vertical = (point.y - last.y) / dt;
    pose.speed = Math.hypot(across, vertical);
    const facing = heading ?? (across > 1 ? Math.atan2(dx, dz) : pose.heading);
    const turned = wrap(facing - pose.heading);
    pose.heading = wrap(pose.heading + turned * blend(4, dt));
    pose.turnRate += (turned * blend(4, dt) / dt - pose.turnRate) * blend(3, dt);
    pose.roll += (clamp(-pose.turnRate * .5, -.6, .6) - pose.roll) * blend(3, dt);
    pose.pitch += (clamp(Math.atan2(vertical, Math.max(across, 6)), -.6, .6) - pose.pitch) * blend(3, dt);
  }
  // A course along `points`, a cubic curve from where it is now.
  function course(points, speed, next) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
    route = { points, duration: Math.max(2.5, length / speed), t: 0, lift: 0, next };
  }
  // Along the course, kept clear of whatever it passes over: it rises for a
  // roof at once and settles back slowly.
  function follow(dt) {
    route.t = Math.min(1, route.t + dt / route.duration);
    curve(route.points, smooth(route.t), at);
    const need = Math.max(0, minimum(at.x, at.z, FLIGHT.guided) - at.y);
    route.lift += (need - route.lift) * blend(need > route.lift ? 8 : 1.5, dt);
    at.y += route.lift;
    settle(at, dt);
    if (route.t >= 1) { const next = route.next; route = null; next(); }
  }
  // The highest the seat must go to pass straight from one point to another.
  function passage(from, to) {
    let high = -Infinity;
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 6);
    for (let i = 0; i <= steps; i++) high = Math.max(high, minimum(from.x + (to.x - from.x) * i / Math.max(1, steps), from.z + (to.z - from.z) * i / Math.max(1, steps)));
    return high + 2;
  }
  const forward = (heading, distance) => new THREE.Vector3(Math.sin(heading) * distance, 0, Math.cos(heading) * distance);

  // Out on the water, round and round; `lift` is the story's, above or
  // below the surface. The circle turns with the clock, so it holds still
  // when the world's motion does.
  function circling(time, lift) {
    const angle = time / water.period * Math.PI * 2 + offset;
    return at.set(water.x + Math.cos(angle) * water.radius, waterline + seat.y + lift, water.z + Math.sin(angle) * water.radius);
  }
  function goHome() {
    const from = pose.position.clone(), entry = Math.atan2(from.z - water.z, from.x - water.x);
    const home = new THREE.Vector3(water.x + Math.cos(entry) * water.radius, waterline + seat.y + swell, water.z + Math.sin(entry) * water.radius);
    // Up clear of the roofs first, then out and down to the water, joining
    // the circle along it.
    const high = Math.max(from.y + 6, passage(from, home));
    const along = -entry, reach = clamp(from.distanceTo(home) * .35, 10, 60);
    mode = 'returning';
    course([from, new THREE.Vector3(from.x, high, from.z), home.clone().sub(forward(along, reach)).setY(Math.max(home.y, high * .6)), home], 18, () => {
      mode = 'circling';
      // Rejoined where it came down.
      offset = entry - clock / water.period * Math.PI * 2;
    });
  }

  return {
    rig, saddle, flight,
    /** Where it waits when called, and where the quay it is called from is. */
    berth: { x: dock.x, y: dock.y, z: dock.z, heading: berth.heading, call: { ...berth.call } },
    get mode() { return mode; },
    get position() { return pose.position; },
    get heading() { return pose.heading; },
    get pitch() { return pose.pitch; },
    get roll() { return pose.roll; },
    get speed() { return pose.speed; },
    /** Where it is setting its rider down, while it lands. */
    get spot() { return spot; },

    /**
     * Each frame, before the ray is drawn. `lift` raises it above the water
     * or sinks it below as the story would have it; `player` is where the
     * hero is, so it knows when nobody is waiting for it at the quay.
     */
    update(dt, time, { lift = 0, player } = {}) {
      clock = time; swell = lift;
      if (route) follow(dt);
      else if (mode === 'circling') settle(circling(time, lift), dt);
      else if (mode === 'waiting' || mode === 'landed') {
        const rest = mode === 'waiting' ? dock : spot.hover;
        // It hangs on its wings, rising and falling a little with each beat.
        settle(at.copy(rest).setY(rest.y + Math.sin(time * .9) * .3), dt, mode === 'waiting' ? berth.heading : undefined);
        // Left waiting at an empty quay, it goes back to the water.
        const away = mode === 'waiting' && player && Math.hypot(player.x - berth.call.x, player.z - berth.call.z) > 30;
        idle = away ? idle + dt : 0;
        if (idle > 10) goHome();
      }
      rig.position.copy(pose.position);
      rig.rotation.set(-pose.pitch, pose.heading, pose.roll);
      // Its wings beat faster the faster it goes.
      action.timeScale = 1 + pose.speed / 24;
    },
    /**
     * Each frame, once the camera has moved. A camera that has swung into its
     * body or wings, over the quay or round its rider, sees through it
     * rather than into it.
     */
    see(eye, dt) {
      if (!fade || body.isEmpty()) return;
      rig.updateWorldMatrix(true, false);
      const inside = body.containsPoint(rig.worldToLocal(at.copy(eye)));
      const wanted = inside ? .2 : 1, was = shown;
      shown += (wanted - shown) * blend(inside ? 14 : 5, dt);
      if (Math.abs(shown - wanted) < .01) shown = wanted;
      if (shown !== was) fade(shown);
    },
    /** Called from the quay: it comes in to the berth. */
    call() {
      if (mode !== 'circling' && mode !== 'returning') return false;
      const from = pose.position.clone(), reach = clamp(from.distanceTo(dock) * .35, 8, 45);
      mode = 'summoned'; idle = 0;
      course([from, from.clone().add(forward(pose.heading, reach)), dock.clone().sub(forward(berth.heading, reach)).setY(dock.y + 4), dock.clone()], 20, () => { mode = 'waiting'; });
      return true;
    },
    /** A rider is on its back: from here, it flies where they ask. */
    ride() {
      if (mode !== 'waiting' && mode !== 'landing' && mode !== 'landed') return false;
      route = null; spot = null; mode = 'ridden';
      flight.reset(pose.position, pose.heading, Math.min(pose.speed, FLIGHT.cruise));
      return true;
    },
    /** Under its rider. `input` is WingFlight's. */
    fly(dt, input) {
      if (mode !== 'ridden') return pose;
      flight.update(dt, input, { minimum: (x, z) => minimum(x, z), bounds });
      pose.position.copy(flight.position); pose.heading = flight.heading; pose.pitch = flight.pitch; pose.roll = flight.roll;
      pose.speed = Math.hypot(flight.speed, flight.vertical); pose.turnRate = flight.turnRate;
      return pose;
    },
    /** Sets its rider down at `ground` ({ x, y, z }): it comes in above it. */
    land(ground) {
      if (mode !== 'ridden') return false;
      const from = pose.position.clone(), hover = new THREE.Vector3(ground.x, Math.max(ground.y + seat.y + 1.2, minimum(ground.x, ground.z, FLIGHT.guided)), ground.z);
      const high = Math.max(from.y, passage(from, hover)), across = Math.hypot(hover.x - from.x, hover.z - from.z);
      spot = { x: ground.x, y: ground.y, z: ground.z, hover };
      mode = 'landing';
      course([from, from.clone().add(forward(pose.heading, Math.min(10, across * .4))).setY(high), new THREE.Vector3(hover.x, Math.max(high, hover.y + 6), hover.z), hover], 15, () => { mode = 'landed'; });
      return true;
    },
    /** Its rider has got off, or never got on: home to the water. */
    release() {
      if (mode === 'circling' || mode === 'returning') return false;
      route = null; spot = null; idle = 0;
      goHome();
      return true;
    },
    get diagnostics() {
      const r = v => +v.toFixed(2);
      return {
        mode, x: r(pose.position.x), y: r(pose.position.y), z: r(pose.position.z),
        heading: r(pose.heading), pitch: r(pose.pitch), roll: r(pose.roll), speed: r(pose.speed),
        course: route ? r(route.t) : null, blocked: mode === 'ridden' && flight.blocked, shown: r(shown),
        berth: { x: r(dock.x), y: r(dock.y), z: r(dock.z) }, spot: spot && { x: r(spot.x), y: r(spot.y), z: r(spot.z) },
      };
    },
  };
}
