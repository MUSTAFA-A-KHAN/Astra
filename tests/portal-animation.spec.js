import { test, expect } from '@playwright/test';

// The gate alone, with its real model and clip, on flat ground at y = 0.
// Booting the whole game is not needed to watch the stones.
const page = `<!doctype html><html><head>
<script type="importmap">{"imports":{"three":"/vendor/three/three.module.js","three/addons/":"/vendor/three/addons/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { createPortal } from '/portal-world.js';
const portal = createPortal({ world: { getHeight: () => 0 } });
await portal.load();
portal.place({ x: 0, y: 0, z: 0 }, .4);
portal.root.updateMatrixWorld(true);
const stones = () => { const found = []; portal.root.traverse(node => { if (node.isMesh && node.visible && /2SG/.test(node.name)) { let shown = true; for (let n = node; n; n = n.parent) shown &&= n.visible; if (shown) found.push(node); } }); return found; };
const box = new THREE.Box3();
const spin = () => { let node = null; portal.root.traverse(n => { if (n.name === 'Sphere001') node = n; }); return node.quaternion.toArray(); };
window.__GATE__ = {
  diagnostics: () => { const d = portal.diagnostics(); return { ...d, portal: null, book: null, reading: null }; },
  phase: (name, amount) => { portal.setPhase(name, amount); portal.update(0, 0); },
  step: (seconds, dt = .1) => { for (let t = 0; t < seconds - 1e-9; t += dt) portal.update(dt, t); },
  spin,
  clear: () => portal.entryClear(),
  watch: (x, y, z) => portal.watch(x === null ? null : new THREE.Vector3(x, y, z)),
  // How close the nearest standing stone comes to a point on the ground, in metres.
  nearest: (x, z) => { portal.root.updateMatrixWorld(true); return Math.min(...stones().map(stone => { box.setFromObject(stone); if (box.max.y < .1) return Infinity;
    return Math.hypot(Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z)); })); },
  // Highest top and lowest bottom among the shown stones, in metres.
  heights: () => { portal.root.updateMatrixWorld(true); const h = stones().map(s => { box.setFromObject(s); return [box.min.y, box.max.y]; }); return { count: h.length, top: Math.max(...h.map(v => v[1])), lowestTop: Math.min(...h.map(v => v[1])) }; },
  // Stones standing within reach of the reader or the walk in, at body height.
  intrusions: () => {
    portal.root.updateMatrixWorld(true);
    const way = []; for (let t = 0; t <= 3; t += .1) way.push(portal.entryPose(t).position.clone());
    return stones().filter(stone => { box.setFromObject(stone); if (box.max.y < .1 || box.min.y > 2) return false;
      return way.some(p => Math.max(box.min.x - p.x, 0, p.x - box.max.x) ** 2 + Math.max(box.min.z - p.z, 0, p.z - box.max.z) ** 2 < .3 ** 2); }).length;
  },
};
window.__READY__ = true;
</script></body></html>`;

test('the gate plays its own clip: stones break the ground, turn with the arch and make way for the keeper', async ({ page: tab }) => {
  test.setTimeout(120000);
  const errors = []; tab.on('pageerror', error => errors.push(error.message));
  await tab.route('**/__gate.html', route => route.fulfill({ contentType: 'text/html', body: page }));
  await tab.goto('/__gate.html');
  await tab.waitForFunction(() => window.__READY__, null, { timeout: 60000 });
  const gate = (name, ...args) => tab.evaluate(([name, args]) => window.__GATE__[name](...args), [name, args]);

  const loaded = await gate('diagnostics');
  expect(loaded).toMatchObject({ modelLoaded: true, stones: 9, stonesVisible: 0, animation: { clip: 'Take 001', duration: 20, time: 0 } });
  const rest = await gate('spin');

  // The spell starts the clip from its first frame with every stone buried.
  await gate('phase', 'casting', .02);
  expect((await gate('heights')).top).toBeLessThan(0);
  // They rise in turn as it is spoken; by its end all stand in the clip's own places.
  for (let p = .05; p <= 1.0001; p += .05) { await gate('phase', 'casting', p); await gate('step', .31); }
  const risen = await gate('diagnostics');
  expect(risen.stonesRisen).toBe(9);
  expect(risen.animation.playing).toBe(true);
  expect(risen.animation.time).toBeGreaterThan(5);
  expect((await gate('heights')).top).toBeGreaterThan(3);

  // The whole twenty-second loop plays while the gate stands open, the arch
  // turning with it. The way in is sometimes blocked by its footing stones and
  // sometimes clear, and no stone ever stands in the keeper's way.
  await gate('phase', 'ready');
  const seen = new Set();
  let intrusions = 0, turned = false;
  for (let i = 0; i < 100; i++) {
    await gate('step', .2);
    seen.add(await gate('clear'));
    intrusions += await gate('intrusions');
    turned ||= (await gate('spin')).some((v, k) => Math.abs(v - rest[k]) > .1);
  }
  expect(turned).toBe(true);
  expect([...seen].sort()).toEqual([false, true]);
  expect(intrusions).toBe(0);

  // A camera at the edge of the stones' ring never has one pass through its lens.
  await gate('watch', 13, 4, 0);
  let closest = Infinity;
  for (let i = 0; i < 100; i++) { await gate('step', .2); closest = Math.min(closest, await gate('nearest', 13, 0)); }
  expect(closest).toBeGreaterThan(2.5);
  await gate('watch', null);

  // Asleep again, the gate is back in its rest pose with its stones gone.
  await gate('phase', 'dormant');
  const asleep = await gate('diagnostics');
  expect(asleep).toMatchObject({ stonesVisible: 0, animation: { time: 0, playing: false } });
  (await gate('spin')).forEach((v, k) => expect(v).toBeCloseTo(rest[k], 5));
  expect(errors).toEqual([]);
});
