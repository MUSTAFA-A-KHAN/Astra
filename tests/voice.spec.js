import { test, expect } from '@playwright/test';

// The story is heard aloud. Meeting Maren as Spiderman, Maren speaks, then
// Gwen's question is heard in her own voice, its words typing out at the pace
// she says it; once she has said it the conversation moves on by itself, and
// each falls quiet when it moves on or is skipped. Tobin, at the jetty, speaks
// too, and a line no one speaks holds long enough to be read and then closes
// the conversation. As in story.spec.js, the
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
  // Stands the hero at the keeper's book by the gate, and opens it.
  toBook() {
    const at = portal.places.reading;
    resetInput(); position.set(at.x, groundHeight(at.x, at.z), at.z); locomotion.reset(); avatar.position.copy(position);
  },
  read() { if (!chat) readPortalBook(); return !!portalJourney; },
  phase: () => portalJourney?.phase ?? null,
  clock: () => time,
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
  // between two of the test's looks: what is heard, how long her line takes
  // to type out, when she falls quiet and when Maren takes over.
  await page.evaluate(line => {
    const name = document.getElementById('conversation-name'), text = document.getElementById('conversation-text'), watch = { subtree: true, childList: true, characterData: true };
    const typing = window.__TYPING__ = { heard: null };
    const listen = () => {
      const now = window.__VOICE_TEST__.speaking();
      typing.heard ??= now;
      if (typing.heard && !now) typing.quiet ??= performance.now();
      if (!typing.moved) requestAnimationFrame(listen);
    };
    new MutationObserver(() => {
      if (name.textContent === 'Spiderman' && !typing.start) { typing.start = performance.now(); listen(); }
      if (name.textContent === 'Maren' && typing.start) typing.moved ??= performance.now();
    }).observe(name, watch);
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
  // She says it to the end, and with no press at all, a beat later, Maren answers.
  const moved = await (await page.waitForFunction(() => window.__TYPING__.moved && window.__TYPING__, null, { timeout: 10000 })).jsonValue();
  expect(moved.quiet, 'she finished before the conversation moved on').toBeLessThan(moved.moved);
  expect(moved.moved - moved.quiet).toBeGreaterThan(200);
  expect(moved.moved - moved.quiet).toBeLessThan(3000);
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
  // No one speaks the last line: it stays to be read, then closes the conversation.
  const shown = Date.now();
  await expect(page.locator('#conversation')).toBeHidden({ timeout: 10000 });
  expect(Date.now() - shown).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});

// A save with both chapters done, in the city: the book by the gate offers the
// passage to Pine Islet.
const done = ['accepted', 'roots', 'bells', 'valves', 'vigil', 'warden', 'complete'];
const FINISHED = {
  hero: 'Spiderman', map: 'city', restored: true, kills: 3, collected: [0, 1, 2, 3, 4],
  story: { keeper: true, ferryman: true, ledger: true, farewell: true, notice: true },
  chapterTwo: Object.fromEntries(done.map(flag => [flag, true])),
};

test('the gate answers as soon as the hero has said the spell', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one browser is enough to hear her');
  test.setTimeout(process.env.CI ? 600000 : 240000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(save => localStorage.setItem('astra-journey-v1', JSON.stringify(save)), FINISHED);
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
${probe}` });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.astraReady && window.__VOICE_TEST__);
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.hero === 'Spiderman' && window.__ASTRA_DEBUG__.ready && !window.__ASTRA_DEBUG__.switching, null, { timeout: 120000 });
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.screen === 'game' && window.__ASTRA_DEBUG__.audio.state === 'running');

  // Watched from inside the page: when her spell is heard, when she falls
  // quiet, and when the gate starts to answer. Timed on the game's own clock:
  // the next map is loading meanwhile, and a stalled frame only ever moves
  // the game on by a fraction of the time it took.
  await page.evaluate(() => {
    const seen = window.__SPELL__ = {};
    const watch = () => {
      const now = window.__VOICE_TEST__.clock(), said = window.__VOICE_TEST__.speaking();
      if (/by-marens-light/.test(said ?? '')) seen.spell ??= now;
      if (seen.spell && !said) seen.quiet ??= now;
      if (window.__VOICE_TEST__.phase() === 'casting') seen.casting ??= now;
      if (!seen.casting) requestAnimationFrame(watch);
    };
    watch();
  });
  await page.evaluate(() => window.__VOICE_TEST__.toBook());
  await page.waitForFunction(() => window.__VOICE_TEST__.read());
  await expect(page.locator('#conversation-name')).toHaveText('The keeper’s spellbook');
  // Page through the book's narration to the spell.
  for (let presses = 0; presses < 12 && await page.locator('#conversation-title').textContent() !== 'You'; presses++) {
    await page.keyboard.press('f'); await page.waitForTimeout(40);
  }
  await expect(page.locator('#conversation-text')).toContainText('wake the path the roots have heard', { timeout: 15000 });
  // The spell is the last of it: once it has been said, a beat later, the gate stirs.
  const seen = await (await page.waitForFunction(() => window.__SPELL__.casting && window.__SPELL__, null, { timeout: 30000 })).jsonValue();
  expect(seen.spell, 'her spell was heard').toBeTruthy();
  expect(seen.casting, 'the gate waited for her to finish').toBeGreaterThan(seen.quiet);
  expect(seen.casting - seen.quiet, 'and no longer than a beat').toBeLessThan(.8);
  await expect(page.locator('#conversation')).toBeHidden();
  await expect(page.locator('#portal-status')).toHaveText(/The words leave the page as light/);
  expect(errors).toEqual([]);
});
