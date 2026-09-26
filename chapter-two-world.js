import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { RUNE_ORDER, BELL_ORDER, CHALLENGE_RULES, chapterTwoStep } from './chapter-two-script.js';
import { fit, meshes, materialsOf, shadows, softTexture, footprints } from './model-fit.js';

// The trials' models come down once the chapter is open (`load`), as the
// story's do (story.js). Until one lands, and outside a browser, its sites keep
// the stand-ins carved here from primitives. assets/story/CREDITS.md credits
// the models.
const ASSETS = new URL('./assets/story/', import.meta.url);
const loader = new GLTFLoader();
const fetchModel = file => loader.loadAsync(new URL(`${file}.glb`, ASSETS).href);
// The Reach is built at about 1.9 units to the metre: sizes here are metres, times M.
const M = 3.4 / 1.8;
// The altar ruins stood on a platform the yard's own floor stands in for: the
// altar and its rubble sit this far above the arches' feet, in the model's units.
const ALTAR_FLOOR = 3.3;

// Each model's file, the size it is fitted to (its height, or with 'length'
// the longer side of its footprint), and anything done to it first.
const MODELS = {
  rune: { file: 'meridian-rune', size: 1.25 * M },
  tablet: { file: 'root-tablet', size: 1.3 * M },
  gauge: { file: 'pressure-gauge', size: .5 * M, measure: 'length' },
  // Its stem runs along z from the wheel back to the pipe's flange: stood on
  // end, the wheel is on top. The wheel is centred on its hub so it can turn.
  valve: { file: 'pressure-valve', size: .55 * M, measure: 'length', setup(scene) {
    scene.rotation.x = Math.PI / 2;
    for (const wheel of meshes(scene, mesh => mesh.material.name === '01 - Default')) {
      wheel.geometry.computeBoundingBox();
      const hub = wheel.geometry.boundingBox.getCenter(new THREE.Vector3());
      wheel.geometry.translate(-hub.x, -hub.y, -hub.z);
      wheel.position.add(hub.multiply(wheel.scale).applyQuaternion(wheel.quaternion));
      wheel.name = 'Valve wheel';
    }
  } },
  beacon: { file: 'meridian-beacon', size: 1.05 * M },
  // Its lines light themselves rather than waiting on the night's light.
  seal: { file: 'meridian-seal', size: 3 * M, measure: 'length', shadows: false, setup(scene) {
    for (const material of materialsOf(scene)) { material.emissive.set('#ffffff'); material.emissiveMap = material.map; material.depthWrite = false; }
  } },
  // Only the altar ruins' arches and altar: its platform, stairs, tree, flags
  // and grass stay behind.
  dais: { file: 'warden-dais', size: 28, measure: 'length', setup(scene) {
    for (const mesh of meshes(scene, mesh => !/^(Arches|Altar)$/.test(mesh.material.name))) { mesh.removeFromParent(); mesh.geometry.dispose(); }
  }, after(model) { const scene = model.children[0]; scene.position.y -= ALTAR_FLOOR * scene.scale.y; } },
  chart: { file: 'tide-chart', size: .8 * M, measure: 'length' },
  warden: { file: 'hollow-warden', size: 3.2 * M },
  // A cold sea light in the drowned, so they read in the dark.
  echo: { file: 'drowned-echo', size: 1.65 * M, setup(scene) {
    for (const material of materialsOf(scene)) { material.emissive.set('#1f7f8c'); material.emissiveIntensity = .45; }
  } },
};

