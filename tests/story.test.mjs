import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStory } from '../story.js';
import { STEPS, PEOPLE, CONVERSATIONS, CAMP_DIRECTIONS, storyStep, stepId, readStory, conversation, whisper, WHISPERS } from '../story-script.js';

const progress = (changes = {}) => ({ collected: new Set(), kills: 0, restored: false, story: readStory({}), ...changes });

test('the story walks its steps in order, one flag at a time', () => {
  const p = progress();
  assert.equal(stepId(p), 'notice');
  p.story.notice = true; assert.equal(stepId(p), 'keeper');
  p.story.keeper = true; assert.equal(stepId(p), 'shards');
  for (let i = 0; i < 5; i++) p.collected.add(i);
  assert.equal(stepId(p), 'ferryman');
  p.story.ferryman = true; assert.equal(stepId(p), 'wisps');
  p.kills = 3; assert.equal(stepId(p), 'ledger');
  p.story.ledger = true; assert.equal(stepId(p), 'restore');
  p.restored = true; assert.equal(stepId(p), 'farewell');
  p.story.farewell = true; assert.equal(stepId(p), 'complete');
  assert.equal(storyStep(p), STEPS.length - 1);
});

test('shards and wisps won early count when their step comes round', () => {
  const p = progress({ kills: 7, collected: new Set([0, 1, 2, 3, 4, 5]) });
  assert.equal(stepId(p), 'notice');
  p.story.notice = true; assert.equal(stepId(p), 'keeper');
  p.story.keeper = true; assert.equal(stepId(p), 'ferryman');
  p.story.ferryman = true; assert.equal(stepId(p), 'ledger');
});

test('the notice board comes first, but the keeper met first counts for it', () => {
  const p = progress();
  p.story.keeper = true; assert.equal(stepId(p), 'shards');
  // Found before the board, she says what she says at the start.
  assert.deepEqual(conversation('maren', 'notice'), conversation('maren', 'keeper'));
  // Read first, the board ends on the light it sets free; read after, it is only a memorial.
  const first = conversation('notice', 'notice').lines, later = conversation('notice', 'shards').lines;
  assert.equal(first.length, later.length + 1);
  assert.match(first.at(-1)[1], /light/);
  assert.deepEqual(first.slice(0, -1), later);
  for (const entry of [conversation('notice', 'notice'), conversation('notice', 'shards')]) assert.equal(entry.sets, 'notice');
});

test('a save from before the story keeps the ending it already earned', () => {
  assert.deepEqual(Object.values(readStory({ restored: true })), [true, true, true, true, true]);
  assert.equal(stepId(progress({ restored: true, story: readStory({ restored: true }) })), 'complete');
  // A save made mid-story is read as it is, and nothing but true counts.
  assert.deepEqual(readStory({ restored: false, story: { keeper: true, ferryman: 'yes', unknown: true } }), { keeper: true, ferryman: false, ledger: false, farewell: false, notice: false });
});

test('whoever the player can reach has something to say at every step', () => {
  for (const step of STEPS) {
    for (const person of ['tobin', 'notice', 'ledger']) assert.ok(conversation(person, step.id)?.lines.length, `${person} at ${step.id}`);
    // Maren is gone once the well is lit.
    if (!['farewell', 'complete'].includes(step.id)) assert.ok(conversation('maren', step.id)?.lines.length, `maren at ${step.id}`);
  }
});

test('conversations only name real speakers and set real flags', () => {
  const flags = new Set([...Object.keys(readStory({})), 'restored']);
  for (const [person, table] of Object.entries(CONVERSATIONS)) {
    assert.ok(PEOPLE[person], person);
    for (const [step, entry] of Object.entries(table)) {
      if (entry.sets) assert.ok(flags.has(entry.sets), `${person}/${step} sets ${entry.sets}`);
      for (const [who, text] of entry.lines) {
        assert.ok(who === null || who === 'you' || PEOPLE[who], `${person}/${step}: ${who}`);
        assert.ok(text.length > 0 && text.length < 260, `${person}/${step}: a line fits the panel`);
      }
    }
  }
  // Each step that waits on a conversation has one that ends it.
  const sets = Object.values(CONVERSATIONS).flatMap(table => Object.values(table).map(entry => entry.sets));
  for (const flag of ['keeper', 'ferryman', 'ledger', 'restored', 'farewell']) assert.ok(sets.includes(flag), flag);
});

test('Tobin sends the player to the camp wherever it stands, and no line is left with a blank', () => {
  const directions = (camp, step) => conversation('tobin', step, { camp }).lines.map(([, text]) => text).join(' ');
  for (const step of ['ferryman', 'ledger']) {
    assert.match(directions('city', step), /west of the square/);
    assert.match(directions('mesa', step), /Red Mesa/);
    assert.doesNotMatch(directions('mesa', step), /west of the square/);
    // A district with no directions of its own, such as the plaza, falls back on the city's.
    assert.match(directions('plaza', step), /west of the square/);
  }
  for (const camp of Object.keys(CAMP_DIRECTIONS)) for (const person of Object.keys(CONVERSATIONS)) for (const step of [...STEPS.map(s => s.id), 'finale']) {
    for (const [, text] of conversation(person, step, { camp })?.lines ?? []) assert.doesNotMatch(text, /\{camp\}/, `${person} at ${step}`);
  }
});

