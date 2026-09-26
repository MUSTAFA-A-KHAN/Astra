import { test, expect } from '@playwright/test';

const snapshot = page => page.evaluate(() => window.__ASTRA_DEBUG__);
async function enterCity(page, heroId) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.astraReady === true);
  if (heroId) {
    await page.locator(`[data-hero="${heroId}"]`).click();
    await page.waitForFunction(id => window.__ASTRA_DEBUG__?.hero === id && !window.__ASTRA_DEBUG__.switching, heroId);
  }
  await expect(page.locator('#play-button')).toBeEnabled();
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
  return errors;
}

test('camera controls enter aim and cinematic modes and restore the follow view', async ({ page }) => {
  const errors = await enterCity(page);
  for (const selector of ['#aim-button', '#cinematic-button', '#lock-button']) {
    const button = page.locator(selector);
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
  }
  const follow = (await snapshot(page)).camera;
  await page.locator('#aim-button').click();
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('aim');
  await expect(page.locator('#aim-reticle')).toBeVisible();
  await expect(page.locator('#aim-button')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await snapshot(page)).camera.fov).toBeLessThan(48);
  await expect.poll(async () => (await snapshot(page)).camera.requestedDistance).toBeLessThan(5);

  await page.locator('#cinematic-button').click();
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('cinematic');
  await expect(page.locator('#aim-reticle')).toBeHidden();
  await expect(page.locator('#aim-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#cinematic-button')).toHaveAttribute('aria-pressed', 'true');
  const cinematicYaw = (await snapshot(page)).camera.yaw;
  await expect.poll(async () => Math.abs((await snapshot(page)).camera.yaw - cinematicYaw)).toBeGreaterThan(.04);

  await page.locator('#cinematic-button').click();
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('follow');
  await expect.poll(async () => Math.abs((await snapshot(page)).camera.fov - follow.fov)).toBeLessThan(.5);
  await expect(page.locator('#camera-mode')).toHaveText('');
  expect((await snapshot(page)).camera.view).toBe(follow.view);
  expect(errors).toEqual([]);
});

for (const heroId of ['warden', 'arthur', 'Spiderman']) {
test(`${heroId} sits on the nearby horse, walks without Shift and sprints only while held`, async ({ page }, testInfo) => {
  test.skip(heroId !== 'warden' && testInfo.project.name !== 'desktop', 'Imported riding poses are checked once on desktop.');
  const errors = await enterCity(page, heroId);
  const horse = (await snapshot(page)).activities.mount;
  expect(horse.model).toBe('./horse.glb');
  expect(horse.animation.imported).toBe(true);
  expect(horse.animation.selectedAnimations.walk).toMatch(/Walk$/);
  expect(horse.animation.selectedAnimations.run).toMatch(/Gallop$/);
  expect(horse.animation.state).toBe('Idle');
  // Activity placement leaves the arrival area clear; approach the horse first.
  await page.keyboard.down('KeyD');
  await expect(page.locator('#interaction-text')).toHaveText('Ride trail horse');
  await page.keyboard.up('KeyD');
  await page.locator('#interact-button').click();
  await expect.poll(async () => (await snapshot(page)).activities.mounted).toBe(true);
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('mount');
  await expect(page.locator('#camera-mode')).toHaveText('MOUNTED');
  await expect(page.locator('#interaction-text')).toHaveText('Dismount');
  await expect.poll(async () => (await snapshot(page)).riding.seatGap).toBeLessThan(.001);
  if (heroId !== 'warden') {
    await expect.poll(async () => (await snapshot(page)).heroRuntime.activeAction).toMatch(/Sitting_Idle/);
    await expect.poll(async () => (await snapshot(page)).riding.rootHeight).toBeLessThan(horse.seatHeight - .8);
  }
  await page.screenshot({ path: testInfo.outputPath(`${heroId}-mounted.png`) });
  const initial = await snapshot(page);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).position.z).toBeLessThan(initial.position.z - .5);
  const moving = await snapshot(page);
  expect(moving.locomotion.speed).toBeGreaterThan(1);
  expect(moving.activities.mount.z).toBeCloseTo(moving.position.z, 4);
  // Check the sustained walking pace, beyond the brief walk during acceleration.
  await expect.poll(async () => (await snapshot(page)).locomotion.speed).toBeGreaterThan(4.4);
  expect((await snapshot(page)).locomotion.sprinting).toBe(false);
  await expect.poll(async () => (await snapshot(page)).activities.mount.animation.state).toBe('Walk');
  await expect.poll(async () => (await snapshot(page)).activities.mount.animation.activeAction).toMatch(/Walk$/);
  expect((await snapshot(page)).riding.seatGap).toBeLessThan(.001);
  await page.keyboard.down('ShiftLeft');
  await expect.poll(async () => (await snapshot(page)).locomotion.sprinting).toBe(true);
  await expect.poll(async () => (await snapshot(page)).locomotion.speed).toBeGreaterThan(7);
  await expect.poll(async () => (await snapshot(page)).activities.mount.animation.activeAction).toMatch(/Gallop$/);
  expect((await snapshot(page)).riding.seatGap).toBeLessThan(.001);
  await page.keyboard.up('ShiftLeft');
  // Releasing Shift must return to walking even while forward remains held.
  await expect.poll(async () => (await snapshot(page)).locomotion.sprinting).toBe(false);
  await expect.poll(async () => (await snapshot(page)).activities.mount.animation.state).toBe('Walk');
  await expect.poll(async () => (await snapshot(page)).activities.mount.animation.activeAction).toMatch(/Walk$/);
  await expect.poll(async () => (await snapshot(page)).locomotion.speed).toBeLessThan(6.1);
  expect((await snapshot(page)).locomotion.speed).toBeGreaterThan(1);
  await page.keyboard.up('KeyW');
  await expect.poll(async () => (await snapshot(page)).locomotion.speed).toBeLessThan(.1);
  await expect.poll(async () => (await snapshot(page)).activities.mount.animation.state).toBe('Idle');
  await page.locator('#interact-button').click();
  await expect.poll(async () => (await snapshot(page)).activities.mounted).toBe(false);
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('follow');
  const dismounted = await snapshot(page);
  expect(dismounted.locomotion.grounded).toBe(true);
  expect(dismounted.position.y).toBeCloseTo(dismounted.terrain.height, 2);
  expect(dismounted.riding).toBeNull();
  expect(errors).toEqual([]);
});
}

