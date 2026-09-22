export class CharacterManager {
  constructor({ assetManager, animationManager, heroes, createBuiltin }) {
    this.assets = assetManager;
    this.animations = animationManager;
    this.heroes = heroes;
    this.createBuiltin = createBuiltin;
    this.active = null;
    this.instances = new Map();
  }

  getMeta(id) {
    return this.heroes.find(hero => hero.id === id) || this.heroes[0];
  }

  async load(id, { signal } = {}) {
    const meta = this.getMeta(id);
    if (this.instances.has(meta.id)) return this.instances.get(meta.id);

    // createHero() contains Astra's original, working character runtime for
    // both built-in and imported characters. Do not clone/retarget the rig here:
    // that can break SkinnedMesh skeleton bindings and existing animation clips.
    const character = await this.createBuiltin(meta);

    this.instances.set(meta.id, character);
    return character;
  }

  async activate(id, options = {}) {
    const character = await this.load(id, options);
    this.active = character;
    return character;
  }

  async preload(ids = []) {
    await Promise.all(ids.map(id => this.load(id).catch(error => {
      console.warn('Character preload skipped:', id, error);
      return null;
    })));
  }

  release(id) {
    const character = this.instances.get(id);
    if (!character || character === this.active) return;
    character.dispose?.();
    this.instances.delete(id);
  }

  releaseAll({ keepActive = true } = {}) {
    for (const [id, character] of this.instances) {
      if (keepActive && character === this.active) continue;
      character.dispose?.();
      this.instances.delete(id);
    }
    if (!keepActive) this.active = null;
  }

  // Keep the original Astra character runtime as the source of truth.
  // The manager owns lifecycle/caching, while createHero preserves the existing
  // rig, animation clips, retargeting assumptions, and character-specific behavior.

  }
}
