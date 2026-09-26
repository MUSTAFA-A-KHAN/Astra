import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const PORTAL_ASSET = 'map/portal/european_and_american_game_scencemagic_portal.glb';
export const PORTAL_BOOK_ASSET = 'assets/story/lore-book.glb';
const PHASES = new Set(['dormant', 'reading', 'casting', 'ready', 'traveling']);
const AWAKE = new Set(['casting', 'ready', 'traveling']);
const BOOK_OFFSET = new THREE.Vector3(-4.6, 0, 4.8);
const READ_OFFSET = new THREE.Vector3(-4.6, 0, 6.6);
// Sleeping stones wait this far below their place in the gate's own clip.
const STONE_DEPTH = 12;
const smoothstep = (from, to, value) => { const t = THREE.MathUtils.clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };
const easeOutBack = t => 1 + 2.1 * (t - 1) ** 3 + 1.1 * (t - 1) ** 2;

// The awakening is one timeline over the cast's progress: the stones break
// out of the ground in turn, the arch's runes kindle, and the aperture opens
// last. Afterwards the gate stays fully awake until the traveller has gone.
export function portalAwakening(phase, progress = 0) {
  if (!AWAKE.has(phase)) return { glow: 0, open: 0 };
  if (phase !== 'casting') return { glow: 1, open: 1 };
  return { glow: smoothstep(.2, .75, progress), open: smoothstep(.55, .92, progress) };
}
// How far stone `index` of `count` has risen: 0 is still buried, 1 is in the
// clip's own place. The first stones rise behind the gate, the last beside the reader.
export function stoneRise(phase, progress, index, count) {
  if (!AWAKE.has(phase)) return 0;
  if (phase !== 'casting') return 1;
  const start = .04 + (count > 1 ? index / (count - 1) : 0) * .34;
  return THREE.MathUtils.clamp((progress - start) / .28, 0, 1);
}

// The traveller's way in, in the gate's own frame. They walk round from the
// reading spot to the foot of the dais on the aperture's axis and stop for a
// breath. The dais's first tier is a metre high, so the gate itself lifts them
// over its steps and draws them into the ring.
const FOOT = new THREE.Vector3(0, 0, 4.75), BEND = new THREE.Vector3(0, 0, 6.9), THROUGH = -.4;
const PACE = 2.3, SPEED_UP = .5, SLOW_DOWN = .7;
const WALK = (() => {
  const curve = new THREE.QuadraticBezierCurve3(READ_OFFSET, BEND, FOOT), length = curve.getLength();
  const cruise = Math.max(0, length - PACE * (SPEED_UP + SLOW_DOWN) / 2) / PACE;
  return { curve, length, cruise, duration: SPEED_UP + cruise + SLOW_DOWN };
})();
export const PORTAL_ENTRY = Object.freeze({ walk: WALK.duration, pause: .6, float: 2, veil: .72,
  get duration() { return this.walk + this.pause + this.float; } });
