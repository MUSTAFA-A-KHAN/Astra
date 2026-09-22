// Central asset configuration. Keep large GLBs outside GitHub Pages.
export const ASSET_BASE_URL = '';
export const ASSET_VERSION = 'v1';

export const assetUrl = path => {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  const base = ASSET_BASE_URL.replace(/\/$/, '');
  const normalized = path.replace(/^\//, '');
  return base ? base + '/' + normalized : normalized;
};

export const CHARACTER_DEFINITIONS = {
  rei: {
    name: 'Rei Ayanami',
    base: 'characters/rei/base.glb',
    fallbackBase: './rigged-model-optimized.glb',
    animations: {
      locomotion: 'animations/rei/locomotion.glb',
      combat: 'animations/rei/combat.glb',
      emotes: 'animations/rei/emotes.glb',
      traversal: 'animations/rei/traversal.glb'
    },
    sharedAnimationPacks: {}
  },
  soldier: {
    name: 'Soldier',
    base: 'https://threejs.org/examples/models/gltf/Soldier.glb',
    animations: {},
    sharedAnimationPacks: {}
  },
  arthur: {
    name: 'Arthur',
    base: 'characters/arthur/base.glb',
    fallbackBase: './Arthur-rigged-under-25mb.glb',
    animations: {
      locomotion: 'animations/arthur/locomotion.glb',
      combat: 'animations/arthur/combat.glb',
      emotes: 'animations/arthur/emotes.glb',
      traversal: 'animations/arthur/traversal.glb'
    },
    sharedAnimationPacks: {}
  }
};

export const WORLD_ASSETS = {
  city: 'https://threejs.org/examples/models/gltf/LittlestTokyo.glb',
  terrain: null,
  sectors: {}
};