test('the horse leans its walk and gallop into their left and right turn clips', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Detailed rig checks run once on desktop.');
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.astraReady === true);
  const ride = await page.evaluate(async () => {
    const { createHero } = await import('/characters.js');
    const THREE = await import('three');
    const horse = await createHero('Horse');
    let head = null;
    horse.group.traverse(node => { if (!head && node.isBone && /^BN_Head_00/.test(node.name)) head = node; });
    // A second of riding, then where the head has swung to: the horse faces
    // +z, so its left is +x, measured in body heights.
    const after = (state, turnRate, speed) => {
      for (let frame = 0; frame < 60; frame++) horse.animate(1 / 60, { state, speed, moving: state !== 'Idle', turnRate, time: frame / 60 });
      horse.group.updateMatrixWorld(true);
      const { activeAction, turnAction, turning } = horse.diagnostics;
      const headX = horse.group.worldToLocal(head.getWorldPosition(new THREE.Vector3())).x / horse.height;
      return { activeAction, turnAction, turning, headX };
    };
    const results = {
      straight: after('Walk', 0, 5), left: after('Walk', 3, 5), right: after('Walk', -3, 5),
      gentle: after('Walk', .5, 5), unsteered: after('Walk', NaN, 5),
      straightGallop: after('Sprint', 0, 14), gallopLeft: after('Sprint', 3, 14), gallopRight: after('Sprint', -3, 14),
      stopped: after('Idle', -3, 0),
      turns: horse.diagnostics.selectedAnimations.turns,
    };
    horse.dispose();
    return results;
  });
  expect(ride.turns).toEqual({
    walk: ['Skeleton|Walk_L', 'Skeleton|Walk_R'],
    run: ['Skeleton|Gallop_L', 'Skeleton|Gallop_R'],
    sprint: ['Skeleton|Gallop_L', 'Skeleton|Gallop_R'],
  });
  expect(ride.straight).toMatchObject({ activeAction: 'Skeleton|Walk', turnAction: null });
  expect(ride.left).toMatchObject({ activeAction: 'Skeleton|Walk', turnAction: 'Skeleton|Walk_L' });
  expect(ride.right).toMatchObject({ activeAction: 'Skeleton|Walk', turnAction: 'Skeleton|Walk_R' });
  expect(ride.left.turning).toBeGreaterThan(.99);
  expect(ride.right.turning).toBeLessThan(-.99);
  // The clips really bend the horse the way it is turning.
  expect(ride.left.headX).toBeGreaterThan(ride.straight.headX + .05);
  expect(ride.right.headX).toBeLessThan(ride.straight.headX - .05);
  // A gentle curve blends only part way in.
  expect(ride.gentle.turnAction).toBeNull();
  expect(ride.gentle.turning).toBeGreaterThan(.2);
  expect(ride.gentle.turning).toBeLessThan(.5);
  expect(Math.abs(ride.unsteered.turning)).toBeLessThan(.01);
  expect(ride.gallopLeft).toMatchObject({ activeAction: 'Skeleton|Gallop', turnAction: 'Skeleton|Gallop_L' });
  expect(ride.gallopRight).toMatchObject({ activeAction: 'Skeleton|Gallop', turnAction: 'Skeleton|Gallop_R' });
  expect(ride.gallopLeft.headX).toBeGreaterThan(ride.straightGallop.headX + .05);
  expect(ride.gallopRight.headX).toBeLessThan(ride.straightGallop.headX - .05);
  // Standing still hands the stride back from any turn.
  expect(ride.stopped).toMatchObject({ turnAction: null });
  expect(Math.abs(ride.stopped.turning)).toBeLessThan(.01);
});

