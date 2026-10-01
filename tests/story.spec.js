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
// Every message the game shows, in order: one can come and go between two of
// a slow test's looks at the screen.
const shown = toast;
toast = (message, options) => { window.__STORY_TEST__.toasts.push(message); return shown(message, options); };
window.__STORY_TEST__ = {
  toasts: [],
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
  // How long the camera has left to turn with the light.
  turning: () => followLight,
  // Stands the hero at the keeper's book by the gate and reads the passage
  // to \`map\`: the Moonwell is on the Red Mesa, the rest of the story in the city.
  cross(map) {
    const at = portal.places.reading;
    resetInput(); position.set(at.x, groundHeight(at.x, at.z), at.z); locomotion.reset(); avatar.position.copy(position);
    readPortalBook(map);
    return !!portalJourney;
  },
  // The patrols put down, so that nothing cuts a walk short.
  quiet() { for (const e of enemies) { e.alive = false; e.respawn = 1e9; } },
  // Walks the hero after the guiding light, as a player would: turning the
  // view toward it, pressing ahead, and stopping a stride short. Once it has
  // gone in, the hero walks up to whoever it went into.
  follow(on, name = 'maren') {
    clearInterval(this.walking); joyX = joyY = 0; if (!on) return;
    this.walking = setInterval(() => {
      const light = guideLight.position, goal = name === 'portal' ? portal.places.book : story.places[name], target = light || goal;
      const dx = target.x - position.x, dz = target.z - position.z, d = Math.hypot(dx, dz);
      if (light ? d < 2.5 : Math.hypot(goal.x - position.x, goal.z - position.z) < 3.6) { joyX = joyY = 0; return; }
      const want = Math.atan2(-dx, -dz); yaw += Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw)) * .2;
      joyX = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / d; joyY = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / d;
    }, 40);
  },
  // Holds each line on the screen until the test moves it on, so that every
  // shot can be looked at; step() moves it on, finishing it first if it is
  // still being typed.
  hold() { const next = nextLine; nextLine = (pressed = false) => { if (pressed) next(true); }; },
  step() { const at = chat?.index; while (chat && chat.index === at) advance(); return chat?.index ?? null; },
  // The conversation's film, and where Maren's eyes and the hero's fall on
  // the screen: inside the picture, between the bars, is |x| < 1, |y| < .78.
  film() {
    const screen = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return { x: v.x, y: v.y, z: v.z }; };
    const maren = story.places.maren;
    return { ...window.__ASTRA_DEBUG__.camera.conversation, line: chat?.index ?? null, cinematic: document.body.classList.contains('conversation-cinematic'),
      maren: screen(maren.x, maren.y + maren.top * .93, maren.z), hero: screen(position.x, position.y + hero.height * .91, position.z) };
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