test('the first three wisps whisper in order, and any after at random', () => {
  assert.deepEqual([1, 2, 3].map(kills => whisper(kills)), WHISPERS.slice(0, 3));
  assert.equal(whisper(4, () => 0), WHISPERS[3]);
  assert.equal(whisper(9, () => .999), WHISPERS.at(-1));
});

test('only the keeper and restoration send chapter one through the Red Mesa portal', () => {
  assert.deepEqual(STEPS.filter(step => step.map === 'mesa').map(step => step.id), ['keeper', 'restore']);
  for (const step of STEPS) assert.ok(['city', 'mesa'].includes(step.map), step.id);
  assert.match(STEPS.find(step => step.id === 'keeper').description, /city portal/);
  assert.match(STEPS.find(step => step.id === 'restore').description, /city portal/);
  assert.doesNotMatch(CAMP_DIRECTIONS.mesa, /jetty/);
});

test('portal story loads only the current map and preserves city coordinates across a mesa visit', async t => {
  const downloads = [], colliders = new Map(), registrations = new Set(), heightQueries = [];
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => {
    downloads.push(new URL(url).pathname.split('/').at(-1));
    const scene = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    mesh.name = 'GhostStag'; scene.add(mesh);
    return { scene, animations: ['Idle', 'Talk', 'Chest_Open'].map(name => new THREE.AnimationClip(name, 1, [])) };
  });
  t.mock.method(globalThis, 'fetch', async () => ({ json: async () => ['Idle', 'Talk'].map(name => THREE.AnimationClip.toJSON(new THREE.AnimationClip(name, 1, []))) }));
  const world = {
    portalTravel: true, activeMap: 'city', spawn: { x: 0, y: 2, z: 18 },
    landmarks: [{ id: 'shrine', x: 90, y: 0, z: 140, approach: { x: -5, z: 125 } }],
    getHeight(x, z) { heightQueries.push({ x, z }); return this.activeMap === 'city' ? 2 : 5; },
    streaming: { add: object => registrations.add(object), remove: object => registrations.delete(object) },
  };
  const fire = new THREE.Group(); fire.position.set(-45, 2, 25);
  const activities = {
    campfire: { group: fire }, stations: [],
    reserve(id, x, z) {
      assert.equal(world.activeMap, 'city', 'mesa never reserves an off-map city site');
      this.stations.push({ id, x, z }); return { x: x + 1, y: 2, z: z + 1 };
    },
  };
  const collision = { insert: (id, shape) => colliders.set(id, shape), remove: id => colliders.delete(id) };
  const city = createStory({ world, activities, collision });
  const cityMetadata = structuredClone(city.places);
  const streaming = city.stream();
  assert.equal(city.stream(), streaming, 'repeated startup calls share the same downloads');
  assert.deepEqual(await streaming, { loaded: 8, failed: 0 });
  assert.deepEqual(downloads.sort(), [
    'quest-notice-board.glb', 'harbour-villager.glb', 'harbour-rowboat.glb', 'old-lantern.glb',
    'lore-book.glb', 'wanderers-tent.glb', 'wanderers-campfire.glb', 'harbour-mythic-whale.glb',
  ].sort());
  assert.equal(city.nearby(city.places.maren, 'keeper'), null);
  assert.equal(city.objective('keeper'), null);
  assert.equal(city.nearby(city.places.tobin, 'ferryman')?.person, 'tobin');
  assert.ok(city.objective('ferryman'));
  city.setState({ restored: true });
  assert.equal(colliders.has('story-chest'), false, 'a restored save creates no mesa colliders in the city');
  assert.equal(city.root.children.some(child => child.isPointLight), false);
  city.dispose();
  assert.equal(colliders.size, 0); assert.equal(registrations.size, 0); assert.equal(activities.stations.length, 0);

  world.activeMap = 'mesa'; world.spawn = { x: -5, y: 5, z: 125 }; world.landmarks[0].y = 5;
  downloads.length = 0; heightQueries.length = 0;
  const mesa = createStory({ world, activities, collision });
  for (const name of ['tent', 'ledger', 'notice', 'tobin', 'boat', 'campLantern']) assert.deepEqual(mesa.places[name], cityMetadata[name], name);
  assert.ok(heightQueries.every(point => point.x > 70 && point.z > 120), 'mesa only samples its own sanctuary terrain');
  assert.equal(activities.stations.length, 0);
  assert.equal(mesa.nearby(mesa.places.tobin, 'ferryman'), null);
  assert.equal(mesa.objective('ferryman'), null);
  assert.equal(mesa.nearby(mesa.places.maren, 'keeper')?.person, 'maren');
  assert.ok(mesa.objective('keeper'));
  assert.deepEqual(await mesa.stream(), { loaded: 6, failed: 0 });
  assert.deepEqual(downloads.sort(), [
    'moonwell-well.glb', 'moonwell-stone-circle.glb', 'moonwell-keeper.glb',
    'moonwell-ghost-stag.glb', 'treasure-chest.glb', 'old-lantern.glb',
  ].sort());
  assert.equal(colliders.has('story-tobin'), false);
  mesa.setState({ restored: true });
  assert.equal(colliders.has('story-chest'), true);
  assert.equal(colliders.has('story-maren'), false);
  mesa.dispose();
  assert.equal(colliders.size, 0); assert.equal(registrations.size, 0); assert.equal(mesa.root.children.length, 0);
});
