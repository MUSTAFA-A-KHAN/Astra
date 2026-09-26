import * as THREE from 'three';

/**
 * CONVERSATIONS, SHOT BY SHOT
 *
 * While the hero talks with someone, or reads something, the camera leaves the
 * player's hands and shoots the scene as film. Every shot is framed round the
 * line between the hero and whoever they face, and from the same side of it,
 * so that neither of them seems to jump across the screen when the picture
 * cuts. The picture cuts when the voice changes:
 *
 *   two    both of them, from the side, for the first line;
 *   them   whoever is talking, three-quarter on, from beside the hero;
 *   close  closer and more nearly face on, when they go on talking;
 *   hero   the hero the same way, from beside whoever they talk to, when the
 *          hero talks;
 *   wide   well back, for narration, so whatever it tells of is in frame;
 *   read   high over the hero's shoulder onto the page, easing in, for as
 *          long as the reading lasts.
 *
 * A face is set on the upper third of the picture between the letterbox bars,
 * on the far side of the frame from whoever it is talking to, so that the two
 * of them look at each other across the cut, and each shot drifts a little
 * while it holds. Nobody is filmed over the back of the other's head: the
 * people of the Reach are built large of head and shoulder, and theirs filled
 * the frame.
 *
 * Distances are in world units: the Reach stands about 1.9 to the metre, and
 * its people 3.4 tall.
 */
const DEG = Math.PI / 180, UP = new THREE.Vector3(0, 1, 0), ACROSS = new THREE.Vector3(1, 0, 0);
const clamp = THREE.MathUtils.clamp;
export const CONVERSATION_BLEND = Object.freeze({ in: .9, out: .8 });
/**
 * The shots. Each stands its camera off one of the two, or the middle of the
 * line between them: `back` along that line toward the hero's end of it (less
 * than nothing, on past the subject), and `aside` off it on the camera's side;
 * or, for the shots of both, as far off as `distance` gives for how far apart
 * they stand ([times, plus, least, most]), swung `angle` round toward the
 * hero. `height` is over whose eyes the camera stands (the level between
 * them, for both), and `look` what it looks at, by how far over or under
 * those eyes. A shot over the hero's shoulder at what they read keeps its
 * line of sight `past` their head by at least that much, stepping further
 * aside the nearer the page is.
 *
 * `lens` is the horizontal field of view, in degrees; `place` where the one
 * looked at falls on the screen, -1 to 1 each way: across, toward the far
 * side from whoever is nearer the camera, and up. `drift` is how the shot
 * moves as it holds, most of the way in eight seconds: in toward what it looks
 * at by a share of the distance, round it by an angle, and up. `reach` is how
 * far in a blocked shot can be drawn before it stops being that shot.
 */
export const SHOTS = {
  two: { stand: 'middle', distance: [1.2, 3.6, 6, 10], angle: .3, height: ['level', -.25], look: ['middle', -.1], lens: 50, place: [0, .16], drift: [.07, .05, 0], reach: .6 },
  them: { stand: 'subject', back: 3.4, aside: 2.6, height: ['subject', .25], look: ['subject', -.05], lens: 42, place: [1 / 3, .26], drift: [.05, .03, 0], reach: .55 },
  close: { stand: 'subject', back: 2.9, aside: 1.3, height: ['subject', .1], look: ['subject', -.05], lens: 36, place: [.3, .28], drift: [.06, 0, 0], reach: .6 },
  hero: { stand: 'hero', back: -3.4, aside: 2.6, height: ['hero', -.1], look: ['hero', -.05], lens: 42, place: [1 / 3, .26], drift: [.05, -.03, 0], reach: .55 },
  wide: { stand: 'middle', distance: [1.6, 7, 10, 15], angle: .3, height: ['level', 2.2], look: ['middle', -.6], lens: 58, place: [0, .06], drift: [.05, .06, .4], reach: .45 },
  read: { stand: 'hero', back: 3.6, aside: 2, past: 1.1, height: ['hero', 1.2], look: ['subject', 0], lens: 44, place: [.18, .05], drift: [.1, 0, 0], reach: .85 },
};

const smooth = t => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const blankShot = () => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), frame: { x: 0, y: 0 }, hfov: 50 });

/**
 * Where the camera stands for a shot, what it looks at, and where on the
 * screen that should fall. rig.hero and rig.subject are where the two stand,
 * rig.heroEye and rig.subjectEye how high the eye goes on each (a face, or
 * the middle of a page), and rig.side the side of the line between them that
 * the camera keeps to: 1 or -1.
 */
