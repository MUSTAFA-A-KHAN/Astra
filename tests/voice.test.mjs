import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameAudio } from '../audio.js';
import { HEROES } from '../characters.js';
import { PEOPLE, CAMP_DIRECTIONS } from '../story-script.js';
import { VOICES } from '../voice-manifest.js';
import { CAST, FEELINGS, scripts, spokenLines, voiceOf } from '../tools/voice-direction.mjs';

const audioDirectory = new URL('../assets/audio/', import.meta.url);
const cast = [...Object.keys(CAST.heroes).map(id => ['heroes', id]), ...Object.keys(CAST.people).map(id => ['people', id])];

test('every line the cast speaks has a feeling the recording knows', () => {
  const voiced = new Set(['you', ...Object.keys(CAST.people)]);
  const lines = spokenLines().filter(line => voiced.has(line.voice));
  for (const { voice, text, feeling } of lines) assert.ok(FEELINGS[feeling], `${voice}'s “${text}” is felt as ${feeling}, which tools/voice-direction.mjs does not know`);
  const { heroes, people } = scripts();
  // The hero's spells are among theirs, one for each of the book's passages.
  assert.equal(heroes.Spiderman.filter(line => line.feeling === 'incantation').length, 3);
  // Maren and Tobin say every line they have that has words in it.
  assert.equal(people.maren.length, 18);
  assert.ok(people.tobin.every(line => /\p{L}/u.test(line.text)));
});

test('Tobin reads out his own tide chart, and gives the way to the camp wherever it stands', () => {
  assert.equal(voiceOf('chart'), 'tobin');
  assert.equal(voiceOf('tobin'), 'tobin');
  assert.equal(voiceOf('you'), 'you');
  const tobin = Object.keys(VOICES.people.tobin);
  assert.ok(tobin.some(text => text.startsWith('Keeper. I slept, just as I said I would.')), 'the chart is his to read');
  for (const directions of Object.values(CAMP_DIRECTIONS)) assert.ok(tobin.some(text => text.includes(directions)), `the way to the camp, ${directions}`);
  assert.ok(!tobin.some(text => text.includes('{camp}')));
  assert.equal(PEOPLE.tobin.voice, undefined, 'he speaks in his own name everywhere else');
});

test('each member of the cast has every one of their lines recorded, as Ogg and AAC, and credited', async () => {
  const credits = await readFile(new URL('CREDITS.md', audioDirectory), 'utf8');
  const lines = scripts();
  for (const [kind, id] of cast) {
    if (kind === 'heroes') assert.ok(HEROES.some(h => h.id === id), `${id} is a hero`);
    const rerecord = `run python tools/generate-voice.py ${id}`, recorded = VOICES[kind][id];
    assert.ok(recorded, `${id} has no recordings: ${rerecord}`);
    // A line reworded in the story is a recording out of date.
    assert.deepEqual(Object.keys(recorded).sort(), lines[kind][id].map(line => line.text).sort(), `${id}'s recordings are not of the story's lines: ${rerecord}`);
    for (const file of Object.values(recorded)) {
      assert.ok(file.startsWith(`voice/${kind}/${id.toLowerCase()}/`), file);
      const bytes = await readFile(new URL(file, audioDirectory)).catch(() => null);
      assert.ok(bytes, `assets/audio/${file} is missing`);
      assert.equal(bytes.subarray(0, 4).toString('latin1'), 'OggS', `${file} is not an Ogg stream`);
      const twin = await readFile(new URL(file.replace(/\.ogg$/, '.m4a'), audioDirectory)).catch(() => null);
      assert.ok(twin, `the AAC twin of ${file} is missing`);
      assert.equal(twin.subarray(4, 8).toString('latin1'), 'ftyp', `the twin of ${file} is not an MP4 file`);
    }
    assert.ok(credits.includes(`voice/${kind}/${id.toLowerCase()}/`), `${id}'s voice is not credited`);
  }
});

