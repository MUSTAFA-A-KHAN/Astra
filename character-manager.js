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

    const character = meta.imported
      ? await this.#loadImported(meta, { signal })
      : this.createBuiltin(meta);

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

  async #loadImported(meta, { signal }) {
    const asset = await this.assets.load(meta.model, { signal });
    const source = asset.scene;
    if (!source) throw new Error(`The ${meta.name} model did not contain a scene.`);

    // Clone the cached scene. The binary GLB, geometry, textures and source
    // parse result are requested/parsed once; each live character owns its rig.
    const model = source.clone(true);
    const group = this.#fitModel(model, meta);
    const clips = (asset.animations || []).map(clip => clip.clone());

    const mixer = clips.length ? new THREE.AnimationMixer(model) : null;
    const controller = this.#createController({ meta, model, group, mixer, clips });
    return controller;
  }

  #fitModel(model, meta) {
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.001) {
      throw new Error(`The ${meta.name} model has invalid dimensions.`);
    }

    model.scale.multiplyScalar(3.4 / size.y);
    model.updateMatrixWorld(true);

    const fitted = new THREE.Group();
    const resizedBounds = new THREE.Box3().setFromObject(model);
    const center = resizedBounds.getCenter(new THREE.Vector3());
    fitted.add(model);
    fitted.position.set(-center.x, -resizedBounds.min.y, -center.z);

    model.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.filter(Boolean).forEach(material => {
        if ('roughness' in material) material.roughness = Math.max(0.48, material.roughness);
      });
    });

    return fitted;
  }

  #createController({ meta, model, group, mixer, clips }) {
    const find = pattern => clips.find(clip => pattern.test(clip.name));
    const idle = find(/idle/i) || clips[0];
    const walk = find(/^(walk|jog)/i) || idle;
    const run = find(/(?:sprint|run)/i) || walk;
    const actions = new Map();
    for (const clip of new Set([idle, walk, run].filter(Boolean))) {
      actions.set(clip, mixer.clipAction(clip));
    }

    let current = idle ? actions.get(idle) : null;
    current?.play();
    let disposed = false;

    return {
      group,
      model,
      meta,
      mixer,
      height: 3.4,
      animationSource: clips.length ? 'character' : 'none',
      animate(dt, { moving = false, sprinting = false, attacking = false, time = 0 } = {}) {
        if (disposed) return;
        const next = actions.get(moving ? sprinting ? run : walk : idle);
        if (next && next !== current) {
          next.reset().setEffectiveWeight(1).fadeIn(0.22).play();
          current?.fadeOut(0.22);
          current = next;
        }
        mixer?.update(Math.min(Math.max(dt, 0), 0.1));
        group.rotation.z = attacking ? Math.sin(time * 22) * 0.025 : 0;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        mixer?.stopAllAction();
        mixer?.uncacheRoot(model);
      },
    };
  }
}