export function framing(kind, rig, out = blankShot()) {
  const shot = SHOTS[kind];
  if (!shot) throw new Error(`Unknown conversation shot: ${kind}`);
  const { hero: h, subject: s, side } = rig;
  let ux = s.x - h.x, uz = s.z - h.z;
  const d = Math.hypot(ux, uz) || 1; ux /= d; uz /= d;
  const nx = -uz * side, nz = ux * side;
  const eyes = { hero: h.y + rig.heroEye, subject: s.y + rig.subjectEye };
  eyes.level = eyes.middle = (eyes.hero + eyes.subject) / 2;
  const at = { hero: h, subject: s, middle: { x: (h.x + s.x) / 2, z: (h.z + s.z) / 2 } };
  let back = shot.back, aside = shot.aside;
  if (shot.distance) {
    const [times, plus, least, most] = shot.distance, reach = clamp(d * times + plus, least, most);
    back = reach * Math.sin(shot.angle); aside = reach * Math.cos(shot.angle);
  }
  // The line from the camera to the page passes the hero aside by
  // aside × d / (back + d): the nearer the page, the further aside to see it.
  if (shot.past) aside = Math.max(aside, shot.past * (back + d) / d);
  const from = at[shot.stand], [over, lift] = shot.height, [what, drop] = shot.look;
  out.position.set(from.x - ux * back + nx * aside, eyes[over] + lift, from.z - uz * back + nz * aside);
  out.target.set(at[what].x, eyes[what] + drop, at[what].z);
  // The nearer of the two, when the shot is of one of them.
  const other = what === 'subject' ? h : what === 'hero' ? s : null;
  let toward = 0;
  if (other) {
    // Which side of the picture the nearer one stands on.
    const fx = out.target.x - out.position.x, fz = out.target.z - out.position.z;
    toward = Math.sign(-fz * (other.x - out.position.x) + fx * (other.z - out.position.z)) || 1;
  }
  const [across, up] = shot.place;
  out.frame.x = -toward * across; out.frame.y = up; out.hfov = shot.lens;
  return out;
}

/**
 * Aims a camera standing at `position` so that `target` falls at
 * frame.x, frame.y on the screen (-1 to 1 each way), with a lens as wide
 * across as `hfov` degrees where the screen allows. Returns the camera's
 * quaternion and vertical field of view.
 */
const aim = new THREE.Matrix4(), turn = new THREE.Quaternion();
export function composeView(position, target, frame, hfov, aspect, out = { quaternion: new THREE.Quaternion(), fov: 50 }) {
  const fov = clamp(2 * Math.atan(Math.tan(hfov * DEG / 2) / aspect) / DEG, 24, 75);
  const high = Math.tan(fov * DEG / 2), wide = high * aspect;
  aim.lookAt(position, target, UP); out.quaternion.setFromRotationMatrix(aim);
  out.quaternion.multiply(turn.setFromAxisAngle(UP, Math.atan(frame.x * wide)));
  out.quaternion.multiply(turn.setFromAxisAngle(ACROSS, -Math.atan(frame.y * high)));
  out.fov = fov;
  return out;
}

/**
 * The shot for each line. start() with the two who are talking; cue() with
 * who says each line as it comes (null for narration, 'you' for the hero);
 * stop() once it is over; and update() every frame for the camera's pose and
 * how much of the picture it owns, as it eases in and back out.
 *
 * `clear(from, to, rig)` says how much of the way from a shot's subject to its
 * camera is clear, from 0 to 1. A shot with something in the way is drawn in
 * toward its subject, or, if that would make it a different shot, given up
 * for the next one that is clear.
 */