// Through the portal to `map`: the book is read to its spell, and the
// crossing plays out until the hero stands on the far shore.
async function cross(page, map) {
  await page.waitForFunction(map => window.__STORY_TEST__.cross(map), map);
  for (let presses = 0; presses < 20 && await page.locator('#conversation').isVisible(); presses++) {
    await page.keyboard.press('f');
    await page.waitForTimeout(40);
  }
  await page.waitForFunction(map => window.__ASTRA_DEBUG__.terrain.activeMap === map && !window.__ASTRA_DEBUG__.portal.journey, map, { timeout: 120000 });
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
  // Four crossings of the portal, each loading the far shore.
  test.setTimeout(process.env.CI ? 1200000 : 600000);
  const errors = await boot(page);
  // The first task is the board, which calls to whoever has just arrived.
  await expect(page.locator('#quest-title')).toHaveText('News from the harbour');
  await expect(page.locator('#quest-count')).toHaveText('◇ NOTICE BOARD');
  // Every person and prop of the city streams in behind the start; the
  // sanctuary's six wait on the Red Mesa.
  await expect.poll(async () => (await snapshot(page)).story.loaded.length, { timeout: 120000 }).toBe(8);

  // The memorial on the notice board, read before anyone has been met.
  await approach(page, 'notice', 'Read the notice board');
  await expect(page.locator('#conversation-name')).toHaveText('Harbour notice board');
  await hear(page, 'notice');
  expect((await snapshot(page)).story.flags.notice).toBe(true);
  // Read, it sets free the light that leads the way to the keeper.
  expect((await snapshot(page)).story.step).toBe('keeper');
  await expect(page.locator('#quest-title')).toHaveText('The woman at the well');
  await expect(page.locator('#quest-count')).toHaveText('◇ MOONWELL');
  // The keeper is on the Red Mesa: the light leads first to the portal's book.
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('keeper:portal:mesa');
  expect((await snapshot(page)).guide.state).toBe('leading');
  await cross(page, 'mesa');
  await expect.poll(async () => (await snapshot(page)).story.loaded.length, { timeout: 120000 }).toBe(6);
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('keeper:maren');

  await approach(page, 'maren', 'Speak with Maren');
  await expect(page.locator('#conversation-title')).toHaveText('Keeper of the Moonwell');
  const first = await hear(page, 'maren');
  expect(first[0]).toBe('Maren');
  expect(first.length).toBeGreaterThan(2);
  expect((await snapshot(page)).story.step).toBe('shards');
  await expect(page.locator('#quest-title')).toHaveText('A glimmer in the green');
  // The light comes out of her and leads home through the gate, then on to
  // the nearest shard.
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('shards:portal:city');
  await cross(page, 'city');
  await expect.poll(async () => (await snapshot(page)).guide.target).toMatch(/^shards:\d+$/);
  expect((await snapshot(page)).guide.state).toBe('leading');

  await page.evaluate(() => window.__STORY_TEST__.grant({ shards: 5 }));
  expect((await snapshot(page)).story.step).toBe('ferryman');
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('ferryman:tobin');
  await approach(page, 'tobin', 'Speak with Tobin');
  expect(await hear(page, 'tobin')).toContain('Tobin');
  expect((await snapshot(page)).story.step).toBe('wisps');
  await expect.poll(async () => (await snapshot(page)).guide.target).toMatch(/^wisps:\d+$/);

  // The book can be looked at early, but it only gives up its last page once
  // Tobin has told the player about it.
  await page.evaluate(() => window.__STORY_TEST__.grant({ kills: 3 }));
  expect((await snapshot(page)).story.step).toBe('ledger');
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('ledger:ledger');
  await approach(page, 'ledger', 'Read the keeper’s ledger');
  await hear(page, 'ledger');
  expect((await snapshot(page)).story.step).toBe('restore');
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('restore:portal:mesa');
  await cross(page, 'mesa');
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('restore:maren');

  // The finale: the well wakes, the Hart comes, the keeper goes home.
  await approach(page, 'maren', 'Give Maren the light');
  await hear(page, 'confession');
  await expect.poll(async () => (await snapshot(page)).story.restored).toBe(true);
  // The light has no part in the finale.
  expect((await snapshot(page)).guide.target).toBe(null);
  await expect(page.locator('#conversation')).toBeVisible({ timeout: 15000 });
  await shoot(page, 'hart');
  expect(await hear(page)).toEqual(expect.arrayContaining(['Maren']));
  await expect.poll(async () => (await snapshot(page)).story.departed, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await snapshot(page)).story.finale).toBe(false);
  expect((await snapshot(page)).story.step).toBe('farewell');
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('farewell:portal:city');
  await page.evaluate(() => window.__STORY_TEST__.place('chest', 7));
  await page.waitForTimeout(800);
  await shoot(page, 'moonwell-lit');

  await cross(page, 'city');
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('farewell:tobin');
  await approach(page, 'tobin', 'Speak with Tobin');
  // The hero speaks too, under their own name.
  const heroName = await page.locator('#hud-name').textContent();
  expect(await hear(page, 'farewell')).toEqual(expect.arrayContaining(['Tobin', heroName]));
  expect((await snapshot(page)).story.step).toBe('complete');
  await expect(page.locator('#quest-eyebrow')).toHaveText('CHAPTER TWO · THE DROWNED MERIDIAN');
  expect((await snapshot(page)).chapterTwo.step).toBe('summons');
  // And into the next chapter, it leads on.
  await expect.poll(async () => (await snapshot(page)).guide.target).toMatch(/^summons:/);

  // The ending is kept: the keeper has gone, and the well stays lit.
  await page.reload();
  await page.waitForFunction(() => window.astraReady && window.__STORY_TEST__);
  const after = (await snapshot(page)).story;
  expect(after).toMatchObject({ step: 'complete', restored: true, departed: true });
  expect(Object.values(after.flags).every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});

