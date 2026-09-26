import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPortal } from '../portal-world.js';
import { SpatialHash } from '../physics.js';

test('portal requires reaching the visible book, including after a rotated map relocation', () => {
  const colliders = new Map();
  const portal = createPortal({
    world: { getHeight: () => 7 },
    collision: { insert: (id, value) => colliders.set(id, value), remove: id => colliders.delete(id), cameraFraction: () => 1 },
  });
  portal.place({ x: 10, y: 7, z: 20 });
  assert.equal(portal.nearby(portal.places.portal), null, 'standing at the gate cannot replace reading its book');
  assert.equal(portal.nearby(portal.places.reading)?.type, 'portal');
  const previousBook = portal.places.book;
  portal.place({ x: 90, y: 7, z: -20 }, Math.PI / 2);
  assert.equal(portal.nearby(previousBook), null, 'the old map must lose its book interaction');
  assert.equal(portal.nearby(portal.places.reading)?.id, 'keeper-spellbook');
  assert.equal(portal.places.book.y, 7);
  assert.equal(colliders.size, 5, 'moving the portal replaces its old collision footprint');
  portal.dispose();
  assert.equal(colliders.size, 0);
});

test('the sleeping gate is solid at any facing, and still lets the reader and the camera through its aperture', () => {
  const collision = new SpatialHash();
  const portal = createPortal({ world: { getHeight: () => 2 }, collision });
  const at = (x, y, z) => portal.root.localToWorld(new THREE.Vector3(x, y, z));
  const pushed = point => { const moved = point.clone(); collision.resolve(moved, .65, 3.3); return moved.distanceTo(point); };
  for (const facing of [0, Math.PI / 2, 1]) {
    portal.place({ x: 30, y: 2, z: -10 }, facing);
    assert.ok(pushed(at(0, 0, 0)) > 4, 'nobody stands on the dais');
    assert.ok(pushed(at(0, 0, 4.75)) > .3, 'nor at its foot, where the gate lifts the traveller');
    assert.ok(pushed(at(-5.2, 0, .15)) > .5, 'the arch’s left foot stands outside the dais');
    assert.ok(pushed(at(5.8, 0, .15)) > .5, 'and so does its right');
    assert.equal(pushed(portal.places.reading), 0, 'the reading spot stays open');
    assert.ok(collision.cameraFraction(at(2.3, 7, 9), at(2.3, 7, -9), .4) < .6, 'the crown blocks the camera');
    assert.equal(collision.cameraFraction(at(-1, 4, 9), at(-1, 4, -9), .4), 1, 'the aperture does not');
  }
  portal.dispose();
  assert.equal(collision.entries.size, 0);
});

test('book stays visible while reading and casting; gate only awakens during the cast', () => {
  const portal = createPortal();
  assert.equal(portal.diagnostics().bookVisible, true);
  assert.equal(portal.diagnostics().apertureVisible, false);
  portal.setPhase('reading', 1);
  assert.equal(portal.diagnostics().bookVisible, true);
  assert.equal(portal.diagnostics().apertureVisible, false);
  assert.equal(portal.nearby(portal.places.book), null, 'a ritual cannot be started twice');
  portal.setPhase('casting', .3); portal.update(.1, 1);
  assert.equal(portal.diagnostics().bookVisible, true);
  assert.equal(portal.diagnostics().apertureVisible, false, 'the stones rise before the aperture opens');
  portal.setPhase('casting', .8); portal.update(.1, 1.1);
  assert.equal(portal.diagnostics().apertureVisible, true);
  portal.setPhase('ready');
  assert.equal(portal.diagnostics().apertureVisible, true);
  portal.setPhase('dormant');
  assert.equal(portal.diagnostics().apertureVisible, false, 'arrival resets the gate for the next spell');
  portal.dispose();
});

test('failed model downloads preserve a usable spellbook and fallback gate', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
  const portal = createPortal();
  const diagnostics = await portal.load();
  assert.equal(diagnostics.modelLoaded, false);
  assert.equal(diagnostics.bookLoaded, false);
  assert.match(diagnostics.modelError, /Offline/);
  assert.match(diagnostics.bookError, /Offline/);
  assert.equal(diagnostics.bookVisible, true);
  assert.equal(portal.nearby(portal.places.reading)?.type, 'portal');
  portal.setPhase('casting', 1);
  assert.equal(portal.diagnostics().apertureVisible, true);
  portal.dispose();
});

test('book cannot be read through an obstruction and disposal releases shared geometry once', () => {
  const portal = createPortal({ collision: { cameraFraction: () => .3 } });
  assert.equal(portal.nearby(portal.places.reading), null);
  const geometry = portal.root.getObjectByName('Waking runes').children[0].geometry;
  let released = 0;
  geometry.addEventListener('dispose', () => released++);
  portal.dispose(); portal.dispose();
  assert.equal(released, 1);
  assert.equal(portal.diagnostics().bookVisible, false);
  assert.equal(portal.nearby(portal.places.reading), null);
});
