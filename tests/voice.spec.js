import { test, expect } from '@playwright/test';

// The story is heard aloud. Meeting Maren as Spiderman, Maren speaks, then
// Gwen's question is heard in her own voice, its words typing out at the pace
// she says it, and each falls quiet when the conversation moves on or is
// skipped; Tobin, at the jetty, speaks too. As in story.spec.js, the
// hook exists only in this intercepted response: it stands the hero before
// Maren, and opens a conversation of its own choosing.
const probe = `
window.__VOICE_TEST__ = {
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
  },
  // Opens a conversation of these lines with Maren, without the story's say.
  say(lines) { begin('maren', lines); },
  speaking: () => audio.getStats().speaking,
};
`;
const audio = page => page.evaluate(() => window.__ASTRA_DEBUG__.audio);

test('Maren, Gwen and Tobin speak their lines aloud', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one browser is enough to hear her');
  test.setTimeout(process.env.CI ? 600000 : 240000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.astraReady && window.__VOICE_TEST__);
  await page.locator('[data-hero="Spiderman"]').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.hero === 'Spiderman' && !window.__ASTRA_DEBUG__.switching, null, { timeout: 120000 });
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.screen === 'game' && window.__ASTRA_DEBUG__.audio.state === 'running');

  await page.evaluate(() => window.__VOICE_TEST__.place('maren'));
  await expect(page.locator('#interaction-text')).toHaveText('Speak with Maren');
  await page.keyboard.press('f');
  await expect(page.locator('#conversation')).toBeVisible();
  // Maren greets the traveller in her own voice.
  await expect.poll(async () => (await audio(page)).speaking).toMatch(/^voice\/people\/maren\/ah-someone-who-can-still-see-\w+\.ogg$/);

  // Watched from inside the page, where a second-long line can't slip by
  // between two of the test's looks: what is heard, and how long her line
  // takes to type out.
  await page.evaluate(line => {
    const name = document.getElementById('conversation-name'), text = document.getElementById('conversation-text'), watch = { subtree: true, childList: true, characterData: true };
    const typing = window.__TYPING__ = { heard: null };
    const listen = () => { typing.heard ??= window.__VOICE_TEST__.speaking(); if (!typing.end) requestAnimationFrame(listen); };
    new MutationObserver(() => { if (name.textContent === 'Spiderman' && !typing.start) { typing.start = performance.now(); listen(); } }).observe(name, watch);
    new MutationObserver(() => { if (typing.start && text.textContent === line) typing.end ??= performance.now(); }).observe(text, watch);
  }, 'How many do you need?');
  // Page on through her greeting to the hero's line.
  for (let presses = 0; presses < 20 && await page.locator('#conversation-title').textContent() !== 'You'; presses++) {
    await page.keyboard.press('f'); await page.waitForTimeout(40);
  }
  await expect(page.locator('#conversation-name')).toHaveText('Spiderman');
  // Typed at her pace, a little over a second, where unvoiced text takes a third of one.
  const typing = await (await page.waitForFunction(() => window.__TYPING__.end && window.__TYPING__)).jsonValue();
  expect(typing.heard).toMatch(/^voice\/heroes\/spiderman\/how-many-do-you-need-\w+\.ogg$/);
  expect(typing.end - typing.start).toBeGreaterThan(700);
  expect((await audio(page)).failed).toEqual([]);
  // She says it to the end by herself, and Maren answers.
  await expect.poll(async () => (await audio(page)).speaking, { timeout: 5000 }).toBeNull();
  await page.keyboard.press('f');
  await expect(page.locator('#conversation-name')).toHaveText('Maren');
  await expect.poll(async () => (await audio(page)).speaking).toMatch(/^voice\/people\/maren\/five-will-wake-it-\w/);
  // Skipping the rest quiets her.
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
  expect((await audio(page)).speaking).toBeNull();

  // Tobin, with the ferry closed, says so in his own voice.
  await page.evaluate(() => window.__VOICE_TEST__.place('tobin'));
  await expect(page.locator('#interaction-text')).toHaveText('Speak with Tobin');
  await page.keyboard.press('f');
  await expect(page.locator('#conversation-name')).toHaveText('Tobin');
  await expect.poll(async () => (await audio(page)).speaking).toMatch(/^voice\/people\/tobin\/ferrys-closed-tides-wrong-\w/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();

  // Hurried along, through a spell six seconds long: the first press shows
  // the whole of it and leaves her speaking, the second moves on and cuts her
  // off mid-word.
  const spell = "By Maren's light and keeper's word, wake the path the roots have heard.";
  await page.evaluate(spell => window.__VOICE_TEST__.say([['you', spell], [null, 'The well hums.']]), spell);
  await expect.poll(async () => (await audio(page)).speaking).toMatch(/^voice\/heroes\/spiderman\/by-marens-light-\w/);
  await page.keyboard.press('f');
  await expect(page.locator('#conversation-text')).toHaveText(spell);
  expect((await audio(page)).speaking).toMatch(/^voice\/heroes\/spiderman\/by-marens-light-\w/);
  await page.keyboard.press('f');
  await expect(page.locator('#conversation-text')).toHaveText('The well hums.');
  expect((await audio(page)).speaking).toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
  expect(errors).toEqual([]);
});
