import test from 'node:test';
import assert from 'node:assert/strict';
import { portalRoute, portalConversation } from '../portal-script.js';
import { readStory } from '../story-script.js';
import { readChapterTwo } from '../chapter-two-script.js';

const ready = () => ({
  restored: true,
  story: readStory({ restored: true }),
  chapterTwo: { ...readChapterTwo({}), accepted: true },
});
const completeTrials = progress => {
  for (const flag of ['roots', 'bells', 'valves', 'vigil', 'warden']) progress.chapterTwo[flag] = true;
};

test('the first passage requires the book, restored Moonwell, farewell and accepted chapter', () => {
  for (const progress of [undefined, null, {}]) {
    const route = portalRoute(progress, 'city');
    assert.equal(route.destination, null);
    assert.match(route.lockedReason, /book/);
  }
  for (const [key, expected] of [
    ['ledger', /keeper's book/], ['restored', /Restore the Moonwell/],
    ['farewell', /Tell Tobin/], ['accepted', /tide chart/],
  ]) {
    const progress = ready();
    if (key === 'restored') progress.restored = false;
    else if (key === 'accepted') progress.chapterTwo.accepted = false;
    else progress.story[key] = false;
    const route = portalRoute(progress, 'city');
    assert.equal(route.destination, null, key);
    assert.equal(route.spell, null, key);
    assert.match(route.lockedReason, expected, key);
  }
  assert.equal(portalRoute(ready(), 'city').destination, 'forest');
});

test('the story opens city, forest, yard and home in order', () => {
  const progress = ready();
  assert.equal(portalRoute(progress, 'city').destination, 'forest');
  assert.match(portalRoute(progress, 'forest').lockedReason, /root lock/);
  assert.equal(portalRoute(progress, 'yard').destination, null);
  progress.chapterTwo.roots = true;
  const forest = portalRoute(progress, 'forest');
  assert.equal(forest.destination, 'yard');
  assert.equal(forest.mapName, 'Skibidi Yard');
  assert.equal(forest.lockedReason, null);
  for (const flag of ['bells', 'valves', 'vigil']) {
    progress.chapterTwo[flag] = true;
    assert.equal(portalRoute(progress, 'yard').destination, null, flag);
  }
  progress.chapterTwo.warden = true;
  assert.equal(portalRoute(progress, 'yard').destination, 'city');
  for (const prerequisite of ['roots', 'bells', 'valves', 'vigil']) {
    progress.chapterTwo[prerequisite] = false;
    assert.equal(portalRoute(progress, 'yard').destination, null, `later flags cannot skip ${prerequisite}`);
    progress.chapterTwo[prerequisite] = true;
  }
});

test('completed saves allow the exploration circuit and still require the book', () => {
  const progress = ready();
  completeTrials(progress);
  progress.chapterTwo.complete = true;
  const reloaded = JSON.parse(JSON.stringify(progress));
  for (const [source, destination] of [['city', 'forest'], ['forest', 'yard'], ['yard', 'city']]) {
    assert.equal(portalRoute(reloaded, source).destination, destination);
    const withoutBook = { ...reloaded, story: { ...reloaded.story, ledger: false } };
    assert.equal(portalRoute(withoutBook, source).destination, null, `${source} needs the book even after the ending`);
  }
  assert.deepEqual(reloaded, progress, 'route selection leaves the save untouched');
});

test('legacy completed chapter-one saves retain the keeper book after accepting the chart', () => {
  const legacy = { restored: true, chapterTwo: { accepted: true } };
  assert.equal(portalRoute(legacy, 'city').destination, 'forest');
  assert.equal(portalRoute({ restored: true }, 'city').destination, null, 'legacy saves still need the new chapter');
  assert.equal(portalRoute(ready(), 'mesa').destination, null);
});

test('every passage requires a visible book reading before its distinct spoken spell', () => {
  const progress = ready();
  completeTrials(progress);
  const spells = new Set();
  for (const source of ['city', 'forest', 'yard']) {
    const route = portalRoute(progress, source);
    const dialogue = portalConversation(route);
    assert.ok(dialogue.lines.length >= 3);
    assert.match(dialogue.lines[0][1], /open the keeper's ledger.*lectern/);
    const reading = dialogue.lines.findIndex(([speaker, text]) => speaker === null && /read each word from the book/.test(text));
    const casting = dialogue.lines.findIndex(([speaker, text]) => speaker === 'you' && text === route.spell);
    assert.ok(reading >= 0 && casting > reading, `${source}: read before cast`);
    assert.ok(dialogue.lines.some(([, text]) => text.includes(route.mapName)));
    spells.add(route.spell);
  }
  assert.equal(spells.size, 3);
  const locked = portalRoute({}, 'city');
  assert.deepEqual(portalConversation(locked), { lines: [[null, locked.lockedReason]] });
  assert.ok(portalConversation(null).lines.length > 0);
});