// A context whose nodes remember where they are connected and the level they
// were last sent to, and whose sources can be ended by hand.
function voiceContext() {
  const param = () => ({ value: 1, target: 1, setTargetAtTime(value) { this.target = value; }, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect(to) { this.to = to; }, disconnect() {} });
  const sources = [];
  return {
    sources, state: 'running', currentTime: 0, destination: {},
    listener: { positionX: param(), positionY: param(), positionZ: param() },
    createGain: () => ({ ...node(), gain: param() }),
    createBufferSource: () => {
      const source = { ...node(), playbackRate: param(), started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
      sources.push(source); return source;
    },
    decodeAudioData: async data => ({ duration: 2.5, url: data.url }),
  };
}
const spoken = (context, name) => context.sources.filter(source => source.buffer?.url.includes(name));

test('a line is spoken on the voice bus, one at a time, with the music stepping back beneath it', async () => {
  const context = voiceContext();
  const audio = new GameAudio({ fetcher: async url => ({ ok: true, arrayBuffer: async () => ({ url: String(url) }) }) });
  audio.setContext(context);
  await Promise.all([...audio.pending.values()]);
  const music = audio.buses.music.gain, voice = audio.buses.voice;

  // A line not yet downloaded starts once it is.
  assert.ok(audio.speak('voice/hero/first.ogg'));
  assert.equal(audio.duration('voice/hero/first.ogg'), null);
  await Promise.all([...audio.pending.values()]);
  const [first] = spoken(context, 'first');
  assert.ok(first?.started, 'the line is heard');
  assert.equal(first.to.to, voice, 'on the voice bus');
  assert.equal(audio.duration('voice/hero/first.ogg'), 2.5);
  assert.equal(audio.getStats().speaking, 'voice/hero/first.ogg');
  assert.ok(Math.abs(music.target - audio.volumes.music * .4) < 1e-9, 'the music steps back');

  // The next line cuts it off, and a line passed over before it downloads is never heard.
  audio.speak('voice/hero/skipped.ogg');
  audio.speak('voice/hero/second.ogg');
  assert.ok(first.stopped);
  await Promise.all([...audio.pending.values()]);
  assert.equal(spoken(context, 'skipped').length, 0);
  const [second] = spoken(context, 'second');
  assert.ok(second?.started);

  // A line that runs to its end gives the music back.
  second.onended();
  assert.equal(audio.getStats().speaking, null);
  assert.equal(music.target, audio.volumes.music);

  // Quiet stops a line mid-word, and one still downloading never starts.
  audio.speak('voice/hero/second.ogg');
  const [, again] = spoken(context, 'second');
  audio.hush();
  assert.ok(again.stopped);
  assert.equal(music.target, audio.volumes.music);
  audio.speak('voice/hero/late.ogg');
  audio.hush();
  await Promise.all([...audio.pending.values()]);
  assert.equal(spoken(context, 'late').length, 0);
});

test('a line about to be spoken never waits on the music', async () => {
  // Every start-up download hangs, as a long recording can while the game is busy.
  const requested = [];
  const audio = new GameAudio({ fetcher: url => {
    requested.push(String(url));
    return String(url).includes('voice/') ? Promise.resolve({ ok: true, arrayBuffer: async () => ({ url: String(url) }) }) : new Promise(() => {});
  } });
  const context = voiceContext();
  audio.setContext(context);
  await new Promise(resolve => setTimeout(resolve));
  assert.equal(audio.downloads, 3, 'three downloads are under way, and the rest queue behind them');
  assert.ok(audio.queue.length > 3);
  audio.speak('voice/hero/line.ogg');
  await new Promise(resolve => setTimeout(resolve));
  assert.equal(requested.filter(url => url.includes('voice/hero/line')).length, 1, 'the line starts downloading at once');
  assert.ok(spoken(context, 'line')[0]?.started, 'and is heard');
});

test('the voice has its own volume, and nothing is spoken with sound off', async () => {
  const context = voiceContext();
  const audio = new GameAudio({ enabled: false, fetcher: async url => ({ ok: true, arrayBuffer: async () => ({ url: String(url) }) }) });
  audio.setContext(context);
  audio.setVolumes({ voice: .35 });
  assert.equal(audio.getStats().volumes.voice, .35);
  assert.equal(audio.buses.voice.gain.target, .35);
  assert.equal(audio.speak('voice/hero/line.ogg'), false);
  await Promise.all([...audio.pending.values()]);
  assert.equal(spoken(context, 'line').length, 0);
});
