import { AnimationManager } from './AnimationManager.js';
import { CHARACTER_DEFINITIONS } from './config.js';

const ACTION_ALIASES = {
  idle: ['Idle', 'Idle Fold Arms'],
  walk: ['Walk Forward', 'Walk'],
  run: ['Sprint', 'Jog Forward', 'Run'],
  jump: ['Jump', 'Jump Start'],
  land: ['Jump Land'],
  fall: ['Fall'],
  attack: ['Attack', 'Attack 1'],
  block: ['Block', 'Guard'],
  hit: ['Hit', 'Take Hit'],
  emote: ['Emote']
};

export class CharacterManager {
  constructor({ assetManager, player, loading, prepareModel } = {}) {
    this.assets = assetManager;
    this.player = player;
    this.loading = loading;
    this.prepareModel = prepareModel;
    this.definitions = CHARACTER_DEFINITIONS;
    this.cache = new Map();
    this.active = null;
    this.switching = null;
    this.animationPacks = new Map();
  }

  definition(id) { return this.definitions[id] || this.definitions.rei; }

  async getCharacter(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const def = this.definition(id);
    const gltf = await this.assets.loadGLTF(def.base, {
      fallback: def.fallbackBase,
      key: 'char-' + id,
      label: def.name
    });
    const entry = { id, def, gltf, model: null, manager: null };
    this.cache.set(id, entry);
    return entry;
  }

  async preloadCharacter(id) {
    await this.getCharacter(id);
    return true;
  }

  async activate(id) {
    if (this.active?.id === id) return this.active;
    if (this.switching) return this.switching;

    this.switching = (async () => {
      const entry = await this.getCharacter(id);
      const previous = this.active;
      const oldPosition = this.player.group.position.clone();
      const oldFacing = this.player.facing;
      const oldDisplayYaw = this.player.displayYaw;
      const oldVelocity = this.player.velocity.clone();

      this.detachEntry(previous);

      const model = this.assets.cloneScene(entry.gltf);
      if (!model) throw new Error('Character scene is missing for ' + entry.id);
      this.prepareModel?.(model, entry);

      entry.model = model;
      this.player.group.add(model);
      this.player.model = model;

      const manager = new AnimationManager(this.assets);
      manager.attach(model, entry.gltf.animations || []);
      entry.manager = manager;
      this.player.mixerManager = manager;
      this.player.mixer = manager.mixer;

      this.player.idleAction = manager.getAction('idle', ...ACTION_ALIASES.idle);
      this.player.walkAction = manager.getAction('walk', ...ACTION_ALIASES.walk);
      this.player.runAction = manager.getAction('run', ...ACTION_ALIASES.run);
      this.player.jumpAction = manager.getAction('jump', ...ACTION_ALIASES.jump);
      this.player.jumpLandAction = manager.getAction('land', ...ACTION_ALIASES.land);
      this.player.fallAction = manager.getAction('fall', ...ACTION_ALIASES.fall);

      const locomotion = [
        this.player.idleAction,
        this.player.walkAction,
        this.player.runAction,
        this.player.jumpAction,
        this.player.jumpLandAction,
        this.player.fallAction
      ];
      locomotion.forEach(action => {
        if (action) {
          action.enabled = true;
          action.setEffectiveWeight(0);
          action.play();
        }
      });
      if (this.player.idleAction) this.player.idleAction.setEffectiveWeight(1);

      this.player.group.position.copy(oldPosition);
      this.player.facing = oldFacing;
      this.player.displayYaw = oldDisplayYaw;
      this.player.velocity.copy(oldVelocity);
      this.active = entry;

      this.loading?.complete('char-' + id, entry.def.name + ' ready');
      return entry;
    })().finally(() => { this.switching = null; });

    return this.switching;
  }

  async ensureAnimationPack(pack) {
    const entry = this.active;
    if (!entry) return false;
    const path = entry.def.sharedAnimationPacks?.[pack] || entry.def.animations?.[pack];
    const key = entry.id + ':' + pack;
    if (!path || this.animationPacks.has(key)) return true;

    const loaded = await entry.manager?.loadPack(path, pack, 'anim-' + entry.id + '-' + pack);
    if (loaded) {
      this.animationPacks.set(key, true);
      // Pack clips become available immediately; actions are still lazy.
    }
    return !!loaded;
  }

  preloadLikely() {
    return this.ensureAnimationPack('combat').catch(() => false);
  }

  detachEntry(entry) {
    if (!entry?.model) return;
    const model = entry.model;
    entry.manager?.detach();
    this.player.group.remove(model);
    // Geometry/materials are shared with the cached GLTF source and must not be disposed here.
    entry.model = null;
    entry.manager = null;
    if (this.player.model === model) this.player.model = null;
    if (this.player.mixerManager === entry.manager) this.player.mixerManager = null;
    if (!this.active || this.active === entry) {
      this.player.mixer = null;
      this.player.idleAction = null;
      this.player.walkAction = null;
      this.player.runAction = null;
      this.player.jumpAction = null;
      this.player.jumpLandAction = null;
      this.player.fallAction = null;
    }
  }
}
