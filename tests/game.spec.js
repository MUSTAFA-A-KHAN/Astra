import { test, expect } from '@playwright/test';

async function boot(page, path = '/?debug=1') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(path);
  await page.waitForFunction(() => window.astraReady === true);
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#loading')).toBeHidden();
  return errors;
}

async function start(page) {
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
}

const snapshot = page => page.evaluate(() => window.__ASTRA_DEBUG__);

test('offline local boot, existing roster selection and menus remain usable', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const errors = await boot(page);
  await expect(page.locator('.character-card')).toHaveCount(7);
  for (const [name, id] of [['Lyra', 'ranger'], ['Elowen', 'mage'], ['Cael', 'warden']]) {
    await page.getByRole('button', { name: new RegExp(`Select ${name},`) }).click();
    await expect.poll(async () => (await snapshot(page)).hero).toBe(id);
  }
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.locator('#menu-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close menu' }).click();
  await start(page);
  await page.getByRole('button', { name: 'Open quest journal' }).click();
  await expect(page.locator('#dialog-content')).toContainText('glimmer');
  await page.getByRole('button', { name: 'Close menu' }).click();
  await page.getByRole('button', { name: 'Return to character lobby' }).click();
  await expect(page.locator('#lobby')).toBeVisible();
  expect(errors).toEqual([]);
});

test('local imported GLB loads, animates, and survives switching back to the original runtime', async ({ page }) => {
  const errors = await boot(page);
  await page.getByRole('button', { name: /Select Rei,/ }).click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.hero === 'rei' && !window.__ASTRA_DEBUG__.switching);
  await start(page);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).position.z).toBeLessThan(17.5);
  await page.keyboard.up('KeyW');
  const state = await snapshot(page);
  expect(state.ready).toBe(true);
  if (state.heroRuntime) {
    expect(state.heroRuntime.imported).toBe(true);
    expect(state.heroRuntime.rootMotion).toBe('in-place');
    expect(state.heroRuntime.animations).toContain('Walk');
  }
  await page.getByRole('button', { name: 'Return to character lobby' }).click();
  await page.getByRole('button', { name: /Select Cael,/ }).click();
  await expect.poll(async () => (await snapshot(page)).hero).toBe('warden');
  expect(errors).toEqual([]);
});

test('missing terrain credentials and unavailable network never prevent play', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  const errors = await boot(page, '/?debug=1&terrain=cesium');
  await start(page);
  expect((await snapshot(page)).ready).toBe(true);
  expect(errors).toEqual([]);
  await page.goto('/?debug=1&terrain=terrarium');
  await page.waitForFunction(() => window.astraReady === true);
  await expect(page.locator('#loading')).toBeHidden();
  await start(page);
  expect((await snapshot(page)).ready).toBe(true);
  expect(errors).toEqual([]);
});

test('keyboard locomotion accelerates, jumps, lands and turns toward travel', async ({ page }) => {
  const errors = await boot(page);
  await start(page);
  const initial = await snapshot(page);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).position.z).toBeLessThan(initial.position.z - 1);
  await page.keyboard.up('KeyW');
  await expect.poll(async () => (await snapshot(page)).locomotion?.grounded).toBe(true);
  const ground = (await snapshot(page)).position.y;
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page)).position.y, { intervals: [50, 75, 100] }).toBeGreaterThan(ground + 0.25);
  await expect.poll(async () => (await snapshot(page)).locomotion?.grounded).toBe(true);
  const landed = await snapshot(page);
  expect(Math.abs(landed.position.y - landed.terrain.height)).toBeLessThan(0.25);
  expect(errors).toEqual([]);
});

test('responsive touch controls fit and joystick drives the same player', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch controls apply to mobile devices.');
  const errors = await boot(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await start(page);
  for (const selector of ['#joystick', '#jump-button', '#sprint-button', '#attack-button', '#ability-button']) {
    await expect(page.locator(selector)).toBeVisible();
    const box = await page.locator(selector).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
  }
  const initial = await snapshot(page);
  const box = await page.locator('#joystick').boundingBox();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width / 2, y: box.y + 2 }] });
  await expect.poll(async () => (await snapshot(page)).position.z).toBeLessThan(initial.position.z - 0.4);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  expect(errors).toEqual([]);
});

test('both bundled GLBs keep skeleton bindings and in-place roots across animation states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Detailed asset validation runs once on desktop Chromium.');
  const errors = await boot(page);
  const models = await page.evaluate(async () => {
    const { createHero } = await import('/characters.js');
    const THREE = await import('three');
    const results = [];
    for (const id of ['rei', 'arthur']) {
      const hero = await createHero(id);
      const roots = [], skins = [];
      hero.group.traverse(object => {
        if (object.isBone && !object.parent?.isBone) roots.push(object);
        if (object.isSkinnedMesh) skins.push(object);
      });
      hero.animate(1 / 60, { state: 'Idle', speed: 0 });
      const origins = roots.map(root => ({ x: root.position.x, z: root.position.z }));
      let drift = 0;
      const actions = {};
      for (const state of ['Walk', 'Run', 'Sprint', 'Jump', 'Fall', 'Land', 'Idle']) {
        for (let frame = 0; frame < 90; frame++) hero.animate(1 / 60, { state, speed: state === 'Walk' ? 4.2 : state === 'Sprint' ? 11.5 : 8, time: frame / 60 });
        actions[state] = hero.diagnostics.activeAction;
        roots.forEach((root, index) => { drift = Math.max(drift, Math.hypot(root.position.x - origins[index].x, root.position.z - origins[index].z)); });
      }
      const bounds = new THREE.Box3().setFromObject(hero.group);
      results.push({ id, skinCount: skins.length, boundBones: skins.every(skin => skin.skeleton.bones.length > 0), height: bounds.max.y - bounds.min.y,
        drift, actions, mixerTime: hero.mixer.time, diagnostics: hero.diagnostics });
      hero.dispose(); hero.dispose();
    }
    return results;
  });
  for (const model of models) {
    expect(model.skinCount).toBeGreaterThan(0);
    expect(model.boundBones).toBe(true);
    expect(model.height).toBeGreaterThan(2.5);
    expect(model.height).toBeLessThan(4.5);
    expect(model.mixerTime).toBeGreaterThan(10);
    expect(model.drift).toBeLessThan(0.001);
    expect(model.actions.Walk).toMatch(/Walk/i);
    expect(model.actions.Sprint).toMatch(/Sprint/i);
    expect(model.actions.Land).toMatch(/Land/i);
    expect(model.diagnostics.orientationYaw).toBe(0);
  }
  expect(errors).toEqual([]);
});
