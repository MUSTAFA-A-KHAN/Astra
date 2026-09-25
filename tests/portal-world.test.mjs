import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortal } from '../portal-world.js';

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
  assert.equal(colliders.size, 1, 'moving the portal replaces its old collision footprint');
  portal.dispose();
  assert.equal(colliders.size, 0);
});

test('book stays visible while reading and casting; gate only awakens during the cast', () => {
  const portal = createPortal();
  assert.equal(portal.diagnostics().bookVisible, true);
  assert.equal(portal.diagnostics().apertureVisible, false);
  portal.setPhase('reading', 1);
  assert.equal(portal.diagnostics().bookVisible, true);
  assert.equal(portal.diagnostics().apertureVisible, false);
  assert.equal(portal.nearby(portal.places.book), null, 'a ritual cannot be started twice');
  portal.setPhase('casting', .5); portal.update(.1, 1);
  assert.equal(portal.diagnostics().bookVisible, true);
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
