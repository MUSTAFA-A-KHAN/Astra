import * as THREE from 'three';

// A mote of light that shows the way on foot. It asks the world's navigator
// for the walk, keeps a few strides ahead of whoever follows it along that
// walk, and never leaves them behind: fall back and it stops and circles,
// calling; stand still and, after a moment, it calls too; wander off and it
// plans a new way from wherever they are. Once they come within sight of the
// end, it spirals down into whatever it was leading to and goes out. It is
// sprites alone, and no light, so showing it never has a material rebuild its
// shader.
//
// Distances are in world units: the Reach stands about 1.9 to the metre.
const LEAD = 9;      // how far along the way it keeps ahead of its follower
const LEASH = 14;    // how far off they can fall before it stops to call
const STRAY = 16;    // how far off the way they can wander before it plans again
const ARRIVE = 9;    // how close to the end they come before it goes in
const HOVER = 2.9;   // how high over the ground it rides: just above a head
const TRAIL = 10;    // how many sparks follow it
// A way across a whole map takes the navigator several milliseconds to find.
// A follower who keeps wandering off is given a new one less and less often,
// up to this many seconds apart, until they walk the one they were given.
const REPLAN = 1.5, REPLAN_MAX = 6, FOLLOWED = 6;
// A follower who makes no headway along the way is called after a moment,
// for a few seconds at a time, and again every so often after that.
const CALL_AFTER = 3, CALL_FOR = 6, CALL_EVERY = 20;

