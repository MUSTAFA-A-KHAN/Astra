import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, PEOPLE, CONVERSATIONS, storyStep, stepId, readStory, conversation, whisper, WHISPERS } from '../story-script.js';

const progress = (changes = {}) => ({ collected: new Set(), kills: 0, restored: false, story: readStory({}), ...changes });

test('the story walks its steps in order, one flag at a time', () => {
  const p = progress();
  assert.equal(stepId(p), 'keeper');
  p.story.keeper = true; assert.equal(stepId(p), 'shards');
  for (let i = 0; i < 5; i++) p.collected.add(i);
  assert.equal(stepId(p), 'ferryman');
  p.story.ferryman = true; assert.equal(stepId(p), 'wisps');
  p.kills = 3; assert.equal(stepId(p), 'ledger');
  p.story.ledger = true; assert.equal(stepId(p), 'restore');
  p.restored = true; assert.equal(stepId(p), 'farewell');
  p.story.farewell = true; assert.equal(stepId(p), 'complete');
  assert.equal(storyStep(p), STEPS.length - 1);
});

test('shards and wisps won early count when their step comes round', () => {
  const p = progress({ kills: 7, collected: new Set([0, 1, 2, 3, 4, 5]) });
  assert.equal(stepId(p), 'keeper');
  p.story.keeper = true; assert.equal(stepId(p), 'ferryman');
  p.story.ferryman = true; assert.equal(stepId(p), 'ledger');
});

test('a save from before the story keeps the ending it already earned', () => {
  assert.deepEqual(Object.values(readStory({ restored: true })), [true, true, true, true, true]);
  assert.equal(stepId(progress({ restored: true, story: readStory({ restored: true }) })), 'complete');
  // A save made mid-story is read as it is, and nothing but true counts.
  assert.deepEqual(readStory({ restored: false, story: { keeper: true, ferryman: 'yes', unknown: true } }), { keeper: true, ferryman: false, ledger: false, farewell: false, notice: false });
});

test('whoever the player can reach has something to say at every step', () => {
  for (const step of STEPS) {
    for (const person of ['tobin', 'notice', 'ledger']) assert.ok(conversation(person, step.id)?.lines.length, `${person} at ${step.id}`);
    // Maren is gone once the well is lit.
    if (!['farewell', 'complete'].includes(step.id)) assert.ok(conversation('maren', step.id)?.lines.length, `maren at ${step.id}`);
  }
});

test('conversations only name real speakers and set real flags', () => {
  const flags = new Set([...Object.keys(readStory({})), 'restored']);
  for (const [person, table] of Object.entries(CONVERSATIONS)) {
    assert.ok(PEOPLE[person], person);
    for (const [step, entry] of Object.entries(table)) {
      if (entry.sets) assert.ok(flags.has(entry.sets), `${person}/${step} sets ${entry.sets}`);
      for (const [who, text] of entry.lines) {
        assert.ok(who === null || who === 'you' || PEOPLE[who], `${person}/${step}: ${who}`);
        assert.ok(text.length > 0 && text.length < 260, `${person}/${step}: a line fits the panel`);
      }
    }
  }
  // Each step that waits on a conversation has one that ends it.
  const sets = Object.values(CONVERSATIONS).flatMap(table => Object.values(table).map(entry => entry.sets));
  for (const flag of ['keeper', 'ferryman', 'ledger', 'restored', 'farewell']) assert.ok(sets.includes(flag), flag);
});

test('the first three wisps whisper in order, and any after at random', () => {
  assert.deepEqual([1, 2, 3].map(kills => whisper(kills)), WHISPERS.slice(0, 3));
  assert.equal(whisper(4, () => 0), WHISPERS[3]);
  assert.equal(whisper(9, () => .999), WHISPERS.at(-1));
});
