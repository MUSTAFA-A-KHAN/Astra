import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENING_LINES, OPENING_PEOPLE, OPENING_STAGES, readOpening, openingStep, openingClue, openingChoice } from '../opening-script.js';

test('new journeys keep the prologue while existing earned progress is preserved', () => {
  const fresh = { stage: 'prologue', lantern: false, memorial: false, choice: null };
  assert.deepEqual(readOpening(), fresh);
  assert.deepEqual(readOpening({ quality: 'low', hero: 'warden', sound: false }), fresh, 'changing lobby settings does not skip the story');
  for (const saved of [{ restored: true }, { xp: 20 }, { kills: 1 }, { collected: [4] }, { story: { notice: true } }, {map:'mesa'}, {map:'street'}]) {
    assert.equal(readOpening(saved).stage, 'complete', 'a returning player retains the chapter they already reached');
  }
  assert.equal(readOpening({ xp: 20, opening: { stage: 'investigate', lantern: true } }).stage, 'investigate', 'new opening saves take precedence over legacy migration');
});

test('opening saves accept known stages, strict clue booleans and only real choices', () => {
  for (const stage of OPENING_STAGES) {
    const saved = { opening: { stage, lantern: true, memorial: false, choice: stage === 'witness' ? 'mercy' : null } };
    assert.equal(readOpening(saved).stage, stage);
  }
  assert.deepEqual(readOpening({ opening: { stage: 'teleport-to-ending', lantern: 1, memorial: 'true', choice: 'both' } }), {
    stage: 'prologue', lantern: false, memorial: false, choice: null,
  });
  const saved = { opening: { stage: 'investigate', lantern: true, memorial: false } };
  const restored = readOpening(saved);
  restored.memorial = true;
  assert.equal(saved.opening.memorial, false, 'runtime progress does not alias the loaded save');
});

test('either clue can be investigated first and discoveries survive reload without repeating', () => {
  for (const order of [['lantern', 'memorial'], ['memorial', 'lantern']]) {
    const state = readOpening({ opening: { stage: 'investigate' } });
    assert.equal(openingStep(state).count(), 0);
    assert.equal(openingClue(state, order[0]), true);
    assert.equal(state.stage, 'investigate');
    assert.equal(openingStep(state).count(), 1);
    const resumed = readOpening({ opening: JSON.parse(JSON.stringify(state)) });
    assert.equal(openingClue(resumed, order[0]), false, 'the first discovery cannot be rewarded again');
    assert.equal(openingClue(resumed, order[1]), true);
    assert.equal(resumed.stage, 'breach', 'the incident follows the second discovery');
    assert.equal(resumed.lantern && resumed.memorial, true);
    assert.equal(openingClue(resumed, order[1]), false);
  }
});

test('clues cannot skip the cinematic, enemy encounter or ending', () => {
  for (const stage of OPENING_STAGES.filter(stage => stage !== 'investigate')) {
    const state = { stage, lantern: false, memorial: false, choice: null };
    const before = structuredClone(state);
    assert.equal(openingClue(state, 'lantern'), false);
    assert.equal(openingClue(state, 'memorial'), false);
    assert.deepEqual(state, before, stage);
  }
  const state = { stage: 'investigate', lantern: false, memorial: false, choice: null };
  for (const id of ['tobin', 'choice', 'stage', '__proto__', '', null]) assert.equal(openingClue(state, id), false);
  assert.equal(state.stage, 'investigate');
});

test('mercy and sealing are exclusive, persistent choices that can only be awarded once', () => {
  for (const choice of ['mercy', 'seal']) {
    const state = { stage: 'choice', lantern: true, memorial: true, choice: null };
    assert.equal(openingChoice(state, 'unknown'), false);
    assert.equal(openingChoice(state, choice), true);
    assert.equal(state.stage, 'witness');
    assert.equal(state.choice, choice);
    assert.equal(openingChoice(state, choice), false);
    assert.equal(openingChoice(state, choice === 'mercy' ? 'seal' : 'mercy'), false);
    assert.deepEqual(readOpening({ opening: state }), state);
    assert.equal(readOpening({ opening: { ...state, stage: 'choice' } }).stage, 'witness', 'reload after a committed choice cannot pay twice');
  }
  assert.equal(readOpening({ opening: { stage: 'witness' } }).stage, 'choice', 'missing decision returns to its recoverable interaction');
  for (const stage of OPENING_STAGES.filter(stage => stage !== 'choice')) {
    const state = { stage, choice: null };
    assert.equal(openingChoice(state, 'mercy'), false);
    assert.equal(state.choice, null);
  }
});

test('every opening stage has a usable objective and investigation progress is live', () => {
  for (const stage of OPENING_STAGES) {
    const step = openingStep({ stage, lantern: false, memorial: false });
    assert.equal(step.id, `opening-${stage}`);
    assert.equal(step.map, 'city');
    assert.ok(step.title.length > 3 && step.description.length > 10, stage);
    assert.equal(step.where, stage === 'witness' ? 'WEST JETTY' : 'ARRIVAL SQUARE');
  }
  const state = { stage: 'investigate', lantern: false, memorial: false };
  const step = openingStep(state);
  state.memorial = true;
  assert.equal(step.count(), 1, 'the tracker reflects discoveries without rebuilding the objective');
  assert.equal(step.goal, 2);
});

test('spoken beats stay short and each decision has a distinct consequence before the Moonwell handoff', () => {
  const voices = new Set(['you', 'tobin', ...Object.keys(OPENING_PEOPLE)]);
  for (const [beat, lines] of Object.entries(OPENING_LINES)) {
    assert.ok(lines.length > 0 && lines.length <= 4, `${beat} keeps control interruptions short`);
    for (const [voice, text, feeling] of lines) {
      assert.ok(voices.has(voice), `${beat}: unknown speaker ${voice}`);
      assert.ok(text.length > 0 && text.length < 260, `${beat}: words fit the dialogue panel`);
      assert.ok(typeof feeling === 'string' && feeling.length > 0, `${beat}: voice direction is present`);
    }
  }
  assert.notDeepEqual(OPENING_LINES.mercy, OPENING_LINES.seal);
  for (const branch of ['witnessMercy', 'witnessSeal']) {
    const words = OPENING_LINES[branch].map(line => line[1]).join(' ');
    assert.match(words, /Maren/);
    assert.match(words, /Moonwell/);
    assert.match(words, /book.*city portal/);
  }
});
