import * as THREE from 'three';
import { assetManager } from './asset-manager.js';
import { animationManager } from './animation-manager.js';
import { HEROES } from '../characters.js';

export class CharacterManager {
  constructor() {
    this.current = null;
    this.currentMeta = null;
  }

  async load(meta) {
    if (!meta) throw new Error('Character metadata is required.');
    const existing = this.currentMeta?.id === meta.id ? this.current : null;
    if (existing) return existing;

    const created = meta.imported
      ? await this.#loadImported(meta)
      : await this.#loadBuiltin(meta);

    return created;
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
      model.traverse(node => {
        if (node.isMesh && node.material?.clone) node.material = node.material.clone();
      });
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
      group, meta, height: 3.4,
      mixer: controller.mixer,
      animate(dt, state = {}) {
        if (disposed) return;
        const moving = !!state.moving;
        const sprinting = !!state.sprinting;
        const attacking = !!state.attacking;
        const next = moving ? (sprinting ? controller.clips.run : controller.clips.walk) : controller.clips.idle;
        if (next) controller.play(next);
        controller.update(dt);
        fitted.rotation.z = attacking ? Math.sin((state.time || 0) * 22) * 0.025 : 0;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        controller.dispose();
      },
    };
  }

  async #loadBuiltin(meta) {
    const { createBuiltinCharacter } = await import('../characters.js');
    return createBuiltinCharacter(meta);
  }
}

export const characterManager = new CharacterManager();
