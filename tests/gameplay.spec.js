import { test, expect } from '@playwright/test';

const snapshot = page => page.evaluate(() => window.__ASTRA_DEBUG__);
async function enterCity(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.astraReady === true);
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

test('the nearby horse can be ridden, moves with momentum and returns to walking', async ({ page }) => {
  const errors = await enterCity(page);
  await expect(page.locator('#interaction-text')).toHaveText('Ride trail horse');
  await page.locator('#interact-button').click();
  await expect.poll(async () => (await snapshot(page)).activities.mounted).toBe(true);
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('mount');
  await expect(page.locator('#camera-mode')).toHaveText('MOUNTED');
  await expect(page.locator('#interaction-text')).toHaveText('Dismount');
  const initial = await snapshot(page);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await snapshot(page)).position.z).toBeLessThan(initial.position.z - .5);
  const moving = await snapshot(page);
  expect(moving.locomotion.speed).toBeGreaterThan(1);
  expect(moving.activities.mount.z).toBeCloseTo(moving.position.z, 4);
  await page.keyboard.up('KeyW');
  await expect.poll(async () => (await snapshot(page)).locomotion.speed).toBeLessThan(.1);
  await page.locator('#interact-button').click();
  await expect.poll(async () => (await snapshot(page)).activities.mounted).toBe(false);
  await expect.poll(async () => (await snapshot(page)).camera.mode).toBe('follow');
  const dismounted = await snapshot(page);
  expect(dismounted.locomotion.grounded).toBe(true);
  expect(dismounted.position.y).toBeCloseTo(dismounted.terrain.height, 2);
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
  const radius = (await snapshot(page)).camera.radius;
  await page.mouse.move(800, 400);
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await snapshot(page)).camera.radius).toBeLessThan(radius - 1);
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
