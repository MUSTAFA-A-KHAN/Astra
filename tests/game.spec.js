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

test('City Set Proto assets load offline and the roster and menus remain usable', async ({ page }) => {
  const cityResponses = [];
  const cityFailures = [];
  page.on('response', response => {
    if (response.url().includes('/City_Set_-_Proto_Series/')) {
      cityResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
    }
  });
  page.on('requestfailed', request => {
    if (request.url().includes('/City_Set_-_Proto_Series/')) cityFailures.push(request.url());
  });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const errors = await boot(page);
  expect(cityFailures).toEqual([]);
  expect(cityResponses.some(response => response.path.endsWith('.gltf'))).toBe(true);
  expect(cityResponses.some(response => response.path.endsWith('.bin'))).toBe(true);
  expect(cityResponses.some(response => response.path.endsWith('.png'))).toBe(true);
  expect(cityResponses.every(response => response.status === 200)).toBe(true);
  const { terrain } = await snapshot(page);
  expect(terrain.ready).toBe(true);
  expect(terrain.provider).toBe('city-set-proto-series');
  expect(terrain.asset).toContain('City_Set_-_Proto_Series.gltf');
  expect(terrain.triangleCount).toBeGreaterThan(500_000);
  expect(terrain.meshCount).toBeGreaterThan(0);
  expect(terrain.colliderCount).toBeGreaterThan(0);
  const rosterCount = await page.evaluate(async () => (await import('/characters.js')).HEROES.length);
  await expect(page.locator('.character-card')).toHaveCount(rosterCount);
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
  // #lobby is a zero-height landmark — every panel inside it is absolutely
  // positioned — so the screen itself is what says the lobby is back.
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'lobby');
  await expect(page.locator('#play-button')).toBeVisible();
  expect(errors).toEqual([]);
});

test('local imported GLB loads, animates, and survives switching back to the original runtime', async ({ page }) => {
  const errors = await boot(page);
  await page.getByRole('button', { name: /Select Rei,/ }).click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.hero === 'rei' && !window.__ASTRA_DEBUG__.switching);
  await start(page);
  const initial = await snapshot(page);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).position.z).toBeLessThan(initial.position.z - 0.5);
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

test('sun and moon follow the time slider and the world clock pauses with menus', async ({ page }) => {
  const errors = await boot(page);
  await page.getByRole('button', { name: 'Open settings' }).click();
  const setHour = async hour => {
    await page.getByRole('slider', { name: 'Time of day' }).evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, hour);
    await expect.poll(async () => (await snapshot(page)).atmosphere.hour).toBe(hour);
    return (await snapshot(page)).atmosphere;
  };
  const morning = await setHour(8);
  const noon = await setHour(12);
  const night = await setHour(0);
  expect(morning.sunDirection[0]).toBeGreaterThan(0.5);
  expect(noon.sunElevation).toBeGreaterThan(morning.sunElevation);
  expect(noon.sunIntensity).toBeGreaterThan(morning.sunIntensity);
  expect(noon.daylight).toBe(1);
  expect(noon.sunIntensity).toBeGreaterThan(noon.moonIntensity);
  expect(night.sunElevation).toBeLessThan(0);
  expect(night.moonElevation).toBeGreaterThan(0);
  expect(night.daylight).toBe(0);
  expect(night.sunIntensity).toBe(0);
  expect(night.moonIntensity).toBeGreaterThan(0);
  for (const state of [morning, noon, night]) {
    for (let axis = 0; axis < 3; axis++) {
      expect(state.sunDirection[axis] + state.moonDirection[axis]).toBeCloseTo(0, 6);
    }
  }
  // Start away from midnight so wraparound cannot masquerade as a stopped clock.
  await setHour(8);
  await page.getByRole('button', { name: 'Close menu' }).click();
  await start(page);
  const runningHour = (await snapshot(page)).atmosphere.hour;
  await expect.poll(async () => (await snapshot(page)).atmosphere.hour).toBeGreaterThan(runningHour);
  await page.getByRole('button', { name: 'Open quest journal' }).click();
  const pausedHour = (await snapshot(page)).atmosphere.hour;
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const step = () => ++frames >= 4 ? resolve() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  }));
  expect((await snapshot(page)).atmosphere.hour).toBe(pausedHour);
  await page.getByRole('button', { name: 'Close menu' }).click();
  await expect.poll(async () => (await snapshot(page)).atmosphere.hour).toBeGreaterThan(pausedHour);
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
  expect(landed.locomotion.groundHeight).toBeCloseTo(landed.terrain.height, 3);
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
