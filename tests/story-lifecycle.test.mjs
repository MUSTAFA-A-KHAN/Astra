import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStory } from '../story.js';

function fixture() {
  const registrations = new Set(), colliders = new Map();
  const fire = new THREE.Group();
  const visible = new THREE.Mesh(), hidden = new THREE.Mesh(); hidden.visible = false;
  fire.add(visible, hidden);
  const activities = {
    campfire: { group: fire }, stations: [{ id: 'arrival', x: 0, z: 0 }],
    reserve(id, x, z) { this.stations.push({ id, x, z }); return { x, y: 0, z }; },
  };
  const world = {
    spawn: { x: 0, z: 0 }, landmarks: [{ id: 'shrine', x: 10, z: 20 }], getHeight: () => 0,
    streaming: { add: object => registrations.add(object), remove: object => registrations.delete(object) },
  };
  const collision = { insert: (id, shape) => colliders.set(id, shape), remove: id => colliders.delete(id) };
  const story = createStory({ world, activities, collision });
  new THREE.Group().add(story.root);
  return { story, world, activities, collision, registrations, colliders, visible, hidden };
}

function model() {
  const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(1, 2, 1);
  const freed = { geometry: 0, material: 0, texture: 0, image: 0, skeleton: 0 };
  const texture = new THREE.Texture({ close() { freed.image++; } });
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'GhostStag'; scene.add(mesh);
  mesh.skeleton = { dispose() { freed.skeleton++; } };
  for (const [name, resource] of Object.entries({ geometry, material, texture })) resource.addEventListener('dispose', () => freed[name]++);
  const animations = ['Idle', 'Talk', 'Chest_Open'].map(name => new THREE.AnimationClip(name, 1, []));
  return { scene, animations, freed, geometry, material, texture };
}

function mockAssets(t, handler) {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', handler);
  t.mock.method(globalThis, 'fetch', async () => ({ json: async () => ['Idle', 'Talk'].map(name => THREE.AnimationClip.toJSON(new THREE.AnimationClip(name, 1, []))) }));
}

test('story disposal is idempotent, releases reservations, and settles pending finale tweens', async () => {
  const f = fixture();
  const awaken = f.story.awaken(), depart = f.story.depart();
  f.story.dispose(); f.story.dispose();
  await Promise.all([awaken, depart]);
  f.story.update(1, 2, new THREE.Vector3(), 'farewell');
  f.story.setState({ restored: true });
  assert.equal(f.colliders.size, 0, 'cancelled departure never recreates the chest collider');
  assert.equal(f.registrations.size, 0);
  assert.equal(f.story.root.parent, null);
  assert.equal(f.story.root.children.length, 0);
  assert.equal(f.story.nearby(new THREE.Vector3(), 'keeper'), null);
  assert.equal(f.story.objective('farewell'), null);
  assert.deepEqual(f.activities.stations.map(station => station.id), ['arrival']);
  const next = createStory(f);
  assert.deepEqual(next.places, f.story.places, 'returning to the city uses the same story locations');
  next.dispose();
});

test('models arriving after disposal release every resource without preparing or attaching', async t => {
  const arrivals = [], models = [];
  mockAssets(t, () => new Promise(resolve => arrivals.push(resolve)));
  const f = fixture();
  let prepared = 0;
  const streamed = f.story.stream({ prepare: async () => { prepared++; } });
  assert.equal(arrivals.length, 14);
  f.story.dispose();
  for (const resolve of arrivals) { const asset = model(); models.push(asset); resolve(asset); }
  assert.deepEqual(await streamed, { loaded: 0, failed: 0 });
  assert.equal(prepared, 0);
  for (const asset of models) assert.deepEqual(asset.freed, { geometry: 1, material: 1, texture: 1, image: 1, skeleton: 1 });
  assert.equal(f.colliders.size, 0);
  assert.equal(f.registrations.size, 0);
  assert.equal(f.story.root.children.length, 0);
  assert.deepEqual(await f.story.stream(), { loaded: 0, failed: 0 });
  assert.equal(arrivals.length, 14, 'a disposed story starts no further downloads');
});

test('disposal during shader preparation drops prepared and queued models before they attach', async t => {
  const models = [];
  mockAssets(t, async () => { const asset = model(); models.push(asset); return asset; });
  const f = fixture();
  let release, started;
  const preparing = new Promise(resolve => { started = resolve; });
  const streamed = f.story.stream({ prepare: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  await preparing;
  f.story.dispose(); release();
  assert.deepEqual(await streamed, { loaded: 0, failed: 0 });
  for (const asset of models) assert.deepEqual(asset.freed, { geometry: 1, material: 1, texture: 1, image: 1, skeleton: 1 });
  assert.deepEqual(f.story.diagnostics.loaded, []);
  assert.equal(f.colliders.size, 0);
  assert.equal(f.registrations.size, 0);
  assert.equal(f.story.root.children.length, 0);
});

test('streamed story cleanup restores the campfire and preserves shard resources owned by the game', async t => {
  const models = [];
  mockAssets(t, async () => { const asset = model(); models.push(asset); return asset; });
  const f = fixture();
  assert.deepEqual(await f.story.stream(), { loaded: 14, failed: 0 });
  assert.equal(f.visible.visible, false);
  assert.equal(f.hidden.visible, false);
  const shard = await f.story.shard(), shardAsset = models.at(-1);
  f.story.dispose();
  assert.equal(f.visible.visible, true);
  assert.equal(f.hidden.visible, false, 'a placeholder already hidden stays hidden');
  for (const asset of models.slice(0, -1)) {
    assert.equal(asset.freed.geometry, 1);
    assert.equal(asset.freed.texture, 1);
    assert.equal(asset.freed.image, 1);
    assert.equal(asset.freed.skeleton, 1);
  }
  assert.equal(shardAsset.freed.material, 0);
  assert.equal(shardAsset.freed.texture, 0);
  assert.equal(shardAsset.freed.image, 0);
  assert.equal(shard.material, shardAsset.material);
  assert.equal(f.registrations.size, 0);
  assert.equal(f.colliders.size, 0);
  shard.geometry.dispose(); shard.material.dispose(); shardAsset.texture.dispose();
});