// Watches the ridden horse, frame by frame in the page, lean into a turn and
// come out of it, collecting every turn clip it used. The watch closes the
// moment the turn ends, so a later bump into the street furniture cannot add
// to it, and gives up after five seconds.
const watchTurn = page => page.evaluate(() => {
  window.__turn = new Promise(resolve => {
    const seen = new Set(), start = performance.now();
    const watch = () => {
      const { turning, turnAction } = window.__ASTRA_DEBUG__.activities.mount.animation;
      if (turnAction) seen.add(turnAction);
      if ((seen.size && Math.abs(turning) < .3) || performance.now() - start > 5000) resolve([...seen]);
      else requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
});
const turnWatched = page => page.evaluate(() => window.__turn);

test('steering the ridden horse right and back leans it right, then left', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Riding turns are checked once on desktop.');
  const errors = await enterCity(page);
  await page.keyboard.down('KeyD');
  await expect(page.locator('#interaction-text')).toHaveText('Ride trail horse');
  await page.keyboard.up('KeyD');
  await page.locator('#interact-button').click();
  await expect.poll(async () => (await snapshot(page)).activities.mounted).toBe(true);
  // The horse stands facing the camera, so riding away from it is an about-turn,
  // which it wheels round through instead of snapping to.
  await page.evaluate(() => {
    const headings = window.__headings = [];
    const record = () => {
      if (window.__headings !== headings) return;
      headings.push(window.__ASTRA_DEBUG__.riding.heading);
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await page.keyboard.down('KeyW');
  // Riding straight on keeps the straight stride.
  await page.waitForFunction(() => {
    const { state, turning } = window.__ASTRA_DEBUG__.activities.mount.animation;
    return state === 'Walk' && Math.abs(turning) < .1;
  });
  const headings = await page.evaluate(() => { const headings = window.__headings; window.__headings = null; return headings; });
  const swing = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
  expect(swing(headings[0], headings.at(-1))).toBeGreaterThan(2.5);
  // Even the longest frame the game steps (.08 s) turns it only a little.
  expect(Math.max(...headings.slice(1).map((heading, i) => swing(headings[i], heading)))).toBeLessThan(.25);
  expect(headings.length).toBeGreaterThan(10);
  expect((await snapshot(page)).activities.mount.animation.turnAction).toBeNull();
  // Bearing right, then straightening up again, which is a turn to the left.
  await watchTurn(page);
  await page.keyboard.down('KeyD');
  expect(await turnWatched(page)).toEqual(['Skeleton|Walk_R']);
  await watchTurn(page);
  await page.keyboard.up('KeyD');
  expect(await turnWatched(page)).toEqual(['Skeleton|Walk_L']);
  await page.keyboard.up('KeyW');
  expect(errors).toEqual([]);
});

test('keyboard camera modes and zoom remain usable after a menu pause', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Keyboard shortcuts and mouse zoom run on desktop.');
  const errors = await enterCity(page);
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('aim');
  await page.keyboard.press('KeyC');
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('cinematic');
  await page.keyboard.press('KeyC');
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('follow');
  // A new player starts in the close view, as near as the wheel goes:
  // zooming in holds there, and zooming out pulls back.
  const radius = (await snapshot(page)).camera.radius;
  await page.mouse.move(800, 400);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(300);
  expect((await snapshot(page)).camera.radius).toBeGreaterThanOrEqual(radius - .01);
  await page.mouse.wheel(0, 200);
  await expect.poll(async () => (await snapshot(page)).camera.radius).toBeGreaterThan(radius + 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await page.keyboard.press('KeyR');
  expect((await snapshot(page)).camera.mode).toBe('follow');
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-dialog')).toBeHidden();
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('aim');
  expect(errors).toEqual([]);
});
