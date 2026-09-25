import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTER_TWO, CHAPTER_TWO_STEPS, CHAPTER_TWO_PEOPLE, CHALLENGE_RULES,
  RUNE_ORDER, BELL_ORDER, readChapterTwo, chapterTwoStep, chapterTwoConversation, advanceSequence,
} from '../chapter-two-script.js';

const flags = ['accepted', 'roots', 'bells', 'valves', 'vigil', 'warden', 'complete'];

test('chapter two saves only explicit booleans and never inherits chapter one completion', () => {
  for (const saved of [undefined, null, {}, { restored: true, story: { farewell: true } }, { chapterTwo: 'complete' }]) {
    assert.deepEqual(readChapterTwo(saved), Object.fromEntries(flags.map(flag => [flag, false])));
  }
  const saved = { chapterTwo: { accepted: true, roots: 1, bells: 'true', valves: false, vigil: null, warden: {}, complete: true, extra: true } };
  assert.deepEqual(readChapterTwo(saved), { accepted: true, roots: false, bells: false, valves: false, vigil: false, warden: false, complete: true });
  const state = readChapterTwo(saved);
  state.accepted = false;
  assert.equal(saved.chapterTwo.accepted, true, 'reading creates an independent state object');
});

test('the chapter advances through three maps and retains completed trials', () => {
  const state = readChapterTwo({});
  const expected = ['summons', 'roots', 'bells', 'valves', 'vigil', 'warden', 'homecoming', 'complete'];
  assert.equal(CHAPTER_TWO.title, 'The Drowned Meridian');
  assert.deepEqual(CHAPTER_TWO_STEPS.map(step => step.id), expected);
  assert.equal(chapterTwoStep(state).id, expected[0]);
  for (let index = 0; index < flags.length; index++) {
    state[flags[index]] = true;
    assert.equal(chapterTwoStep(state).id, expected[index + 1]);
  }
  assert.deepEqual([...new Set(CHAPTER_TWO_STEPS.map(step => step.map))].sort(), ['city', 'forest', 'yard']);
  state.bells = false;
  assert.equal(chapterTwoStep(state).id, 'bells', 'a later flag cannot skip an unfinished trial');
});

test('only the chart accepts the quest and only the seal awards the finale after the guardian', () => {
  const state = readChapterTwo({});
  assert.equal(chapterTwoConversation('chart', state).sets, 'accepted');
  for (const person of Object.keys(CHAPTER_TWO_PEOPLE).filter(id => id !== 'chart')) {
    assert.equal(chapterTwoConversation(person, state).sets, undefined, person);
  }
  state.accepted = true;
  assert.equal(chapterTwoConversation('chart', state).sets, undefined);
  for (const flag of ['roots', 'bells', 'valves', 'vigil']) {
    state[flag] = true;
    for (const person of Object.keys(CHAPTER_TWO_PEOPLE)) {
      assert.equal(chapterTwoConversation(person, state).sets, undefined, `${person} after ${flag}`);
    }
  }
  state.warden = true;
  assert.equal(chapterTwoConversation('seal', state).sets, 'complete');
  for (const prerequisite of flags.filter(flag => flag !== 'complete')) {
    assert.equal(chapterTwoConversation('seal', { ...state, [prerequisite]: false }).sets, undefined, `the finale needs ${prerequisite}`);
  }
  state.complete = true;
  assert.equal(chapterTwoConversation('seal', state).sets, undefined, 'the finale is awarded once');
  assert.equal(chapterTwoConversation('unknown', state), null);
});

test('every story stage has readable dialogue with known speakers', () => {
  const state = readChapterTwo({});
  for (const flag of [null, ...flags]) {
    if (flag) state[flag] = true;
    for (const person of Object.keys(CHAPTER_TWO_PEOPLE)) {
      const entry = chapterTwoConversation(person, state);
      assert.ok(entry.lines.length > 0, `${person}/${flag}`);
      for (const [speaker, text] of entry.lines) {
        assert.ok(speaker === null || speaker === 'you' || CHAPTER_TWO_PEOPLE[speaker], speaker);
        assert.ok(text.length > 0 && text.length < 260, `${person}: ${text}`);
      }
    }
  }
});

