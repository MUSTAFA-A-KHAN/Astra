import { test, expect } from '@playwright/test';

const snapshot = page => page.evaluate(() => window.__ASTRA_DEBUG__);
test('stamina live check', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.astraReady === true);
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const s = await snapshot(page);
    samples.push({ t: i + 1, stamina: +s.locomotion.stamina.toFixed(2), exhausted: s.locomotion.exhausted, state: s.locomotion.state, speed: +s.locomotion.speed.toFixed(1) });
    if (i === 6) await page.locator('.player-panel').screenshot({ path: testInfo.outputPath('hud-exhausted.png') });
  }
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(5000);
  const rested = await snapshot(page);
  samples.push({ t: 'rested', stamina: rested.locomotion.stamina, exhausted: rested.locomotion.exhausted, meter: await page.locator('#stamina-meter').getAttribute('class') });
  console.log(JSON.stringify(samples, null, 1));
  console.log('SHOT', testInfo.outputPath('hud-exhausted.png'));
  expect(errors).toEqual([]);
});