// Ease into the walk and out of it again, cruising at a walking pace between.
function walkSpeed(t) {
  if (t <= 0 || t >= WALK.duration) return 0;
  return PACE * Math.min(1, t / SPEED_UP, (WALK.duration - t) / SLOW_DOWN);
}
function walkDistance(t) {
  if (t <= 0) return 0;
  if (t < SPEED_UP) return PACE * t * t / (2 * SPEED_UP);
  if (t < SPEED_UP + WALK.cruise) return PACE * (SPEED_UP / 2 + t - SPEED_UP);
  const left = Math.max(0, WALK.duration - t);
  return WALK.length - PACE * left * left / (2 * SLOW_DOWN);
}
// The part of the entry during which the traveller is low enough, and near
// enough the spinning arch, for its footing stones to reach them.
const LANE = (() => {
  let from = 0;
  while (from < WALK.duration && WALK.curve.getPointAt(walkDistance(from) / WALK.length).length() > 6.8) from += .05;
  return { from, to: WALK.duration + PORTAL_ENTRY.pause + PORTAL_ENTRY.float * .55 };
})();
// Samples the clip, a tenth of a second apart, for when the turning arch's
// low stones (above the top step, or anywhere past the dais's edge) stand in
// the entry lane. Measured in the parentless source, which is the gate's frame.
function measureLane(source, clips, frame) {
  const tracks = new Map(clips.flatMap(clip => clip.tracks).map(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    return [`${nodeName}.${propertyName}`, track];
  }));
  let spin = frame[0];
  while (spin && !tracks.has(`${spin.name}.quaternion`)) spin = spin.parent;
  if (!spin?.parent) return null;
  source.updateMatrixWorld(true);
  const axis = spin.getWorldPosition(new THREE.Vector3()), toSpin = spin.matrixWorld.clone().invert();
  const point = new THREE.Vector3(), obstacles = [];
  for (const mesh of frame) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 3) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const r = Math.hypot(point.x - axis.x, point.z - axis.z);
      if (point.y < 3.9 && r > 2.4 && r < 6.6 && (point.y > 1.85 || (r > 4.4 && point.y > .05))) obstacles.push(point.clone().applyMatrix4(toSpin));
    }
  }
  const turn = tracks.get(`${spin.name}.quaternion`).createInterpolant(), duration = Math.max(...clips.map(clip => clip.duration));
  const count = Math.max(1, Math.round(duration * 10)), blocked = new Uint8Array(count);
  const rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    rotation.fromArray(turn.evaluate(i / count * duration));
    matrix.compose(spin.position, rotation, spin.scale).premultiply(spin.parent.matrixWorld);
    for (const obstacle of obstacles) {
      point.copy(obstacle).applyMatrix4(matrix);
      if (Math.abs(point.x) < 1 && point.z > 2 && point.z < 6.9) { blocked[i] = 1; break; }
    }
  }
  return blocked;
}

