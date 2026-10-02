import { test, expect } from '@playwright/test';

// The Lantern Plaza and Nightwood Road are places the keeper's book offers
// for their own sake. Each is fetched only when its passage is read, and
// walked on arrival with the game's actual terrain, controller and camera.
// The hook exists only in this intercepted test response, never in the
// shipped game. The patrols are put down first: a hero walking a fixed line
// past them would be fought, and sent back to the city.
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
  // Stands the hero at the keeper's book by the gate, and says what is offered there.
  book() {
    const p=portal.places.reading;
    resetInput();position.set(p.x,world.getHeight(p.x,p.z),p.z);locomotion.reset();avatar.position.copy(position);closed.at=0;
    return nearbyInteraction();
  },
  async finishCrossing() {
    for(let i=0;i<1200&&portalJourney;i++){
      time+=.05;portal.update(.05,time);updatePortalJourney(.05);
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    if(portalJourney)throw Error('Portal did not finish: '+portalJourney.phase);
    return world.activeMap;
  },
};
`;
// What each place fetches when its passage is read.
const FILES = {
  plaza: ['/plaza-world.js', '/plaza-lighting.js', '/plaza-light-sources.js', '/plaza-night-time/plaza-night-footprint.glb', '/plaza-night-time/plaza-navigation.json', '/plaza-night-time/plaza-night.glb'],
  nightwood: ['/nightwood-world.js', '/map/a_forest_3_with_a_road_at_night_for_game.glb'],
};
// A journey far enough on for the book to open its other passages.
const JOURNEY = {
  quality: 'low', sound: false, hero: 'warden', map: 'city', restored: true, kills: 3, collected: [0, 1, 2, 3, 4],
  story: { keeper: true, ferryman: true, ledger: true, farewell: true, notice: true },
  chapterTwo: Object.fromEntries(['accepted', 'roots', 'bells', 'valves', 'vigil', 'warden', 'complete'].map(flag => [flag, true])),
};

// Boots the game in the city, where neither place has been fetched, and
// crosses to `district` by its passage in the keeper's book.
async function travel(page, district) {
  const errors = [], requested = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  await page.addInitScript(saved => localStorage.setItem('astra-journey-v1', JSON.stringify(saved)), JOURNEY);
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.astraReady && window.__DISTRICT_TEST__);
  await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
  const optional = Object.values(FILES).flat();
  expect(requested.filter(path => optional.includes(path))).toEqual([]);
  // The book offers the place by name, beside the passages the story uses.
  expect((await page.evaluate(() => window.__DISTRICT_TEST__.book()))?.id).toBe('keeper-spellbook');
  await page.keyboard.press('f');
  await expect(page.locator('#dialog-title')).toHaveText('Choose a passage');
  const choice = page.locator(`[data-portal-destination="${district}"]`);
  await expect(choice).toHaveText({ plaza: 'Explore Lantern Plaza', nightwood: 'Explore Nightwood Road' }[district]);
  await choice.click();
  await expect(page.locator('#conversation')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
  expect(await page.evaluate(() => window.__DISTRICT_TEST__.finishCrossing())).toBe(district);
  // Only now is it fetched; a model that streams in behind is asked for a moment after.
  await expect.poll(() => requested.filter(path => optional.includes(path)).sort()).toEqual([...FILES[district]].sort());
  return errors;
}

// Walks the route from `start`, standing on the ground and inside `region`
// all the way. On a slope steep enough to slide, a hero who stops settles a
// little downhill: `tolerance` allows for that.
async function walk(page, start, route, { region, tolerance = .2 }) {
  await page.evaluate(([x, z]) => window.__DISTRICT_TEST__.place(x, z), start);
  for (const [x, z] of route) {
    const step = await page.evaluate(([x, z]) => window.__DISTRICT_TEST__.walk(x, z), [x, z]);
    expect(step.distance, `Could not reach ${x},${z}`).toBeLessThan(tolerance);
    expect(step.inWater, `In the water at ${x},${z}`).toBe(false);
    expect(Math.abs(step.y - step.ground), `Not standing on the ground at ${x},${z}`).toBeLessThan(.05);
    expect(step.region).toBe(region);
  }
}

test('the Lantern Plaza is fetched only once its passage is read, and its square leads up to the cathedral', async ({ page }) => {
  test.setTimeout(240000);
  const errors = await travel(page, 'plaza');
  const { terrain } = await page.evaluate(() => window.__ASTRA_DEBUG__);
  expect(terrain.residentMaps).toEqual(['plaza']);
  expect(terrain.plazaReachable).toBe(true);
  await expect.poll(async () => (await page.evaluate(() => window.__ASTRA_DEBUG__)).terrain.plaza.state, { timeout: 120000 }).toBe('ready');
  // From the market square where the passage lands, round the stalls, down
  // the side street and up the steps to the cathedral's great door.
  await walk(page, [271, 17], [[270.4, 16.1], [265.1, 16.1], [260.6, 14.6], [247.9, 4.9], [248.6, -7.1], [248.6, -18.4], [253.9, -24.4], [255.4, -34.1], [259.1, -35.6], [261.4, -40.1]], { region: 'plaza' });
  expect(errors).toEqual([]);
});

test('the Nightwood is fetched only once its passage is read, and its road is walked through the wood', async ({ page }) => {
  test.setTimeout(240000);
  const errors = await travel(page, 'nightwood');
  const { terrain } = await page.evaluate(() => window.__ASTRA_DEBUG__);
  expect(terrain.residentMaps).toEqual(['nightwood']);
  expect(terrain.woodReachable).toBe(true);
  // From the road's end at the wood's northern edge, where the passage lands,
  // round both of the road's bends to the far side.
  await walk(page, [0, -176], [[1, -197], [13, -207], [31, -215], [48, -223], [60, -235], [61, -247], [54, -258], [42, -268], [31, -279], [19, -290]],
    { region: 'nightwood' });
  expect(errors).toEqual([]);
});