// The first minute teaches without a word. A beat after the newcomer steps
// into the world, a light rises at their shoulder and the view turns with it
// toward the notice board, where it waits; standing still, they are called.
// Walking up, it goes into the board, and reading the board sets it free
// again, out of the carving and on toward the keeper.
test('a newcomer is led to the notice board and on by the light, without a word on screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The intro is played once, on desktop.');
  test.setTimeout(process.env.CI ? 600000 : 240000);
  const errors = await boot(page);
  await page.evaluate(() => window.__STORY_TEST__.quiet());
  await expect.poll(async () => (await snapshot(page)).guide.target, { timeout: 30000 }).toBe('notice:notice');
  const rise = await snapshot(page);
  expect(Math.hypot(rise.guide.position.x - rise.position.x, rise.guide.position.z - rise.position.z)).toBeLessThan(4);
  expect(await page.evaluate(() => window.__STORY_TEST__.turning())).toBeGreaterThan(0);
  // It goes on to the board and waits there, and calls to a hero who stands still.
  const board = rise.story.places.notice;
  await expect.poll(async () => { const { guide } = await snapshot(page); return Math.hypot(guide.position.x - board.x, guide.position.z - board.z); }, { timeout: 30000 }).toBeLessThan(3);
  await expect.poll(async () => (await snapshot(page)).guide.calling, { timeout: 30000 }).toBeGreaterThan(.5);
  await shoot(page, 'intro-calling');
  // A few steps toward it, and it goes into the board.
  await page.evaluate(() => window.__STORY_TEST__.follow(true, 'notice'));
  await expect.poll(async () => (await snapshot(page)).guide.state, { timeout: 60000 }).toBe('done');
  await expect(page.locator('#interaction-text')).toHaveText('Read the notice board', { timeout: 60000 });
  await page.evaluate(() => window.__STORY_TEST__.follow(false));
  await shoot(page, 'intro-board');
  await page.keyboard.press('f');
  await expect(page.locator('#conversation')).toBeVisible();
  await hear(page);
  // Out of the carving, and on toward the keeper by way of the portal, with the
  // view turning to see it go.
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('keeper:portal:mesa');
  const out = await snapshot(page);
  expect(Math.hypot(out.guide.position.x - board.x, out.guide.position.z - board.z)).toBeLessThan(7);
  expect(await page.evaluate(() => window.__STORY_TEST__.turning())).toBeGreaterThan(0);
  // Nothing on screen said to do any of it.
  expect(await page.evaluate(() => window.__STORY_TEST__.toasts.filter(message => /follow|press|walk|read|notice board/i.test(message)))).toEqual([]);
  expect(errors).toEqual([]);
});

// A newcomer who reads the board and then simply follows the light walks,
// on their own feet, to the keeper: down the street to the portal, through
// it, and along the mesa's sands, however far the Moonwell stands from the gate.
test('after the notice board, the light leads the hero on foot to Maren', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The walk is played once, on desktop.');
  test.setTimeout(process.env.CI ? 900000 : 300000);
  const errors = await boot(page);
  await page.evaluate(() => window.__STORY_TEST__.quiet());
  await approach(page, 'notice', 'Read the notice board');
  await hear(page, 'notice');
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('keeper:portal:mesa');
  expect((await snapshot(page)).guide.state).toBe('leading');
  // Shown the way, not told it.
  expect(await page.evaluate(() => window.__STORY_TEST__.toasts.filter(message => /follow the light|press f|notice board/i.test(message)))).toEqual([]);
  const { total } = (await snapshot(page)).guide;
  expect(total).toBeGreaterThan(20);
  // The light stays close enough to follow all the way: to the portal's book,
  // and on the far shore to the keeper.
  let farthest = 0;
  const led = text => expect.poll(async () => {
    const { guide, position } = await snapshot(page);
    if (guide.state === 'leading') farthest = Math.max(farthest, Math.hypot(guide.position.x - position.x, guide.position.z - position.z));
    return page.locator('#interaction-text').textContent();
  }, { timeout: process.env.CI ? 840000 : 240000, intervals: [500] }).toBe(text);
  await page.evaluate(() => window.__STORY_TEST__.follow(true, 'portal'));
  await led('Read the keeper’s spellbook');
  await page.evaluate(() => window.__STORY_TEST__.follow(false));
  await cross(page, 'mesa');
  await expect.poll(async () => (await snapshot(page)).guide.target).toBe('keeper:maren');
  await page.evaluate(() => window.__STORY_TEST__.follow(true));
  await led('Speak with Maren');
  await page.evaluate(() => window.__STORY_TEST__.follow(false));
  expect(farthest).toBeLessThan(16);
  await shoot(page, 'led-to-maren');
  // It goes into her, and is gone.
  await expect.poll(async () => (await snapshot(page)).guide.state).toBe('done');
  expect((await snapshot(page)).story.step).toBe('keeper');
  expect(errors).toEqual([]);
});

