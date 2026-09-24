import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HARBOUR_LEVEL } from './world-map.js';

// The Last Keeper, stood up in the Reach: the Moonwell and its keeper in the
// sanctuary, the ferryman on the west quay, the wanderers' camp and its
// ledger, a notice board by the arrival square, and the Tidewarden circling
// the harbour. story-script.js has the words; this has the places and things.
//
// Everything is placed from the world's own layout the moment the story is
// created, so the people can be spoken to straight away. The models stream in
// behind the game's start, like the plaza, and each is dropped into its place
// when it lands.
const ASSETS = new URL('./assets/story/', import.meta.url);
const loader = new GLTFLoader();

// The Reach is built at about 1.9 units to the metre: its people stand 3.4
// tall. Sizes here are given in metres, times M.
const M = 3.4 / 1.8;
// How close each person or thing can be spoken to or read from.
const RANGE = { maren: 2.6 * M, tobin: 2.6 * M, notice: 2.2 * M, ledger: 2 * M };
// The Tidewarden's water: open harbour west of the islet, in sight of the
// ferryman's jetty.
const TIDEWARDEN = { x: -134, z: 60, radius: 30, period: 80 };

// Scales a model so one measure of its visible bounds comes out at `size`
// ('height', or 'length' for the longer footprint side), and sets it on a pivot
// with that footprint centred on the origin and its base at y = 0.
function fit(scene, size, measure = 'height', only = object => object.visible) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  scene.traverse(object => { if (object.isMesh && only(object)) box.expandByObject(object); });
  const extent = box.getSize(new THREE.Vector3());
  const scale = size / (measure === 'height' ? extent.y : Math.max(extent.x, extent.z));
  const pivot = new THREE.Group();
  scene.scale.setScalar(scale);
  scene.position.set(-(box.min.x + box.max.x) / 2 * scale, -box.min.y * scale, -(box.min.z + box.max.z) / 2 * scale);
  pivot.add(scene);
  return pivot;
}
const meshes = (object, test = () => true) => { const found = []; object.traverse(o => { if (o.isMesh && test(o)) found.push(o); }); return found; };
const materialsOf = object => [...new Set(meshes(object).flatMap(mesh => [mesh.material].flat()))];
function shadows(object, cast = true) { for (const mesh of meshes(object)) { mesh.castShadow = cast; mesh.receiveShadow = true; } }
// Fades a model's own materials; they are cloned first so a fade never reaches
// another model sharing them.
function fader(object) {
  const materials = [];
  for (const mesh of meshes(object)) {
    mesh.material = [mesh.material].flat().map(material => { const copy = material.clone(); materials.push({ copy, opacity: copy.opacity, transparent: copy.transparent, depthWrite: copy.depthWrite }); return copy; });
    if (mesh.material.length === 1) mesh.material = mesh.material[0];
  }
  return k => {
    for (const { copy, opacity, transparent, depthWrite } of materials) {
      const blending = transparent || k < 1;
      if (copy.transparent !== blending) { copy.transparent = blending; copy.needsUpdate = true; }
      // Mid-fade, a solid surface stops writing depth so it can be seen through.
      copy.opacity = opacity * k; copy.depthWrite = transparent || k >= 1 ? depthWrite : false;
    }
  };
}
// Round footprints for whatever stands on the ground of a model: the pillars
// of the stone circle are found as clusters of its lowest vertices.
function footprints(object, height = .6, join = .9) {
  object.updateMatrixWorld(true);
  const points = [], vertex = new THREE.Vector3();
  for (const mesh of meshes(object)) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (vertex.y < height) points.push([vertex.x, vertex.z]);
    }
  }
  const clusters = [];
  for (const [x, z] of points) {
    const near = clusters.find(c => Math.hypot(c.x - x, c.z - z) < join);
    if (near) { near.n++; near.x += (x - near.x) / near.n; near.z += (z - near.z) / near.n; near.points.push([x, z]); }
    else clusters.push({ x, z, n: 1, points: [[x, z]] });
  }
  return clusters.filter(c => c.n > 8).map(c => ({ x: c.x, z: c.z, r: Math.max(.3, ...c.points.map(([x, z]) => Math.hypot(x - c.x, z - c.z))) }));
}

