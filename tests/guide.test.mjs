import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGuide } from '../guide.js';

// A walk in the shape of an L: forty units east, then forty north. The
// navigator always starts it from wherever it is asked.
const corner = [{ x: 40, z: 0 }, { x: 40, z: -40 }];
const dt = 1 / 30;

function setup({ route = from => [{ x: from.x, z: from.z }, ...corner], onArrive } = {}) {
  const asked = [];
  const guide = createGuide({ route: (from, to) => { asked.push({ from: { ...from }, to: { ...to } }); return route?.(from, to); }, heightAt: () => 0, texture: null, onArrive });
  guide.lead({ x: 40, y: 2, z: -40 }, { x: 0, y: 3, z: 0 });
  return { guide, asked, player: new THREE.Vector3(0, 0, 0) };
}
function wait(guide, player, seconds, each = () => {}) { for (let t = 0; t < seconds; t += dt) { guide.update(dt, t, player); each(guide); } }
// Walks the follower to a point at running pace, a frame at a time, calling
// `each` with the guide after every one.
function walk(guide, player, to, each = () => {}, speed = 4.7) {
  for (let frames = 0; frames < 2000; frames++) {
    const dx = to.x - player.x, dz = to.z - player.z, d = Math.hypot(dx, dz);
    if (d < .01) return;
    const step = Math.min(d, speed * dt); player.x += dx / d * step; player.z += dz / d * step;
    guide.update(dt, frames * dt, player); each(guide);
  }
}
// How far along the L a point on it stands.
const alongL = p => p.z === 0 || p.x < 40 ? p.x : 40 - p.z;

test('it waits a moment at the follower’s shoulder, then keeps a few strides ahead along the way', () => {
  const { guide, player } = setup();
  wait(guide, player, 1);
  assert.equal(guide.state, 'leading');
  const shoulder = guide.position;
  assert.ok(Math.hypot(shoulder.x - player.x, shoulder.z - player.z) < 2.5, 'at the shoulder while it holds');
  assert.ok(shoulder.y > 2, 'above the follower’s head');
  wait(guide, player, 2);
  let worst = 0;
  walk(guide, player, { x: 40, z: 0 }, g => {
    const lead = g.diagnostics.along - alongL(player);
    assert.ok(lead > 0, 'always ahead');
    worst = Math.max(worst, lead);
  });
  assert.ok(worst <= 9.1, `never more than its lead ahead: ${worst}`);
  // Round the corner, it follows the way rather than cutting across it.
  walk(guide, player, { x: 40, z: -10 });
  wait(guide, player, 1);
  assert.ok(Math.abs(guide.position.x - 40) < 1.5 && guide.position.z < -10, JSON.stringify(guide.position));
});

test('left behind, it stops and calls instead of running on, and never doubles back along the way', () => {
  const { guide, player } = setup();
  wait(guide, player, 6);
  const { along } = guide.diagnostics;
  assert.ok(along <= 9.1, `no further than its lead from a follower standing still: ${along}`);
  // Walking back the way they came, the follower is not led back with them.
  walk(guide, player, { x: -12, z: 0 });
  wait(guide, player, 2);
  assert.equal(guide.diagnostics.along, along);
  // Circling where it waits, it stays on the spot it stopped at.
  const here = guide.position;
  assert.ok(Math.hypot(here.x - along, here.z) < 2.5, JSON.stringify(here));
});

test('a follower who wanders off the way is given a new one from where they stand', () => {
  const { guide, player, asked } = setup();
  wait(guide, player, 2);
  player.set(10, 0, 30);
  wait(guide, player, 3);
  assert.equal(asked.length, 2);
  assert.deepEqual({ x: Math.round(asked[1].from.x), z: Math.round(asked[1].from.z) }, { x: 10, z: 30 });
  assert.deepEqual(asked[1].to, { x: 40, y: 2, z: -40 });
  assert.ok(guide.diagnostics.total > 80, 'the new way starts where they are');
  // Then it comes to them, rather than waiting on the old way.
  assert.ok(Math.hypot(guide.position.x - player.x, guide.position.z - player.z) < 14);
});

test('at the end of the way it goes into its goal once, and goes out', () => {
  let arrived = 0;
  const { guide, player } = setup({ onArrive: () => arrived++ });
  wait(guide, player, 2);
  const states = new Set();
  walk(guide, player, { x: 40, z: 0 }, g => states.add(g.state));
  walk(guide, player, { x: 40, z: -34 }, g => states.add(g.state));
  wait(guide, player, 3, g => states.add(g.state));
  assert.deepEqual([...states], ['leading', 'arriving', 'done']);
  assert.equal(arrived, 1);
  assert.equal(guide.position, null, 'it has gone out');
  assert.equal(guide.root.visible, false);
});

test('released, it fades away and is gone', () => {
  const { guide, player } = setup();
  wait(guide, player, 1);
  guide.release(); wait(guide, player, 2);
  assert.equal(guide.state, 'idle');
  assert.equal(guide.position, null);
  assert.equal(guide.root.visible, false);
  guide.release(); wait(guide, player, .5);
  assert.equal(guide.state, 'idle', 'releasing twice changes nothing');
});

test('with no navigator, or no way found, it goes straight for its goal', () => {
  for (const route of [() => undefined, () => null, () => [{ x: 0, z: 0 }]]) {
    const { guide, player } = setup({ route });
    wait(guide, player, 1);
    assert.equal(guide.diagnostics.legs, 1);
    assert.equal(Math.round(guide.diagnostics.total), Math.round(Math.hypot(40, 40)));
  }
});
