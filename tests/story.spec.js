import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Plays The Last Keeper from the notice board to the ferryman's farewell,
// through the game's own interaction key and conversation panel. The hook
// exists only in this intercepted test response, never in the shipped game: it
// stands the hero in front of each person, and grants the shards and wisps the
// steps between them ask for, which the gameplay tests already cover.
//
// STORY_SHOTS=1 also saves a screenshot of each beat to test-results/story/.
const probe = `
window.__STORY_TEST__ = {
  place(name, distance = 3.4) {
    const at = story.places[name];
    const x = at.x + Math.sin(at.facing) * distance, z = at.z + Math.cos(at.facing) * distance;
    resetInput();
    position.set(x, groundHeight(x, z), z);
    locomotion.reset();
    avatar.position.copy(position);
    yaw = Math.atan2(x - at.x, z - at.z); pitch = .3; radius = 8;
    followCamera.reset(position, yaw, pitch, radius);
    updateCamera(1);
    return window.__ASTRA_DEBUG__;
  },
  grant({ shards = 0, kills = 0 }) {
    for (let i = 0; progress.collected.size < shards; i++) progress.collected.add(i);
    progress.kills = Math.max(progress.kills, kills);
    updateHUD();
    return window.__ASTRA_DEBUG__;
  },
};
`;