test('Tobin gives the physical keeper book and mission directions follow the portal route', () => {
  const chart = chapterTwoConversation('chart', {}).lines.map(([, text]) => text).join(' ');
  assert.match(chart, /places Maren's ledger in your hands/);
  assert.match(chart, /Only this book can awaken them/);
  assert.match(chart, /open it on the lectern, read the passage, then cast the spell/);
  for (const [id, map] of [['roots', 'forest'], ['bells', 'yard'], ['homecoming', 'city']]) {
    const step = CHAPTER_TWO_STEPS.find(entry => entry.id === id);
    assert.equal(step.map, map);
    assert.match(step.description, /book/);
    assert.match(step.description, /portal/);
    assert.match(step.description, /spell/);
    assert.doesNotMatch(step.description, /bridge/);
  }
});

test('the readable clues specify the exact playable rune and bell sequences', () => {
  const state = { accepted: true };
  for (const [person, order] of [['rootTablet', RUNE_ORDER], ['bellTablet', BELL_ORDER]]) {
    const clue = chapterTwoConversation(person, state).lines.map(line => line[1]).join(' ');
    let previous = -1;
    for (const token of order) {
      const position = clue.indexOf(token.toUpperCase());
      assert.ok(position > previous, `${person}: ${token} follows the prior clue`);
      previous = position;
    }
    let progress = 0;
    for (let index = 0; index < order.length; index++) {
      const result = advanceSequence(order, progress, order[index]);
      assert.equal(result.correct, true);
      assert.equal(result.complete, index === order.length - 1);
      progress = result.progress;
    }
    assert.deepEqual(advanceSequence(order, 1, order[0]), { progress: 0, correct: false, complete: false });
    assert.deepEqual(advanceSequence(order, -8, order[0]), { progress: 1, correct: true, complete: false });
  }
  assert.deepEqual(advanceSequence([], 0, undefined), { progress: 0, correct: false, complete: false });
});

test('challenge clues cover the shared time limit, escalating waves and shield window', () => {
  const state = Object.fromEntries(flags.map(flag => [flag, !['vigil', 'warden', 'complete'].includes(flag)]));
  assert.equal(CHALLENGE_RULES.waveCounts.length, CHALLENGE_RULES.waves);
  assert.deepEqual(CHALLENGE_RULES.waveCounts, [2, 3, 4]);
  assert.ok(CHALLENGE_RULES.bossHP > CHALLENGE_RULES.baseEnemyHP);
  const words = person => chapterTwoConversation(person, state).lines.flat().join(' ');
  state.valves = false;
  assert.match(words('valvePanel'), new RegExp(`${CHALLENGE_RULES.valveSeconds}-second`));
  assert.match(words('valvePanel'), /Close all three marked valves in any order/);
  assert.match(words('valvePanel'), /timer starts when you close the first valve/);
  assert.match(words('valvePanel'), /all three valves reopen/);
  assert.match(words('valvePanel'), /Retry from any valve/);
  state.valves = true;
  assert.match(words('beacon'), /two, then three, then four/);
  state.vigil = true;
  assert.match(words('warden'), /shield opens/);
  assert.match(words('warden'), /red circle/);
  assert.match(words('warden'), /Jump over the surge or move outside/);
  assert.match(words('warden'), /3\.4 seconds/);
  assert.match(words('warden'), /next 3\.6 seconds/);
});

test('the iron boss imprisons the friendly Tidewarden voice instead of replacing the harbour guardian', () => {
  const state = { accepted: true, roots: true, bells: true, valves: true, vigil: true, warden: false };
  const mission = CHAPTER_TWO_STEPS.find(step => step.id === 'warden');
  assert.equal(mission.map, 'yard');
  assert.match(mission.description, /challenge the Hollow Warden/);
  const chart = chapterTwoConversation('chart', {}).lines.map(line => line[1]).join(' ');
  assert.match(chart, /great whale in the harbour/);
  const boss = chapterTwoConversation('warden', state).lines.map(line => line[1]).join(' ');
  assert.match(boss, /Hollow Warden/);
  assert.match(boss, /prison holding the Tidewarden's stolen voice/);
  state.warden = true;
  const finale = chapterTwoConversation('seal', state);
  assert.ok(finale.lines.some(([speaker, text]) => speaker === 'warden' && /I guard the passage/.test(text)));
  assert.equal(CHAPTER_TWO_PEOPLE.warden.name, 'The Tidewarden');
});
