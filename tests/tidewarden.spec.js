import { test, expect } from '@playwright/test';
import { existingJourney } from './existing-journey.js';

// Rides the Tidewarden through the game's own controls: called from the west
// quay, climbed onto, flown up and away, and landed. The hook exists only in
// this intercepted test response, never in the shipped game: it stands the
// hero on the quay, facing the water, with the patrols put down.
const probe = `
window.__TIDEWARDEN_TEST__ = {
  quay() {
    for (const e of enemies) { e.alive = false; e.respawn = 1e9; }
    const call = story.tidewarden.berth.call;
    resetInput(); position.set(call.x + 1, groundHeight(call.x + 1, call.z), call.z); locomotion.reset(); avatar.position.copy(position);
    yaw = Math.PI / 2; pitch = .32; radius = 14; followLight = 0; followCamera.reset(position, yaw, pitch, radius); updateCamera(1);
  },
  // Looking out to sea again: the guiding light may have turned the view
  // toward the story while the hero waited.
  seaward() { yaw = Math.PI / 2; pitch = .32; followLight = 0; },
  walkable: (x, z) => world.isWalkable(x, z, .5),
};`;
const snapshot = page => page.evaluate(() => window.__ASTRA_DEBUG__);

test('the Tidewarden comes when called from the quay, flies its rider over the city and sets them down', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The ride is checked once on desktop; the held jump button is the same climb as Space.');
  test.setTimeout(150000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await existingJourney(page);
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.astraReady === true && window.__TIDEWARDEN_TEST__);
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.tidewarden.mode === 'circling', null, { timeout: 60000 });

  await page.evaluate(() => window.__TIDEWARDEN_TEST__.quay());
  await expect(page.locator('#interaction-text')).toHaveText('Call the Tidewarden');
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await snapshot(page)).tidewarden.mode).toBe('summoned');
  await expect.poll(async () => (await snapshot(page)).tidewarden.mode, { timeout: 20000 }).toBe('waiting');
  await expect(page.locator('#interaction-text')).toHaveText('Climb onto the Tidewarden');
  const berth = (await snapshot(page)).tidewarden.berth;

  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await snapshot(page)).tidewarden.riding).toBe(true);
  await expect.poll(async () => (await snapshot(page)).tidewarden.leap).toBeNull();
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('flight');
  await expect(page.locator('#camera-mode')).toHaveText('FLYING');
  await expect(page.locator('#interaction-text')).toHaveText('Land the Tidewarden');
  const seated = await snapshot(page);
  expect(seated.tidewarden.mode).toBe('ridden');
  expect(seated.riding.seatGap).toBeLessThan(.001);
  expect(seated.position.y).toBeCloseTo(berth.y, 0);

  // Out over the harbour and up, with jump held.
  await page.evaluate(() => window.__TIDEWARDEN_TEST__.seaward());
  await page.keyboard.down('KeyW'); await page.keyboard.down('Space');
  await expect.poll(async () => (await snapshot(page)).position.y, { timeout: 15000 }).toBeGreaterThan(berth.y + 12);
  await page.keyboard.up('Space');
  await expect.poll(async () => (await snapshot(page)).tidewarden.speed).toBeGreaterThan(8);
  const flying = await snapshot(page);
  expect(flying.position.x).toBeLessThan(berth.x);
  expect(flying.riding.seatGap).toBeLessThan(.001);
  expect(flying.camera.distance).toBeGreaterThan(20);
  expect(flying.locomotion.grounded).toBe(true);
  expect(flying.health).toBe(100);
  // Out past the city's west edge it is still the city's harbour.
  await expect(page.locator('#region-name')).toHaveText('City Quarter');
  await page.screenshot({ path: testInfo.outputPath('tidewarden-flying.png') });
  await page.keyboard.up('KeyW');

  // Attacks and the jump are the ride's, not the hero's, while aloft.
  await page.keyboard.press('KeyQ');
  expect((await snapshot(page)).tidewarden.riding).toBe(true);

  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await snapshot(page)).tidewarden.mode).toBe('landing');
  await expect(page.locator('#interaction-text')).toHaveText('Keep flying');
  await expect.poll(async () => (await snapshot(page)).tidewarden.riding, { timeout: 30000 }).toBe(false);
  await expect.poll(async () => (await snapshot(page)).tidewarden.leap).toBeNull();
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('follow');
  const landed = await snapshot(page);
  expect(landed.locomotion.grounded).toBe(true);
  expect(landed.position.y).toBeCloseTo(landed.terrain.height, 2);
  expect(landed.riding).toBeNull();
  expect(landed.tidewarden.mode).toBe('returning');
  expect(await page.evaluate(({ x, z }) => window.__TIDEWARDEN_TEST__.walkable(x, z), landed.position)).toBe(true);
  await expect(page.locator('#camera-mode')).toHaveText('');
  await page.screenshot({ path: testInfo.outputPath('tidewarden-landed.png') });
  // Left on the water, it can be called again.
  await expect.poll(async () => (await snapshot(page)).tidewarden.mode, { timeout: 40000 }).toBe('circling');
  expect(errors).toEqual([]);
});
