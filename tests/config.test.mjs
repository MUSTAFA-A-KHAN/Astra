import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { developmentConfig, parseEnvironment } from '../tools/runtime-config.mjs';

test('runtime config accepts only public terrain settings without executing dotenv content', () => {
  const config = parseEnvironment(`
    ASTRA_TERRAIN_PROVIDER=terrarium # public elevation
    ASTRA_TERRAIN_LATITUDE='46.577'
    ASTRA_TERRAIN_URL="https://tiles.example/{z}/{x}/{y}.png?key=$SECRET"
    DATABASE_PASSWORD=private
    export ASTRA_TERRAIN_LONGITUDE=10.718
  `);
  assert.equal(config.ASTRA_TERRAIN_PROVIDER, 'terrarium');
  assert.equal(config.ASTRA_TERRAIN_LATITUDE, '46.577');
  assert.match(config.ASTRA_TERRAIN_URL, /\$SECRET$/);
  assert.equal(config.DATABASE_PASSWORD, undefined);
});

test('development configuration defaults safely and environment overrides local file', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'astra-config-'));
  try {
    assert.deepEqual(await developmentConfig(directory, {}), { terrain: {} });
    await writeFile(resolve(directory, '.env.local'), 'ASTRA_TERRAIN_PROVIDER=terrarium\nASTRA_TERRAIN_LATITUDE=46\nASTRA_TERRAIN_TOKEN=local-token\n');
    const config = await developmentConfig(directory, { ASTRA_TERRAIN_LATITUDE: '47', ASTRA_TERRAIN_ZOOM: 'not-a-number', PRIVATE_KEY: 'hidden' });
    assert.deepEqual(config, { terrain: { provider: 'terrarium', latitude: 47, token: 'local-token' } });
  } finally {
    // The path is created by mkdtemp within the operating system temporary directory.
    assert.ok(directory.startsWith(resolve(tmpdir(), 'astra-config-')));
    await rm(directory, { force: true, recursive: true });
  }
});
