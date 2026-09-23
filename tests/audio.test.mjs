import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AUDIO_ASSETS } from '../audio-manifest.js';
import { GameAudio } from '../audio.js';

const audioDirectory = new URL('../assets/audio/', import.meta.url);

test('every sound in the manifest ships as a local Ogg file with credits', async () => {
  for (const [name, { files }] of Object.entries(AUDIO_ASSETS)) {
    for (const file of files) {
      const bytes = await readFile(new URL(file, audioDirectory)).catch(() => null);
      assert.ok(bytes, `${name}: assets/audio/${file} is missing`);
      assert.equal(bytes.subarray(0, 4).toString('latin1'), 'OggS', `${name}: ${file} is not an Ogg stream`);
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
