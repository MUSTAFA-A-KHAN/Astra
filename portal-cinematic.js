import * as THREE from 'three';

/**
 * PORTAL CROSSING, SHOT BY SHOT
 *
 * While the keeper's gate wakes and the traveller steps through, the camera
 * leaves the player's hands and follows a short sequence of shots. Each shot
 * is a few keyframes of a camera on a cylinder round the gate, always outside
 * the ring its standing stones fly in, looking at a point between the
 * traveller and the aperture. Keys are eased through with Catmull-Rom
 * tangents, so the camera glides through them rather than stopping at each.
 *
 * A shot's `angle` is measured round the gate from the aperture's axis on the
 * side the traveller enters from, `radius` out from the gate, and `height`
 * above its ground. `look` runs from the traveller's head (0) to the aperture
 * (1); `fov` is in degrees.
 */
export const PORTAL_TIMING = Object.freeze({ cast: 6.2, blendIn: 1.2, land: 2.8, blendOut: 1.5 });

const CAST = [
  // Over the reader's shoulder as the spell leaves the book.
  [0, { angle: -.95, radius: 13.8, height: 2, look: .3, fov: 46 }],
  // Low, so the stones tower as they break the ground.
  [2, { angle: -1.2, radius: 14.2, height: 1.1, look: .5, fov: 52 }],
  // Up and out, to take in the whole ring of turning stones.
  [4.2, { angle: -.35, radius: 18, height: 7.5, look: .85, fov: 56 }],
  // Round to the aperture's face as it opens.
  [PORTAL_TIMING.cast, { angle: .38, radius: 15.5, height: 3.6, look: 1, fov: 48 }],
];
// Landing: from high over the traveller down into the player's own view.
const LAND = [[0, { angle: -.9, elevation: 1.1, distance: 19, fov: 50 }]];

const smooth = t => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// Hermite interpolation through keyed values, with Catmull-Rom tangents inside
// and zero tangents at the ends, so a shot eases in and out of its first and last key.
export function sampleKeys(keys, t, out = {}) {
  const last = keys.length - 1;
  if (!(t > keys[0][0])) return Object.assign(out, keys[0][1]);
  if (t >= keys[last][0]) return Object.assign(out, keys[last][1]);
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i], [t1, b] = keys[i + 1], span = t1 - t0, s = (t - t0) / span;
  const s2 = s * s, s3 = s2 * s;
  for (const key of Object.keys(a)) {
    const m0 = i > 0 ? (b[key] - keys[i - 1][1][key]) / (t1 - keys[i - 1][0]) : 0;
    const m1 = i + 1 < last ? (keys[i + 2][1][key] - a[key]) / (keys[i + 2][0] - t0) : 0;
    out[key] = (2 * s3 - 3 * s2 + 1) * a[key] + (s3 - 2 * s2 + s) * span * m0 + (-2 * s3 + 3 * s2) * b[key] + (s3 - s2) * span * m1;
  }
  return out;
}

/**
 * The shot for one moment of the crossing.
 * phase: 'casting' | 'ready' | 'entering' (and 'traveling', which holds the entry's last frames).
 * t: seconds into that phase. entry: the traveller's walk, pause and float durations.
 * from: the shot at the moment the traveller set off, so the camera leaves it smoothly.
 */
export function portalShot(phase, t, { entry, from } = {}, out = {}) {
  if (phase === 'casting') return sampleKeys(CAST, t, out);
  const settled = CAST[CAST.length - 1][1];
  if (phase === 'ready' || !entry) {
    // A slow sway round the open gate for as long as the far shore takes.
    return Object.assign(out, settled, { angle: settled.angle + Math.sin(t * .2) * .35, height: settled.height + Math.sin(t * .4) * .5 });
  }
  const start = { ...(from ?? settled) }, walk = entry.walk, inside = entry.walk + entry.pause;
  const keys = [
    [0, start],
    // Behind the traveller as they walk round to the dais…
    [walk * .8, { angle: -.28, radius: 14.2, height: 2.4, look: .35, fov: 46 }],
    [walk, { angle: -.1, radius: 13.6, height: 2.1, look: .45, fov: 42 }],
    // …a breath at its foot, then a slow push into the light with them.
    [inside, { angle: -.06, radius: 13.4, height: 2.4, look: .6, fov: 38 }],
    [inside + entry.float, { angle: 0, radius: 13, height: 3.5, look: 1, fov: 26 }],
  ];
  // Leave by the shorter way round, however long the camera circled.
  start.angle = keys[1][1].angle + wrap(start.angle - keys[1][1].angle);
  return sampleKeys(keys, t, out);
}

/**
 * Camera position and aim for a gate shot. rig.gate is the gate's ground
 * centre, rig.axis the unit direction from it toward the entry side,
 * rig.aperture the aperture's centre and rig.hero the traveller's feet.
 */
export function shotPose(shot, rig, out = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 }) {
  const { gate, axis, aperture, hero } = rig, c = Math.cos(shot.angle), s = Math.sin(shot.angle);
  const dx = axis.x * c + axis.z * s, dz = -axis.x * s + axis.z * c;
  out.position.set(gate.x + dx * shot.radius, gate.y + shot.height, gate.z + dz * shot.radius);
  out.target.set(hero.x, hero.y + 1.5, hero.z).lerp(aperture, shot.look);
  out.fov = shot.fov;
  return out;
}

/**
 * The arrival: the camera starts high over the traveller as the light clears
 * and comes down to where the player's own camera will be. rig.hero is the
 * traveller's feet; rig.yaw, rig.pitch, rig.distance, rig.height and rig.fov
 * describe the player's camera, in the follow camera's own terms.
 */
export function landingPose(t, rig, out = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 }) {
  const shot = sampleKeys([...LAND, [PORTAL_TIMING.land, { angle: 0, elevation: Math.max(.08, rig.pitch), distance: rig.distance, fov: rig.fov }]], t);
  const yaw = rig.yaw + shot.angle, flat = Math.cos(shot.elevation) * shot.distance;
  out.target.set(rig.hero.x, rig.hero.y + rig.height, rig.hero.z);
  out.position.set(out.target.x + Math.sin(yaw) * flat, out.target.y + Math.sin(shot.elevation) * shot.distance, out.target.z + Math.cos(yaw) * flat);
  out.fov = shot.fov;
  return out;
}

// How much of the frame the cinematic owns: it eases in from the player's
// camera as the spell begins and hands back to it as the arrival settles.
export function cinematicWeight(phase, t) {
  if (phase === 'casting') return smooth(t / PORTAL_TIMING.blendIn);
  if (phase === 'landing') return 1 - smooth((t - (PORTAL_TIMING.land - PORTAL_TIMING.blendOut)) / PORTAL_TIMING.blendOut);
  return phase === 'reading' ? 0 : 1;
}
