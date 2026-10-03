import { test, expect } from '@playwright/test';

// Positioning and reading diagnostics exist only in this intercepted response.
// Clues, attacks, decisions, rewards, and saving use the shipped runtime.
const probe = `
window.__OPENING_TEST__ = {
  state() { return { ...progress.opening, active: opening.active, cinematic: opening.cinematic, locked: opening.locked }; },
  place(id, distance = 2.6) {
    const at = id === 'tobin' ? story.places.tobin : opening.places[id];
    if (!at) throw Error('Missing opening place: ' + id);
    const angle = at.facing || 0;
    const x = at.x + Math.sin(angle) * distance, z = at.z + Math.cos(angle) * distance;
    resetInput();
    position.set(x, groundHeight(x, z), z);
    locomotion.reset(); avatar.position.copy(position);
    yaw = Math.atan2(x - at.x, z - at.z); pitch = .35; radius = 9;
    followCamera.reset(position, yaw, pitch, radius); updateCamera(1);
    return nearbyInteraction();
  },
  enemy() {
    const e = enemies.find(e => e.openingEnemy);
    return e ? { alive: e.alive, hp: e.hp, x: e.group.position.x, z: e.group.position.z } : null;
  },
  approachEnemy(distance = 3.2) {
    const e = enemies.find(e => e.openingEnemy && e.alive);
    if (!e) return false;
    resetInput();
    const x = e.group.position.x, z = e.group.position.z + distance;
    position.set(x, groundHeight(x, z), z); locomotion.reset(); avatar.position.copy(position);
    yaw = 0; followCamera.reset(position, yaw, .4, 10); updateCamera(1);
    return true;
  },
  finishSpeech() { skipConversation(); },
};
`;

const snapshot = page => page.evaluate(() => window.__ASTRA_DEBUG__);
const opening = page => page.evaluate(() => window.__OPENING_TEST__.state());
const enemy = page => page.evaluate(() => window.__OPENING_TEST__.enemy());
const coarse = page => page.evaluate(() => matchMedia('(pointer:coarse)').matches);

async function boot(page, { reducedMotion = false } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.addInitScript(() => {
    // These are preferences only, deliberately without any progression seed.
    if (!sessionStorage.getItem('opening-test-started')) {
      localStorage.setItem('astra-journey-v1', JSON.stringify({ quality: 'low', sound: true }));
      sessionStorage.setItem('opening-test-started', 'yes');
    }
  });
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.astraReady && window.__OPENING_TEST__, null, { timeout: 120000 });
  await page.locator('#play-button').click();
  await expect(page.locator('#opening-cinema')).toBeVisible();
  return errors;
}

async function interact(page) {
  if (await coarse(page)) await page.locator('#interact-button').click();
  else await page.keyboard.press('f');
}

async function closeSpeech(page) {
  if (await page.locator('#conversation').isVisible()) {
    await page.evaluate(() => window.__OPENING_TEST__.finishSpeech());
    await expect(page.locator('#conversation')).toBeHidden();
  }
}

async function clue(page, id) {
  await page.evaluate(id => window.__OPENING_TEST__.place(id), id);
  await expect(page.locator('#interaction-text')).toContainText(id === 'lantern' ? /lantern/i : /memorial/i);
  await interact(page);
  await expect(page.locator('#conversation')).toBeVisible();
  await closeSpeech(page);
}

async function winEncounter(page) {
  await expect.poll(async () => (await opening(page)).stage, { timeout: 30000 }).toBe('encounter');
  await closeSpeech(page);
  await expect.poll(async () => (await enemy(page))?.alive).toBe(true);
  const hp = (await enemy(page)).hp;
  // Cooldown, damage, targeting and the death callback all remain real.
  for (let hit = 0; hit < 12 && (await opening(page)).stage === 'encounter'; hit++) {
    await page.evaluate(() => window.__OPENING_TEST__.approachEnemy());
    if (await coarse(page)) await page.locator('#attack-button').click();
    else await page.keyboard.press('q');
    await page.waitForTimeout(800);
  }
  await expect.poll(async () => (await opening(page)).stage, { timeout: 10000 }).toBe('choice');
  expect((await enemy(page)).hp).toBeLessThan(hp);
  expect((await enemy(page)).alive).toBe(false);
  await closeSpeech(page);
}

