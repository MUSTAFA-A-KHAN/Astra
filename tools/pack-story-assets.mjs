// Packs the Sketchfab models the story is dressed with into assets/story/.
//
//   node tools/pack-story-assets.mjs [source dir]     (default: 3D-model-glb)
//
// The sources are Sketchfab's auto-converted GLBs, credited in
// assets/story/CREDITS.md. Several carry 4K or 8K textures, one is over the
// repository's 25 MB limit on its own, and two use the spec/gloss materials
// three.js no longer reads. This converts those to metal/rough, caps every
// texture at TEXTURE, and re-encodes them as WebP.
// Geometry is left uncompressed, so every model loads with a plain GLTFLoader,
// the character loader's included, without a meshopt decoder.
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

// [output, Sketchfab file, spec/gloss materials]
const ASSETS = [
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
];

const source = process.argv[2] || '3D-model-glb';
const scratch = mkdtempSync(join(tmpdir(), 'story-'));
// npx is a batch file on Windows, so it runs through the shell with its
// arguments quoted. npx itself stays bare: quoted, cmd.exe loses its folder.
const run = (...args) => execSync(`npx ${[...GLTF_TRANSFORM, ...args].map(arg => `"${arg}"`).join(' ')}`, { stdio: ['ignore', 'ignore', 'inherit'] });
mkdirSync(OUT, { recursive: true });
let failed = false;
try {
  for (const [name, file, specGloss] of ASSETS) {
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
