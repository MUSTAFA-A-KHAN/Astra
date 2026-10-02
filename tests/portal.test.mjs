import test from 'node:test';
import assert from 'node:assert/strict';
import { portalRoute, portalChoices, portalConversation, EXPLORATIONS } from '../portal-script.js';
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

test('the forest passage requires the book, restored Moonwell, farewell and accepted chapter', () => {
  for (const progress of [undefined, null, {}]) {
    const route = portalRoute(progress, 'city', 'forest');
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
    const route = portalRoute(progress, 'city', 'forest');
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
    assert.equal(portalRoute(reloaded, source, destination).destination, destination);
    const withoutBook = { ...reloaded, story: { ...reloaded.story, ledger: false } };
    assert.equal(portalRoute(withoutBook, source, destination).destination, null, `${source} needs the book even after the ending`);
  }
  assert.deepEqual(reloaded, progress, 'route selection leaves the save untouched');
});

test('legacy completed chapter-one saves retain the keeper book after accepting the chart', () => {
  const legacy = { restored: true, chapterTwo: { accepted: true } };
  assert.equal(portalRoute(legacy, 'city').destination, 'forest');
  assert.equal(portalRoute({ restored: true }, 'city', 'forest').destination, null, 'legacy saves still need the new chapter');
  assert.equal(portalRoute(ready(), 'mesa').destination, 'city');
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
  const locked = portalRoute({}, 'city', 'forest');
  assert.deepEqual(portalConversation(locked), { lines: [[null, locked.lockedReason]] });
  assert.ok(portalConversation(null).lines.length > 0);
});

// Places the book offers for their own sake: each one a passage of its own,
// with its own spell, and a way home.
test('Street City, the Lantern Plaza and Nightwood Road are optional book passages with a homeward return', () => {
  const progress = ready();
  const names = { street: 'Street City', plaza: 'Lantern Plaza', nightwood: 'Nightwood Road' };
  assert.deepEqual([...EXPLORATIONS], Object.keys(names));
  assert.equal(portalRoute(progress, 'city').destination, 'forest');
  assert.equal(portalRoute(progress, 'city', 'forest').destination, 'forest');
  assert.deepEqual(portalChoices(progress, 'city'),
    [portalRoute(progress, 'city'), portalRoute(progress, 'city', 'mesa'), ...EXPLORATIONS.map(map => portalRoute(progress, 'city', map))]);
  const spells = new Set([portalRoute(progress, 'city').spell]);
  for (const map of EXPLORATIONS) {
    const route = portalRoute(progress, 'city', map);
    assert.equal(route.destination, map);
    assert.equal(route.mapName, names[map]);
    assert.equal(route.lockedReason, null);
    assert.equal(portalRoute(progress, map).destination, 'city');
    assert.equal(portalRoute(progress, map, 'city').destination, 'city');
    assert.deepEqual(portalChoices(progress, map), [portalRoute(progress, map)]);
    const conversation = portalConversation(route);
    assert.match(conversation.lines[0][1], /keeper's ledger/);
    assert.ok(conversation.lines.some(([, text]) => text.includes(names[map])));
    assert.deepEqual(conversation.lines.at(-1), ['you', route.spell, 'incantation']);
    assert.ok(!spells.has(route.spell), `${map} has a spell of its own`);
    spells.add(route.spell);
  }
});

test('every exploration passage, there and back, requires every basic book prerequisite', () => {
  for (const key of ['ledger', 'restored', 'farewell', 'accepted']) {
    const progress = ready();
    if (key === 'restored') progress.restored = false;
    else if (key === 'accepted') progress.chapterTwo.accepted = false;
    else progress.story[key] = false;
    for (const [source, destination] of EXPLORATIONS.flatMap(map => [['city', map], [map, 'city']])) {
      const route = portalRoute(progress, source, destination);
      assert.equal(route.destination, null, `${source} requires ${key}`);
      assert.equal(route.spell, null);
      assert.ok(route.lockedReason);
      assert.deepEqual(portalChoices(progress, source), source === 'city' ? [portalRoute(progress, 'city', 'mesa')] : []);
    }
  }
});

test('destination requests cannot skip chapter locks or invent passages', () => {
  const progress = ready();
  assert.match(portalRoute(progress, 'forest', 'street').lockedReason, /root lock/);
  assert.match(portalRoute(progress, 'yard', 'city').lockedReason, /Tidewarden/);
  assert.deepEqual(portalChoices(progress, 'forest'), []);
  assert.deepEqual(portalChoices(progress, 'yard'), []);
  completeTrials(progress);
  for (const [source, destination] of [
    ['city', 'yard'], ['city', 'observatory'], ['city', 'unknown'], ['city', null],
    ['forest', 'street'], ['yard', 'street'], ['street', 'forest'], ['street', 'street'],
    ['street', 'unknown'], ['unknown', 'street'],
  ]) {
    const route = portalRoute(progress, source, destination);
    assert.equal(route.destination, null, `${source} cannot request ${destination}`);
    assert.equal(route.spell, null);
    assert.ok(route.lockedReason);
  }
  assert.deepEqual(portalChoices(progress, 'forest'), [portalRoute(progress, 'forest')]);
  assert.deepEqual(portalChoices(progress, 'yard'), [portalRoute(progress, 'yard')]);
  assert.deepEqual(portalChoices(progress, 'unknown'), []);
});

test('Street City choices survive reloads and leave story progression untouched', () => {
  const progress = ready();
  const saved = JSON.stringify(progress);
  const reloaded = JSON.parse(saved);
  Object.freeze(reloaded.story);
  Object.freeze(reloaded.chapterTwo);
  Object.freeze(reloaded);
  assert.deepEqual(portalChoices(reloaded, 'city'), portalChoices(progress, 'city'));
  assert.equal(portalRoute(reloaded, 'city', 'street').destination, 'street');
  assert.equal(portalRoute(reloaded, 'street').destination, 'city');
  assert.equal(portalRoute(reloaded, 'city').destination, 'forest');
  assert.equal(JSON.stringify(reloaded), saved);
  assert.equal(reloaded.chapterTwo.roots, false);
});


test('the sanctuary book allows a first visit and return without skipping later chapter locks', () => {
  for (const progress of [undefined, null, {}, { story: { notice: true } }, { restored: true }]) {
    const toMesa = portalRoute(progress, 'city');
    assert.equal(toMesa.destination, 'mesa');
    assert.equal(toMesa.mapName, 'Red Mesa');
    assert.ok(toMesa.spell);
    assert.deepEqual(portalChoices(progress, 'city'), [toMesa]);
    assert.equal(portalRoute(progress, 'mesa').destination, 'city');
    assert.equal(portalRoute(progress, 'city', 'street').destination, null);
    assert.equal(portalRoute(progress, 'city', 'forest').destination, null);
    assert.equal(portalRoute(progress, 'mesa', 'forest').destination, null);
  }
  const progress = ready(), saved = JSON.stringify(progress);
  assert.equal(portalRoute(progress, 'city', 'mesa').destination, 'mesa');
  assert.equal(portalRoute(progress, 'city').destination, 'forest');
  assert.equal(JSON.stringify(progress), saved);
  completeTrials(progress);
  assert.equal(portalRoute(progress, 'city').destination, 'mesa', 'the voice returns to the Moonwell');
});
