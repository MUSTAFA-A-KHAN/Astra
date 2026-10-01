import { test, expect } from '@playwright/test';

const previous = {
  quality: 'low', sound: false, hero: 'warden', xp: 780,
  restored: true, kills: 3, collected: [0, 1, 2, 3, 4],
  story: { keeper: true, ferryman: true, ledger: true, farewell: true, notice: true },
  chapterTwo: Object.fromEntries(['accepted', 'roots', 'bells', 'valves', 'vigil', 'warden', 'complete'].map(flag => [flag, true])),
};
const asset = '/street_city_7_for_games_free.glb';

// Only the intercepted test response exposes movement and clock controls.
// The book, destination menu, map loading, controller and save use game code.
const probe = `
renderer.setAnimationLoop(null);
window.__STREET_TEST__ = {
  render() {
    world.update(0,time,position);
    chapterTwo.update(0,time,position,{active:false});
    chapterThree.update(0,time,position,{active:false});
    updateHUD();drawMap();
    camera.position.set(position.x+10,position.y+10,position.z+15);
    camera.lookAt(position.x,position.y+2,position.z);
    renderer.render(scene,camera);
  },
  place(x,z) {
    resetInput();yaw=0;
    position.set(x,world.getHeight(x,z),z);
    locomotion.reset();avatar.position.copy(position);closed.at=0;
    const near=nearbyInteraction();
    $('interaction-hint').hidden=!near;
    if(near)$('interaction-text').textContent=near.label;
    this.render();return near;
  },
  book() { const p=portal.places.reading;return this.place(p.x,p.z); },
  async finishCrossing() {
    for(let i=0;i<1200&&portalJourney;i++) {
      time+=.05;portal.update(.05,time);updatePortalJourney(.05);
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    if(portalJourney)throw Error('Portal did not finish: '+portalJourney.phase);
    this.render();return world.activeMap;
  },
  walk(x,z) {
    resetInput();yaw=0;
    for(let i=0;i<1200;i++) {
      const dx=x-position.x,dz=z-position.z,d=Math.hypot(dx,dz);
      if(d<.12)break;
      joyX=dx/d;joyY=dz/d;time+=1/60;updatePlayer(1/60);
    }
    joyX=joyY=0;
    for(let i=0;i<30;i++)updatePlayer(1/60);
    this.render();
    return {distance:Math.hypot(x-position.x,z-position.z),...this.summary()};
  },
  summary() {
    return {map:world.activeMap,region:region(),terrain:{...world.diagnostics},
      position:{x:position.x,y:position.y,z:position.z},ground:world.getHeight(position.x,position.z),
      walkable:world.isWalkable(position.x,position.z,.52),inWater:locomotion.inWater,
      colliders:[...collision.entries.keys()].filter(id=>String(id).startsWith('city-')).length,
      journey:portalJourney?.route.destination??null,step:currentStep().id};
  },
  overview() {
    world.update(0,time,position);
    camera.position.set(-348,75,-236);camera.lookAt(-400,1,-326);
    renderer.render(scene,camera);
  },
};
`;

