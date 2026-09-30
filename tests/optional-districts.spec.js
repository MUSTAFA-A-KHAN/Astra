import { test, expect } from '@playwright/test';

// Exercise the game's actual terrain, controller and camera. The hook exists
// only in this intercepted test response, never in the shipped game. The
// patrols are put down first: a hero walking a fixed line past them would be
// fought, and sent back to the city.
const probe = `
window.__DISTRICT_TEST__ = {
  place(x, z) {
    renderer.setAnimationLoop(null);
    for(const e of enemies){e.alive=false;e.respawn=1e9;}
    resetInput();
    position.set(x, world.getHeight(x, z), z);
    locomotion.reset();
    avatar.position.copy(position);
    yaw=0;pitch=.15;radius=8;
    followCamera.reset(position,yaw,pitch,radius);
    world.update(0,time,position);
  },
  walk(x, z) {
    for(let frames=0;frames<1800;frames++) {
      const dx=x-position.x,dz=z-position.z,d=Math.hypot(dx,dz);
      if(d<.12)break;
      joyX=dx/d;joyY=dz/d;
      time+=1/60;updatePlayer(1/60);
    }
    joyX=joyY=0;
    for(let i=0;i<30;i++)updatePlayer(1/60);
    const { terrain, locomotion: stride } = window.__ASTRA_DEBUG__;
    return {distance:Math.hypot(x-position.x,z-position.z),y:position.y,ground:terrain.height,region:world.biomeAt(position.x,position.z),inWater:stride.inWater};
  },
};
`;
// What each optional district fetches once enabled. Red Mesa uses the portal
// instead; its on-demand loading and crossing are covered by mesa.spec.js.
const FILES = {
  plaza: ['/plaza-world.js', '/plaza-lighting.js', '/plaza-light-sources.js', '/plaza-night-time/plaza-night-footprint.glb', '/plaza-night-time/plaza-navigation.json', '/plaza-night-time/plaza-night.glb'],
  nightwood: ['/nightwood-world.js', '/map/a_forest_3_with_a_road_at_night_for_game.glb'],
};

// Boots the game as a new player finds it, where no district that must be
// turned on has been fetched, then turns `district` on in the settings.
async function turnOn(page, district) {
  const errors = [], requested = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.astraReady && window.__DISTRICT_TEST__);
  await expect(page.locator('#loading')).toBeHidden();
  const optional = Object.values(FILES).flat();
  expect(requested.filter(path => optional.includes(path))).toEqual([]);
  // It takes a fresh world, and only then is fetched.
  await page.getByRole('button', { name: 'Open settings' }).click();
  const setting = page.locator(`#${district}-setting`);
  await expect(setting).not.toBeChecked();
  await Promise.all([page.waitForEvent('load'), setting.click()]);
  await page.waitForFunction(() => window.astraReady && window.__DISTRICT_TEST__);
  await expect(page.locator('#loading')).toBeHidden();
  // A model that streams in behind the game is asked for a moment after it opens.
  await expect.poll(() => requested.filter(path => optional.includes(path)).sort()).toEqual([...FILES[district]].sort());
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(setting).toBeChecked();
  await page.getByRole('button', { name: 'Close menu' }).click();
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
  return errors;
}

// Walks the route from `start`, standing on the ground all the way; from the
// crossing's landing on (where `from` says, given x and z), inside `region`.
// On a slope steep enough to slide, a hero who stops settles a little
// downhill: `tolerance` allows for that.
async function walk(page, start, route, { region, from, tolerance = .2 }) {
  await page.evaluate(([x, z]) => window.__DISTRICT_TEST__.place(x, z), start);
  for (const [x, z] of route) {
    const step = await page.evaluate(([x, z]) => window.__DISTRICT_TEST__.walk(x, z), [x, z]);
    expect(step.distance, `Could not reach ${x},${z}`).toBeLessThan(tolerance);
    expect(step.inWater, `In the water at ${x},${z}`).toBe(false);
    expect(Math.abs(step.y - step.ground), `Not standing on the ground at ${x},${z}`).toBeLessThan(.05);
    if (from(x, z)) expect(step.region).toBe(region);
  }
}

test('the Lantern Plaza is fetched only once turned on, and the east jetty reaches its street', async ({ page }) => {
  test.setTimeout(240000);
  const errors = await turnOn(page, 'plaza');
  const { terrain } = await page.evaluate(() => window.__ASTRA_DEBUG__);
  expect(terrain.assets).toHaveLength(4);
  expect(terrain.plazaReachable).toBe(true);
  await expect.poll(async () => (await page.evaluate(() => window.__ASTRA_DEBUG__)).terrain.plaza.state, { timeout: 120000 }).toBe('ready');
  // From the end of the spawn road, along the east jetty, over the plinth's
  // rim and down onto the market street.
  await walk(page, [180, 18], [[190, 18], [202, 18], [207, 18]], { region: 'plaza', from: x => x >= 207 });
  expect(errors).toEqual([]);
});

test('the Nightwood is fetched only once turned on, and its road is walked from the north quay', async ({ page }) => {
  test.setTimeout(240000);
  const errors = await turnOn(page, 'nightwood');
  const { terrain } = await page.evaluate(() => window.__ASTRA_DEBUG__);
  expect(terrain.assets).toHaveLength(4);
  expect(terrain.woodReachable).toBe(true);
  // On the promenade along the north quay, then up the ramp, along the deck,
  // off its buried end, and round both of the road's bends to the far side.
  await walk(page, [0, -146], [[0,-155],[0,-165],[0,-176],[1,-197],[13,-207],[31,-215],[48,-223],[60,-235],[61,-247],[54,-258],[42,-268],[31,-279],[19,-290]],
    { region: 'nightwood', from: (x, z) => z <= -176 });
  expect(errors).toEqual([]);
});
