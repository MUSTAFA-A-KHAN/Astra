import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AUDIO_ASSETS } from '../audio-manifest.js';
import { GameAudio } from '../audio.js';

const audioDirectory = new URL('../assets/audio/', import.meta.url);

test('every sound in the manifest ships as local Ogg and AAC files with credits', async () => {
  for (const [name, { files }] of Object.entries(AUDIO_ASSETS)) {
    for (const file of files) {
      const bytes = await readFile(new URL(file, audioDirectory)).catch(() => null);
      assert.ok(bytes, `${name}: assets/audio/${file} is missing`);
      assert.equal(bytes.subarray(0, 4).toString('latin1'), 'OggS', `${name}: ${file} is not an Ogg stream`);
      const aac = file.replace(/\.ogg$/, '.m4a'), twin = await readFile(new URL(aac, audioDirectory)).catch(() => null);
      assert.ok(twin, `${name}: assets/audio/${aac} is missing`);
      assert.equal(twin.subarray(4, 8).toString('latin1'), 'ftyp', `${name}: ${aac} is not an MP4 file`);
    }
  }
  assert.match(await readFile(new URL('CREDITS.md', audioDirectory), 'utf8'), /creativecommons\.org/);
});

function fakeContext() {
  const param = () => ({ value: 0, setTargetAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  return {
    state: 'running', currentTime: 0, destination: {},
    listener: { positionX: param(), positionY: param(), positionZ: param() },
    createGain: () => ({ ...node(), gain: param() }),
    createBufferSource: () => ({ ...node(), playbackRate: param(), start() {}, stop() {} }),
    decodeAudioData: async () => ({ duration: 1 }),
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
  assert.equal(stats.loaded, requested.filter(url => url.endsWith('.m4a')).length);
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
    audio.update(1 / 60, { x: 0, y: 0, z: 0 }, 'city', { grounded: true, speed: 4, state: 'run', surface: 'stone' });
  }
  assert.equal(played.filter(name => name === 'stepStone').length, 2);
});
