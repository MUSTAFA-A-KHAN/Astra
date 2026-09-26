import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameAudio } from '../audio.js';
import { HEROES } from '../characters.js';
import { HERO_VOICES } from '../voice-manifest.js';
import { CAST, FEELINGS, voicedLines } from '../tools/voice-direction.mjs';

const audioDirectory = new URL('../assets/audio/', import.meta.url);

test('every line a hero speaks has a feeling the recording knows', () => {
  const lines = voicedLines();
  assert.ok(lines.length >= 9);
  for (const { text, feeling } of lines) assert.ok(FEELINGS[feeling], `“${text}” is felt as ${feeling}, which tools/voice-direction.mjs does not know`);
  // The spells are among them, one for each of the book's passages.
  assert.equal(lines.filter(line => line.feeling === 'incantation').length, 3);
});

test('each hero cast has every line of the story recorded, as Ogg and AAC, and credited', async () => {
  const credits = await readFile(new URL('CREDITS.md', audioDirectory), 'utf8');
  const lines = voicedLines().map(line => line.text).sort();
  for (const hero of Object.keys(CAST)) {
    assert.ok(HEROES.some(h => h.id === hero), `${hero} is a hero`);
    const rerecord = `run python tools/generate-voice.py ${hero}`;
    assert.ok(HERO_VOICES[hero], `${hero} has no recordings: ${rerecord}`);
    // A line reworded in the story is a recording out of date.
    assert.deepEqual(Object.keys(HERO_VOICES[hero]).sort(), lines, `${hero}'s recordings are not of the story's lines: ${rerecord}`);
    for (const file of Object.values(HERO_VOICES[hero])) {
      const bytes = await readFile(new URL(file, audioDirectory)).catch(() => null);
      assert.ok(bytes, `assets/audio/${file} is missing`);
      assert.equal(bytes.subarray(0, 4).toString('latin1'), 'OggS', `${file} is not an Ogg stream`);
      const twin = await readFile(new URL(file.replace(/\.ogg$/, '.m4a'), audioDirectory)).catch(() => null);
      assert.ok(twin, `the AAC twin of ${file} is missing`);
      assert.equal(twin.subarray(4, 8).toString('latin1'), 'ftyp', `the twin of ${file} is not an MP4 file`);
    }
    assert.ok(credits.includes(`voice/${hero.toLowerCase()}/`), `${hero}'s voice is not credited`);
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

test('a line about to be spoken downloads ahead of the music', async () => {
  const requested = [];
  const audio = new GameAudio({ fetcher: async url => { requested.push(String(url)); return { ok: true, arrayBuffer: async () => ({ url: String(url) }) }; } });
  audio.setContext(voiceContext());
  // The start-up downloads are all queued, three at a time, when the line is asked for.
  assert.ok(audio.queue.length > 3);
  audio.speak('voice/hero/line.ogg');
  await Promise.all([...audio.pending.values()]);
  const line = requested.findIndex(url => url.includes('voice/hero/line'));
  assert.ok(line >= 0 && line <= 3, `the line was the ${line + 1}th download`);
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
