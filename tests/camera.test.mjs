import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FollowCamera } from '../camera.js';

const clear = { cameraFraction: () => 1 };
const flat = { getHeight: () => 0 };
const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);
function setup(terrain = flat, collision = clear) {
  const camera = new THREE.PerspectiveCamera(55, 1, .15, 650);
  const follow = new FollowCamera(camera, terrain, collision);
  const position = new THREE.Vector3();
  follow.reset(position, 0, .3, 12);
  follow.update(1 / 60, position, 0, .3, 12);
  return { camera, follow, position };
}
function tick(follow, position, { seconds = 3, fps = 60, yaw = 0, pitch = .3, distance = 12, options = {} } = {}) {
  for (let i = 0; i < seconds * fps; i++) follow.update(1 / fps, position, yaw, pitch, distance, options);
  return follow.getStats();
}
// Axis-aligned slab obstacle, independent of the game's physics implementation.
function obstacle(min, max) {
  return {
    cameraFraction(from, to, radius = 0) {
      let entry = 0, exit = 1;
      for (const axis of ['x', 'y', 'z']) {
        const delta = to[axis] - from[axis], low = min[axis] - radius, high = max[axis] + radius;
        if (Math.abs(delta) < 1e-9) {
          if (from[axis] < low || from[axis] > high) return 1;
        } else {
          let a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
          if (a > b) [a, b] = [b, a];
          entry = Math.max(entry, a); exit = Math.min(exit, b);
          if (entry > exit) return 1;
        }
      }
      return entry;
    },
  };
}

test('follow stays centred without accumulated shoulder drift and zoom obeys bounds', () => {
  const { follow, position } = setup();
  const start = tick(follow, position);
  const end = tick(follow, position, { seconds: 20 });
  close(end.target.x, .4);
  close(end.target.x, start.target.x);
  close(end.target.z, 0);
  const near = tick(follow, position, { distance: 0 });
  const far = tick(follow, position, { distance: 100 });
  close(near.requestedDistance, 3);
  close(far.requestedDistance, 28);
  assert.equal(far.mode, 'follow');
});

test('zoom, yaw, pitch and follow smoothing behave consistently at different frame rates', () => {
  const runs = [30, 60, 144].map(fps => {
    const { follow, position } = setup();
    return tick(follow, position, { fps, seconds: 1, yaw: 1.2, pitch: .65, distance: 21 });
  });
  for (const result of runs.slice(1)) {
    close(result.yaw, runs[0].yaw);
    close(result.pitch, runs[0].pitch);
    close(result.requestedDistance, runs[0].requestedDistance);
    assert.ok(new THREE.Vector3().copy(result.position).distanceTo(new THREE.Vector3().copy(runs[0].position)) < .04);
  }
});

test('walls retract the boom and the final smoothed position remains on the safe side', () => {
  const wall = obstacle({ x: -30, y: -5, z: 4 }, { x: 30, y: 30, z: 5 });
  const { follow, position, camera } = setup(flat, wall);
  let stats = tick(follow, position);
  assert.equal(stats.colliding, true);
  assert.ok(camera.position.z < 4 - follow.radius);
  for (let i = 0; i < 180; i++) {
    position.x += .08;
    stats = follow.update(1 / 60, position, Math.sin(i / 30) * 1.4, .1, 24);
    assert.equal(wall.cameraFraction(follow.anchor, camera.position, follow.radius), 1);
    assert.ok(camera.position.y >= follow.floorHeight(camera.position.x, camera.position.z));
  }
});

test('terrain between a clear endpoint and the hero still blocks the camera boom', () => {
  const terrain = { getHeight: (x, z) => z > 3 && z < 6 ? 7 : 0 };
  const { follow, position, camera } = setup(terrain);
  const stats = tick(follow, position, { pitch: .1, distance: 16 });
  assert.equal(stats.colliding, true);
  assert.ok(camera.position.z < 3);
  assert.ok(camera.position.y >= follow.floorHeight(camera.position.x, camera.position.z));
});

test('looking up preserves a sky-facing lens while keeping the camera above ground', () => {
  const { follow, position, camera } = setup();
  tick(follow, position, { pitch: -1.2 });
  const direction = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(direction.y > .8);
  assert.ok(camera.position.y >= .42);
});

test('lock-on frames both combatants, follows its target, and releases invalid targets', () => {
  const { follow, position } = setup();
  const enemy = { id: 'enemy', alive: true, group: { visible: true, position: new THREE.Vector3(10, 0, 0) } };
  const options = { mode: 'combat', lockTarget: enemy };
  let stats = tick(follow, position, { options });
  assert.equal(stats.locked, true);
  assert.equal(stats.mode, 'combat');
  assert.equal(stats.targetId, 'enemy');
  close(stats.yaw, -Math.PI / 2);
  assert.ok(stats.target.x > 3 && stats.target.x < 7);
  enemy.group.position.set(0, 0, -15);
  stats = tick(follow, position, { options });
  close(stats.yaw, 0);
  for (const invalidate of [() => { enemy.alive = false; }, () => { enemy.group.position.x = 90; }, () => { enemy.group.position.x = NaN; }]) {
    invalidate();
    stats = follow.update(1 / 60, position, 0, .3, 12, options);
    assert.equal(stats.mode, 'follow');
    assert.equal(stats.locked, false);
    assert.equal(stats.targetId, null);
    enemy.alive = true;
  }
});

test('aim, cinematic and mount have distinct framing and transition back to the chosen view', () => {
  const { follow, position } = setup();
  const aim = tick(follow, position, { options: { mode: 'aim' } });
  assert.equal(aim.mode, 'aim');
  close(aim.fov, 43, .001);
  close(aim.requestedDistance, 4.8);
  close(aim.target.x, .95);
  const mount = tick(follow, position, { options: { mode: 'mount', speed: 12 } });
  assert.equal(mount.mode, 'mount');
  assert.ok(mount.target.y > 3);
  assert.ok(mount.fov > 67);
  assert.ok(mount.distance > 15);
  const cinematic = tick(follow, position, { options: { mode: 'cinematic' } });
  assert.equal(cinematic.mode, 'cinematic');
  assert.ok(cinematic.yaw > .2);
  close(cinematic.fov, 48, .001);
  const restored = tick(follow, position, { distance: 8.5, pitch: .6, options: { height: 2.25, shoulder: .8, fov: 70 } });
  assert.equal(restored.mode, 'follow');
  close(restored.fov, 70, .001);
  close(restored.requestedDistance, 8.5);
  close(restored.target.y, 2.25);
  close(restored.target.x, .8);
});

test('reset and invalid updates do not retain locks or corrupt the camera', () => {
  const { follow, position, camera } = setup();
  tick(follow, position, { options: { lockTarget: new THREE.Vector3(4, 0, 0) } });
  follow.reset(new THREE.Vector3(100, 0, 100), 1, .4, 10);
  assert.equal(follow.getStats().locked, false);
  follow.update(1 / 60, new THREE.Vector3(100, 0, 100), 1, .4, 10);
  const previous = camera.position.clone();
  follow.update(NaN, position, NaN, Infinity, NaN);
  assert.ok(camera.position.equals(previous));
  follow.update(1 / 60, { x: NaN, y: 0, z: 0 }, 0, 0, 12);
  assert.ok(camera.position.equals(previous));
});
