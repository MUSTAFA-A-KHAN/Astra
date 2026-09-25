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

test('all four districts load offline and the roster and menus remain usable', async ({ page }) => {
  const districtResponses = [];
  const districtFailures = [];
  const district = url => ['/City_Set_-_Proto_Series/', '/forest-loner-diorama/', '/plaza-night-time/', '/map-79-void/'].some(folder => url.includes(folder));
  page.on('response', response => {
    if (district(response.url())) districtResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  page.on('requestfailed', request => {
    if (district(request.url())) districtFailures.push(request.url());
  });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const errors = await boot(page);
  expect(districtFailures).toEqual([]);
  expect(districtResponses.some(response => response.path.endsWith('.gltf'))).toBe(true);
  expect(districtResponses.some(response => response.path.endsWith('.bin'))).toBe(true);
  expect(districtResponses.some(response => response.path.endsWith('.png'))).toBe(true);
  // The diorama ships as one file: its textures travel inside the binary.
  expect(districtResponses.some(response => response.path.endsWith('.glb'))).toBe(true);
  expect(districtResponses.some(response => /\.fbx(\.br)?$/i.test(response.path))).toBe(false);
  // The plaza opens on its footprint alone; its model is fetched once the game is running.
  expect(districtResponses.some(response => response.path.endsWith('/plaza-night-footprint.glb'))).toBe(true);
  // The yard is packed into one file, and never reaches for the supplied glTF it was built from.
  expect(districtResponses.some(response => response.path.endsWith('/skibidi-toilet-79.glb'))).toBe(true);
  expect(districtResponses.some(response => response.path.includes('/map-79-void/source/'))).toBe(false);
  expect(districtResponses.every(response => response.status === 200)).toBe(true);
  const { terrain } = await snapshot(page);
  expect(terrain.ready).toBe(true);
  expect(terrain.provider).toBe('astra-world-map');
  expect(terrain.asset).toContain('City_Set_-_Proto_Series.gltf');
  expect(terrain.assets).toHaveLength(4);
  expect(terrain.triangleCount).toBeGreaterThan(500_000);
  expect(terrain.meshCount).toBeGreaterThan(0);
  expect(terrain.colliderCount).toBeGreaterThan(0);
  // The island is only a place if the jetty reaches it from the city's spawn.
  expect(terrain.forestReachable).toBe(true);
  // And the plaza only if the east jetty does.
  expect(terrain.plazaReachable).toBe(true);
  // And the yard's pier only if the south jetty does.
  expect(terrain.yardReachable).toBe(true);
  // Every street lantern in the city model is found and given light.
  expect(terrain.streetLights.lanterns).toBeGreaterThan(100);
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
  // A starter hero has no gestures, so there is no picker to open.
  await expect(page.locator('#emote-button')).toBeHidden();
  await page.getByRole('button', { name: 'Open quest journal' }).click();
  await expect(page.locator('#dialog-content')).toContainText('The woman at the well');
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
  // The flashlight found the rig's left hand, and followed the switch back.
  expect(state.flashlight.mount).toBe('hand');
  await page.getByRole('button', { name: 'Return to character lobby' }).click();
  await page.getByRole('button', { name: /Select Cael,/ }).click();
  await expect.poll(async () => (await snapshot(page)).hero).toBe('warden');
  expect((await snapshot(page)).flashlight.mount).toBe('shield');
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

test('Gwen reads, talks, limps and fidgets in place with her feet on the floor', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Detailed asset validation runs once on desktop Chromium.');
  test.setTimeout(process.env.CI ? 480000 : 240000);
  const errors = await boot(page);
  const result = await page.evaluate(async () => {
    const { createHero } = await import('/characters.js');
    const THREE = await import('three');
    const hero = await createHero('Spiderman');

    const feet = [];
    let hips = null;
    hero.group.traverse(object => {
      if (object.isBone && /Foot|Toe/i.test(object.name)) feet.push(object);
      if (!hips && object.isBone && /hips/i.test(object.name)) hips = object;
    });

    const point = new THREE.Vector3();
    let anchor = null;
    // As Arthur's emotes are measured, but against the floor her walk
    // lands on: the gaits play exactly as they were authored. Drift is
    // the hips' own: her clips carry them, root motion and all.
    const scan = (options, seconds) => {
      const band = { lowest: Infinity, drift: 0, actions: new Set() };
      for (let frame = 0; frame < Math.round(seconds * 30); frame++) {
        hero.animate(1 / 30, { speed: 0, fidget: false, time: frame / 30, ...options });
        hero.group.updateMatrixWorld(true);
        for (const bone of feet) band.lowest = Math.min(band.lowest, bone.getWorldPosition(point).y);
        hips.getWorldPosition(point);
        anchor ??= point.clone();
        band.drift = Math.max(band.drift, Math.hypot(point.x - anchor.x, point.z - anchor.z));
        band.actions.add(hero.diagnostics.activeAction);
      }
      band.actions = [...band.actions];
      return band;
    };

    const floor = scan({ state: 'Walk', moving: true, speed: 3 }, 3).lowest;
    anchor = null;
    const selected = hero.diagnostics.selectedAnimations;
    const bands = { Idle: scan({ state: 'Idle' }, 3) };
    for (const state of [...Object.keys(selected.emotes), ...Object.keys(selected.actions)]) {
      bands[state] = scan({ state }, Math.min(hero.cue(state), 4));
      scan({ state: 'Idle' }, 0.5);
    }
    bands.Read = scan({ state: 'Read' }, 6);
    bands['Read, put away'] = scan({ state: 'Idle' }, 2.5);
    bands.Injured = scan({ state: 'Idle', injured: true }, 3);
    bands.Limp = scan({ state: 'Walk', injured: true, moving: true, speed: 2 }, 6);

    // Left standing, she finds something to do with herself.
    const fidgets = new Set();
    for (let frame = 0; frame < 40 * 10; frame++) {
      hero.animate(1 / 10, { state: 'Idle', time: frame / 10 });
      if (hero.diagnostics.fidget) fidgets.add(hero.diagnostics.fidget);
    }

    const height = hero.height;
    hero.dispose();
    return { selected, bands, floor, height, fidgets: [...fidgets] };
  });

  const { selected } = result;
  expect(Object.keys(selected.emotes)).toEqual(expect.arrayContaining(['Dance', 'Sad', 'Wave', 'Cheer', 'Point', 'Stomp', 'Salute', 'Sing']));
  // A different dance each time.
  expect(selected.emotes.Dance).toHaveLength(4);
  expect(Object.keys(selected.actions).sort()).toEqual(['Interact', 'Kneel', 'Push', 'Talk']);
  expect(selected.read.enter).toMatch(/Trans_SpellBook/);
  expect(selected.read.loop).toMatch(/Read_Loop/);
  expect(selected.read.exit).toMatch(/SpellBook_Trans_Stand/);
  expect(selected.injured.idle).toBeTruthy();
  expect(selected.injured.walk).toBeTruthy();
  expect(result.fidgets.length).toBeGreaterThan(0);

  // The book is opened, read, and closed again.
  expect(result.bands.Read.actions).toEqual([selected.read.enter, selected.read.loop]);
  expect(result.bands['Read, put away'].actions).toEqual([selected.read.exit, 'Idle']);
  expect(result.bands.Limp.actions).toEqual([selected.injured.walk]);

  for (const [state, band] of Object.entries(result.bands)) {
    // Her clips come from three different rigs, each with its own idea
    // of where the hips sit: an idle stood a hand's width in the air, a
    // kneel with no hip track hung above the ground.
    expect.soft(band.lowest, `${state} sinks below the floor`).toBeGreaterThan(result.floor - result.height * 0.03);
    expect.soft(band.lowest, `${state} never reaches the floor`).toBeLessThan(result.floor + result.height * 0.03);
    // Sway is allowed; travel is not. An in-place walk left with its
    // root motion carries her metres off and snaps her back.
    expect.soft(band.drift, `${state} walks away from the player position`).toBeLessThan(result.height * 0.05);
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
  expect((await snapshot(page)).terrain.streetLights.power).toBe(0);
  const night = await setHour(0);
  expect((await snapshot(page)).terrain.streetLights.power).toBe(1);
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
  for (const selector of ['#joystick', '#jump-button', '#sprint-button', '#attack-button', '#ability-button', '#view-button']) {
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

  // No control may begin a gesture of its own: they are pressed and dragged.
  const touchAction = selector => page.locator(selector).evaluate(element => getComputedStyle(element).touchAction);
  for (const selector of ['#attack-button', '#ability-button', '#jump-button', '#view-button', '#joystick', '#sprint-button']) {
    expect(await touchAction(selector), `${selector} may not begin a gesture`).toBe('none');
  }

  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [thumb] });
  await touch.detach();
  expect(errors).toEqual([]);
});

// Driving with one thumb and pressing the buttons with another is two fingers
// on the glass, and Safari reads the second one arriving and leaving as a
// pinch — it zoomed the page mid-fight, leaving half the HUD out of reach on a
// screen that cannot scroll. iOS does not honour `touch-action` for the
// viewport's own zoom, so play has to refuse the gesture itself.
test('two fingers on the controls never zoom the page away from the player', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Only a touch screen has a pinch to refuse.');
  const errors = await boot(page);
  await start(page);
  await page.evaluate(() => {
    window.gestures = [];
    for (const type of ['touchmove', 'gesturestart'])
      addEventListener(type, event => window.gestures.push({ type, refused: event.defaultPrevented }), { passive: true });
  });
  const touch = await page.context().newCDPSession(page);
  const stick = await centre(page, '#joystick'), button = await centre(page, '#attack-button');
  const thumb = { ...stick, id: 1 }, finger = { ...button, id: 2 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [thumb] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [thumb, finger] });
  // The tapping finger never lands twice in quite the same place; the drift
  // between the two touches is the spread Safari zooms on.
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [thumb, { ...finger, x: finger.x + 40 }] });
  const moves = await page.evaluate(() => window.gestures);
  expect(moves.length, 'the two-fingered move reached the page').toBeGreaterThan(0);
  expect(moves.every(gesture => gesture.refused), JSON.stringify(moves)).toBe(true);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...finger, x: finger.x + 40 }] });
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