// Chapter checkpoints are persistent. A failed attempt only resets its local challenge.
export function createChapterTwo({ world, collision, state, storyPlaces, isUnlocked, onChange, onMessage, onDamage, loadModel = fetchModel }) {
  const root = new THREE.Group(); root.name = 'The Drowned Meridian'; root.visible = false;
  const places = { chart: storyPlaces.tobin, seal: storyPlaces.maren };
  const props = {}, marks = {}, fighters = [], remains = [], templates = {};
  const siteMaps = { chart: 'city', seal: 'city' };
  const sites = [];
  let player = new THREE.Vector3(), runeIndex = 0, bellIndex = 0, valves = new Set(), valveTime = 0;
  let wave = 0, arena = null, waveDelay = 0, bossTime = 0, enabled = false;
  const base = new THREE.MeshStandardMaterial({ color: '#344950', roughness: .85 });
  const glow = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, roughness: .4 });
  const wood = new THREE.MeshStandardMaterial({ color: '#4d3b2b', roughness: .92 });
  const iron = new THREE.MeshStandardMaterial({ color: '#3b4247', metalness: .6, roughness: .55 });
  const bronze = color => new THREE.MeshStandardMaterial({ color: '#9a7743', metalness: .75, roughness: .38, emissive: color, side: THREE.DoubleSide });
  const unitBox = new THREE.BoxGeometry(1, 1, 1), ember = softTexture();
  // A bell's outline from lip to crown, turned about its axis: one unit tall.
  const bellShape = new THREE.LatheGeometry([[.5, 0], [.52, .035], [.46, .09], [.39, .22], [.33, .42], [.3, .62], [.28, .76], [.23, .88], [.13, .97], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 24);
  const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const faceToward = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  const clear = (a, b) => collision.cameraFraction(new THREE.Vector3(a.x, a.y + 1.8, a.z), new THREE.Vector3(b.x, b.y + 1.8, b.z), .1) > .98;
  const own = (prop, mesh) => { prop.owned.push(mesh.geometry); return mesh; };
  const solidly = mesh => { mesh.castShadow = mesh.receiveShadow = true; return mesh; };
  // What the chapter's props stand in the way of. It only stands in the way
  // while the chapter is open: before then, none of it can be seen.
  const solids = new Map(); let solid = false;
  function block(id, shape) { solids.set(id, shape); if (solid) collision.insert(id, shape); }
  function unblock(id) { solids.delete(id); collision.remove(id); }
  function setSolid(on) { if (on === solid) return; solid = on; for (const [id, shape] of solids) on ? collision.insert(id, shape) : collision.remove(id); }
  function place(id, x, z, map, color, kind) {
    siteMaps[id] = map;
    sites.push({ id, x, z, map, color, kind });
  }
  function buildSite({ id, x, z, map, color, kind }) {
    const available = p => world.biomeAt(p.x,p.z) === map && world.isWalkable(p.x,p.z,.85) && Object.values(places).every(other=>flatDistance(p,other)>4.5);
    let spot = world.findWalkable(x, z, .85);
    if(!available(spot)) {
      spot=null;
      for(let radius=1.5;radius<=75&&!spot;radius+=1.5)for(let i=0,count=Math.ceil(radius*5);i<count;i++){
        const candidate={x:x+Math.cos(i/count*Math.PI*2)*radius,z:z+Math.sin(i/count*Math.PI*2)*radius};
        if(available(candidate)){spot={...candidate,y:world.getHeight(candidate.x,candidate.z)};break;}
      }
    }
    if (!spot) throw new Error(`No reachable Chapter Two site for ${id} in ${map}`);
    places[id] = { ...spot };
    const group = new THREE.Group(); group.name = id; group.position.set(spot.x, spot.y, spot.z);
    const material = glow(color);
    // Everything faces the landing, where the player comes from.
    const prop = props[id] = { id, kind, color, group, material, owned: [material], glows: [[material, 1]], colliders: [], flash: 0,
      facing: world.spawn ? faceToward(spot, world.spawn) : 0, standIn: new THREE.Group() };
    group.add(prop.standIn);
    const foot = own(prop, new THREE.Mesh(new THREE.CylinderGeometry(.7, 1, .5, 6), base)); foot.position.y = .25; prop.standIn.add(foot);
    const icon = own(prop, new THREE.Mesh(kind === 'valve' ? new THREE.TorusGeometry(.7, .13, 6, 16) : new THREE.OctahedronGeometry(.6), material)); icon.position.y = 1.7; prop.standIn.add(icon);
    const ring = own(prop, new THREE.Mesh(new THREE.TorusGeometry(1.25, .045, 4, 32), material)); ring.rotation.x = -Math.PI / 2; ring.position.y = .06; group.add(ring);
    if (kind === 'bell' || kind === 'verse') hangBell(prop);
    root.add(group); world.streaming?.add(group, { kind: 'props', bounds: { x: spot.x, z: spot.z, radius: kind === 'dais' ? 15 : 2.5 } });
    dress(prop);
    return spot;
  }
  // The drowned bells the salvage crews stacked in the yard: three hung on
  // frames to be rung, and the one the bell-ringer scratched a verse into
  // lying where it fell. These need no download.
  function hangBell(prop) {
    prop.standIn.visible = false;
    const metal = bronze(prop.color); prop.owned.push(metal); prop.glows.push([metal, .12]);
    const holder = new THREE.Group(); holder.rotation.y = prop.facing; prop.group.add(holder);
    const bell = new THREE.Mesh(bellShape, metal); bell.castShadow = bell.receiveShadow = true;
    if (prop.kind === 'verse') {
      // On its side across the way in, crown a little raised, resting on its lip.
      bell.scale.setScalar(1.25 * M); bell.rotation.z = Math.PI / 2 - .35; bell.position.set(.55 * M, .49 * 1.25 * M, 0); holder.add(bell);
      return;
    }
    const beam = (width, height, depth, x, y) => { const mesh = solidly(new THREE.Mesh(unitBox, wood)); mesh.scale.set(width, height, depth); mesh.position.set(x, y, 0); holder.add(mesh); };
    for (const side of [-1, 1]) beam(.14 * M, 2.2 * M, .14 * M, side * .62 * M, 1.1 * M);
    beam(1.5 * M, .16 * M, .18 * M, 0, 2.15 * M);
    // The bell swings from under the beam, crown up.
    prop.swing = new THREE.Group(); prop.swing.position.y = 2.07 * M; holder.add(prop.swing);
    bell.scale.setScalar(.7 * M); bell.position.y = -.7 * M; prop.swing.add(bell);
    prop.ringing = 0;
  }
  // A site's own model, in place of its stand-in, once it has come down.
  function dress(prop) {
    const template = templates[prop.kind];
    if (!template || prop.model || props[prop.id] !== prop) return;
    const model = prop.model = template.model.clone(); model.rotation.y = prop.facing;
    prop.standIn.visible = false; prop.group.add(model);
    if (prop.kind === 'rune') {
      // Its carvings glow in the rune's own colour. They are cut into the
      // stone's back (-z), which is turned to the landing. Its foot is set into the slope.
      model.rotation.y += Math.PI; model.position.y = -.08 * M;
      for (const mesh of meshes(model)) { mesh.material = mesh.material.clone(); mesh.material.emissive.set(prop.color); prop.owned.push(mesh.material); prop.glows.push([mesh.material, 2.4]); }
    } else if (prop.kind === 'tablet') model.position.y = -.1 * M;
    else if (prop.kind === 'gauge') {
      const post = solidly(own(prop, new THREE.Mesh(new THREE.CylinderGeometry(.045 * M, .07 * M, 1.05 * M, 10), iron))); post.position.y = .525 * M; prop.group.add(post);
      model.position.y = 1 * M;
    } else if (prop.kind === 'valve') {
      const pipe = solidly(own(prop, new THREE.Mesh(new THREE.CylinderGeometry(.09 * M, .11 * M, .55 * M, 12), iron))); pipe.position.y = .275 * M; prop.group.add(pipe);
      model.position.y = .5 * M; prop.wheel = model.getObjectByName('Valve wheel');
    } else if (prop.kind === 'beacon') kindling(prop);
    else if (prop.kind === 'dais') {
      // The arches' pillars stand in the way, and so does the altar's spire:
      // the one part of it that rises above the rubble, which does not.
      prop.group.updateWorldMatrix(true, true);
      const pillars = footprints(model, .6, 1.2, mesh => mesh.material.name === 'Arches');
      const spire = new THREE.Vector3(), vertex = new THREE.Vector3(); let count = 0;
      for (const mesh of meshes(model, mesh => mesh.material.name === 'Altar')) {
        const position = mesh.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) if (vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).y > prop.group.position.y + 3) { spire.add(vertex); count++; }
      }
      if (count) pillars.push({ x: spire.x / count, z: spire.z / count, r: 1.3 });
      pillars.forEach((pillar, i) => { const id = `chapter-two-${prop.id}-${i}`; prop.colliders.push(id); block(id, { x: pillar.x, z: pillar.z, r: pillar.r }); });
    }
  }
  // The beacon's fire, low embers until it is kindled. Glows, not a light: a
  // light switched on would rebuild every shader in the Reach.
  function kindling(prop) {
    const flame = new THREE.Group(); flame.position.y = .9 * M; prop.group.add(flame);
    const sprite = (color, opacity) => {
      const material = new THREE.SpriteMaterial({ map: ember, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
      prop.owned.push(material); const glow = new THREE.Sprite(material); flame.add(glow); return glow;
    };
    prop.flame = { outer: sprite('#ff7a2e', .85), inner: sprite('#ffe2a0', .95), embers: sprite('#ff4a1a', .4) };
    prop.flame.embers.scale.set(.9 * M, .5 * M, 1);
  }
  // Along the island clearing, then round the container lanes of Map 79's
  // yard: the bell verse just off the south bridge, a bell in each far corner,
  // the valves by the landing, the beacon in the open west lane and the
  // Hollow Warden at the north end, in the ruins of an old altar.
  place('rootTablet', -96, 8, 'forest', '#b3cda0', 'tablet');
  place('root', -106, 5, 'forest', '#9aca75', 'rune');
  place('rain', -121, 13, 'forest', '#72c8ef', 'rune');
  place('moon', -115, -3, 'forest', '#d5b6fa', 'rune');
  place('bellTablet', 186, 136, 'yard', '#ffd9a4', 'verse');
  place('dusk', 132, 200, 'yard', '#ed9477', 'bell');
  place('tide', 211, 165, 'yard', '#7ddddd', 'bell');
  place('dawn', 170, 212, 'yard', '#efcd76', 'bell');
  place('valvePanel', 157, 143, 'yard', '#ecc674', 'gauge');
  place('valve1', 170, 140, 'yard', '#f1a265', 'valve');
  place('valve2', 138, 165, 'yard', '#f1a265', 'valve');
  place('valve3', 176, 178, 'yard', '#f1a265', 'valve');
  place('beacon', 140, 182, 'yard', '#b6fff2', 'beacon');
  place('warden', 205, 206, 'yard', '#c5a5fc', 'dais');
  // The two things in the city that are the chapter's own: the meridian seal,
  // on the ground where the keeper stood, and Tobin's tide chart, open on a
  // crate at his side.
  function buildMarks() {
    for (const id of Object.keys(marks)) { world.streaming?.removeTree?.(marks[id].group); marks[id].group.removeFromParent(); delete marks[id]; }
    unblock('chapter-two-chart');
    if (world.activeMap && world.activeMap !== 'city') return;
    const seal = new THREE.Group(); seal.name = 'The meridian seal'; seal.position.set(places.seal.x, places.seal.y + .03, places.seal.z);
    marks.seal = { kind: 'seal', group: seal, glows: [] };
    const tobin = places.chart, facing = tobin.facing ?? 0;
    const [beside] = [1, -1].map(side => ({ x: tobin.x + Math.cos(facing) * 1.15 * M * side, z: tobin.z - Math.sin(facing) * 1.15 * M * side }))
      .sort((a, b) => world.isWalkable(b.x, b.z, .4 * M) - world.isWalkable(a.x, a.z, .4 * M));
    const chart = new THREE.Group(); chart.name = 'Tobin’s tide chart'; chart.position.set(beside.x, world.getHeight(beside.x, beside.z), beside.z); chart.rotation.y = facing;
    const crate = solidly(new THREE.Mesh(unitBox, wood)); crate.scale.set(.6 * M, .5 * M, .45 * M); crate.position.y = .25 * M; chart.add(crate);
    marks.chart = { kind: 'chart', group: chart, glows: [] };
    block('chapter-two-chart', { x: beside.x, z: beside.z, r: .38 * M });
    for (const mark of Object.values(marks)) {
      root.add(mark.group); world.streaming?.add(mark.group, { kind: 'props', bounds: { x: mark.group.position.x, z: mark.group.position.z, radius: 3 } });
      dressMark(mark);
    }
  }
  function dressMark(mark) {
    const template = templates[mark.kind];
    if (!template || mark.model || marks[mark.kind] !== mark) return;
    const model = mark.model = template.model.clone(); mark.group.add(model);
    if (mark.kind === 'seal') mark.glows = materialsOf(model).map(material => [material, 1]);
    else { model.position.y = .5 * M + .01; model.rotation.y = .2; }
  }
  function syncMap() {
    resetChallenge(); runeIndex = bellIndex = 0;
    for (const r of remains.splice(0)) bury(r);
    for (const [id, prop] of Object.entries(props)) {
      world.streaming?.removeTree?.(prop.group);
      for (const thing of prop.owned) thing.dispose();
      for (const collider of prop.colliders) unblock(collider);
      prop.group.removeFromParent();
      delete props[id]; delete places[id];
    }
    for (const site of sites) if (!world.activeMap || site.map === world.activeMap) buildSite(site);
    buildMarks();
  }
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.45), glow('#ffe3a1')); root.add(marker);
  const warning = new THREE.Mesh(new THREE.RingGeometry(.1, 10, 64), new THREE.MeshBasicMaterial({ color: '#ff7255', transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false }));
  warning.rotation.x = -Math.PI / 2; warning.visible = false; root.add(warning);
  const fighterGeometry = new THREE.IcosahedronGeometry(1, 1);
  syncMap();
  function checkpoint(flag, reward) { if (state[flag]) return; state[flag] = true; onChange({ flag, reward }); }
  const step = () => chapterTwoStep(state).id;
  function objective() {
    if (world.activeMap && chapterTwoStep(state).map !== world.activeMap) return null;
    return ({ summons: places.chart, roots: places.rootTablet, bells: places.bellTablet,
      valves: valveTime > 0 ? places[['valve1','valve2','valve3'].find(id => !valves.has(id))] : places.valvePanel,
      vigil: places.beacon, warden: places.warden, homecoming: places.seal })[step()] || null;
  }
  function candidates() {
    switch (step()) {
      case 'summons': return [['chart', 'Ask Tobin about the black tide']];
      case 'roots': return [['rootTablet','Read the root inscription'], ...RUNE_ORDER.map(id => [id, `Touch the ${id} rune`])];
      case 'bells': return [['bellTablet','Read the bell inscription'], ...BELL_ORDER.map(id => [id, `Ring the ${id} bell`])];
      case 'valves': return [['valvePanel','Read the pressure log'], ...['valve1','valve2','valve3'].filter(id => !valves.has(id)).map((id) => [id, `Close pressure valve ${id.slice(-1)}`])];
      case 'vigil': return arena ? [] : [['beacon','Light the beacon · survive three waves']];
      case 'warden': return arena ? [] : [['warden','Challenge the Hollow Warden']];
      case 'homecoming': return [['seal','Return the Tidewarden’s voice']];
      default: return [];
    }
  }
  function nearby(position) {
    player.copy(position);
    if (!isUnlocked()) return null;
    return candidates().filter(([id]) => places[id] && (!world.activeMap || siteMaps[id] === world.activeMap)).map(([id,label]) => ({ type: 'chapterTwo', id, label, ...places[id] }))
      .filter(p => flatDistance(position,p) < 4.8 && Math.abs(position.y-p.y) < 3 && (['chart','seal'].includes(p.id)||clear(position,p)))
      .sort((a,b) => flatDistance(position,a)-flatDistance(position,b))[0] || null;
  }
  function resetChallenge() {
    for (const f of fighters) { f.alive=false;root.remove(f.group); f.material.dispose(); unrig(f); }
    fighters.length = 0; arena = null; wave = 0; waveDelay = 0; bossTime = 0; valveTime = 0; valves.clear(); warning.visible = false;
  }
  function spawnFighter(centre, index, boss = false) {
    const angle = index * 2.4;
    let at = boss ? centre : world.findWalkable(centre.x + Math.cos(angle)*7, centre.z + Math.sin(angle)*7, .85);
    const safe = p => flatDistance(p,centre)<18 && world.biomeAt(p.x,p.z)===world.biomeAt(centre.x,centre.z) && clear(centre,p);
    if(!safe(at)){
      at=centre;
      for(let i=0;i<24;i++){
        const candidate=world.findWalkable(centre.x+Math.cos(angle+i/24*Math.PI*2)*5,centre.z+Math.sin(angle+i/24*Math.PI*2)*5,.85);
        if(safe(candidate)){at=candidate;break;}
      }
    }
    const group = new THREE.Group(), material = glow(boss ? '#ba87f6' : '#ef866f');
    const core = new THREE.Mesh(fighterGeometry, material); core.scale.setScalar(boss ? 2.2 : 1); core.position.y = boss ? 2.6 : 1.6; group.add(core);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(boss ? 2.8 : 1.3, .07, 4, 24), material); hoop.position.y = core.position.y; hoop.rotation.x = Math.PI / 2; group.add(hoop);
    group.position.set(at.x,at.y,at.z); root.add(group);
    const fighter = { group, core, hoop, material, hp: boss ? CHALLENGE_RULES.bossHP : CHALLENGE_RULES.baseEnemyHP, alive: true, boss, cooldown: 1, pulseDone: false };
    fighters.push(fighter); rig(fighter);
  }
  // A drowned echo, or the Hollow Warden, in its own animated model once it
  // has come down. The echo's ring drops to its feet; the Warden's circles it
  // as its shield.
  function rig(f) {
    const template = templates[f.boss ? 'warden' : 'echo'];
    if (!template || f.model || !f.alive) return;
    f.model = cloneRig(template.model); f.mixer = new THREE.AnimationMixer(f.model);
    f.clips = Object.fromEntries(template.clips.map(clip => [clip.name, clip])); f.clip = null;
    f.core.visible = false; f.group.add(f.model);
    f.hoop.geometry.dispose();
    if (f.boss) {
      // The Warden's heart is the one light in it, and its own, to show the shield.
      f.heart = null;
      for (const mesh of meshes(f.model, mesh => mesh.material.name === 'Emission')) f.heart = mesh.material = mesh.material.clone();
      f.hoop.geometry = new THREE.TorusGeometry(1.9 * M, .07, 4, 40); f.hoop.position.y = 1.6 * M;
      act(f, 'Defence3', { once: true });
    } else {
      f.hoop.geometry = new THREE.TorusGeometry(.62 * M, .05, 4, 28); f.hoop.position.y = .08;
      act(f, 'idle');
    }
  }
  function unrig(f) {
    f.hoop.geometry.dispose();
    if (f.mixer) { f.mixer.stopAllAction(); f.mixer.uncacheRoot(f.model); }
    f.heart?.dispose(); f.model = f.mixer = f.heart = null;
  }
  // Plays one of a fighter's clips, eased in from whatever it was doing.
  function act(f, name, { once = false } = {}) {
    if (!f.mixer || f.clip === name || !f.clips[name]) return;
    const next = f.mixer.clipAction(f.clips[name]);
    next.reset(); next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = once;
    next.fadeIn(.25).play();
    if (f.clip) f.mixer.clipAction(f.clips[f.clip]).fadeOut(.25);
    f.clip = name;
  }
  // The fallen stay a moment: the Warden comes apart, and an echo topples back
  // and sinks away.
  function fall(f) {
    f.alive = false; f.group.visible = false;
    if (!f.model) return;
    const group = new THREE.Group(); group.position.copy(f.group.position); group.rotation.order = 'YXZ'; group.rotation.y = f.model.rotation.y; root.add(group);
    f.model.rotation.y = 0; group.add(f.model);
    const r = { group, model: f.model, mixer: f.mixer, heart: f.heart, boss: f.boss, time: 0, action: null };
    if (f.boss && f.clips.IdlePieces) { f.mixer.stopAllAction(); r.action = f.mixer.clipAction(f.clips.IdlePieces).reset().setLoop(THREE.LoopOnce, 1); r.action.play(); }
    remains.push(r);
    f.model = f.mixer = f.heart = null;
  }
  function bury(r) {
    r.group.removeFromParent(); r.mixer.stopAllAction(); r.mixer.uncacheRoot(r.model); r.heart?.dispose();
  }
  function nextWave() {
    wave++; waveDelay = 0;
    for(let i=0;i<CHALLENGE_RULES.waveCounts[wave-1];i++)spawnFighter(places.beacon,i);
    onMessage(`Beacon vigil · wave ${wave} / 3. Stay within the square.`);
  }
  function interact(action) {
    if (!isUnlocked() || !places[action.id] || (world.activeMap && siteMaps[action.id] !== world.activeMap) || !candidates().some(([id])=>id===action.id) || flatDistance(player,places[action.id])>=4.8 || Math.abs(player.y-places[action.id].y)>=3 || (!['chart','seal'].includes(action.id)&&!clear(player,places[action.id]))) return null;
    const id = action.id;
    if (['chart','rootTablet','bellTablet','valvePanel','seal'].includes(id)) return { person: id };
    if (step() === 'roots' || step() === 'bells') {
      const roots = step()==='roots', order = roots ? RUNE_ORDER : BELL_ORDER, index = roots ? runeIndex : bellIndex;
      const correct = id===order[index], next = correct ? index+1 : 0;
      if(roots)runeIndex=next;else bellIndex=next;
      // Touched, a rune flares and a bell swings, right or wrong.
      if(props[id]){props[id].flash=1;props[id].ringing=1;}
      onMessage(correct ? `${roots?'Root lock':'Bell lock'} · ${next} / 3` : 'The lock falls silent. The sequence resets; read the inscription again.');
      if(next===3)checkpoint(roots?'roots':'bells',100);
    } else if (step()==='valves') {
      if(!valveTime)valveTime=CHALLENGE_RULES.valveSeconds;
      valves.add(id); onMessage(`Pressure valves · ${valves.size} / 3 · ${Math.ceil(valveTime)} seconds`);
      if(valves.size===3){valveTime=0;checkpoint('valves',120);}
    } else if(id==='beacon') { resetChallenge(); arena='vigil'; nextWave(); }
    else if(id==='warden') { resetChallenge(); arena='warden'; spawnFighter(places.warden,0,true); onMessage('The Hollow Warden · leave the red circle, then strike while its shield is down.'); }
    return null;
  }
  function attack({ position, range, damage, special, target, lineOfSight = clear }) {
    if(!isUnlocked() || !arena)return {hits:0,kills:0,bossShielded:false};
    const targets=fighters.filter(f=>f.alive&&(special||target===undefined||target===f)&&flatDistance(position,f.group.position)<range&&Math.abs(position.y-f.group.position.y)<4&&lineOfSight(position,f.group.position)).sort((a,b)=>flatDistance(position,a.group.position)-flatDistance(position,b.group.position));
    const result={hits:0,kills:0,bossShielded:false};
    for(const f of special?targets:targets.slice(0,1)) {
      if(f.boss && bossTime%7<3.4){result.bossShielded=true;continue;}
      f.hp-=damage; result.hits++;
      if(f.hp<=0){fall(f);result.kills++;}
    }
    if(result.bossShielded)onMessage('Its shield holds. Dodge the red pulse; strike during the silver glow.');
    if(arena==='warden' && fighters.length && fighters.every(f=>!f.alive)){resetChallenge();checkpoint('warden',250);onMessage('The stolen voice is free. Bring it home to the Moonwell.');}
    return result;
  }
  function update(dt,time,position,{active}) {
    player.copy(position); enabled=isUnlocked(); root.visible=enabled; setSolid(enabled);
    if(!enabled)return;
    const goal=objective(); marker.visible=!!goal;
    if(goal)marker.position.set(goal.x,goal.y+4.7+Math.sin(time*2)*.2,goal.z);
    marker.rotation.y=time;
    for(const [id,p] of Object.entries(props)) {
      const done=(RUNE_ORDER.includes(id)&&state.roots)||(BELL_ORDER.includes(id)&&state.bells)||(id.startsWith('valve')&&state.valves)||(id==='beacon'&&state.vigil)||(id==='warden'&&state.warden);
      p.flash=Math.max(0,p.flash-dt*1.5);
      const strength=(done?.25:1.2+Math.sin(time*2)*.3)*(1+p.flash*1.5);
      for(const [material,share] of p.glows)material.emissiveIntensity=share*strength;
      // A closed valve's wheel is turned three half-turns home.
      if(p.wheel)p.wheel.rotation.z+=((state.valves||valves.has(id)?3*Math.PI:0)-p.wheel.rotation.z)*Math.min(1,dt*2.5);
      if(p.swing){p.ringing=Math.max(0,p.ringing-dt*.6);p.swing.rotation.x=Math.sin(time*7)*.45*p.ringing**2;}
      if(p.flame){
        const lit=arena==='vigil'||state.vigil,{outer,inner,embers}=p.flame,flicker=Math.sin(time*11)*.5+Math.sin(time*17.3)*.5;
        outer.visible=inner.visible=lit;embers.visible=!lit;
        outer.scale.set(1.3*M*(1+flicker*.06),1.8*M*(1+flicker*.1),1);outer.position.y=.45*M;
        inner.scale.set(.65*M,1*M*(1+flicker*.12),1);inner.position.y=.3*M;
        embers.material.opacity=.3+Math.sin(time*2)*.12;
      }
    }
    // The seal wakes as the voice comes home, and stays lit once it has.
    const seal=marks.seal;
    if(seal){
      const strength=state.complete?1.1:step()==='homecoming'?1.3+Math.sin(time*2.4)*.5:.3;
      for(const [material,share] of seal.glows)material.emissiveIntensity=share*strength;
      if(seal.model)seal.model.rotation.y=time*.12;
    }
    if(!active)return;
    for(let i=remains.length-1;i>=0;i--){
      const r=remains[i];r.time+=dt;
      if(r.action&&r.action.time>1.15)r.action.paused=true;
      r.mixer.update(dt);
      if(!r.boss)r.group.rotation.x=-Math.min(1,r.time/.45)*1.35;
      if(r.time>(r.boss?2.2:.6))r.group.position.y-=dt*(r.boss?1.2:2.4);
      if(r.time>(r.boss?4:1.6)){bury(r);remains.splice(i,1);}
    }
    if(valveTime>0){valveTime=Math.max(0,valveTime-dt);if(!valveTime){valves.clear();onMessage('Pressure returned. All three valves reopened. Try again from any valve.');}}
    if(!arena)return;
    const centre=places[arena==='vigil'?'beacon':'warden'];
    if(flatDistance(position,centre)>42){resetChallenge();onMessage('The challenge resets when you leave its grounds. Your completed locks are safe.');return;}
    if(arena==='vigil') {
      if(fighters.every(f=>!f.alive)){
        if(wave===3){resetChallenge();checkpoint('vigil',180);onMessage('The beacon holds. The Hollow Warden waits beyond the yard’s stacks.');return;}
        waveDelay+=dt;if(waveDelay>=2)nextWave();
      }
      for(const f of fighters)if(f.alive){
        const at=f.group.position, d=flatDistance(position,at);f.cooldown-=dt;
        let moving=false;
        if(d>2 && clear(at,position)){
          const nx=at.x+(position.x-at.x)/d*3.6*dt,nz=at.z+(position.z-at.z)/d*3.6*dt;
          if(world.isWalkable(nx,nz,.7)){at.x=nx;at.z=nz;collision.resolve(at,.7,3);at.y=world.getHeight(at.x,at.z);moving=true;}
        }
        f.core.rotation.y=time; f.core.position.y=1.6+Math.sin(time*3)*.2;
        if(f.model){f.model.rotation.y=faceToward(at,position);act(f,moving?'run':'idle');f.mixer.update(dt);}
        if(d<3 && Math.abs(position.y-at.y)<1.8 && clear(at,position) && f.cooldown<=0){f.cooldown=1.4;onDamage(16);if(!arena)return;}
      }
    } else {
      const boss=fighters.find(f=>f.alive);if(!boss)return;
      const previous=bossTime%7;bossTime+=dt;const phase=bossTime%7;
      if(phase<previous)boss.pulseDone=false;
      warning.visible=phase<3.4;warning.position.set(centre.x,centre.y+.16,centre.z);
      warning.material.opacity=.12+Math.min(1,phase/3.4)*.4;
      boss.material.color.set(phase<3.4?'#ba87f6':'#c7fff1');boss.material.emissive.set(phase<3.4?'#9f51e3':'#a5ffdc');
      boss.core.rotation.y=time*.7;
      // Curled up behind its shield, it rises to slam the ground as the pulse
      // breaks, then stands open, heart bare, until the next telegraph.
      if(boss.model){
        boss.model.rotation.y=faceToward(centre,position);
        act(boss,phase<1.9?'Defence3':phase<4.8?'Attack1':'Idle',{once:phase<4.8});
        boss.heart?.emissive.set(phase<3.4?'#9f51e3':'#a5ffdc');
        boss.mixer.update(dt);
      }
      if(phase>=3.4&&!boss.pulseDone){boss.pulseDone=true;if(flatDistance(position,centre)<10&&position.y-world.getHeight(position.x,position.z)<1&&clear(centre,position))onDamage(32);}
    }
  }
  function status() {
    if(step()==='roots')return `Runes ${runeIndex} / 3 · inscription at the island landing`;
    if(step()==='bells')return `Bells ${bellIndex} / 3 · inscription by the south jetty`;
    if(step()==='valves')return valveTime>0?`Valves ${valves.size} / 3 · ${Math.ceil(valveTime)}s left`:'Three valves · 45 seconds · timer starts at the first valve';
    if(arena==='vigil')return `Wave ${wave} / 3 · ${fighters.filter(f=>f.alive).length} sentinels remain`;
    if(arena==='warden')return `Hollow Warden ${Math.max(0,Math.ceil(fighters[0]?.hp||0))} / ${CHALLENGE_RULES.bossHP} · ${bossTime%7<3.4?'DODGE THE RED PULSE':'SHIELD DOWN · ATTACK'}`;
    return '';
  }
  // Brings the models down once the chapter is open: players still in the
  // first chapter never pay for them. Every download starts at once; each
  // model is readied (`prepare`) and put in place in turn. One that will not
  // load leaves its stand-ins standing.
  let request = null, loading = null, begin = null;
  const ready = new Promise(resolve => { begin = () => resolve(fetchAll()); });
  function load(options = {}) {
    request ??= options;
    if (isUnlocked()) start();
    return ready;
  }
  function start() { if (request && !loading) { loading = true; begin(); } }
  async function fetchAll() {
    const jobs = Object.entries(MODELS).map(([kind, spec]) => {
      const job = Promise.resolve().then(() => loadModel(spec.file)).then(gltf => {
        spec.setup?.(gltf.scene);
        const model = fit(gltf.scene, spec.size, spec.measure);
        spec.after?.(model); shadows(model, spec.shadows !== false);
        return { model, clips: gltf.animations };
      });
      job.catch(() => {});
      return [kind, job];
    });
    let loaded = 0, failed = 0;
    for (const [kind, job] of jobs) {
      try {
        const template = await job;
        await request.prepare?.(template.model);
        templates[kind] = template; loaded++;
        for (const prop of Object.values(props)) if (prop.kind === kind) dress(prop);
        for (const mark of Object.values(marks)) if (mark.kind === kind) dressMark(mark);
        for (const f of fighters) rig(f);
      } catch (error) {
        failed++; console.warn(`The Drowned Meridian's ${kind} model did not load; its stand-in stays.`, error);
      }
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    return { loaded, failed };
  }
  const updateAndLoad = (...args) => { if (request && !loading && isUnlocked()) start(); update(...args); };
  return { root,places,nearby,interact,update:updateAndLoad,attack,objective,resetChallenge,syncMap,load,get status(){return status();},
    get mapTargets(){return isUnlocked()?candidates().filter(([id]) => places[id] && (!world.activeMap || siteMaps[id] === world.activeMap)).map(([id,label])=>({id,label,...places[id]})):[];},
    get combatants(){return fighters;},
    get diagnostics(){return {step:step(),flags:{...state},places,arena,wave,runeIndex,bellIndex,valves:[...valves],valveTime,bossTime,status:status(),
      models:Object.keys(templates),dressed:Object.values(props).filter(p=>p.model||p.swing||p.kind==='verse').map(p=>p.id),marks:Object.values(marks).filter(m=>m.model).map(m=>m.kind),
      enemies:fighters.map(f=>({hp:f.hp,alive:f.alive,boss:f.boss,model:!!f.model,clip:f.clip??null,x:f.group.position.x,y:f.group.position.y,z:f.group.position.z}))};} };
}
