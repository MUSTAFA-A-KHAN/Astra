import { test, expect } from '@playwright/test';

async function boot(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.astraReady === true);
  await expect(page.locator('#play-button')).toBeEnabled();
  await expect(page.locator('#loading')).toBeHidden();
  return errors;
}

const snapshot = page => page.evaluate(() => window.__ASTRA_DEBUG__);
const flashlight = async page => (await snapshot(page)).flashlight;

async function setHour(page, hour) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('slider', { name: 'Time of day' }).evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, hour);
  await expect.poll(async () => (await snapshot(page)).atmosphere.hour).toBe(hour);
  await page.getByRole('button', { name: 'Close menu' }).click();
}

test('heroes take the flashlight out after dusk, and the player can switch it off and on', async ({ page }) => {
  // The plaza, the wisps and the story's people and props arrive behind the
  // game and build their own shaders when they do. Left out, only the
  // flashlight can add one.
  await page.route(/plaza-night\.glb$|\/assets\/story\//, route => route.abort());
  const errors = await boot(page);
  await setHour(page, 13);
  expect(await flashlight(page)).toMatchObject({ ready: true, enabled: true, out: false, intensity: 0, mount: 'shield' });

  await setHour(page, 22);
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
  await expect.poll(async () => (await flashlight(page)).out).toBe(true);
  const lit = await flashlight(page);
  expect(lit.intensity).toBeGreaterThan(0);
  expect(lit.shaft).toBe(true);
  const button = page.getByRole('button', { name: 'Flashlight after dark (T)' });
  await expect(button).toHaveAttribute('aria-pressed', 'true');

  // The beam goes where the hero walks.
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await flashlight(page)).direction[2], { timeout: 15000 }).toBeLessThan(-0.6);
  await page.keyboard.up('KeyW');
  const { direction } = await flashlight(page);
  expect(direction[1]).toBeLessThan(0);

  // Switching it off and on again never recompiles a shader.
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0;
    const step = () => ++frames >= 10 ? resolve() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  }));
  const programs = (await snapshot(page)).render.programs;
  await page.keyboard.press('KeyT');
  await expect.poll(async () => (await flashlight(page)).out).toBe(false);
  expect((await flashlight(page)).intensity).toBeLessThan(lit.intensity * 0.01);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect.poll(async () => (await flashlight(page)).intensity).toBeGreaterThan(lit.intensity * 0.99);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect((await snapshot(page)).render.programs).toBe(programs);

  // The choice is saved with the rest of the journey.
  await page.keyboard.press('KeyT');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('astra-journey-v1')).flashlight)).toBe(false);
  expect(errors).toEqual([]);
});

test('a flashlight left packed stays packed on the next night', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('astra-journey-v1', JSON.stringify({ time: 22, flashlight: false })));
  const errors = await boot(page);
  expect(await flashlight(page)).toMatchObject({ enabled: false, out: false, intensity: 0 });
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
  expect((await flashlight(page)).out).toBe(false);
  const button = page.getByRole('button', { name: 'Flashlight after dark (T)' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('KeyT');
  await expect.poll(async () => (await flashlight(page)).out).toBe(true);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
