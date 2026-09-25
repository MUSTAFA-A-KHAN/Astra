import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AUDIO_ASSETS } from '../audio-manifest.js';
import { GameAudio, footstepSurface, stepSlices } from '../audio.js';

const audioDirectory = new URL('../assets/audio/', import.meta.url);

test('every sound in the manifest ships as local Ogg and AAC files with credits', async () => {
  const credits = await readFile(new URL('CREDITS.md', audioDirectory), 'utf8');
  for (const [name, { files }] of Object.entries(AUDIO_ASSETS)) {
    for (const file of files) {
      const bytes = await readFile(new URL(file, audioDirectory)).catch(() => null);
      assert.ok(bytes, `${name}: assets/audio/${file} is missing`);
      assert.ok(credits.includes(file.split('/').pop()), `${name}: ${file} is not credited`);
      assert.equal(bytes.subarray(0, 4).toString('latin1'), 'OggS', `${name}: ${file} is not an Ogg stream`);
      const aac = file.replace(/\.ogg$/, '.m4a'), twin = await readFile(new URL(aac, audioDirectory)).catch(() => null);
      assert.ok(twin, `${name}: assets/audio/${aac} is missing`);
      assert.equal(twin.subarray(4, 8).toString('latin1'), 'ftyp', `${name}: ${aac} is not an MP4 file`);
    }
  }
  assert.match(credits, /creativecommons\.org/);
});

// A recording of footfalls at the given times (seconds) and levels: each a
// sharp knock that dies away, over a faint hiss.
function walking(falls, { duration = 3, sampleRate = 8000, channels = 2 } = {}) {
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
  const data = Array.from({ length: channels }, () => new Float32Array(Math.round(duration * sampleRate)));
  for (const samples of data) {
    for (let i = 0; i < samples.length; i++) samples[i] = noise() * .002;
    for (const [time, level] of falls) {
      for (let i = 0, start = Math.round(time * sampleRate); i < sampleRate * .15 && start + i < samples.length; i++) samples[start + i] += noise() * level * Math.exp(-i / (sampleRate * .03));
    }
  }
  return { sampleRate, numberOfChannels: channels, duration, getChannelData: c => data[c] };
}

function fakeContext() {
  const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  return {
    state: 'running', currentTime: 0, destination: {},
    listener: { positionX: param(), positionY: param(), positionZ: param() },
    createGain: () => ({ ...node(), gain: param() }),
    createBufferSource: () => ({ ...node(), playbackRate: param(), start() {}, stop() {} }),
    decodeAudioData: async () => walking([[.2, .5], [.7, .5]], { duration: 1 }),
  };
}

test('a browser that cannot decode Ogg Vorbis falls back to the AAC files', async () => {
  const requested = [], context = fakeContext();
  context.decodeAudioData = async data => { if (data.url.endsWith('.ogg')) throw new Error('EncodingError'); return { duration: 1 }; };
  const audio = new GameAudio({ fetcher: async url => { requested.push(String(url)); return { ok: true, arrayBuffer: async () => ({ url: String(url) }) }; } });
  audio.setContext(context);
  await Promise.all([...audio.pending.values()]);
  const stats = audio.getStats();
  assert.equal(stats.format, 'm4a');
  assert.deepEqual(stats.failed, []);
  assert.equal(stats.loaded, requested.filter(url => !url.endsWith('.ogg')).length);
  assert.ok(requested.filter(url => url.endsWith('.ogg')).length <= 3, 'only the first concurrent batch should try Ogg');
});

test('a wrong AAC guess falls back to the Ogg files', async () => {
  const context = fakeContext();
  context.decodeAudioData = async data => { if (data.url.endsWith('.m4a')) throw new Error('EncodingError'); return { duration: 1 }; };
  const audio = new GameAudio({ format: 'm4a', fetcher: async url => ({ ok: true, arrayBuffer: async () => ({ url: String(url) }) }) });
  audio.setContext(context);
  await Promise.all([...audio.pending.values()]);
  assert.equal(audio.getStats().format, 'ogg');
  assert.deepEqual(audio.getStats().failed, []);
});

