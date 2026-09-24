// Packs the Sketchfab models the story is dressed with into assets/story/.
//
//   node tools/pack-story-assets.mjs [source dir]     (default: 3D-model-glb)
//
// The sources are Sketchfab's auto-converted GLBs, credited in
// assets/story/CREDITS.md. Several carry 4K or 8K textures, one is over the
// repository's 25 MB limit on its own, and two use the spec/gloss materials
// three.js no longer reads. This converts those to metal/rough, caps each
// model's textures at the size it is ever seen at, and re-encodes them as WebP.
// Geometry is left uncompressed, so every model loads with a plain GLTFLoader,
// the character loader's included, without a meshopt decoder.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GLTF_TRANSFORM = ['--yes', '@gltf-transform/cli@4.5.0'];
const LIMIT = 25e6;
const OUT = 'assets/story';

// [output, Sketchfab file, texture cap in px, spec/gloss materials]
const ASSETS = [
  ['moonwell-well', 'magic_well', 2048],
  ['moonwell-stone-circle', 'mythical_stone_circle', 2048],
  ['moonwell-ghost-stag', 'ghost_stag', 2048],
  ['moonwell-keeper', 'witch', 2048],
  ['light-shard', 'enchanted_crystal', 1024],
  ['restless-wisp', 'fantasma_ghost_phantom', 1024, true],
  ['harbour-villager', 'fuse_civilian_1', 1024, true],
  ['wanderers-campfire', 'cozy_campfire_-_shape_key_animation', 1024],
  ['wanderers-tent', 'tent', 2048],
  ['sunstone-watchtower', 'medieval_watchtower_house', 2048],
  ['harbour-rowboat', 'old_rowboat', 2048],
  ['harbour-mythic-whale', 'mythic_whale_-_stylized_animated_model', 2048],
  ['lore-book', 'paladins_book__ancient_knights_secrets', 1024],
  ['quest-notice-board', 'medieval_notice_board', 1024],
  ['old-lantern', 'old_lantern_game_ready_asset', 1024],
  ['treasure-chest', 'treasure_chest', 1024],
];

const source = process.argv[2] || '3D-model-glb';
const scratch = mkdtempSync(join(tmpdir(), 'story-'));
// npx is a batch file on Windows, so it runs through the shell with its
// arguments quoted. npx itself stays bare: quoted, cmd.exe loses its folder.
const run = (...args) => execSync(`npx ${[...GLTF_TRANSFORM, ...args].map(arg => `"${arg}"`).join(' ')}`, { stdio: ['ignore', 'ignore', 'inherit'] });
mkdirSync(OUT, { recursive: true });
let failed = false;
try {
  for (const [name, file, size, specGloss] of ASSETS) {
    const input = join(source, `${file}.glb`), output = join(OUT, `${name}.glb`);
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
    apply('resize', '--width', size, '--height', size);
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