// Portal props live outside district roots. Moving the same props between maps
// keeps the book available while a district is downloaded or released.
export function createPortal({ world, collision, reducedMotion = false } = {}) {
  const root = new THREE.Group(); root.name = 'The keeper’s spellbook and sleeping gate';
  const gate = new THREE.Group(); gate.name = 'Sleeping portal'; root.add(gate);
  const lectern = new THREE.Group(); lectern.name = 'Keeper’s spellbook lectern'; lectern.position.copy(BOOK_OFFSET); root.add(lectern);
  const reader = new THREE.Group(); reader.name = 'Spellbook reading position'; reader.position.copy(READ_OFFSET); root.add(reader);
  const bookMount = new THREE.Group(); bookMount.name = 'Visible open spellbook'; bookMount.position.y = 1.95; bookMount.rotation.x = .22; lectern.add(bookMount);
  let phase = 'dormant', progress = 0, disposed = false, loadPromise = null;
  let modelLoaded = false, bookLoaded = false, modelError = null, bookError = null;
  let mixer = null, erupted = 0, actions = [];
  const loadedGlow = [], bookGlow = [], colliderIds = [], stones = [], events = [];
  const apertureScale = new THREE.Vector3(1, 1, 1);
  const stone = new THREE.MeshStandardMaterial({ color: '#626b68', roughness: .95 });
  const darkStone = new THREE.MeshStandardMaterial({ color: '#3e4947', roughness: .9 });
  const gold = new THREE.MeshStandardMaterial({ color: '#b39a65', metalness: .4, roughness: .7 });
  const paper = new THREE.MeshStandardMaterial({ color: '#eee0b8', roughness: .95, emissive: '#91e9df', emissiveIntensity: 0 });
  const cover = new THREE.MeshStandardMaterial({ color: '#264b50', metalness: .15, roughness: .65 });
  const ink = new THREE.MeshStandardMaterial({ color: '#436d68', roughness: .9, emissive: '#6cf6eb', emissiveIntensity: 0 });
  const runeMaterial = new THREE.MeshBasicMaterial({ color: '#71e9e5', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });

  function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z);
    object.castShadow = object.receiveShadow = !material.transparent; parent.add(object); return object;
  }
  function box(parent, size, position, material) { return mesh(parent, new THREE.BoxGeometry(...size), material, ...position); }

  const fallbackGate = new THREE.Group(); fallbackGate.name = 'Stone gate fallback'; gate.add(fallbackGate);
  mesh(fallbackGate, new THREE.CylinderGeometry(3.9, 4.3, .45, 32), stone, 0, .225);
  const arch = mesh(fallbackGate, new THREE.TorusGeometry(3, .42, 8, 40), stone, 0, 4);
  arch.scale.y = 1.18;
  mesh(fallbackGate, new THREE.TorusGeometry(2.77, .07, 6, 48), gold, 0, 4, .3).scale.y = 1.18;
  for (const x of [-2.9, 2.9]) {
    box(fallbackGate, [.8, 3.5, 1], [x, 1.95, 0], stone);
    box(fallbackGate, [1.2, .32, 1.3], [x, .55, 0], darkStone);
  }
  mesh(lectern, new THREE.CylinderGeometry(.78, .95, .2, 8), stone, 0, .1);
  mesh(lectern, new THREE.CylinderGeometry(.27, .4, 1.55, 8), darkStone, 0, .95);
  mesh(lectern, new THREE.CylinderGeometry(.34, .34, .13, 8), gold, 0, 1.5);
  box(lectern, [1.9, .18, 1.25], [0, 1.82, 0], stone).rotation.x = .22;

  // An open physical book is present from the first frame, including on a
  // failed model request. The two pages and their ink are separate meshes.
  const fallbackBook = new THREE.Group(); fallbackBook.name = 'Open spellbook fallback'; bookMount.add(fallbackBook);
  for (const side of [-1, 1]) {
    const page = new THREE.Group(); page.position.x = side * .4; page.rotation.z = side * .1; fallbackBook.add(page);
    box(page, [.8, .065, .95], [0, 0, 0], cover);
    box(page, [.74, .065, .87], [0, .06, 0], paper);
    for (let line = 0; line < 5; line++) box(page, [.42 - (line % 2) * .1, .008, .023], [0, .1, -.22 + line * .1], ink);
    const seal = mesh(page, new THREE.TorusGeometry(.075, .014, 3, 6), gold, 0, .104, .32); seal.rotation.x = -Math.PI / 2;
  }
  box(fallbackBook, [.065, .14, 1], [0, .01, 0], gold);

  const aperture = new THREE.Group(); aperture.name = 'Awakened portal aperture'; aperture.position.set(0, 4, .38); gate.add(aperture);
  const surfaceMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, awaken: { value: 0 }, travel: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec2 vUv;
      uniform float time;
      uniform float awaken;
      uniform float travel;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float radius = length(p);
        float edge = 1.0 - smoothstep(0.86, 1.0, radius);
        float angle = atan(p.y, p.x);
        float spiral = 0.5 + 0.5 * sin(angle * 4.0 - radius * 17.0 + time * 2.3);
        float inner = pow(1.0 - min(radius, 1.0), 2.0);
        vec3 color = mix(vec3(0.06, 0.20, 0.34), vec3(0.21, 0.91, 0.86), spiral * 0.65 + inner * 0.25);
        color += vec3(0.52, 0.69, 0.73) * inner * travel;
        gl_FragColor = vec4(color, edge * awaken * (0.55 + spiral * 0.24 + travel * 0.15));
      }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
  const surface = mesh(aperture, new THREE.CircleGeometry(2.65, 64), surfaceMaterial);
  const runes = new THREE.Group(); runes.name = 'Waking runes'; aperture.add(runes);
  const runeGeometry = new THREE.BoxGeometry(.12, .32, .035);
  for (let i = 0; i < 18; i++) {
    const angle = i / 18 * Math.PI * 2;
    const rune = mesh(runes, runeGeometry, runeMaterial, Math.sin(angle) * 2.8, Math.cos(angle) * 2.8, .04);
    rune.rotation.z = -angle + (i % 2 ? .45 : 0);
  }
  const edge = mesh(aperture, new THREE.TorusGeometry(2.68, .035, 4, 64), runeMaterial, 0, 0, .02);
  const spell = new THREE.Group(); spell.name = 'Spell flowing from the book'; root.add(spell);
  const sparkGeometry = new THREE.OctahedronGeometry(.065);
  const sparks = Array.from({ length: 16 }, () => mesh(spell, sparkGeometry, runeMaterial));
  const bookHalo = mesh(lectern, new THREE.TorusGeometry(1.15, .022, 4, 40), runeMaterial, 0, .24); bookHalo.rotation.x = -Math.PI / 2;
  // Each stone throws up a ring of earth where it breaks the ground.
  const dust = new THREE.Group(); dust.name = 'Broken ground'; root.add(dust);
  const dustGeometry = new THREE.RingGeometry(.35, 1, 24); dustGeometry.rotateX(-Math.PI / 2);
  const bursts = [];
  const start = new THREE.Vector3(), end = new THREE.Vector3(), currentBook = new THREE.Vector3(), probe = new THREE.Vector3();
  const bounds = new THREE.Box3(), local = new THREE.Vector3(), tangent = new THREE.Vector3(), foot = new THREE.Vector3();
  // The traveller's way in the world, and clip-time samples at which the
  // arch's footing stones stand across it.
  let way = [], laneBlocked = null;
  const bookSpot = new THREE.Vector3();
  const pose = { position: new THREE.Vector3(), yaw: 0, speed: 0, stage: 'walk', veil: false, done: false };

  const worldPosition = object => object.getWorldPosition(new THREE.Vector3());
  const places = {
    get portal() { return worldPosition(gate); },
    get aperture() { return worldPosition(aperture); },
    get book() { return worldPosition(lectern); },
    get reading() { return worldPosition(reader); },
    get casting() { return worldPosition(reader); },
    get foot() { return root.localToWorld(FOOT.clone()); },
  };

  function clearColliders() { for (const id of colliderIds) collision?.remove(id); colliderIds.length = 0; }
  function place(point, facing = 0) {
    if (disposed) return;
    root.position.set(point.x, point.y ?? world?.getHeight(point.x, point.z) ?? 0, point.z); root.rotation.y = facing;
    lectern.position.copy(BOOK_OFFSET); reader.position.copy(READ_OFFSET); root.updateMatrixWorld(true);
    for (const object of [lectern, reader]) {
      const position = worldPosition(object), height = world?.getHeight(position.x, position.z);
      if (Number.isFinite(height)) object.position.y += height - position.y;
    }
    root.updateMatrixWorld(true); clearColliders();
    way = WALK.curve.getSpacedPoints(20).map(point => root.localToWorld(point)); bookSpot.copy(places.book);
    if (collision) {
      const position = places.book, id = `portal-lectern-${root.id}`;
      collision.insert(id, { x: position.x, z: position.z, r: .8, bottom: position.y, top: position.y + 2.25 }); colliderIds.push(id);
    }
    return places;
  }
  function nearby(position) {
    if (disposed || !root.visible || phase !== 'dormant') return null;
    const book = places.book;
    if (Math.hypot(position.x - book.x, position.z - book.z) > 3.4 || Math.abs(position.y - book.y) > 2.8) return null;
    if (collision?.cameraFraction) {
      const from = new THREE.Vector3(position.x, position.y + 2.7, position.z);
      const to = new THREE.Vector3(book.x, book.y + 2.7, book.z);
      if (collision.cameraFraction(from, to, .05) < .97) return null;
    }
    return { type: 'portal', id: 'keeper-spellbook', label: 'Read the keeper’s spellbook', x: book.x, y: book.y, z: book.z };
  }
  function setPhase(next, amount = 0) {
    if (!PHASES.has(next)) throw new Error(`Unknown portal phase: ${next}`);
    // A new spell always starts the gate's own animation from its first frame.
    if (AWAKE.has(next) && !AWAKE.has(phase)) { mixer?.setTime(0); erupted = 0; }
    phase = next; progress = THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
    if (!AWAKE.has(phase)) { mixer?.setTime(0); erupted = 0; for (const burst of bursts) burst.visible = false; }
    refreshEffects(); raiseStones();
  }
  function refreshEffects() {
    const { glow, open } = portalAwakening(phase, progress);
    const reading = phase === 'reading' || phase === 'casting';
    aperture.visible = open > 0; spell.visible = phase === 'casting'; bookHalo.visible = reading;
    // The aperture grows out of a point, like the asset's core, and swells as the traveller steps in.
    aperture.scale.copy(apertureScale).multiplyScalar(Math.max(.02, easeOutBack(open)) * (phase === 'traveling' ? 1.12 : 1));
    surfaceMaterial.uniforms.awaken.value = open;
    surfaceMaterial.uniforms.travel.value = phase === 'traveling' ? 1 : 0;
    runeMaterial.opacity = reading ? .55 + glow * .35 : glow * .85;
    paper.emissiveIntensity = reading ? .25 : 0; ink.emissiveIntensity = reading ? 1 : 0;
    for (const material of loadedGlow) material.emissiveIntensity = glow * .85;
    for (const material of bookGlow) material.emissiveIntensity = reading ? .55 : .08;
  }
  // The clip owns each stone's place in the gate; a buried stone is the same
  // place pushed straight down, so it rises into the animation already moving.
  function raiseStones(dt = 0) {
    mixer?.update(dt);
    for (let i = 0; i < stones.length; i++) {
      const stone = stones[i], rise = stoneRise(phase, progress, stone.order, stones.length);
      stone.node.visible = AWAKE.has(phase);
      stone.rise = reducedMotion ? (rise > 0 ? 1 : 0) : rise;
      stone.node.position.addScaledVector(stone.up, -(1 - easeOutBack(stone.rise)) * STONE_DEPTH);
      if (stone.node.visible) partStone(stone);
    }
  }
  function distanceToWay(point) {
    let nearest = Math.hypot(point.x - bookSpot.x, point.z - bookSpot.z) - .3;
    for (let i = 1; i < way.length; i++) {
      const a = way[i - 1], b = way[i], dx = b.x - a.x, dz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      nearest = Math.min(nearest, Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t));
    }
    return nearest;
  }
  // The stones make way for the keeper. One whose orbit crosses the reading
  // spot, the lectern or the walk in dips under the ground as it passes, or,
  // when it is floating high already, lifts clear over the traveller's head.
  function partStone(stone) {
    stone.mesh.updateWorldMatrix(true, false);
    bounds.copy(stone.mesh.geometry.boundingBox).applyMatrix4(stone.mesh.matrixWorld); bounds.getCenter(probe);
    const half = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * .4;
    const weight = way.length ? 1 - smoothstep(0, 2, distanceToWay(probe) - half - .7) : 0;
    if (weight <= 0) { stone.dodge = null; return; }
    const ground = root.position.y;
    stone.dodge ??= bounds.min.y > ground + .8 ? 'lift' : 'sink';
    const shift = stone.dodge === 'lift' ? Math.max(0, ground + 2.7 - bounds.min.y) : -Math.max(0, bounds.max.y - ground + .3);
    stone.node.position.addScaledVector(stone.up, shift * weight);
  }
  function groundAt(point) {
    const height = world?.getHeight?.(point.x, point.z);
    return Number.isFinite(height) ? height : root.position.y;
  }
  /**
   * Where the traveller is `t` seconds into their entry: the world position of
   * their feet, the way they face, how fast they walk, and whether the light
   * has reached them. The walk follows the ground; the float rises from the
   * foot of the dais to stand them in the middle of the aperture.
   */
  function entryPose(t) {
    t = Math.max(0, Number.isFinite(t) ? t : 0);
    const floatStart = WALK.duration + PORTAL_ENTRY.pause, drawn = (t - floatStart) / PORTAL_ENTRY.float;
    let lift = 0;
    if (t < WALK.duration) {
      const u = walkDistance(t) / WALK.length;
      WALK.curve.getPointAt(u, local); WALK.curve.getTangentAt(u, tangent);
      pose.stage = 'walk'; pose.speed = walkSpeed(t);
    } else {
      tangent.set(0, 0, -1); pose.speed = 0;
      if (drawn < 0) { local.copy(FOOT); pose.stage = 'pause'; }
      else {
        const f = Math.min(1, drawn);
        local.set(0, 0, FOOT.z + (THROUGH - FOOT.z) * (1 - Math.cos(f * Math.PI)) / 2);
        lift = 1 - (1 - Math.min(1, f * 1.15)) ** 3; pose.stage = 'float';
      }
    }
    root.localToWorld(pose.position.copy(local));
    if (pose.stage === 'float') {
      const base = groundAt(root.localToWorld(foot.copy(FOOT))), top = root.position.y + aperture.position.y - 1.2;
      pose.position.y = base + (Math.max(base, top) - base) * lift;
    } else pose.position.y = groundAt(pose.position);
    pose.yaw = Math.atan2(tangent.x, tangent.z) + root.rotation.y;
    pose.veil = drawn >= PORTAL_ENTRY.veil; pose.done = drawn >= 1;
    return pose;
  }
  // Whether a traveller who starts walking now will find the lane clear of
  // the turning arch for as long as they are low enough to meet it.
  function entryClear() {
    const action = actions[0];
    if (!laneBlocked || !action || reducedMotion || !AWAKE.has(phase)) return true;
    const duration = action.getClip().duration, count = laneBlocked.length;
    for (let t = LANE.from; t <= LANE.to; t += duration / count) {
      if (laneBlocked[Math.floor((action.time + t) % duration / duration * count) % count]) return false;
    }
    return true;
  }
  function breakGround(stone) {
    stone.mesh.updateWorldMatrix(true, false); stone.mesh.localToWorld(probe.copy(stone.centre));
    events.push({ type: 'stone', x: probe.x, y: probe.y, z: probe.z });
    if (reducedMotion) return;
    const burst = bursts.find(item => !item.visible) ?? bursts[0];
    if (!burst) return;
    const ground = world?.getHeight?.(probe.x, probe.z);
    probe.y = (Number.isFinite(ground) ? ground : root.position.y) + .06;
    burst.position.copy(dust.worldToLocal(probe)); burst.userData.age = 0; burst.visible = true;
  }
  function update(dt, time) {
    events.length = 0;
    if (disposed) return events;
    raiseStones(AWAKE.has(phase) && !reducedMotion && Number.isFinite(dt) ? Math.max(0, dt) : 0);
    if (phase === 'casting') {
      const risen = stones.filter(stone => stone.rise > .12).length;
      for (const stone of stones) if (stone.order >= erupted && stone.order < risen) breakGround(stone);
      erupted = Math.max(erupted, risen);
    }
    for (const burst of bursts) {
      if (!burst.visible) continue;
      burst.userData.age += dt; const age = burst.userData.age / .9;
      burst.scale.setScalar(1 + age * 3.2); burst.material.opacity = .5 * (1 - age);
      if (age >= 1) burst.visible = false;
    }
    surfaceMaterial.uniforms.time.value = Number.isFinite(time) ? time : surfaceMaterial.uniforms.time.value + dt;
    const elapsed = surfaceMaterial.uniforms.time.value;
    runes.rotation.z = elapsed * .12; edge.scale.setScalar(1 + Math.sin(elapsed * 2) * .008);
    bookHalo.rotation.z = elapsed * .2;
    if (spell.visible) {
      bookMount.getWorldPosition(currentBook); start.copy(root.worldToLocal(currentBook));
      aperture.getWorldPosition(end); root.worldToLocal(end);
      for (let i = 0; i < sparks.length; i++) {
        const t = (elapsed * .42 + i / sparks.length) % 1;
        sparks[i].position.lerpVectors(start, end, t);
        sparks[i].position.y += Math.sin(t * Math.PI) * 1.35;
        sparks[i].position.x += Math.sin(t * Math.PI * 7 + i) * .14;
        sparks[i].rotation.set(elapsed, i + elapsed, 0);
      }
    }
    return events;
  }

  // Each imported asset owns its materials and textures. This also handles a
  // request completing after the portal itself was disposed.
  function release(object) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    object.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of node.material ? Array.isArray(node.material) ? node.material : [node.material] : []) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) { texture.dispose(); texture.source?.data?.close?.(); }
    object.removeFromParent();
  }

  async function load({ prepare } = {}) {
    if (disposed) return diagnostics();
    if (loadPromise) return loadPromise;
    loadPromise = Promise.allSettled([
      loadModel(PORTAL_ASSET, async (source, clips) => {
        // The arch and its dais are the gate. The asset's clip turns them and
        // flies the standing stones around them. The floating island and the
        // always-emissive core plane stay hidden: this gate stands on the
        // district's own ground and draws its own aperture.
        source.rotation.y = Math.PI / 2; source.updateMatrixWorld(true);
        const animated = new Set(clips.flatMap(clip => clip.tracks.map(track => THREE.PropertyBinding.parseTrackName(track.name).nodeName)));
        const frameBounds = new THREE.Box3(), coreCenter = new THREE.Vector3();
        const frame = [];
        source.traverse(node => {
          if (!node.isMesh) return;
          if (/Plane001_/.test(node.name)) new THREE.Box3().setFromObject(node).getCenter(coreCenter);
          if (/shi_aiStandardSurface4SG/.test(node.name)) { frame.push(node); frameBounds.union(new THREE.Box3().setFromObject(node)); }
        });
        if (frame.length === 0 || frameBounds.isEmpty()) throw new Error('Portal asset has no stone frame.');
        // A stone is anything the clip moves that does not carry the arch.
        const stoneNodes = [...animated].map(name => source.getObjectByName(name)).filter(node => {
          let meshes = 0, framed = false;
          node?.traverse(child => { if (child.isMesh) { meshes++; framed ||= frame.includes(child); } });
          return meshes > 0 && !framed;
        });
        const isStone = mesh => { for (let node = mesh; node; node = node.parent) if (stoneNodes.includes(node)) return true; return false; };
        source.traverse(node => { if (node.isMesh && !frame.includes(node) && !isStone(node)) node.visible = false; });
        const scale = 8 / (frameBounds.max.y - frameBounds.min.y);
        source.scale.setScalar(scale); source.position.set(-coreCenter.x * scale, -frameBounds.min.y * scale, -coreCenter.z * scale);
        source.updateMatrixWorld(true);
        for (const node of frame) {
          node.castShadow = node.receiveShadow = true;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            material.emissiveIntensity = 0; material.roughness = Math.max(material.roughness, .75);
            if (!loadedGlow.includes(material)) loadedGlow.push(material);
          }
        }
        // Measured at rest in the gate's frame: where each stone stands
        // around the arch, and which way is up for its animated parent.
        const far = Math.atan2(READ_OFFSET.x, READ_OFFSET.z) + Math.PI, toParent = new THREE.Matrix3(), found = [];
        for (const node of stoneNodes) {
          let stoneMesh = null; node.traverse(child => { if (child.isMesh) { stoneMesh ??= child; child.castShadow = child.receiveShadow = true; } });
          stoneMesh.geometry.computeBoundingBox();
          const centre = stoneMesh.geometry.boundingBox.getCenter(new THREE.Vector3()), at = stoneMesh.localToWorld(centre.clone());
          const turn = Math.atan2(at.x, at.z) - far;
          toParent.setFromMatrix4(node.parent.matrixWorld).invert();
          found.push({ node, mesh: stoneMesh, centre, up: new THREE.Vector3(0, 1, 0).applyMatrix3(toParent), rise: 0, order: 0,
            turn: Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) });
        }
        found.sort((a, b) => a.turn - b.turn).forEach((stone, index) => { stone.order = index; });
        const lane = measureLane(source, clips, frame);
        // Stones are still standing here, so their shaders compile with the gate's.
        await prepare?.(source);
        if (disposed) return;
        gate.add(source); fallbackGate.visible = false; modelLoaded = true;
        aperture.position.set(0, (coreCenter.y - frameBounds.min.y) * scale, .035);
        apertureScale.set(2.49 / 2.65, 2.29 / 2.65, 1);
        if (clips.length) { mixer = new THREE.AnimationMixer(source); actions = clips.map(clip => mixer.clipAction(clip).play()); mixer.setTime(0); }
        stones.push(...found); laneBlocked = lane; refreshEffects(); raiseStones();
      }, error => { modelError = error.message; }),
      loadModel(PORTAL_BOOK_ASSET, async source => {
        // This export stands its page spread upright; lay the spine on the
        // lectern before measuring so the hero can read the open pages above.
        source.rotation.x = -Math.PI / 2; source.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(source), size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
        const scale = 1.7 / size.x; source.scale.setScalar(scale);
        source.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale);
        source.traverse(node => {
          if (!node.isMesh) return;
          node.castShadow = node.receiveShadow = true;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (material.emissive) { material.emissiveIntensity = .08; bookGlow.push(material); }
          }
        });
        await prepare?.(source);
        if (disposed) return;
        bookMount.add(source); fallbackBook.visible = false; bookLoaded = true; refreshEffects();
      }, error => { bookError = error.message; }),
    ]).then(() => diagnostics());
    return loadPromise;
  }
  async function loadModel(path, accept, failed) {
    let source;
    try {
      const gltf = await new GLTFLoader().loadAsync(new URL(path, import.meta.url).href);
      source = gltf.scene;
      if (!disposed) await accept(source, gltf.animations ?? []);
      if (disposed) release(source);
    } catch (error) {
      if (source) release(source);
      failed(error instanceof Error ? error : new Error(String(error)));
    }
  }
  function diagnostics() {
    const action = actions[0];
    return { phase, progress, modelLoaded, bookLoaded, modelError, bookError, bookVisible: !disposed && root.visible && lectern.visible && bookMount.visible,
      apertureVisible: !disposed && aperture.visible, portal: places.portal, book: places.book, reading: places.reading, disposed,
      stones: stones.length, stonesVisible: stones.filter(stone => stone.node.visible).length, stonesRisen: stones.filter(stone => stone.node.visible && stone.rise >= 1).length,
      animation: action ? { clip: action.getClip().name, duration: action.getClip().duration, time: action.time, playing: AWAKE.has(phase) && !reducedMotion } : null };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; clearColliders(); mixer?.stopAllAction(); mixer?.uncacheRoot(mixer.getRoot()); mixer = null; actions = []; stones.length = 0; laneBlocked = null; way = [];
    release(root); root.clear(); loadedGlow.length = 0; bookGlow.length = 0;
  }
  for (let i = 0; i < 12; i++) {
    const burst = mesh(dust, dustGeometry, new THREE.MeshBasicMaterial({ color: '#b8aa8c', transparent: true, opacity: 0, depthWrite: false }));
    burst.userData.age = 0; burst.visible = false; bursts.push(burst);
  }
  refreshEffects();
  return { root, places, place, nearby, setPhase, update, entryPose, entryClear, load, diagnostics, dispose };
}
