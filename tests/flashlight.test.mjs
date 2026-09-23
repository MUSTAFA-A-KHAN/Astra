import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFlashlight, flashlightPower } from '../flashlight.js';
import { createHero } from '../characters.js';

// A hero holding the flashlight at its chest, facing +Z like every hero's group.
function carrier(position = new THREE.Vector3()) {
  const group = new THREE.Group(); group.position.copy(position);
  const hand = new THREE.Group(); hand.position.set(.5, 2, .3); group.add(hand);
  return { group, height: 3.4, flashlightMount: { kind: 'hand', parent: hand, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1 } };
}

const lights = flashlight => {
  const found = [];
  flashlight.group.traverse(object => { if (object.isLight) found.push(object); });
  return found;
};

test('the flashlight comes out as the street lamps come on, and goes away at dawn', () => {
  assert.equal(flashlightPower(1), 0);
  assert.equal(flashlightPower(0), 1);
  for (let daylight = 0; daylight < 1; daylight += .05) assert.ok(flashlightPower(daylight) >= flashlightPower(daylight + .05));
  const flashlight = createFlashlight(), hero = carrier();
  flashlight.attach(hero);
  flashlight.setTime(1);
  assert.equal(flashlight.out, false);
  assert.equal(flashlight.diagnostics.intensity, 0);
  flashlight.setTime(0);
  assert.equal(flashlight.out, true);
  assert.ok(flashlight.diagnostics.intensity > 0);
  flashlight.dispose();
});

test('day, night and the switch never change the lights every shader was compiled for', () => {
  const flashlight = createFlashlight();
  flashlight.attach(carrier());
  const resident = lights(flashlight);
  assert.equal(resident.length, 1);
  const [beam] = resident;
  assert.ok(beam.isSpotLight && beam.map && !beam.castShadow);
  for (const step of [() => flashlight.setTime(0), () => flashlight.toggle(), () => flashlight.update(1), () => flashlight.setQuality('low'), () => flashlight.setTime(1)]) {
    step();
    assert.deepEqual(lights(flashlight), resident);
    assert.ok(beam.visible && beam.map && !beam.castShadow);
  }
  flashlight.dispose();
});

test('switching it off fades the beam before the prop is put away', () => {
  const flashlight = createFlashlight();
  flashlight.attach(carrier());
  flashlight.setTime(0);
  const full = flashlight.diagnostics.intensity;
  assert.equal(flashlight.toggle(), false);
  flashlight.update(1 / 60);
  assert.ok(flashlight.diagnostics.intensity > 0 && flashlight.diagnostics.intensity < full);
  assert.equal(flashlight.out, true);
  for (let i = 0; i < 90; i++) flashlight.update(1 / 60);
  assert.equal(flashlight.out, false);
  assert.ok(flashlight.diagnostics.intensity < full * .01);
  assert.equal(flashlight.toggle(), true);
  for (let i = 0; i < 90; i++) flashlight.update(1 / 60);
  assert.ok(flashlight.diagnostics.intensity > full * .99);
  // A saved choice applies at once, with no fade from the other state.
  flashlight.enabled = false;
  assert.equal(flashlight.out, false);
  assert.equal(flashlight.diagnostics.intensity, 0);
  flashlight.dispose();
});

test('the beam leaves the lens along the hero heading, a little below level', () => {
  const flashlight = createFlashlight(), hero = carrier(new THREE.Vector3(10, 0, -4));
  hero.group.rotation.y = Math.PI / 2;
  flashlight.attach(hero);
  flashlight.setTime(0);
  flashlight.update(1 / 60, { facing: Math.PI / 2 });
  const [x, y, z] = flashlight.diagnostics.direction;
  assert.ok(x > .9, `beam should point along +X, got ${x}`);
  assert.ok(y < -.1 && y > -.4, `beam should dip below level, got ${y}`);
  assert.ok(Math.abs(z) < .1);
  // The lens sits at the prop's far end, 0.6 of its 0.42 length past the grip.
  const lens = new THREE.Vector3(.5, 2, .3 + .6 * .42).applyMatrix4(hero.group.matrixWorld);
  assert.ok(new THREE.Vector3(...flashlight.diagnostics.position).distanceTo(lens) < 1e-6);
  // Turning the hero sweeps the beam round rather than snapping it.
  flashlight.update(1 / 60, { facing: 0 });
  assert.ok(flashlight.diagnostics.direction[0] > .5 && flashlight.diagnostics.direction[2] > .1);
  flashlight.dispose();
});

test('the prop moves to the next hero, and one without a mount holds it at the chest', () => {
  const flashlight = createFlashlight(), first = carrier(), second = { group: new THREE.Group(), height: 3.4 };
  flashlight.attach(first);
  const holder = first.flashlightMount.parent.children[0];
  assert.equal(holder.name, 'Flashlight grip');
  flashlight.attach(second);
  assert.equal(first.flashlightMount.parent.children.length, 0);
  assert.equal(holder.parent, second.group);
  assert.equal(flashlight.diagnostics.mount, 'body');
  flashlight.attach(null);
  assert.equal(holder.parent, null);
  flashlight.setTime(0);
  assert.equal(flashlight.out, false);
  assert.equal(flashlight.diagnostics.intensity, 0);
  flashlight.dispose();
});

test('low quality drops the visible shaft but keeps the light', () => {
  const flashlight = createFlashlight();
  flashlight.attach(carrier());
  flashlight.setTime(0);
  assert.equal(flashlight.diagnostics.shaft, true);
  flashlight.setQuality('low');
  assert.equal(flashlight.diagnostics.shaft, false);
  assert.ok(flashlight.diagnostics.intensity > 0);
  flashlight.setQuality('high');
  assert.equal(flashlight.diagnostics.shaft, true);
  flashlight.dispose();
});

test('starter heroes carry the flashlight pointing ahead, in the pose they hold it in', async t => {
  t.mock.method(console, 'log', () => {});
  for (const [id, kind] of [['warden', 'shield'], ['ranger', 'hand'], ['mage', 'hand']]) {
    const hero = await createHero(id);
    assert.equal(hero.flashlightMount.kind, kind, id);
    for (let i = 0; i < 40; i++) hero.animate(.1, { holding: true });
    const prop = new THREE.Object3D();
    hero.flashlightMount.parent.add(prop);
    prop.position.copy(hero.flashlightMount.position); prop.quaternion.copy(hero.flashlightMount.quaternion);
    hero.group.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(prop.matrixWorld);
    assert.ok(forward.z > .95, `${id} holds it pointing ${forward.toArray()}`);
    assert.ok(forward.y < 0, `${id} holds it below level`);
    const grip = prop.getWorldPosition(new THREE.Vector3());
    assert.ok(grip.z > 0 && grip.y > 1.2 && grip.y < 3, `${id} holds it in front at ${grip.toArray()}`);
    prop.removeFromParent();
    hero.dispose();
  }
});