test('footsteps keep their stride while the game re-asserts the unpaused state every frame', async () => {
  const audio = new GameAudio({ random: () => 0, fetcher: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) });
  audio.setContext(fakeContext());
  await Promise.all([...audio.pending.values()]);
  const played = [], play = audio.play.bind(audio);
  audio.play = (name, options) => { played.push(name); return play(name, options); };
  for (let frame = 0; frame < 60; frame++) {
    audio.setPaused(false);
    audio.update(1 / 60, { x: 0, y: 0, z: 0 }, 'city', { grounded: true, speed: 4, state: 'run', surface: 'city' });
  }
  assert.equal(played.filter(name => name === 'walkDirt').length, 2);
});

test('a walking recording is cut at each footfall, and every step brought to one level', () => {
  const falls = [[.3, .4], [.8, .25], [1.3, .6], [1.8, .02], [2.3, .5]];
  const slices = stepSlices(walking(falls)), heard = falls.filter(([, level]) => level > .05);
  // The step at a thirtieth of the loudest is someone far off: it is left out.
  assert.equal(slices.length, heard.length);
  slices.forEach((slice, i) => {
    const [time, level] = heard[i];
    assert.ok(slice.offset < time && time - slice.offset < .05, `a step starts just before its footfall at ${time}`);
    assert.ok(slice.offset + slice.duration <= time + .5, 'and ends by the next');
    // Quiet steps are raised and loud ones lowered, to the same level.
    assert.ok(Math.abs(slice.gain * level / (slices[0].gain * heard[0][1]) - 1) < .1, `the step at ${time} is levelled`);
  });
  // Silence has no steps at all.
  assert.deepEqual(stepSlices({ sampleRate: 8000, numberOfChannels: 1, getChannelData: () => new Float32Array(8000) }), []);
});

test('each stride plays the walk of the ground underfoot, and the horse when riding', async () => {
  assert.equal(footstepSurface('city'), 'walkDirt');
  assert.equal(footstepSurface('yard'), 'walkDirt');
  assert.equal(footstepSurface('forest'), 'walkGrass');
  assert.equal(footstepSurface('plaza'), 'walkGravel');
  assert.equal(footstepSurface('water'), 'walkWater');
  assert.equal(footstepSurface('forest', true), 'walkHorse');
  let draw = 0;
  const audio = new GameAudio({ random: () => (draw++ % 5) / 5, fetcher: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) });
  audio.setContext(fakeContext());
  // Every recording of a walk is drawn on, and no step is heard twice running.
  const heard = [];
  for (let i = 0; i < 12; i++) {
    const step = audio.step('walkGrass');
    if (step) heard.push(step);
    await Promise.all([...audio.pending.values()]);
  }
  assert.ok(heard.length >= 10);
  assert.equal(new Set(heard.map(step => step.buffer)).size, AUDIO_ASSETS.walkGrass.files.length);
  for (let i = 1; i < heard.length; i++) assert.notEqual(heard[i].span, heard[i - 1].span);
  assert.ok(AUDIO_ASSETS.walkGrass.files.every(file => audio.buffers.has(file)));
});

test('breath is heard only as stamina runs out, not for every sprint or climb', async () => {
  const audio = new GameAudio({ fetcher: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) });
  audio.setContext(fakeContext());
  await Promise.all([...audio.pending.values()]);
  const run = (seconds, locomotion) => {
    for (let t = 0; t < seconds; t += 1 / 60) audio.update(1 / 60, { x: 0, y: 0, z: 0 }, 'city', { grounded: true, speed: 8.5, state: 'sprint', surface: 'city', ...locomotion });
  };
  run(2, { stamina: .8 });
  assert.ok(audio.breathLevel < .01, 'a fresh sprint is quiet');
  run(2, { stamina: 1, climbing: true, state: 'climb' });
  assert.ok(audio.breathLevel < .01, 'and so is a climb');
  run(2, { stamina: .2 });
  assert.ok(audio.breathLevel > .6, 'an almost empty bar is heard');
  run(2, { stamina: .1, exhausted: true, speed: 4.7, state: 'run' });
  assert.ok(audio.breathLevel > .75, 'and keeps on while it refills');
  run(20, { stamina: 1, speed: 0, state: 'idle' });
  assert.ok(audio.breathLevel < .05, 'then fades once it is back');
});