const snapshot = page => page.evaluate(() => window.__ASTRA_DEBUG__);
const shots = process.env.STORY_SHOTS ? 'test-results/story' : null;
async function shoot(page, name) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png` });
}

async function boot(page, hero) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.astraReady && window.__STORY_TEST__);
  if (hero) {
    await page.locator(`[data-hero="${hero}"]`).click();
    await page.waitForFunction(id => window.__ASTRA_DEBUG__.hero === id && !window.__ASTRA_DEBUG__.switching, hero);
  }
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.screen === 'game');
  return errors;
}

// Stands in front of someone, checks what the prompt offers, and speaks.
async function approach(page, name, label) {
  await page.evaluate(name => window.__STORY_TEST__.place(name), name);
  await expect(page.locator('#interaction-text')).toHaveText(label);
  await page.keyboard.press('f');
  await expect(page.locator('#conversation')).toBeVisible();
}
// Pages through the open conversation with the interaction key, returning
// who spoke each line.
async function hear(page, beat) {
  const speakers = [];
  for (let presses = 0; presses < 80 && await page.locator('#conversation').isVisible(); presses++) {
    const name = await page.locator('#conversation-name').textContent();
    if (speakers.at(-1) !== name) speakers.push(name);
    if (beat && presses === 1) await shoot(page, beat);
    await page.keyboard.press('f');
    await page.waitForTimeout(40);
  }
  await expect(page.locator('#conversation')).toBeHidden();
  return speakers;
}

test('The Last Keeper plays from the notice board to the ferryman’s farewell', async ({ page }) => {
  test.setTimeout(process.env.CI ? 900000 : 420000);
  const errors = await boot(page);
  await expect(page.locator('#quest-title')).toHaveText('The woman at the well');
  await expect(page.locator('#quest-count')).toHaveText('◇ MOONWELL');
  // Every person and prop streams in behind the start.
  await expect.poll(async () => (await snapshot(page)).story.loaded.length, { timeout: 120000 }).toBe(14);

  // The memorial on the notice board, read before anyone has been met.
  await approach(page, 'notice', 'Read the notice board');
  await expect(page.locator('#conversation-name')).toHaveText('Harbour notice board');
  await hear(page, 'notice');
  expect((await snapshot(page)).story.flags.notice).toBe(true);

  await approach(page, 'maren', 'Speak with Maren');
  await expect(page.locator('#conversation-title')).toHaveText('Keeper of the Moonwell');
  const first = await hear(page, 'maren');
  expect(first[0]).toBe('Maren');
  expect(first.length).toBeGreaterThan(2);
  expect((await snapshot(page)).story.step).toBe('shards');
  await expect(page.locator('#quest-title')).toHaveText('A glimmer in the green');

  await page.evaluate(() => window.__STORY_TEST__.grant({ shards: 5 }));
  expect((await snapshot(page)).story.step).toBe('ferryman');
  await approach(page, 'tobin', 'Speak with Tobin');
  expect(await hear(page, 'tobin')).toContain('Tobin');
  expect((await snapshot(page)).story.step).toBe('wisps');

  // The book can be looked at early, but it only gives up its last page once
  // Tobin has told the player about it.
  await page.evaluate(() => window.__STORY_TEST__.grant({ kills: 3 }));
  expect((await snapshot(page)).story.step).toBe('ledger');
  await approach(page, 'ledger', 'Read the keeper’s ledger');
  await hear(page, 'ledger');
  expect((await snapshot(page)).story.step).toBe('restore');

  // The finale: the well wakes, the Hart comes, the keeper goes home.
  await approach(page, 'maren', 'Give Maren the light');
  await hear(page, 'confession');
  await expect.poll(async () => (await snapshot(page)).story.restored).toBe(true);
  await expect(page.locator('#conversation')).toBeVisible({ timeout: 15000 });
  await shoot(page, 'hart');
  expect(await hear(page)).toEqual(expect.arrayContaining(['Maren']));
  await expect.poll(async () => (await snapshot(page)).story.departed, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await snapshot(page)).story.finale).toBe(false);
  expect((await snapshot(page)).story.step).toBe('farewell');
  await page.evaluate(() => window.__STORY_TEST__.place('chest', 7));
  await page.waitForTimeout(800);
  await shoot(page, 'moonwell-lit');

  await approach(page, 'tobin', 'Speak with Tobin');
  // The hero speaks too, under their own name.
  const heroName = await page.locator('#hud-name').textContent();
  expect(await hear(page, 'farewell')).toEqual(expect.arrayContaining(['Tobin', heroName]));
  expect((await snapshot(page)).story.step).toBe('complete');
  await expect(page.locator('#quest-eyebrow')).toHaveText('CHAPTER TWO · THE DROWNED MERIDIAN');
  expect((await snapshot(page)).chapterTwo.step).toBe('summons');

  // The ending is kept: the keeper has gone, and the well stays lit.
  await page.reload();
  await page.waitForFunction(() => window.astraReady && window.__STORY_TEST__);
  const after = (await snapshot(page)).story;
  expect(after).toMatchObject({ step: 'complete', restored: true, departed: true });
  expect(Object.values(after.flags).every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});

// What is written is read from a book the hero takes out, and put away
// after; a conversation is talked through with the hands. Checked on a
// hero who has the clips for it.
test('the hero reads the notice board, talks with Maren, and emotes from the picker', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The imported rig is checked once on desktop.');
  test.setTimeout(process.env.CI ? 600000 : 240000);
  const errors = await boot(page, 'Spiderman');
  const hero = async () => (await snapshot(page)).heroRuntime;

  await approach(page, 'notice', 'Read the notice board');
  await expect.poll(async () => (await hero()).state).toBe('Read');
  await expect.poll(async () => (await hero()).activeAction, { timeout: 30000 }).toMatch(/Read_Loop/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
  await expect.poll(async () => (await hero()).bridge).toMatch(/SpellBook_Trans_Stand/);
  await expect.poll(async () => (await hero()).activeAction, { timeout: 30000 }).not.toMatch(/SpellBook/);

  await approach(page, 'maren', 'Speak with Maren');
  const name = await page.locator('#hud-name').textContent();
  for (let presses = 0; presses < 40 && await page.locator('#conversation-name').textContent() !== name; presses++) {
    await page.keyboard.press('f');
    await page.waitForTimeout(40);
  }
  await expect(page.locator('#conversation-name')).toHaveText(name);
  await expect.poll(async () => (await hero()).state).toBe('Talk');
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();

  // The picker offers what this hero has, and nothing she does not.
  await page.keyboard.press('g');
  await expect(page.locator('#emote-panel')).toBeVisible();
  expect(await page.locator('#emote-panel [data-emote]').evaluateAll(buttons => buttons.map(button => button.dataset.emote)))
    .toEqual(['Dance', 'Sad', 'Wave', 'Cheer', 'Point', 'Stomp', 'Salute', 'Sing']);
  await page.locator('#emote-panel [data-emote="Wave"]').click();
  await expect(page.locator('#emote-panel')).toBeHidden();
  await expect.poll(async () => (await hero()).state).toBe('Wave');
  expect(errors).toEqual([]);
});