for (const choice of ['mercy', 'seal']) {
  test(`fresh arrival plays through the ${choice} consequence, witness and saved Moonwell objective`, async ({ page }, info) => {
    test.skip(choice === 'seal' && info.project.name !== 'desktop', 'Both branches run on desktop; touch devices play the mercy path.');
    test.setTimeout(process.env.CI ? 600000 : 360000);
    const errors = await boot(page, { reducedMotion: choice === 'seal' });
    expect((await opening(page)).stage).toBe('prologue');
    expect((await opening(page)).locked).toBe(true);
    await expect.poll(async () => (await snapshot(page)).audio.speaking, { timeout: 20000 }).not.toBeNull();
    await page.screenshot({ path: info.outputPath(`opening-${choice}-prologue.png`) });
    const atStart = (await snapshot(page)).position;
    await page.keyboard.down('w'); await page.waitForTimeout(350); await page.keyboard.up('w');
    const whileLocked = (await snapshot(page)).position;
    expect(Math.hypot(whileLocked.x - atStart.x, whileLocked.z - atStart.z)).toBeLessThan(.1);
    await page.locator('#opening-skip').click();
    await expect.poll(async () => (await opening(page)).stage).toBe('investigate');
    await expect(page.locator('#opening-cinema')).toBeHidden();
    expect((await opening(page)).locked).toBe(false);
    await expect(page.locator('#quest-count')).toHaveText('0 / 2');

    const order = choice === 'mercy' ? ['lantern', 'memorial'] : ['memorial', 'lantern'];
    await clue(page, order[0]);
    await expect(page.locator('#quest-count')).toHaveText('1 / 2');
    if (choice === 'mercy') {
      // Reload after an individual discovery retains it and does not replay the film.
      await page.reload();
      await page.waitForFunction(() => window.astraReady && window.__OPENING_TEST__, null, { timeout: 120000 });
      await page.locator('#play-button').click();
      expect((await opening(page)).stage).toBe('investigate');
      expect((await opening(page)).lantern).toBe(true);
      await expect(page.locator('#opening-cinema')).toBeHidden();
      await expect(page.locator('#quest-count')).toHaveText('1 / 2');
    }
    await clue(page, order[1]);
    await winEncounter(page);
    await page.evaluate(() => window.__OPENING_TEST__.place('lantern'));
    await interact(page);
    await expect(page.locator('#opening-choices')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`opening-${choice}-decision.png`) });
    await page.locator(`[data-opening-choice="${choice}"]`).click();
    await expect.poll(async () => (await opening(page)).stage).toBe('witness');
    expect((await opening(page)).choice).toBe(choice);
    await closeSpeech(page);
    await expect(page.locator('#opening-choices')).toBeHidden();

    await page.evaluate(() => window.__OPENING_TEST__.place('tobin', 3.4));
    await expect(page.locator('#interaction-text')).toContainText(/Tobin/i);
    await interact(page);
    await expect(page.locator('#conversation')).toBeVisible();
    await expect(page.locator('#conversation-name')).toHaveText('Tobin');
    await page.screenshot({ path: info.outputPath(`opening-${choice}-witness.png`) });
    await closeSpeech(page);
    await expect.poll(async () => (await opening(page)).stage).toBe('complete');
    await expect(page.locator('#quest-title')).toHaveText('The woman at the well');
    expect((await snapshot(page)).story.flags.notice).toBe(true);
    const xp = (await snapshot(page)).progress.xp;

    await page.reload();
    await page.waitForFunction(() => window.astraReady && window.__OPENING_TEST__, null, { timeout: 120000 });
    await page.locator('#play-button').click();
    expect(await opening(page)).toMatchObject({ stage: 'complete', choice, active: false, locked: false });
    expect((await snapshot(page)).progress.xp).toBe(xp);
    await expect(page.locator('#opening-cinema')).toBeHidden();
    await expect(page.locator('#quest-title')).toHaveText('The woman at the well');
    expect(errors).toEqual([]);
  });
}
