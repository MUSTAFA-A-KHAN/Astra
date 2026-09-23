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

test('Arthur plays his retargeted emotes in place with his feet on the ground', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Detailed asset validation runs once on desktop Chromium.');
  const errors = await boot(page);
  const result = await page.evaluate(async () => {
    const { createHero } = await import('/characters.js');
    const THREE = await import('three');
    const hero = await createHero('arthur');

    const feet = [];
    let root = null;
    hero.group.traverse(object => {
      if (object.isBone && !object.parent?.isBone) root = object;
      if (object.isBone && /Foot|Toe/i.test(object.name)) feet.push(object);
    });

    const point = new THREE.Vector3();
    // An emote is a gesture, not a journey: the character has to
    // stay where the game put him, and keep his feet on the floor
    // while he does it. Both are measured in world space against
    // the idle he was standing in -- the root bone sits at a fixed
    // offset from the group, so only movement away from where the
    // idle held it counts as drift.
    let anchor = null;
    const scan = (state, seconds) => {
      const band = { lowest: Infinity, highest: -Infinity, drift: 0 };
      for (let frame = 0; frame < Math.round(seconds * 30); frame++) {
        hero.animate(1 / 30, { state, speed: 0, time: frame / 30 });
        hero.group.updateMatrixWorld(true);
        let sole = Infinity;
        for (const bone of feet) sole = Math.min(sole, bone.getWorldPosition(point).y);
        band.lowest = Math.min(band.lowest, sole);
        band.highest = Math.max(band.highest, sole);
        root.getWorldPosition(point);
        anchor ??= point.clone();
        band.drift = Math.max(band.drift, Math.hypot(point.x - anchor.x, point.z - anchor.z));
      }
      return band;
    };

    hero.animate(1 / 30, { state: 'Idle', speed: 0 });
    const idle = scan('Idle', 2);
    const emotes = hero.diagnostics.selectedAnimations.emotes;
    const bands = {};
    for (const state of Object.keys(emotes)) bands[state] = scan(state, 19);

    const height = hero.height;
    hero.dispose();
    return { emotes, idle, bands, height };
  });

  // Every gesture the roster advertises for Arthur has to resolve
  // to a real clip, or the key that plays it does nothing.
  expect(Object.keys(result.emotes).sort()).toEqual(['Dance', 'Nod', 'Sad', 'Shake']);
  for (const name of Object.values(result.emotes)) expect(name).toBeTruthy();

  for (const [state, band] of Object.entries(result.bands)) {
    // Retargeting between rigs of different leg length is what
    // puts a dancer's feet through the floor or a hand's width
    // above it; the bake plants them, and this is what would
    // catch it regressing.
    expect.soft(band.lowest, `${state} sinks below the ground`).toBeGreaterThan(result.idle.lowest - result.height * 0.03);
    expect.soft(band.highest, `${state} floats off the ground`).toBeLessThan(result.idle.lowest + result.height * 0.03);
    expect.soft(band.drift, `${state} walks away from the player position`).toBeLessThan(0.001);
  }
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
  // A touchEnd names the points being lifted, so the thumb below
  // stays on the stick until the very last dispatch.
  const thumb = { x: box.x + box.width / 2, y: box.y + 2, id: 1 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [thumb] });
  await expect.poll(async () => (await snapshot(page)).position.z).toBeLessThan(initial.position.z - 0.4);

  // A press that begins while another finger is already down never
  // becomes a click: the browser only promotes a single-pointer
  // gesture to a tap. Every action button hung off `click`, which
  // left them all dead for as long as the player was moving — the
  // one moment they are worth having. A second finger has to reach
  // the game while the first is still driving.
  const tap = async (selector, id) => {
    const target = await page.locator(selector).boundingBox();
    const finger = { x: target.x + target.width / 2, y: target.y + target.height / 2, id };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [thumb, finger] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [finger] });
  };
  await tap('#jump-button', 2);
  await expect.poll(async () => (await snapshot(page)).locomotion.grounded, { message: 'jump is ignored while the joystick is held' }).toBe(false);
  await tap('#ability-button', 3);
  await expect.poll(
    async () => parseFloat(await page.locator('#ability-cooldown').evaluate(mask => mask.style.height)),
    { message: 'the signature ability is ignored while the joystick is held' },
  ).toBeGreaterThan(50);
  // The thumb never left the stick through any of that.
  expect((await snapshot(page)).input.joyY).toBeLessThan(-0.5);

  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [thumb] });
  await touch.detach();
  expect(errors).toEqual([]);
});

const centre = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
};
const openLayoutEditor = async page => {
  await page.getByRole('button', { name: 'Pause game' }).click();
  await page.locator('#menu-settings').click();
  await page.locator('#layout-edit').click();
  await expect(page.locator('#layout-editor')).toBeVisible();
};

