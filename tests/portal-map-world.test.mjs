import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPortalWorld } from '../portal-map-world.js';
import { disposeMapResources } from '../map-resources.js';

function makeDistrict(map) {
  const [x, z, size, y] = map === 'city' ? [20, -20, 240, .45] : map === 'forest' ? [-115, 8, 60, 2] : map === 'mesa' ? [0, 180, 240, 5] : map === 'street' ? [-400, -320, 160, 3] : [175, 175, 100, 1];
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial());
  mesh.name = 'ground'; mesh.position.set(x, y, z); root.add(mesh);
  const disposed = { geometry: 0, material: 0 };
  mesh.geometry.addEventListener('dispose', () => disposed.geometry++);
  mesh.material.addEventListener('dispose', () => disposed.material++);
  return {
    root, meshes: [mesh], materials: [mesh.material], lanterns: [], asset: `${map}.glb`, disposed,
    bounds: { minX: x - size / 2, maxX: x + size / 2, minZ: z - size / 2, maxZ: z + size / 2 },
    terrain: { layout: root, ground: /ground/, walkable: Infinity },
    setQuality() {}, setTime() {},
  };
}
function fixture() {
  const calls = [], records = [], scene = new THREE.Scene();
  const loaders = Object.fromEntries(['city', 'mesa', 'forest', 'yard', 'street'].map(map => [map, async () => {
    calls.push(map); const district = makeDistrict(map); records.push(district); return district;
  }]));
  return { calls, records, loaders, scene };
}

test('Street City loads on demand, replaces collision terrain and releases resources on return', async () => {
  const f = fixture();
  const world = await createPortalWorld(f.scene, { loaders: f.loaders });
  assert.deepEqual(f.calls, ['city']);
  const arrival = await world.travelTo('street');
  assert.equal(world.activeMap, 'street');
  assert.equal(world.diagnostics.streetReachable, true);
  assert.deepEqual(world.diagnostics.assets, ['street.glb']);
  assert.equal(world.biomeAt(arrival.x, arrival.z), 'street');
  assert.equal(world.isWalkable(arrival.x, arrival.z, 1), true);
  assert.ok(Math.abs(world.getHeight(arrival.x, arrival.z) - 3) < 1e-6);
  assert.deepEqual(world.diagnostics.residentMaps, ['street']);
  assert.equal(f.records[0].disposed.geometry, 1);
  await world.travelTo('city');
  assert.equal(world.diagnostics.streetReachable, false);
  assert.deepEqual(f.calls, ['city', 'street', 'city']);
  assert.equal(f.records[1].disposed.geometry, 1);
  assert.equal(f.records[1].disposed.material, 1);
  world.dispose();
});

test('only the city loads initially; a prepared crossing replaces terrain and every navigation delegate', async () => {
  const f = fixture();
  const world = await createPortalWorld(f.scene, { loaders: f.loaders, lowPower: true });
  assert.deepEqual(f.calls, ['city']);
  assert.deepEqual(world.diagnostics.residentMaps, ['city']);
  assert.equal(world.portalTravel, true);
  const getHeight = world.getHeight, findWalkable = world.findWalkable, sourceColliders = world.colliders;
  const persistentProp = new THREE.Mesh(new THREE.BoxGeometry()); world.streaming.add(persistentProp);
  let finishPrepare, beganPrepare;
  const ready = new Promise(resolve => { beganPrepare = resolve; });
  const gate = new Promise(resolve => { finishPrepare = resolve; });
  const crossing = world.travelTo('forest', { prepare: async candidate => {
    assert.equal(candidate.parent, null);
    assert.equal(world.activeMap, 'city');
    assert.equal(f.records[0].disposed.geometry, 0);
    beganPrepare(); await gate;
  } });
  await ready;
  assert.deepEqual(world.diagnostics.residentMaps, ['city', 'forest']);
  assert.equal(world.diagnostics.loadingMap, 'forest');
  await assert.rejects(world.travelTo('yard'), /already in progress/);
  finishPrepare();
  const spawn = await crossing;
  assert.equal(world.activeMap, 'forest');
  assert.deepEqual(world.diagnostics.residentMaps, ['forest']);
  assert.equal(world.diagnostics.loadingMap, null);
  assert.equal(f.records[0].disposed.geometry, 1);
  assert.equal(f.records[0].disposed.material, 1);
  assert.equal(f.records[0].root.parent, null);
  assert.equal(world.root.children.length, 1);
  assert.equal(world.streaming.diagnostics.items, 2, 'only current terrain and persistent props stay registered');
  assert.notEqual(world.colliders, sourceColliders);
  assert.equal(world.isWalkable(spawn.x, spawn.z, .8), true);
  assert.equal(getHeight(spawn.x, spawn.z), 2);
  assert.equal(findWalkable(-110, 5).y, 2);
  assert.equal(world.getSupportHeight(spawn.x, spawn.z, 2), 2);
  assert.equal(world.getNormal(spawn.x, spawn.z, new THREE.Vector3()).y, 1);
  assert.ok(Math.abs(world.landmarks.find(p => p.id === 'camp').y - .45) < .0001);
  assert.equal(world.shardPositions.length, 48);
  assert.ok(world.shardPositions.slice(20).every(p => p === null));
  await world.travelTo('yard');
  assert.equal(f.records[1].disposed.geometry, 1);
  assert.equal(world.diagnostics.assets[0], 'yard.glb');
  await world.travelTo('city');
  assert.deepEqual(f.calls, ['city', 'forest', 'yard', 'city'], 'returning creates a fresh district instead of retaining a cache');
  world.dispose();
  assert.deepEqual(world.diagnostics.residentMaps, []);
  assert.equal(world.streaming.diagnostics.items, 0);
  assert.equal(f.scene.children.length, 0);
});

