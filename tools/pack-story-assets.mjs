// Packs the Sketchfab models the story is dressed with into assets/story/.
//
//   node tools/pack-story-assets.mjs [output name ...]     (default: all of them)
//
// The sources are Sketchfab's auto-converted GLBs, credited in
// assets/story/CREDITS.md, in the folder each chapter's were saved to. Several
// carry 4K or 8K textures, one is over the repository's 25 MB limit on its
// own, and four use the spec/gloss materials three.js no longer reads. This
// converts those to metal/rough, caps every texture at TEXTURE, and re-encodes
// them as WebP.
// Geometry is left uncompressed, so every model loads with a plain GLTFLoader,
// the character loader's included, without a meshopt decoder.
//
// The industrial valve came as its original FBX in a zip rather than a GLB.
// Unzip it into industrial-valve/ beside the zip and convert it first:
//   node tools/fbx-to-glb.mjs 3D-model-glb-chapter-2/Chapter2/industrial-valve/source/VALVE.fbx \
//     3D-model-glb-chapter-2/Chapter2/industrial_valve.glb 3D-model-glb-chapter-2/Chapter2/industrial-valve/textures
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GLTF_TRANSFORM = ['--yes', '@gltf-transform/cli@4.5.0'];
const LIMIT = 25e6;
const OUT = 'assets/story';
// No story model is seen from closer than a stride or two, where 1024 px is as
// sharp as the screen shows. Anything larger only costs upload time and GPU
// memory while the models stream in beside the game, and a phone has little of
// either to spare.
const TEXTURE = 1024;

// [output, Sketchfab file, spec/gloss materials], by the folder the files are in
const ASSETS = Object.entries({
  '3D-model-glb': [
  ['moonwell-well', 'magic_well'],
  ['moonwell-stone-circle', 'mythical_stone_circle'],
  ['moonwell-ghost-stag', 'ghost_stag'],
  ['moonwell-keeper', 'witch'],
  ['light-shard', 'enchanted_crystal'],
  ['restless-wisp', 'fantasma_ghost_phantom', true],
  ['harbour-villager', 'fuse_civilian_1', true],
  ['wanderers-campfire', 'cozy_campfire_-_shape_key_animation'],
  ['wanderers-tent', 'tent'],
  ['sunstone-watchtower', 'medieval_watchtower_house'],
  ['harbour-rowboat', 'old_rowboat'],
  ['harbour-mythic-whale', 'mythic_whale_-_stylized_animated_model'],
  ['lore-book', 'paladins_book__ancient_knights_secrets'],
  ['quest-notice-board', 'medieval_notice_board'],
  ['old-lantern', 'old_lantern_game_ready_asset'],
  ['treasure-chest', 'treasure_chest'],
  ],
  // The Drowned Meridian's trials, and the Hollow Warden and its echoes.
  '3D-model-glb-chapter-2/Chapter2': [
    ['meridian-rune', 'low_poly_fantasy_rune_stone'],
    ['root-tablet', 'monumental_runic_stone_-_optimised_20k'],
    ['pressure-gauge', 'pressure_gauge'],
    ['pressure-valve', 'industrial_valve'],
    ['meridian-beacon', 'medieval_brazier'],
    ['meridian-seal', 'magic_circle'],
    ['warden-dais', 'altar_ruins'],
    ['tide-chart', 'old_map_3d_model', true],
    ['hollow-warden', 'drugdor_the_golem_animated'],
    ['drowned-echo', 'zombie_warrior', true],
  ],
}).flatMap(([folder, assets]) => assets.map(([name, file, specGloss]) => [name, join(folder, `${file}.glb`), specGloss]));

const only = process.argv.slice(2);
const unknown = only.filter(name => !ASSETS.some(([output]) => output === name));
if (unknown.length) throw new Error(`No story asset is called ${unknown.join(', ')}`);
const scratch = mkdtempSync(join(tmpdir(), 'story-'));
// npx is a batch file on Windows, so it runs through the shell with its
// arguments quoted. npx itself stays bare: quoted, cmd.exe loses its folder.
const run = (...args) => execSync(`npx ${[...GLTF_TRANSFORM, ...args].map(arg => `"${arg}"`).join(' ')}`, { stdio: ['ignore', 'ignore', 'inherit'] });
mkdirSync(OUT, { recursive: true });
let failed = false;
try {
  for (const [name, input, specGloss] of ASSETS) {
    if (only.length && !only.includes(name)) continue;
    const output = join(OUT, `${name}.glb`);
    let step = 0, current = join(scratch, `${name}-${step}.glb`);
    copyFileSync(input, current);
    const apply = (command, ...options) => {
      const next = join(scratch, `${name}-${++step}.glb`);
      run(command, current, next, ...options);
      current = next;
    };
    if (specGloss) apply('metalrough');
    apply('dedup');
    apply('prune');
    apply('resize', '--width', TEXTURE, '--height', TEXTURE);
    apply('webp');
    apply('resample');
    copyFileSync(current, output);
    const [before, after] = [statSync(input).size, statSync(output).size];
    if (after >= LIMIT) failed = true;
    console.log(`${name.padEnd(22)} ${(before / 1e6).toFixed(1).padStart(5)} MB -> ${(after / 1e6).toFixed(1).padStart(5)} MB${after >= LIMIT ? '  OVER 25 MB' : ''}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failed) process.exit(1);