export function createGuide({ route, heightAt, texture, color = '#9fe3ff', onArrive }) {
  const root = new THREE.Group(); root.name = 'Guiding light'; root.visible = false;
  // Drawn over the glow of the notice board and the well, and seen through
  // the fog, for as far as the player can see it. The halo is laid on rather
  // than added, so it still shows blue against sunlit sand and pavement;
  // the core and its sparks are added, and burn white at its heart.
  const glow = (size, tint = color, blending = THREE.AdditiveBlending) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: tint, transparent: true, opacity: 0, blending, depthWrite: false, fog: false }));
    sprite.scale.setScalar(size); sprite.renderOrder = 10; sprite.userData.size = size; return sprite;
  };
  const halo = glow(2.4, '#6fcdf5', THREE.NormalBlending), core = glow(.8, '#f4fdff');
  const sparks = Array.from({ length: TRAIL }, (_, i) => glow(.12 + .4 * (1 - i / TRAIL)));
  root.add(halo, core, ...sparks);

  let state = 'idle', way = [], lengths = [0], total = 0, along = 0, level = 0;
  let hold = 0, sincePlan = 0, replanAfter = REPLAN, reached = 0, still = 0, arrival = 0, ground = 0, sparkClock = 0, calling = 0, goal = null;
  const at = new THREE.Vector3(), aim = new THREE.Vector3(), gap = new THREE.Vector3(), history = Array.from({ length: TRAIL }, () => new THREE.Vector3());

  // The walk from here to the goal, as straight legs; a straight line when
  // the world has no navigator, or it finds no way.
  function plan(from) {
    const points = route?.(from, goal);
    way = points?.length >= 2 ? points.map(({ x, z }) => ({ x, z })) : [{ x: from.x, z: from.z }, { x: goal.x, z: goal.z }];
    lengths = [0];
    for (let i = 1; i < way.length; i++) lengths.push(lengths[i - 1] + Math.hypot(way[i].x - way[i - 1].x, way[i].z - way[i - 1].z));
    total = lengths.at(-1); along = 0; sincePlan = 0; reached = 0; still = 0;
  }
  function pointAt(distance) {
    let i = 1; while (i < way.length - 1 && lengths[i] < distance) i++;
    const span = lengths[i] - lengths[i - 1], k = span > 0 ? THREE.MathUtils.clamp((distance - lengths[i - 1]) / span, 0, 1) : 1;
    return { x: way[i - 1].x + (way[i].x - way[i - 1].x) * k, z: way[i - 1].z + (way[i].z - way[i - 1].z) * k };
  }
  // How far along the walk a point stands, and how far off it.
  function project(p) {
    let best = { along: 0, off: Infinity };
    for (let i = 1; i < way.length; i++) {
      const a = way[i - 1], b = way[i], dx = b.x - a.x, dz = b.z - a.z, span = dx * dx + dz * dz;
      const k = span > 0 ? THREE.MathUtils.clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / span, 0, 1) : 0;
      const off = Math.hypot(p.x - (a.x + dx * k), p.z - (a.z + dz * k));
      if (off < best.off) best = { along: lengths[i - 1] + Math.sqrt(span) * k, off };
    }
    return best;
  }

  // Sets off for `target` ({x, y, z}: y is where it goes in), rising first
  // from `from`, and pausing at the follower's shoulder before it leads.
  function lead(target, from) {
    goal = { x: target.x, y: target.y, z: target.z };
    plan(from);
    ground = heightAt(from.x, from.z);
    at.set(from.x, from.y ?? ground + HOVER, from.z);
    for (const point of history) point.copy(at);
    state = 'leading'; hold = 1.3; level = 0; arrival = 0; calling = 0; replanAfter = REPLAN; root.visible = true;
  }
  // Turns for a new goal from wherever it is, without going back to the
  // follower's shoulder first: for a goal that has changed, or moved, while
  // it was on its way. Out of sight, it sets off afresh from their shoulder.
  function retarget(target, follower) {
    if (state !== 'leading' && state !== 'arriving') { lead(target, { x: follower.x, y: (follower.y ?? heightAt(follower.x, follower.z)) + 3.2, z: follower.z }); return; }
    goal = { x: target.x, y: target.y, z: target.z };
    plan(follower);
    state = 'leading'; arrival = 0;
  }
  // Fades out wherever it is, its work done or no longer wanted.
  function release() { if (state !== 'idle') state = 'leaving'; }
  // Gone at once: for a follower carried off to another map.
  function reset() { state = 'idle'; level = 0; calling = 0; goal = null; root.visible = false; }

  // `paused` holds it where it is: while its follower is talking to someone.
  function update(dt, time, player, { paused = false } = {}) {
    if (state === 'idle') return;
    const fading = state === 'leaving' || state === 'done';
    level += ((fading ? 0 : 1) - level) * (1 - Math.exp(-(fading ? 4 : 2.5) * dt));
    if (fading && level < .02) { level = 0; root.visible = false; if (state === 'leaving') state = 'idle'; return; }
    const away = Math.hypot(at.x - player.x, at.z - player.z);
    let speed = 8;
    if (state === 'leading') {
      sincePlan += dt;
      let { along: follower, off } = project(player);
      if (off > STRAY && sincePlan > replanAfter) { plan(player); replanAfter = Math.min(REPLAN_MAX, replanAfter * 2); follower = 0; }
      // Headway counts only on the way, not level with it a street away.
      if (off <= STRAY && follower > reached + .25) { reached = follower; still = 0; } else if (!paused && hold <= 0) still += dt;
      if (reached > FOLLOWED) replanAfter = REPLAN;
      // Behind, it stops and calls; otherwise it keeps its lead, and never
      // goes back along the way to meet a follower who has turned round. A
      // follower who stands still, or turns away, it calls more gently.
      const behind = away > LEASH, waiting = still > CALL_AFTER && (still - CALL_AFTER) % CALL_EVERY < CALL_FOR;
      calling += ((hold > 0 || paused ? 0 : behind ? 1 : waiting ? .7 : 0) - calling) * (1 - Math.exp(-3 * dt));
      if (hold > 0) hold -= dt;
      else if (!paused && !behind) along = Math.min(total, Math.max(along, follower + LEAD));
      if (hold > 0) {
        // A moment at the follower's shoulder, beside them rather than in
        // front, and leaning the way it is about to go.
        const ahead = pointAt(Math.min(total, 4)), dx = ahead.x - player.x, dz = ahead.z - player.z, d = Math.hypot(dx, dz) || 1;
        aim.set(player.x + (dx * .3 - dz * 1.5) / d, 0, player.z + (dz * .3 + dx * 1.5) / d);
      } else { const p = pointAt(along); aim.set(p.x, 0, p.z); }
      if (calling > .05) aim.x += Math.cos(time * 3.2) * 1.1 * calling, aim.z += Math.sin(time * 3.2) * 1.1 * calling;
      ground += (heightAt(aim.x, aim.z) - ground) * (1 - Math.exp(-3 * dt));
      aim.y = Math.max(ground, (player.y ?? ground) - .5) + HOVER + Math.sin(time * 2.1) * .22;
      if (away > LEASH * 2) speed = 18;
      if (along >= total - .5 && Math.hypot(player.x - goal.x, player.z - goal.z) < ARRIVE) { state = 'arriving'; arrival = 0; }
    }
    if (state === 'arriving') {
      // Round and down into the goal, tightening as it goes.
      arrival += dt;
      const k = Math.min(1, arrival / 1.6), turn = arrival * 5, reach = 1.3 * (1 - k);
      aim.set(goal.x + Math.cos(turn) * reach, goal.y + (1 - k) * 1.2, goal.z + Math.sin(turn) * reach);
      speed = 10;
      if (k >= 1) { state = 'done'; onArrive?.({ ...goal }); }
    }
    const distance = gap.subVectors(aim, at).length();
    if (distance > 1e-4) at.addScaledVector(gap, Math.min(distance * (1 - Math.exp(-4 * dt)), speed * dt) / distance);

    const shrink = state === 'arriving' || state === 'done' ? 1 - .7 * Math.min(1, arrival / 1.6) : 1;
    const pulse = 1 + .12 * Math.sin(time * 4.2) + calling * .4 * (.5 + .5 * Math.sin(time * 7));
    halo.position.copy(at); core.position.copy(at);
    halo.scale.setScalar(halo.userData.size * pulse * shrink); core.scale.setScalar(core.userData.size * shrink);
    halo.material.opacity = level * (.42 + .25 * calling); core.material.opacity = level;
    // The sparks fall in behind it, a little apart.
    sparkClock += dt;
    if (sparkClock > .045) { sparkClock = 0; history.unshift(history.pop().copy(at)); }
    sparks.forEach((spark, i) => { spark.position.copy(history[i]); spark.material.opacity = level * .45 * (1 - i / TRAIL) * shrink; });
  }

  return {
    root, lead, retarget, release, reset, update,
    get state() { return state; },
    // Where it is leading, while it has somewhere to go.
    get goal() { return state === 'idle' || !goal ? null : { ...goal }; },
    // Where it is, for the map, while it can be seen.
    get position() { return root.visible && level > .1 ? { x: at.x, y: at.y, z: at.z } : null; },
    get diagnostics() { return { state, along: +along.toFixed(1), total: +total.toFixed(1), legs: way.length - 1, calling: +calling.toFixed(2), replanAfter, position: { x: +at.x.toFixed(1), y: +at.y.toFixed(1), z: +at.z.toFixed(1) } }; },
  };
}
