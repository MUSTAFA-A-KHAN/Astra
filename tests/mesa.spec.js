import { test, expect } from '@playwright/test';

const terrainFiles = ['/mesa-world.js', '/map/worldmachine_terrain.glb'];
// The lantern is shared with the city's camp; these belong only to the mesa.
const sanctuaryFiles = ['moonwell-well', 'moonwell-stone-circle', 'moonwell-keeper', 'moonwell-ghost-stag', 'treasure-chest']
  .map(name => `/assets/story/${name}.glb`);

// Clock and placement controls exist only in this intercepted response. All
// interactions, destination selection, map loading, walking and saving use
// the shipped game code.
const probe = `
renderer.setAnimationLoop(null);
window.__MESA_TEST__ = {
  render() {
    world.update(0,time,position);
    updateGuideLight(1,time);updateHUD();drawMap();
    camera.position.set(position.x+10,position.y+10,position.z+15);
    camera.lookAt(position.x,position.y+2,position.z);
    renderer.render(scene,camera);
  },
  place(x,z) {
    for(const e of enemies){e.alive=false;e.respawn=1e9;}
    resetInput();yaw=0;pitch=.15;radius=8;
    position.set(x,world.getHeight(x,z),z);
    locomotion.reset();avatar.position.copy(position);closed.at=0;
    followCamera.reset(position,yaw,pitch,radius);
    const near=nearbyInteraction();
    $('interaction-hint').hidden=!near;
    if(near)$('interaction-text').textContent=near.label;
    this.render();return near;
  },
  person(name) {
    const p=story.places[name];
    return this.place(p.x+Math.sin(p.facing)*3.4,p.z+Math.cos(p.facing)*3.4);
  },
  book() { const p=portal.places.reading;return this.place(p.x,p.z); },
  async finishCrossing() {
    const deadline=Date.now()+120000;
    while(portalJourney&&Date.now()<deadline) {
      time+=.05;portal.update(.05,time);updatePortalJourney(.05);
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    if(portalJourney)throw Error('Portal did not finish: '+portalJourney.phase);
    this.render();return world.activeMap;
  },
  walk(x,z) {
    resetInput();yaw=0;
    for(let i=0;i<1800;i++) {
      const dx=x-position.x,dz=z-position.z,d=Math.hypot(dx,dz);
      if(d<.12)break;
      joyX=dx/d;joyY=dz/d;time+=1/60;updatePlayer(1/60);
    }
    joyX=joyY=0;
    for(let i=0;i<30;i++)updatePlayer(1/60);
    this.render();return {distance:Math.hypot(x-position.x,z-position.z),...this.summary()};
  },
  sanctuary() {
    const where=p=>({x:p.x,z:p.z,region:world.biomeAt(p.x,p.z)});
    const {maren,hart,chest,lantern}=story.places;
    const front={x:maren.x+Math.sin(maren.facing)*3.4,z:maren.z+Math.cos(maren.facing)*3.4};
    return {well:where(world.landmarks.find(l=>l.id==='shrine')),maren:where(maren),hart:where(hart),chest:where(chest),lantern:where(lantern),front:where(front)};
  },
  summary() {
    this.render();
    return {map:world.activeMap,region:region(),terrain:{...world.diagnostics},
      position:{x:position.x,y:position.y,z:position.z},ground:world.getHeight(position.x,position.z),
      walkable:world.isWalkable(position.x,position.z,.52),inWater:locomotion.inWater,
      colliders:[...collision.entries.keys()].filter(id=>String(id).startsWith('city-')).length,
      story:{...story.diagnostics},step:currentStep().id,guide:lightFor?.key??null,
      objective:questObjective(),book:portal.places.book,
      journey:portalJourney?.route.destination??null};
  },
};
`;

async function boot(page) {
  const errors = [], requested = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/');
  await ready(page);
  return { errors, requested };
}

async function ready(page) {
  await page.waitForFunction(() => window.astraReady && window.__MESA_TEST__, null, { timeout: 120000 });
  await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.screen === 'game');
}

