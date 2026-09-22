import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fields = {
  ASTRA_TERRAIN_PROVIDER: ['provider', false],
  ASTRA_TERRAIN_LATITUDE: ['latitude', true],
  ASTRA_TERRAIN_LONGITUDE: ['longitude', true],
  ASTRA_TERRAIN_URL: ['urlTemplate', false],
  ASTRA_TERRAIN_TOKEN: ['token', false],
  ASTRA_CESIUM_TOKEN: ['token', false],
  ASTRA_TERRAIN_ZOOM: ['zoom', true],
  ASTRA_TERRAIN_TIMEOUT: ['timeout', true],
  ASTRA_TERRAIN_MAX_RETRIES: ['maxRetries', true],
  ASTRA_TERRAIN_CACHE_SIZE: ['maxCachedTiles', true],
  ASTRA_TERRAIN_ELEVATION_OFFSET: ['elevationOffset', true],
};

export function parseEnvironment(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !Object.hasOwn(fields, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    values[match[1]] = value;
  }
  return values;
}

export async function developmentConfig(root, environment = process.env) {
  let local = {};
  try { local = parseEnvironment(await readFile(resolve(root, '.env.local'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const terrain = {};
  for (const [name, [field, numeric]] of Object.entries(fields)) {
    const value = environment[name] ?? local[name];
    if (value === undefined || value === '') continue;
    if (numeric && !Number.isFinite(Number(value))) continue;
    terrain[field] = numeric ? Number(value) : value;
  }
  return { terrain };
}
