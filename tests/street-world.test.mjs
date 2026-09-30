import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadStreetDistrict, STREET_ASSET, STREET_ARRIVAL } from '../street-world.js';
import { createNavigation } from '../navigation.js';
import { disposeMapResources } from '../map-resources.js';
import { LocomotionController, SpatialHash } from '../physics.js';

test('the supplied Street City has a grounded arrival, connected roads and solid storefronts', async t => {
  const bytes = await readFile(new URL(`../${STREET_ASSET}`, import.meta.url));
  // Keep the real model and texture slots; Node needs no image decoder to
  // exercise the same loader, navigation and resource ownership as the game.
  const parser = new GLTFLoader().register(() => ({ name:'test-textures', loadTexture:() => Promise.resolve(new THREE.Texture()) }));
  const gltf = await parser.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const load = t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => {
    assert.ok(url.endsWith(STREET_ASSET));
    return gltf;
  });
  const district = await loadStreetDistrict({ lowPower:true });
  t.after(() => disposeMapResources(district.root));
  assert.equal(load.mock.callCount(), 1);
  assert.equal(district.layout.getObjectByName('Cube001'), undefined, 'unplaced kit examples are omitted');
  assert.ok(district.layout.getObjectByName('Cube004'), 'placed architecture is preserved');
  assert.ok(district.meshes.every(mesh => !mesh.castShadow));
  assert.ok(district.materials.some(material => material.map), 'the supplied texture slots survive fitting');
  district.setQuality(false);
  assert.ok(district.meshes.some(mesh => mesh.castShadow));
  assert.ok(district.materials.every(material => !material.map || material.map.anisotropy === 4));
  const navigation = createNavigation([district.terrain], district.bounds, { arrival:STREET_ARRIVAL });
  const spawn = navigation.spawn;
  assert.ok(Math.hypot(spawn.x - STREET_ARRIVAL.x, spawn.z - STREET_ARRIVAL.z) < 1);
  assert.ok(spawn.y > .39 && spawn.y < .42, 'arrival is on the road, not a roof');
  assert.ok(navigation.isWalkable(spawn.x, spawn.z, 2.4), 'the arrival has room for its return portal');
  assert.ok(navigation.diagnostics.reachableCells > 4500);
  for (const point of [{ x:-412, z:-288 }, { x:-412, z:-340 }, { x:-400, z:-348 }, { x:-376, z:-364 }]) {
    assert.ok(navigation.isWalkable(point.x, point.z, .8), 'both the straight road and its bend stay open');
    const route = navigation.route(spawn, point);
    assert.ok(route?.length >= 2);
    assert.ok(route.every(leg => Number.isFinite(leg.y)));
  }
  assert.equal(navigation.isWalkable(-396, -304, .6), false, 'storefront interiors are solid');
  assert.equal(navigation.isWalkable(-400, -380, .6), false, 'empty ground outside the model is sealed');
  const collision = new SpatialHash(8);
  navigation.colliders.forEach((shape, id) => collision.insert(id, shape));
  const position = { ...spawn }, controller = new LocomotionController(position, { x:0, y:0, z:0 }, navigation, collision);
  for (let frame = 0; frame < 240; frame++) controller.update(1 / 60, { x:0, z:-1, walk:true });
  assert.ok(position.z < spawn.z - 11, 'ordinary movement progresses along the road');
  assert.ok(controller.grounded);
  assert.ok(Math.abs(position.y - navigation.getHeight(position.x, position.z)) < .01);
  for (let frame = 0; frame < 600; frame++) controller.update(1 / 60, { x:1, z:0, walk:true });
  assert.ok(position.x > spawn.x + 5 && position.x < -402, 'walking east reaches the pavement but cannot enter a building');
  assert.ok(controller.grounded);
});