const summary = page => page.evaluate(() => window.__MESA_TEST__.summary());
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('astra-journey-v1')));
async function interact(page) {
  if (await page.evaluate(() => matchMedia('(pointer:coarse)').matches)) await page.locator('#interact-button').click();
  else await page.keyboard.press('f');
}
async function useBook(page) {
  expect((await page.evaluate(() => window.__MESA_TEST__.book()))?.id).toBe('keeper-spellbook');
  await interact(page);
}
async function finishCrossing(page, map) {
  await expect(page.locator('#conversation')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
  expect(await page.evaluate(() => window.__MESA_TEST__.finishCrossing())).toBe(map);
  await expect(page.locator('#portal-veil')).not.toHaveClass(/visible/);
}
async function speak(page, name, label) {
  await page.evaluate(name => window.__MESA_TEST__.person(name), name);
  await expect(page.locator('#interaction-text')).toHaveText(label);
  await interact(page);
  await expect(page.locator('#conversation')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
}
function grounded(state) {
  expect(state.walkable).toBe(true);
  expect(state.inWater).toBe(false);
  expect(Math.abs(state.position.y - state.ground)).toBeLessThan(.05);
}

test('Red Mesa waits for the portal, keeps the Moonwell walkable, resumes in chapter one, and releases its resources on return', async ({ page }) => {
  test.setTimeout(360000);
  const { errors, requested } = await boot(page);
  await expect.poll(async () => (await summary(page)).story.loaded, { timeout: 120000 }).toContain('The Tidewarden');
  const initial = await summary(page);
  expect(initial.map).toBe('city');
  expect(initial.terrain.residentMaps).toEqual(['city']);
  expect(initial.terrain.mesaReachable).toBe(false);
  expect(requested.filter(path => [...terrainFiles, ...sanctuaryFiles].includes(path))).toEqual([]);
  expect(initial.story.loaded).not.toContain('Maren');

  // The first chapter sends the newcomer to the book before Maren; it does
  // not require the ledger that the player only finds later in that chapter.
  await speak(page, 'notice', 'Read the notice board');
  const keeper = await summary(page);
  expect(keeper.step).toBe('keeper');
  expect(keeper.guide).toBe('keeper:portal:mesa');
  expect(keeper.objective).toMatchObject({ x: keeper.book.x, z: keeper.book.z });
  expect((await saved(page)).story.ledger).toBe(false);
  await useBook(page);
  await finishCrossing(page, 'mesa');
  expect(requested).toEqual(expect.arrayContaining(terrainFiles));
  const arrival = await summary(page);
  expect(arrival.region).toBe('mesa');
  expect(arrival.terrain.residentMaps).toEqual(['mesa']);
  expect(arrival.terrain.assets).toEqual(['map/worldmachine_terrain.glb']);
  expect(arrival.colliders).toBe(arrival.terrain.colliderCount);
  expect(arrival.guide).toBe('keeper:maren');
  grounded(arrival);
  await expect.poll(async () => (await summary(page)).story.loaded.length, { timeout: 120000 }).toBe(6);
  expect((await summary(page)).story.loaded).not.toContain('Tobin');
  expect(requested).toEqual(expect.arrayContaining(sanctuaryFiles));

  const sanctuary = await page.evaluate(() => window.__MESA_TEST__.sanctuary());
  expect(sanctuary.well).toMatchObject({ x: 90, z: 140 });
  for (const [name, place] of Object.entries(sanctuary)) expect(place.region, name).toBe('mesa');
  await page.evaluate(() => window.__MESA_TEST__.place(-5, 125));
  for (const [x, z] of [[40, 134], [sanctuary.front.x, sanctuary.front.z]]) {
    const step = await page.evaluate(([x, z]) => window.__MESA_TEST__.walk(x, z), [x, z]);
    expect(step.distance, `Could not reach ${x},${z}`).toBeLessThan(.2);
    expect(step.region).toBe('mesa');
    grounded(step);
  }
  // The original gully and summit remain traversable on the isolated map.
  await page.evaluate(() => window.__MESA_TEST__.place(-5, 125));
  for (const point of [[-5,150],[-5,176],[-5,191],[-11,197],[-17,202],[-23,208],[-29,214],[-35,218],[-41,223],[-47,229]]) {
    const step = await page.evaluate(([x, z]) => window.__MESA_TEST__.walk(x, z), point);
    expect(step.distance, `Could not reach ${point.join(',')}`).toBeLessThan(.6);
    expect(step.inWater).toBe(false);
    expect(Math.abs(step.position.y - step.ground)).toBeLessThan(.05);
  }
  expect((await summary(page)).position.y).toBeGreaterThan(58);

  const beforeReload = await saved(page);
  expect(beforeReload.map).toBe('mesa');
  expect(beforeReload.story.ledger).toBe(false);
  expect(beforeReload.chapterTwo.accepted).toBe(false);
  await page.reload();
  await ready(page);
  const resumed = await summary(page);
  expect(resumed.map).toBe('mesa');
  expect(resumed.terrain.residentMaps).toEqual(['mesa']);
  expect(resumed.step).toBe('keeper');
  grounded(resumed);
  expect((await saved(page)).story).toEqual(beforeReload.story);

  await speak(page, 'maren', 'Speak with Maren');
  const shards = await summary(page);
  expect(shards.step).toBe('shards');
  expect(shards.guide).toBe('shards:portal:city');
  expect(shards.objective).toMatchObject({ x: shards.book.x, z: shards.book.z });
  await useBook(page);
  await finishCrossing(page, 'city');
  const home = await summary(page);
  expect(home.terrain.residentMaps).toEqual(['city']);
  expect(home.terrain.assets).toHaveLength(1);
  expect(home.terrain.mesaReachable).toBe(false);
  expect(home.story.loaded).not.toContain('Maren');
  expect(home.colliders).toBe(home.terrain.colliderCount);
  expect(home.guide).toMatch(/^shards:\d+$/);
  grounded(home);
  expect((await saved(page)).map).toBe('city');
  expect((await saved(page)).story.ledger).toBe(false);
  expect(errors).toEqual([]);
});

test('the destination menu offers Red Mesa without loading it until selected', async ({ page }) => {
  test.setTimeout(240000);
  await page.addInitScript(() => localStorage.setItem('astra-journey-v1', JSON.stringify({
    quality: 'low', sound: false, hero: 'warden', restored: true, kills: 3, collected: [0, 1, 2, 3, 4],
    story: { notice: true, keeper: true, ferryman: true, ledger: true, farewell: true },
    chapterTwo: { accepted: true, roots: true, bells: true, valves: true, vigil: true, warden: true, complete: true },
  })));
  const { errors, requested } = await boot(page);
  await useBook(page);
  await expect(page.locator('#dialog-title')).toHaveText('Choose a passage');
  await expect(page.locator('[data-portal-destination="mesa"]')).toHaveText('Travel to Red Mesa');
  await expect(page.locator('[data-portal-destination="forest"]')).toBeVisible();
  await expect(page.locator('[data-portal-destination="street"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  expect((await summary(page)).journey).toBeNull();
  expect(requested.filter(path => terrainFiles.includes(path))).toEqual([]);
  await useBook(page);
  await page.locator('[data-portal-destination="mesa"]').click();
  await finishCrossing(page, 'mesa');
  expect((await summary(page)).terrain.residentMaps).toEqual(['mesa']);
  expect(requested).toEqual(expect.arrayContaining(terrainFiles));
  expect(errors).toEqual([]);
});