test('the view button cycles camera perspectives and remembers the one you left on', async ({ page }) => {
  const errors = await boot(page);
  await start(page);
  const settled = async () => {
    await page.waitForFunction(() => window.__ASTRA_DEBUG__.camera.settling === 0, null, { timeout: 10000 });
    return (await snapshot(page)).camera;
  };
  const shape = view => `${view.pitch.toFixed(2)}/${view.radius.toFixed(1)}/${view.fov.toFixed(0)}`;

  const seen = [await settled()];
  for (let press = 0; press < 4; press++) {
    await page.locator('#view-button').click();
    seen.push(await settled());
  }
  expect(seen.map(view => view.view)).toEqual(['follow', 'close', 'shoulder', 'wide', 'overhead']);
  // Five names are worth nothing if they are the same camera: each one
  // has to be a different pitch, distance and field of view.
  expect(new Set(seen.map(shape)).size).toBe(5);
  // And the close one has to be the closest, or it is not what it says.
  const distances = seen.map(view => view.radius);
  expect(Math.min(...distances)).toBe(seen[1].radius);
  expect(await page.locator('#view-label').textContent()).toBe('Overhead');
  await page.locator('#view-button').click();
  expect((await settled()).view).toBe('follow');

  // The key does what the button does.
  await page.keyboard.press('v');
  expect((await settled()).view).toBe('close');

  // Dragging moves the camera off the perspective without choosing a
  // different one — a preset is a posture, not a mode to be locked in.
  const posture = await settled();
  const middle = page.viewportSize();
  await page.mouse.move(middle.width / 2, middle.height / 2);
  await page.mouse.down();
  await page.mouse.move(middle.width / 2, middle.height / 2 - 100, { steps: 5 });
  await page.mouse.up();
  const dragged = (await snapshot(page)).camera;
  expect(dragged.pitch).toBeLessThan(posture.pitch - 0.05);
  expect(dragged.view).toBe('close');

  // And the choice outlives the session.
  await boot(page);
  await start(page);
  const remembered = await settled();
  expect(remembered.view).toBe('close');
  expect(shape(remembered)).toBe(shape(seen[1]));
  expect(await page.locator('#view-label').textContent()).toBe('Close');
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

test('the plaza model streams in once the game is running', async ({ page }) => {
  const errors = await boot(page);
  await start(page);
  // It is fetched behind the game, so allow for a slow link as well as a slow renderer.
  await expect.poll(async () => (await snapshot(page)).terrain.plaza.state, { timeout: 120000 }).toBe('ready');
  const { terrain } = await snapshot(page);
  expect(terrain.plazaReachable).toBe(true);
  // Tiled, so what is out of view or out of range is never drawn.
  expect(terrain.plaza.tiles).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