export function createStory({ world, activities, collision }) {
  const root = new THREE.Group(); root.name = 'The Last Keeper';
  const ground = (x, z) => world.getHeight(x, z);
  const colliderIds = [];
  const collide = (id, shape) => { colliderIds.push(id); collision.insert(id, shape); };
  const uncollide = id => collision.remove(id);
  const site = (point, facing = 0) => ({ x: point.x, y: point.y ?? ground(point.x, point.z), z: point.z, facing });
  const faceToward = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

  // The sanctuary, round the shrine's own marker: the well at its heart and
  // the stone circle round it. The keeper waits at its threshold, on the way
  // in from the city, so whoever speaks with her sees the well behind her; the
  // Hart comes to her there, and her chest is left where she stood.
  const shrine = world.landmarks.find(l => l.id === 'shrine');
  const moonwell = site(shrine);
  const approach = { x: moonwell.x, z: moonwell.z + 30 };
  const around = (dx, dz) => site({ x: moonwell.x + dx, z: moonwell.z + dz });
  const places = { maren: around(1.6, 9.2), hart: around(-3.4, 9.8), chest: around(1.6, 8.3), lantern: around(2.3, 1.9) };
  places.maren.facing = faceToward(places.maren, approach);
  places.hart.facing = faceToward(places.hart, places.maren);
  places.chest.facing = faceToward(places.chest, approach);
  // The camp: the wanderers' fire, their tent, and the ledger on its stand,
  // which faces out from the fire so its reader stands clear of the camp.
  const fire = activities.campfire.group.position;
  places.tent = site(activities.reserve('story-tent', fire.x - 8, fire.z - 6, 3.4));
  places.tent.facing = faceToward(places.tent, fire);
  places.ledger = site(activities.reserve('story-ledger', fire.x + 3, fire.z - 6, 1));
  places.ledger.facing = faceToward(fire, places.ledger);
  // The notice board, a few strides from where every journey starts.
  places.notice = site(activities.reserve('story-notice', world.spawn.x + 7, world.spawn.z - 7, 2.4));
  places.notice.facing = faceToward(places.notice, world.spawn);
  // The ferryman, where the west jetty leaves the quay.
  places.tobin = site(activities.reserve('story-ferryman', -70.5, 16, 1));
  places.tobin.facing = faceToward(places.tobin, { x: -60, z: 16 });
  // His boat is hauled up on the quay beside him: the ferry is closed.
  places.boat = site(activities.reserve('story-boat', -70.8, 24.5, 1.4));
  // How tall each speaker stands, for the beacon over their head.
  places.maren.top = 1.62 * M; places.tobin.top = 1.78 * M; places.ledger.top = .9 * M;
  const along = (p, distance) => ({ x: p.x + Math.cos(p.facing) * distance, z: p.z - Math.sin(p.facing) * distance });
  places.campLantern = site(along(places.ledger, .75 * M));

  collide('story-maren', { x: places.maren.x, z: places.maren.z, r: .42 * M });
  collide('story-tobin', { x: places.tobin.x, z: places.tobin.z, r: .42 * M });
  collide('story-ledger', { x: places.ledger.x, z: places.ledger.z, r: .4 * M });
  for (const side of [-1, 1]) collide(`story-notice-${side}`, { ...along(places.notice, side * .95 * M), r: .25 * M });

  let restored = false, departed = false, talking = null;
  const loaded = {}, tweens = [], mixers = [];
  const add = (name, object, place) => {
    object.name = name; object.position.set(place.x, place.y, place.z); object.rotation.y = place.facing || 0;
    root.add(object); loaded[name] = object; return object;
  };
  const tween = (duration, step) => new Promise(resolve => tweens.push({ duration, t: 0, step, resolve }));
  const ease = k => k * k * (3 - 2 * k);

  // The ledger's stand and the Moonwell's light are the story's own, so they
  // are there before any download.
  const wood = new THREE.MeshStandardMaterial({ color: '#6b4c38', roughness: .95 });
  const stand = new THREE.Mesh(new THREE.BoxGeometry(.56 * M, .62 * M, .44 * M), wood);
  stand.position.y = .31 * M; stand.castShadow = stand.receiveShadow = true;
  const ledgerGroup = add('Keeper’s ledger', new THREE.Group(), places.ledger); ledgerGroup.add(stand);
  // The story's one light, there from the start and only ever brightened: a
  // light added or hidden later would have every material in the Reach
  // rebuild its shader. The Hart and the keeper's lantern stand in its glow;
  // the camp's lantern stands in its fire's.
  const wellLight = new THREE.PointLight('#9fe3ff', 0, 22 * M, 1.6); wellLight.position.set(moonwell.x, moonwell.y + 2.2 * M, moonwell.z); root.add(wellLight);

  const parts = {};
  function load(file, size, measure, options = {}) {
    return loader.loadAsync(new URL(`${file}.glb`, ASSETS).href).then(gltf => {
      if (options.hide) for (const mesh of meshes(gltf.scene, options.hide)) mesh.visible = false;
      const model = fit(gltf.scene, size, measure, options.measure);
      shadows(model, options.castShadow !== false);
      const mixer = gltf.animations.length ? new THREE.AnimationMixer(gltf.scene) : null;
      if (mixer) mixers.push(mixer);
      return { model, gltf, mixer, clips: gltf.animations };
    });
  }
  const loop = (part, clip = part.clips[0]) => part.mixer.clipAction(clip).play();

  async function stream({ prepare } = {}) {
    // Every download starts at once, but the models are readied and shown one
    // at a time, in the order the story reaches them: building a model's
    // shaders and uploading its textures holds the page up, and fourteen at
    // once would hold it long enough to swallow the player's first presses.
    const place = (name, promise, then) => { promise.catch(() => {}); return { name, promise, then }; };
    const jobs = [
      place('notice', load('quest-notice-board', 2.3 * M, 'height'), ({ model }) => add('Harbour notice board', model, places.notice)),
      place('well', load('moonwell-well', 2.7 * M, 'length', { hide: m => /^(Ground|Grass_Grass|Flowers)/.test(m.name) }), ({ model }) => {
        add('Moonwell', model, moonwell);
        parts.well.mist = meshes(model, m => /^Fog/.test(m.name));
        collide('story-well', { x: moonwell.x, z: moonwell.z, r: 1.3 * M });
      }),
      place('circle', load('moonwell-stone-circle', 7.4 * M, 'length'), ({ model }) => {
        add('Moonwell stone circle', model, moonwell);
        footprints(model, .35 * M, .5 * M).forEach((pillar, i) => collide(`story-pillar-${i}`, { x: pillar.x, z: pillar.z, r: pillar.r }));
      }),
      // No shadow of her own, and a little cold light: the first clues.
      place('maren', load('moonwell-keeper', 1.62 * M, 'height', { castShadow: false }), part => {
        add('Maren', part.model, places.maren); loop(part);
        for (const material of materialsOf(part.model)) if (material.emissive) { material.emissive.set('#6f93ad'); material.emissiveIntensity = .28; }
        part.fade = fader(part.model);
      }),
      // The Hart without the islet it was modelled standing on.
      place('hart', load('moonwell-ghost-stag', 2.7 * M, 'height', { hide: m => !/^(GhostStag|ParticleBall)/.test(m.name), measure: m => /^GhostStag/.test(m.name) }), part => {
        add('The Hart of the Moonwell', part.model, places.hart); loop(part);
        shadows(part.model, false); part.fade = fader(part.model);
      }),
      place('chest', load('treasure-chest', 1.1 * M, 'length'), part => {
        add('Keeper’s chest', part.model, places.chest);
        part.open = part.mixer.clipAction(part.clips.find(c => /Open$/.test(c.name)));
        part.open.setLoop(THREE.LoopOnce); part.open.clampWhenFinished = true;
      }),
      place('lantern', load('old-lantern', .55 * M, 'height'), ({ model }) => add('Maren’s lantern', model, places.lantern)),
      place('tobin', Promise.all([load('harbour-villager', 1.78 * M, 'height'), fetch(new URL('harbour-villager-clips.json', ASSETS)).then(r => r.json())]).then(([part, clips]) => {
        // His own clip is a single frame of T-pose; these replace it.
        part.clips = clips.map(clip => THREE.AnimationClip.parse(clip));
        if (!part.mixer) { part.mixer = new THREE.AnimationMixer(part.gltf.scene); mixers.push(part.mixer); }
        return part;
      }), part => {
        add('Tobin', part.model, places.tobin);
        part.idle = part.mixer.clipAction(part.clips.find(c => c.name === 'Idle')).play();
        part.talk = part.mixer.clipAction(part.clips.find(c => c.name === 'Talk'));
      }),
      place('boat', load('harbour-rowboat', 4.6 * M, 'length'), ({ model }) => {
        add('Tobin’s rowboat', model, places.boat); model.rotation.z = .1;
        for (const step of [-1, 0, 1]) collide(`story-boat-${step}`, { x: places.boat.x, z: places.boat.z + step * 1.4 * M, r: .7 * M });
      }),
      place('campLantern', load('old-lantern', .55 * M, 'height'), ({ model }) => add('Camp lantern', model, places.campLantern)),
      place('book', load('lore-book', .52 * M, 'length'), ({ model }) => { model.position.y = .62 * M; ledgerGroup.add(model); }),
      place('tent', load('wanderers-tent', 2.5 * M, 'height'), ({ model }) => {
        add('Wanderers’ tent', model, places.tent);
        collide('story-tent', { x: places.tent.x, z: places.tent.z, r: 1.6 * M });
      }),
      // The wanderers' fire takes the place of the camp's stand-in flame; its
      // light and its crackle stay where they were.
      place('campfire', load('wanderers-campfire', 1.6 * M, 'length', { hide: m => /Ground|Grass/i.test([m.material].flat()[0].name) }), part => {
        add('Wanderers’ fire', part.model, site(fire)); loop(part);
        for (const child of activities.campfire.group.children) if (child.isMesh) child.visible = false;
      }),
      place('tidewarden', load('harbour-mythic-whale', 20 * M, 'length'), part => {
        add('The Tidewarden', part.model, { x: TIDEWARDEN.x, y: HARBOUR_LEVEL, z: TIDEWARDEN.z }); loop(part);
        shadows(part.model, false);
      }),
    ];
    let failed = 0;
    for (const { name, promise, then } of jobs) {
      try {
        const part = await promise;
        await prepare?.(part.model);
        // Known to the story only once it stands in the world.
        parts[name] = part;
        await then(part);
        // A model arriving late finds the story as it stands, unless the
        // finale is part-way through moving things itself.
        if (!tweens.length) applyState();
      } catch (error) {
        failed++; console.warn(`The story's ${name} model did not load; the story goes on without it.`, error);
      }
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    return { loaded: jobs.length - failed, failed };
  }

  // The shard model, for the game's collectibles: one geometry and material,
  // centred on its own middle and as tall as the stand-in it replaces.
  async function shard(height = .95) {
    const gltf = await loader.loadAsync(new URL('light-shard.glb', ASSETS).href);
    const [mesh] = meshes(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3()), centre = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z).scale(height / size.y, height / size.y, height / size.y);
    const material = mesh.material;
    material.emissiveIntensity = Math.max(material.emissiveIntensity, 1.4);
    return { geometry, material };
  }

  // Puts every loaded model in the state the story is in, without ceremony:
  // what a saved game, or a model arriving late, should find.
  function applyState() {
    const { maren, hart, chest, lantern, well } = parts;
    if (maren) maren.model.visible = !departed;
    if (hart) { hart.model.visible = restored; hart.fade(1); }
    if (chest) {
      chest.model.visible = departed; chest.model.scale.setScalar(1);
      if (departed) { chest.open.reset().play(); chest.mixer.update(chest.open.getClip().duration); }
    }
    if (lantern) lantern.model.visible = departed;
    if (well) for (const mist of well.mist) mist.visible = restored;
    wellLight.intensity = restored ? 22 : 0;
    if (departed) { uncollide('story-maren'); collide('story-chest', { x: places.chest.x, z: places.chest.z, r: .55 * M }); }
  }

  // The Moonwell wakes: its light climbs, and the Hart steps out of it.
  async function awaken() {
    restored = true;
    const { hart, well } = parts;
    if (well) for (const mist of well.mist) mist.visible = true;
    if (hart) { hart.model.visible = true; hart.fade(0); }
    await tween(3.2, k => {
      wellLight.intensity = 22 * ease(k) + Math.sin(k * Math.PI) * 30;
      if (hart) { hart.fade(ease(Math.min(1, k * 1.4))); hart.model.position.y = places.hart.y - .7 * M * (1 - ease(k)); }
    });
  }
  // The keeper goes home with the Hart, leaving her lantern and her chest.
  async function depart() {
    const { maren, chest, lantern } = parts;
    departed = true;
    await tween(2.6, k => {
      if (!maren) return;
      maren.fade(1 - ease(k)); maren.model.position.y = places.maren.y + ease(k) * .5 * M;
      maren.model.rotation.y = places.maren.facing + (faceToward(places.maren, places.hart) - places.maren.facing) * ease(Math.min(1, k * 2));
    });
    if (maren) maren.model.visible = false;
    uncollide('story-maren');
    collide('story-chest', { x: places.chest.x, z: places.chest.z, r: .55 * M });
    if (lantern) lantern.model.visible = true;
    if (chest) {
      chest.model.visible = true;
      await tween(.6, k => chest.model.scale.setScalar(ease(k)));
      chest.open.reset().play();
    }
  }
  function setState(state) { restored = state.restored; departed = state.restored; applyState(); }

  // Who or what the player can speak to from here, at this point in the story.
  function nearby(position, step) {
    const candidates = [
      !departed && ['maren', places.maren, step === 'restore' ? 'Give Maren the light' : 'Speak with Maren'],
      ['tobin', places.tobin, 'Speak with Tobin'],
      ['notice', places.notice, 'Read the notice board'],
      ['ledger', places.ledger, step === 'ledger' ? 'Read the keeper’s ledger' : 'Look at the book'],
    ].filter(Boolean);
    let best = null, bestDistance = Infinity;
    for (const [id, place, label] of candidates) {
      const distance = Math.hypot(position.x - place.x, position.z - place.z);
      if (distance < RANGE[id] && distance < bestDistance && Math.abs(position.y - place.y) < 3) { best = { type: 'story', person: id, label, x: place.x, y: place.y, z: place.z }; bestDistance = distance; }
    }
    return best;
  }
  // Where the step at hand is waiting, for the map and the beacon.
  function objective(step) {
    const at = { keeper: places.maren, ferryman: places.tobin, ledger: places.ledger, restore: places.maren, farewell: places.tobin }[step];
    return at ? { x: at.x, y: at.y + (at.top || 0), z: at.z } : null;
  }

  // A small gold diamond over whoever the story is waiting on.
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(.2 * M), new THREE.MeshStandardMaterial({ color: '#ffd98a', emissive: '#ffb347', emissiveIntensity: 1.4, roughness: .35 }));
  beacon.scale.y = 1.6; beacon.name = 'Story beacon'; beacon.visible = false; root.add(beacon);
  const turn = (object, target, dt, rate = 5) => { object.rotation.y += Math.atan2(Math.sin(target - object.rotation.y), Math.cos(target - object.rotation.y)) * (1 - Math.exp(-rate * dt)); };

  function update(dt, time, player, step) {
    for (const mixer of mixers) mixer.update(dt);
    for (let i = tweens.length - 1; i >= 0; i--) {
      const t = tweens[i]; t.t = Math.min(t.duration, t.t + dt); t.step(t.t / t.duration);
      if (t.t >= t.duration) { tweens.splice(i, 1); t.resolve(); }
    }
    // The keeper and the ferryman look up at whoever comes close, and the
    // ferryman talks with his hands while he is being listened to.
    for (const [name, place] of [['maren', places.maren], ['tobin', places.tobin]]) {
      const part = parts[name]; if (!part || (name === 'maren' && departed)) continue;
      const near = Math.hypot(player.x - place.x, player.z - place.z) < 5 * M;
      turn(part.model, near ? faceToward(place, player) : place.facing, dt, near ? 4 : 1.5);
    }
    const tobin = parts.tobin;
    if (tobin?.talk) {
      const wanted = talking === 'tobin' ? tobin.talk : tobin.idle, other = wanted === tobin.talk ? tobin.idle : tobin.talk;
      if (!wanted.isRunning()) { wanted.reset().play(); other.crossFadeTo(wanted, .4, false); }
    }
    if (parts.hart && restored) parts.hart.model.rotation.y = places.hart.facing + Math.sin(time * .3) * .25;
    if (restored && !tweens.length) wellLight.intensity = 22 + Math.sin(time * 1.7) * 2.5;
    // The Tidewarden circles the harbour, breaking the surface as it goes.
    // Once the well is lit it comes up into the air to look.
    const whale = parts.tidewarden?.model;
    if (whale) {
      const angle = time / TIDEWARDEN.period * Math.PI * 2;
      const lift = (restored ? 2.6 + Math.sin(time * .45) * 1.1 : Math.max(-1.2, Math.sin(time * .35) * 1.4 - .3)) * M;
      whale.position.set(TIDEWARDEN.x + Math.cos(angle) * TIDEWARDEN.radius, HARBOUR_LEVEL + lift, TIDEWARDEN.z + Math.sin(angle) * TIDEWARDEN.radius);
      whale.rotation.y = -angle;
    }
    const goal = talking ? null : objective(step);
    beacon.visible = !!goal;
    if (goal) { beacon.position.set(goal.x, goal.y + .7 * M + Math.sin(time * 2.2) * .12, goal.z); beacon.rotation.y = time * 1.4; }
  }

  return {
    root, places, stream, shard, nearby, objective, update, awaken, depart, setState,
    get talking() { return talking; }, set talking(person) { talking = person; },
    get diagnostics() {
      return {
        restored, departed, talking, loaded: Object.keys(loaded),
        places: Object.fromEntries(Object.entries(places).map(([name, p]) => [name, { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) }])),
      };
    },
    dispose() {
      for (const id of colliderIds) collision.remove(id);
      for (const mixer of mixers) mixer.stopAllAction();
      root.traverse(object => { object.geometry?.dispose(); for (const material of [object.material].flat()) material?.dispose?.(); });
      root.removeFromParent();
    },
  };
}
