import * as THREE from 'three';
import { assetManager } from './asset-manager.js';
import { animationManager } from './animation-manager.js';

export class CharacterManager {
  constructor() {
    this.characterCache = new Map();
    this.pending = new Map();
  }

  async load(meta) {
    if (!meta) throw new Error('Character metadata is required.');
    const cached = this.characterCache.get(meta.id);
    if (cached) return cached;

    const pending = this.pending.get(meta.id);
    if (pending) return pending;

    const request = (meta.imported ? this.#loadImported(meta) : this.#loadBuiltin(meta))
      .then(character => {
        this.characterCache.set(meta.id, character);
        return character;
      })
      .finally(() => this.pending.delete(meta.id));

    this.pending.set(meta.id, request);
    return request;
  }

  async #loadBuiltin(meta) {
    const { createBuiltinCharacter } = await import('../characters.js');
    return createBuiltinCharacter(meta);
  }

  async #loadImported(meta) {
    const gltf = await assetManager.loadGLTF(meta.model);
    const model = assetManager.createInstance(gltf, { name: meta.name });
    const group = new THREE.Group();
    group.name = meta.name;
    group.add(model);

    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.001) {
      group.remove(model);
      throw new Error(`The ${meta.name} model has invalid dimensions.`);
    }

    model.scale.multiplyScalar(3.4 / size.y);
    model.updateMatrixWorld(true);
    bounds.setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());

    const fitted = new THREE.Group();
    fitted.position.set(-center.x, -bounds.min.y, -center.z);
    fitted.add(model);
    group.add(fitted);

    const controller = animationManager.createController(model, { characterId: meta.id });
    let disposed = false;

    return {
      group,
      meta,
      height: 3.4,
      mixer: controller.mixer,
      animate(dt, state = {}) {
        if (disposed) return;
        const moving = !!state.moving;
        const sprinting = !!state.sprinting;
        const next = moving
          ? (sprinting ? controller.clips.run : controller.clips.walk)
          : controller.clips.idle;
        if (next) controller.play(next);
        controller.update(dt);
        fitted.rotation.z = state.attacking ? Math.sin((state.time || 0) * 22) * 0.025 : 0;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        controller.dispose();
        disposeInstance(group);
      },
    };
  }

  clearCharacter(id) {
    return this.characterCache.delete(id);
  }

  clearAll() {
    for (const character of this.characterCache.values()) {
      character.dispose?.();
    }
    this.characterCache.clear();
    this.pending.clear();
  }
}

function disposeInstance(object) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const skeletons = new Set();

  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const material of mats) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (child.isSkinnedMesh && child.skeleton) skeletons.add(child.skeleton);
  });

  skeletons.forEach(skeleton => skeleton.dispose());
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
  object.removeFromParent();
}

export const characterManager = new CharacterManager();