async function ready(page) {
  await page.waitForFunction(() => window.astraReady && window.__STREET_TEST__, null, { timeout: 120000 });
  await page.locator('#play-button').click();
}
async function useBook(page) {
  const near = await page.evaluate(() => window.__STREET_TEST__.book());
  expect(near?.id).toBe('keeper-spellbook');
  if (await page.evaluate(() => matchMedia('(pointer:coarse)').matches)) await page.locator('#interact-button').click();
  else await page.keyboard.press('f');
}
async function finishCrossing(page, map) {
  await expect(page.locator('#conversation')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
  expect(await page.evaluate(() => window.__STREET_TEST__.finishCrossing())).toBe(map);
  await expect(page.locator('#portal-veil')).not.toHaveClass(/visible/);
}
const summary = page => page.evaluate(() => window.__STREET_TEST__.summary());
const progress = page => page.evaluate(() => {
  const { xp, kills, restored, collected, story, chapterTwo, chapterThree, hero } = JSON.parse(localStorage.getItem('astra-journey-v1'));
  return { xp, kills, restored, collected, story, chapterTwo, chapterThree, hero };
});

test('Street City loads on selection, is walkable, resumes after reload, and returns without changing the story', async ({ page }) => {
  test.setTimeout(300000);
  const errors = [], requested = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  await page.addInitScript(saved => {
    if (!sessionStorage.getItem('street-seeded')) {
      localStorage.setItem('astra-journey-v1', JSON.stringify(saved));
      sessionStorage.setItem('street-seeded', 'yes');
    }
  }, previous);
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/');
  await ready(page);
  const before = await progress(page), first = await summary(page);
  expect(first.map).toBe('city');
  expect(requested).not.toContain(asset);

  await useBook(page);
  await expect(page.locator('#dialog-title')).toHaveText('Choose a passage');
  await expect(page.locator('[data-portal-destination="forest"]')).toHaveText('Travel to Pine Islet');
  await expect(page.locator('[data-portal-destination="street"]')).toHaveText('Explore Street City');
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  expect((await summary(page)).journey).toBeNull();
  expect(requested).not.toContain(asset);

  await useBook(page);
  await page.locator('[data-portal-destination="street"]').click();
  await finishCrossing(page, 'street');
  expect(requested).toContain(asset);
  const arrival = await summary(page);
  expect(arrival.region).toBe('street');
  expect(arrival.terrain.assets).toEqual(['street_city_7_for_games_free.glb']);
  expect(arrival.terrain.residentMaps).toEqual(['street']);
  expect(arrival.terrain.meshCount).toBeGreaterThan(0);
  expect(arrival.terrain.colliderCount).toBeGreaterThan(0);
  expect(arrival.colliders).toBe(arrival.terrain.colliderCount);
  expect(arrival.walkable).toBe(true);
  expect(arrival.inWater).toBe(false);
  expect(arrival.ground).toBeCloseTo(.402, 2);
  expect(Math.abs(arrival.position.y - arrival.ground)).toBeLessThan(.05);
  expect(arrival.step).toBe(first.step);

  // Walk the road past the shops and along its bend using the real controller.
  // The gate stands in the road where the passage lands, so the way goes
  // round its eastern side, by the lane left between its arch and the shops.
  await page.evaluate(() => window.__STREET_TEST__.place(-412, -288));
  for (const point of [[-412, -304], [-405, -306], [-405, -313], [-412, -318], [-412, -320], [-412, -340], [-400, -348], [-388, -356], [-376, -364]]) {
    const step = await page.evaluate(([x, z]) => window.__STREET_TEST__.walk(x, z), point);
    expect(step.distance, `Could not reach ${point.join(',')}`).toBeLessThan(.25);
    expect(step.inWater).toBe(false);
    expect(step.region).toBe('street');
    expect(Math.abs(step.position.y - step.ground)).toBeLessThan(.05);
  }
  // The east shop's wall stops an attempted walk through its facade.
  await page.evaluate(() => window.__STREET_TEST__.place(-412, -300));
  const wall = await page.evaluate(() => window.__STREET_TEST__.walk(-396, -300));
  expect(wall.distance).toBeGreaterThan(3);
  expect(wall.position.x).toBeLessThan(-400);
  expect(wall.inWater).toBe(false);
  await page.evaluate(() => window.__STREET_TEST__.overview());
  await page.screenshot({ path: test.info().outputPath('street-city.png') });
  expect(await progress(page)).toEqual(before);

  await page.reload();
  await ready(page);
  const resumed = await summary(page);
  expect(resumed.map).toBe('street');
  expect(resumed.region).toBe('street');
  expect(resumed.walkable).toBe(true);
  expect(await progress(page)).toEqual(before);
  await useBook(page);
  await expect(page.locator('#menu-dialog')).toBeHidden();
  await finishCrossing(page, 'city');
  expect((await summary(page)).terrain.residentMaps).toEqual(['city']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('astra-journey-v1')).map)).toBe('city');
  expect(await progress(page)).toEqual(before);
  expect(errors).toEqual([]);
});