// A conversation plays as film: the letterbox closes in and the rest of the
// screen goes, the camera eases in on the two of them and cuts between them
// as the voice changes, and it all hands back once the talking is done.
test('a conversation plays as film, cut to whoever is talking, and hands back', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The camera is checked once, on desktop.');
  test.setTimeout(process.env.CI ? 900000 : 360000);
  // Maren is at the Moonwell on the Red Mesa, which the game resumes on from a save left there.
  await page.addInitScript(() => localStorage.setItem('astra-journey-v1', JSON.stringify({ map: 'mesa' })));
  const errors = await boot(page);
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.terrain.activeMap === 'mesa', null, { timeout: 120000 });
  await page.evaluate(() => { window.__STORY_TEST__.quiet(); window.__STORY_TEST__.hold(); });
  const film = () => page.evaluate(() => window.__STORY_TEST__.film());
  const inPicture = p => Math.abs(p.x) < 1 && Math.abs(p.y) < .78 && p.z < 1;
  const shows = async (kind, who, not) => { const f = await film(); return f.kind === kind && f.weight === 1 && inPicture(f[who]) && (!not || !inPicture(f[not])); };
  await approach(page, 'maren', 'Speak with Maren');
  // Both of them, side on, behind the bars, with nothing else on the screen.
  await expect.poll(() => shows('two', 'maren')).toBe(true);
  expect(inPicture((await film()).hero)).toBe(true);
  expect(await page.evaluate(() => document.body.classList.contains('conversation-cinematic'))).toBe(true);
  for (const part of ['.quest-tracker', '.minimap-wrap', '.player-panel', '.game-menu']) await expect(page.locator(part)).toBeHidden();
  await expect(page.locator('#conversation')).toBeVisible();
  await shoot(page, 'film-two');
  // She goes on: the picture cuts to her alone.
  await page.evaluate(() => window.__STORY_TEST__.step());
  await expect.poll(() => shows('them', 'maren', 'hero')).toBe(true);
  await shoot(page, 'film-maren');
  // The hero asks how many: the picture cuts round to the hero.
  while ((await film()).line < 4) await page.evaluate(() => window.__STORY_TEST__.step());
  await expect(page.locator('#conversation-name')).toHaveText(await page.locator('#hud-name').textContent());
  await expect.poll(() => shows('hero', 'hero', 'maren')).toBe(true);
  await shoot(page, 'film-hero');
  // And back to her when she answers, from the same side of the two of them.
  const side = (await film()).side;
  await page.evaluate(() => window.__STORY_TEST__.step());
  await expect.poll(() => shows('them', 'maren', 'hero')).toBe(true);
  expect((await film()).side).toBe(side);
  // Over: the bars open, the screen comes back, and so does the player's camera.
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
  await expect.poll(async () => (await film()).weight).toBe(0);
  expect((await film()).cinematic).toBe(false);
  await expect(page.locator('.quest-tracker')).toBeVisible();
  expect(errors).toEqual([]);
});

// What is written is read from a book the hero takes out, and put away
// after; a conversation is talked through with the hands. Checked on a
// hero who has the clips for it.
test('the hero reads the notice board, talks with Maren, and emotes from the picker', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The imported rig is checked once on desktop.');
  test.setTimeout(process.env.CI ? 900000 : 360000);
  const errors = await boot(page, 'Spiderman');
  const hero = async () => (await snapshot(page)).heroRuntime;

  await approach(page, 'notice', 'Read the notice board');
  await expect.poll(async () => (await hero()).state).toBe('Read');
  await expect.poll(async () => (await hero()).activeAction, { timeout: 30000 }).toMatch(/Read_Loop/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
  await expect.poll(async () => (await hero()).bridge).toMatch(/SpellBook_Trans_Stand/);
  await expect.poll(async () => (await hero()).activeAction, { timeout: 30000 }).not.toMatch(/SpellBook/);

  await cross(page, 'mesa');
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