test('a dragged control keeps its new place, and driving from it still works', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The joystick and its neighbours only exist on touch devices.');
  const errors = await boot(page);
  await start(page);
  const home = await centre(page, '#joystick');
  await openLayoutEditor(page);

  const touch = await page.context().newCDPSession(page);
  const target = { x: Math.round(page.viewportSize().width * 0.68), y: Math.round(page.viewportSize().height * 0.62), id: 1 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...home, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [target] });
  const moved = await centre(page, '#joystick');
  expect(Math.hypot(moved.x - target.x, moved.y - target.y)).toBeLessThan(8);
  // Arranging a control is not using it: that drag went nowhere near
  // the player, or the stick would be steering while it is picked up.
  expect((await snapshot(page)).input.joyY).toBe(0);
  await page.locator('#layout-done').click();

  // The stick drives from wherever it now lives.
  const resting = await centre(page, '#joystick');
  const initial = await snapshot(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...resting, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: resting.x, y: resting.y - 40, id: 2 }] });
  await expect.poll(async () => (await snapshot(page)).position.z).toBeLessThan(initial.position.z - 0.4);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: resting.x, y: resting.y - 40, id: 2 }] });
  await touch.detach();

  // And a layout is a setting, not a session: it comes back.
  await boot(page);
  await start(page);
  const remembered = await centre(page, '#joystick');
  expect(Math.hypot(remembered.x - moved.x, remembered.y - moved.y)).toBeLessThan(8);
  expect(errors).toEqual([]);
});

test('controls can be arranged from the lobby, before play has begun', async ({ page }) => {
  const errors = await boot(page);
  // A tablet shows the lobby its own settings button, and that is the
  // way in for a player who has not pressed play yet — it used to lead
  // to a greyed-out button and nothing else.
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.locator('#layout-edit')).toBeEnabled();
  await page.locator('#layout-edit').click();
  await expect(page.locator('#layout-editor')).toBeVisible();
  await expect(page.locator('#ability-button')).toBeVisible();

  const home = await centre(page, '#ability-button');
  const target = { x: Math.round(page.viewportSize().width * 0.3), y: Math.round(page.viewportSize().height * 0.42) };
  await page.mouse.move(home.x, home.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  const moved = await centre(page, '#ability-button');
  expect(Math.hypot(moved.x - target.x, moved.y - target.y)).toBeLessThan(8);

  await page.locator('#layout-done').click();
  // The HUD was borrowed for the arranging, not entered: the lobby is
  // still the lobby afterwards.
  await expect(page.locator('#game-hud')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'lobby');

  await start(page);
  const inGame = await centre(page, '#ability-button');
  expect(Math.hypot(inGame.x - moved.x, inGame.y - moved.y)).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test('the layout editor moves buttons with a mouse and puts them all back', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mouse path runs once on desktop Chromium.');
  const errors = await boot(page);
  await start(page);
  const home = await centre(page, '#ability-button');
  await openLayoutEditor(page);
  await page.mouse.move(home.x, home.y);
  await page.mouse.down();
  await page.mouse.move(240, 360, { steps: 8 });
  await page.mouse.up();
  const moved = await centre(page, '#ability-button');
  expect(Math.hypot(moved.x - 240, moved.y - 360)).toBeLessThan(8);
  // Dragging a button is not pressing it: the ability never fired.
  expect(await page.locator('#ability-cooldown').evaluate(mask => parseFloat(mask.style.height) || 0)).toBe(0);

  await page.locator('#layout-reset').click();
  const restored = await centre(page, '#ability-button');
  expect(Math.hypot(restored.x - home.x, restored.y - home.y)).toBeLessThan(2);
  await page.locator('#layout-done').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('astra-journey-v1')).layout)).toEqual({});
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
      hero.group.updateMatrixWorld(true);
      // Drift has to be read in world space. A root bone's own x/z
      // are only the horizontal plane when the rig is authored
      // Y-up, and Arthur's bind pose is a quarter turn off, so
      // local coordinates would measure his vertical bob as travel
      // and let his real travel through unmeasured.
      const origins = roots.map(root => root.getWorldPosition(new THREE.Vector3()));
      const world = new THREE.Vector3();
      let drift = 0, rise = 0;
      const actions = {};
      for (const state of ['Walk', 'Run', 'Sprint', 'Jump', 'Fall', 'Land', 'Idle']) {
        for (let frame = 0; frame < 90; frame++) hero.animate(1 / 60, { state, speed: state === 'Walk' ? 4.2 : state === 'Sprint' ? 11.5 : 8, time: frame / 60 });
        actions[state] = hero.diagnostics.activeAction;
        hero.group.updateMatrixWorld(true);
        roots.forEach((root, index) => {
          drift = Math.max(drift, Math.hypot(root.getWorldPosition(world).x - origins[index].x, world.z - origins[index].z));
          // Height is the one channel in-place keeps, so a clip that
          // arrives in another rig's units has nothing between it and
          // the character taking off. A sprint that climbs instead of
          // running reads here and nowhere else: the bounding box
          // below measures how tall he is, not how high he is.
          rise = Math.max(rise, Math.abs(world.y - origins[index].y));
        });
      }
      const bounds = new THREE.Box3().setFromObject(hero.group);
      results.push({ id, skinCount: skins.length, boundBones: skins.every(skin => skin.skeleton.bones.length > 0), height: bounds.max.y - bounds.min.y,
        drift, rise, actions, mixerTime: hero.mixer.time, diagnostics: hero.diagnostics });
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
    expect(model.rise, `${model.id} leaves the ground`).toBeLessThan(model.height * 0.25);
    expect(model.actions.Walk).toMatch(/Walk/i);
    expect(model.actions.Sprint).toMatch(/Sprint/i);
    expect(model.actions.Land).toMatch(/Land/i);
    expect(model.diagnostics.orientationYaw).toBe(0);
  }
  expect(errors).toEqual([]);
});