test('failed download or preparation preserves the source and disposes an unsuccessful candidate', async () => {
  const f = fixture(), world = await createPortalWorld(f.scene, { loaders: f.loaders, lowPower: true });
  const source = world.root.children[0], colliders = world.colliders;
  await assert.rejects(world.travelTo('forest', { prepare: async () => { throw new Error('GPU preparation failed'); } }), /GPU preparation failed/);
  assert.equal(world.root.children[0], source);
  assert.equal(world.colliders, colliders);
  assert.deepEqual(world.diagnostics.residentMaps, ['city']);
  assert.equal(f.records[0].disposed.geometry, 0);
  assert.equal(f.records[1].disposed.geometry, 1);
  assert.equal(world.streaming.diagnostics.items, 1);
  f.loaders.yard = async () => { throw new Error('Download failed'); };
  await assert.rejects(world.travelTo('yard'), /Download failed/);
  assert.equal(world.activeMap, 'city');
  assert.equal(world.diagnostics.loadingMap, null);
  await assert.rejects(world.travelTo('missing'), /Unknown portal destination/);
  await world.travelTo('forest');
  assert.equal(world.activeMap, 'forest', 'a failed crossing can be retried');
  world.dispose();
});

test('disposal during preparation releases the late destination instead of attaching it', async () => {
  const f = fixture(), world = await createPortalWorld(f.scene, { loaders: f.loaders, lowPower: true });
  const crossing = world.travelTo('forest', { prepare() { world.dispose(); } });
  await assert.rejects(crossing, /disposed while crossing/);
  assert.deepEqual(f.records.map(record => record.disposed.geometry), [1, 1]);
  assert.equal(f.scene.children.length, 0);
  assert.deepEqual(world.diagnostics.residentMaps, []);
});

test('map disposal frees shared GPU resources once and closes each decoded image', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry();
  let geometries = 0, materials = 0, textures = 0, images = 0;
  const bitmap = { close() { images++; } }, texture = new THREE.Texture(bitmap), otherTexture = new THREE.Texture(bitmap);
  const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: otherTexture });
  geometry.addEventListener('dispose', () => geometries++);
  material.addEventListener('dispose', () => materials++);
  texture.addEventListener('dispose', () => textures++); otherTexture.addEventListener('dispose', () => textures++);
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  disposeMapResources(root);
  assert.deepEqual({ geometries, materials, textures, images }, { geometries: 1, materials: 1, textures: 2, images: 1 });
  assert.equal(texture.source.data, null);
  assert.equal(root.children.length, 0);
});


test('Red Mesa stays unloaded until crossing and releases geometry, textures and navigation on return', async () => {
  const f = fixture(), world = await createPortalWorld(f.scene, { loaders: f.loaders });
  assert.deepEqual(f.calls, ['city']);
  assert.deepEqual(world.diagnostics.assets, ['city.glb']);
  assert.equal(world.diagnostics.mesaReachable, false);
  const shrine = world.landmarks.find(place => place.id === 'shrine');
  assert.equal(shrine.map, 'mesa');
  assert.equal(world.root.getObjectByName('Moonwell Sanctuary'), undefined);
  const arrival = await world.travelTo('mesa');
  assert.deepEqual(f.calls, ['city', 'mesa']);
  assert.equal(world.diagnostics.mesaReachable, true);
  assert.deepEqual(world.diagnostics.residentMaps, ['mesa']);
  assert.deepEqual(world.diagnostics.assets, ['mesa.glb']);
  assert.equal(world.biomeAt(arrival.x, arrival.z), 'mesa');
  assert.equal(world.isWalkable(arrival.x, arrival.z, 1), true);
  assert.ok(Math.abs(world.getHeight(arrival.x, arrival.z) - 5) < 1e-6);
  assert.equal(world.landmarks.find(place => place.id === 'shrine'), shrine);
  assert.ok(Math.abs(shrine.y - 5) < 1e-6);
  assert.ok(world.root.getObjectByName('Moonwell Sanctuary'));
  let textures = 0, images = 0;
  const texture = new THREE.Texture({ close() { images++; } });
  texture.addEventListener('dispose', () => textures++);
  f.records[1].materials[0].map = texture;
  const mesaColliders = world.colliders;
  await world.travelTo('city');
  assert.deepEqual(f.calls, ['city', 'mesa', 'city']);
  assert.deepEqual(world.diagnostics.residentMaps, ['city']);
  assert.equal(world.diagnostics.mesaReachable, false);
  assert.notEqual(world.colliders, mesaColliders);
  assert.equal(world.root.getObjectByName('Moonwell Sanctuary'), undefined);
  assert.deepEqual(f.records[1].disposed, { geometry: 1, material: 1 });
  assert.deepEqual({ textures, images }, { textures: 1, images: 1 });
  assert.equal(world.streaming.diagnostics.items, 1);
  await world.travelTo('mesa');
  assert.deepEqual(f.calls, ['city', 'mesa', 'city', 'mesa']);
  world.dispose();
});