export function createConversationDirector({ clear = () => 1 } = {}) {
  let rig = null, on = false, mix = 0, kind = null, side = 1, speaker, age = 0, cuts = 0;
  const shot = blankShot(), candidate = blankShot(), view = { quaternion: new THREE.Quaternion(), fov: 50 };
  const pose = { position: new THREE.Vector3(), quaternion: view.quaternion, fov: 50, weight: 0 };
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  // Nothing moves while two people talk: each shot's room is measured once a conversation.
  const room = new Map();
  const fraction = (k, s) => {
    const key = `${k} ${s}`;
    if (!room.has(key)) room.set(key, clear(framing(k, { ...rig, side: s }, candidate).target, candidate.position, rig));
    return room.get(key);
  };
  const reach = k => SHOTS[k].reach;

  function start(next) {
    const same = on && rig && flat(rig.hero, next.hero) < .5 && flat(rig.subject, next.subject) < .5;
    rig = { hero: { ...next.hero }, subject: { ...next.subject }, heroEye: next.heroEye, subjectEye: next.subjectEye, read: !!next.read };
    // The next conversation with the same person, straight after this one,
    // goes on from the shot on screen.
    if (same) return;
    room.clear();
    // Keep to the side of the line with the most room for this kind of
    // talk, and, all else equal, the side the player's camera is on already:
    // that side first, and if every shot fits there, no further.
    const kinds = rig.read ? ['read', 'hero'] : ['two', 'them', 'hero'], { hero: h, subject: t } = rig, c = next.camera;
    const near = c && Math.sign((t.x - h.x) * (c.z - h.z) - (t.z - h.z) * (c.x - h.x)) || 1;
    let best = -Infinity;
    for (const s of [near, -near]) {
      let fits = 0;
      for (const k of kinds) fits += Math.min(1, fraction(k, s) / reach(k));
      if (fits + (c && s === near ? .25 : 0) > best) { best = fits + (c && s === near ? .25 : 0); side = s; }
      if (fits >= kinds.length) break;
    }
    on = true; kind = null; speaker = undefined; cuts = 0;
  }

  function cue(who) {
    if (!on) return;
    let next;
    if (rig.read) next = who === 'you' ? 'hero' : 'read';
    // The first line sets the scene: the two of them, or all of it for narration.
    else if (kind === null) next = who === null ? 'wide' : 'two';
    else if (who === 'you') next = 'hero';
    else if (who === null) next = 'wide';
    // Someone who goes on talking is cut in closer, and back, now and then.
    else if (who === speaker && (kind === 'them' || kind === 'close')) next = age > 3.5 ? (kind === 'them' ? 'close' : 'them') : kind;
    else next = 'them';
    speaker = who;
    if (next !== kind) cut(next);
  }

  // The shot asked for, if the camera fits, drawn in if it must be; failing
  // that, the two of them; then that shot from across the line; then from
  // well back. With room for none, whichever comes nearest.
  function cut(wanted) {
    const tries = [[wanted, side], ['two', side], [wanted, -side], ['wide', side], ['wide', -side]];
    let chosen = null, least = null, ratio = -1;
    for (const [k, s] of tries) {
      const clearance = fraction(k, s);
      if (clearance >= reach(k)) { chosen = [k, s, clearance >= .97 ? 1 : clearance - .03]; break; }
      if (clearance / reach(k) > ratio) { ratio = clearance / reach(k); least = [k, s, Math.max(.25, clearance - .03)]; }
    }
    const [k, s, drawn] = chosen || least;
    if (k === kind && s === side && cuts) return;
    framing(k, { ...rig, side: s }, shot);
    shot.position.lerpVectors(shot.target, shot.position, drawn);
    kind = k; side = s; age = 0; cuts++;
  }

  function update(dt, { reducedMotion = false, aspect = 16 / 9 } = {}) {
    if (!rig || !kind) return null;
    mix = reducedMotion ? (on ? 1 : 0) : clamp(mix + (on ? dt / CONVERSATION_BLEND.in : -dt / CONVERSATION_BLEND.out), 0, 1);
    if (!on && mix <= 0) { rig = null; kind = null; return null; }
    age += dt;
    const k = reducedMotion ? 0 : 1 - Math.exp(-age / 8), [push, swing, rise] = SHOTS[kind].drift;
    const ox = shot.position.x - shot.target.x, oy = shot.position.y - shot.target.y, oz = shot.position.z - shot.target.z;
    const cos = Math.cos(swing * k * side), sin = Math.sin(swing * k * side), keep = 1 - push * k;
    pose.position.set(shot.target.x + (ox * cos - oz * sin) * keep, shot.target.y + oy * keep + rise * k, shot.target.z + (ox * sin + oz * cos) * keep);
    composeView(pose.position, shot.target, shot.frame, shot.hfov, aspect, view);
    pose.fov = view.fov; pose.weight = smooth(mix);
    return pose;
  }

  return {
    start, cue, update,
    stop() { on = false; },
    get on() { return on; },
    get diagnostics() { return { on, weight: +smooth(mix).toFixed(3), kind, side, cuts, age: +age.toFixed(2) }; },
  };
}
