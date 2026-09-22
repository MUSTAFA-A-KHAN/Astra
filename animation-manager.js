import * as THREE from 'three';

const ROOT_NAMES = /(?:^|[|_:])(hips|pelvis|root)$/i;

function findRootBone(object) {
  let root = null;
  object.traverse(node => {
    if (root || !node.isBone) return;
    if (!node.parent?.isBone || ROOT_NAMES.test(node.name)) root = node;
  });
  return root;
}

function sanitizeClip(clip, model) {
  const sanitized = clip.clone();
  sanitized.tracks = sanitized.tracks.map(track => {
    if (!track.name.endsWith('.position') || track.getValueSize() !== 3) return track;
    const nodeName = track.name.slice(0, -'.position'.length);
    const node = model.getObjectByName(nodeName);
    const rootBone = node?.isBone && (!node.parent?.isBone || ROOT_NAMES.test(node.name));
    if (!rootBone && node !== model && !ROOT_NAMES.test(nodeName)) return track;
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] = track.values[0];
      track.values[i + 2] = track.values[2];
    }
    return track;
  });
  return sanitized;
}

function skeletonSignature(model) {
  const names = [];
  const parents = new Map();
  const root = findRootBone(model);
  if (!root) return null;
  root.traverse(node => {
    if (!node.isBone) return;
    names.push(node.name);
    parents.set(node.name, node.parent?.isBone ? node.parent.name : '');
  });
  names.sort();
  return JSON.stringify({ names, parents: [...parents.entries()].sort() });
}

export class AnimationManager {
  constructor(assetManager) {
    this.assets = assetManager;
    this.compatibility = new Map();
    this.packs = new Map();
  }

  static inspectRig(model) {
    const bones = [];
    model.traverse(node => {
      if (node.isBone) bones.push({ name: node.name, parent: node.parent?.isBone ? node.parent.name : null });
    });
    return {
      hasSkeleton: bones.length > 0,
      boneCount: bones.length,
      signature: skeletonSignature(model),
      rootBone: findRootBone(model)?.name ?? null,
      bones,
    };
  }

  registerPack(name, definition) {
    this.packs.set(name, definition);
  }

  async loadPack(name, { signal } = {}) {
    const definition = this.packs.get(name);
    if (!definition) throw new Error(`Unknown animation pack: ${name}`);
    return this.assets.load(definition.url, { signal });
  }

  canShare(model, packGLTF) {
    const packScene = packGLTF?.scene;
    if (!packScene || !skeletonSignature(model)) return false;
    const packSignature = skeletonSignature(packScene);
    if (!packSignature) return false;

    const modelSig = skeletonSignature(model);
    return modelSig === packSignature;
  }

  getCompatibleClips(model, packGLTF, { clipNames = null } = {}) {
    if (!this.canShare(model, packGLTF)) return [];
    const allowed = clipNames ? new Set(clipNames) : null;
    return (packGLTF.animations || [])
      .filter(clip => !allowed || allowed.has(clip.name))
      .map(clip => sanitizeClip(clip, model));
  }

  attachPack({ model, mixer, packGLTF, clipNames = null }) {
    const clips = this.getCompatibleClips(model, packGLTF, { clipNames });
    if (!clips.length) return { compatible: false, clips: [] };
    const actions = new Map();
    for (const clip of clips) actions.set(clip.name, mixer.clipAction(clip));
    return {
      compatible: true,
      clips,
      actions,
      dispose() {
        for (const action of actions.values()) action.stop();
      },
    };
  }

  resolve(model, { embeddedClips = [], packName = null, packGLTF = null } = {}) {
    const embedded = embeddedClips.map(clip => sanitizeClip(clip, model));
    if (!packName || !packGLTF) {
      return { source: embedded.length ? 'embedded' : 'none', clips: embedded, compatible: true };
    }

    const shared = this.getCompatibleClips(model, packGLTF);
    if (shared.length) {
      return { source: 'shared-pack', clips: [...embedded, ...shared], compatible: true };
    }

    return {
      source: embedded.length ? 'character-specific' : 'none',
      clips: embedded,
      compatible: false,
      reason: 'Rig topology/signature is incompatible with this animation pack.',
    };
  }

  clearCompatibilityCache() {
    this.compatibility.clear();
  }
}
