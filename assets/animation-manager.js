import * as THREE from 'three';
import { assetManager } from './asset-manager.js';

function boneSignature(root) {
  const names = [];
  root.traverse(node => { if (node.isBone) names.push(node.name.toLowerCase()); });
  return names.sort().join('|');
}

function restPoseSignature(root) {
  const values = [];
  root.traverse(node => {
    if (node.isBone) values.push(`${node.name}:${node.quaternion.x.toFixed(4)},${node.quaternion.y.toFixed(4)},${node.quaternion.z.toFixed(4)},${node.quaternion.w.toFixed(4)}`);
  });
  return values.sort().join('|');
}

export class AnimationManager {
  constructor() {
    this.packCache = new Map();
  }

  inspectSkeleton(root) {
    return { bones: boneSignature(root), restPose: restPoseSignature(root) };
  }

  canShare(targetRoot, pack) {
    if (!pack?.skeleton) return false;
    return this.inspectSkeleton(targetRoot).bones === pack.skeleton.bones
      && this.inspectSkeleton(targetRoot).restPose === pack.skeleton.restPose;
  }

  normalizeRootMotion(clip) {
    const sanitized = clip.clone();
    sanitized.tracks = sanitized.tracks.map(track => {
      if (!track.name.endsWith('.position') || track.getValueSize() !== 3) return track;
      const nodeName = track.name.slice(0, -'.position'.length);
      if (!/(?:^|[|_:])(hips|pelvis|root)$/i.test(nodeName)) return track;
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] = track.values[0];
        track.values[i + 2] = track.values[2];
      }
      return track;
    });
    return sanitized;
  }

  registerPack(id, gltf, sourceURL = null) {
    const root = gltf.scene;
    const animations = (gltf.animations || []).map(clip => this.normalizeRootMotion(clip));
    const pack = {
      id,
      sourceURL,
      animations,
      skeleton: root ? this.inspectSkeleton(root) : null,
    };
    this.packCache.set(id, pack);
    return pack;
  }

  async loadPack(id, url) {
    const cached = this.packCache.get(id);
    if (cached) return cached;
    const gltf = await assetManager.loadGLTF(url);
    return this.registerPack(id, gltf, url);
  }

  getClip(pack, pattern, fallback = null) {
    const clip = pack?.animations?.find(item => pattern.test(item.name));
    return clip || fallback;
  }

  createController(model, { packs = [], characterId = model.name } = {}) {
    const compatible = packs.filter(pack => this.canShare(model, pack));
    const allClips = compatible.flatMap(pack => pack.animations);
    const byName = new Map(allClips.map(clip => [clip.name.toLowerCase(), clip]));
    const find = (patterns, fallback = null) => {
      for (const pattern of patterns) {
        for (const clip of allClips) {
          if (pattern.test(clip.name)) return clip;
        }
      }
      return fallback;
    };
    const idle = find([/idle/i]) || allClips[0] || null;
    const walk = find([/^walk/i, /jog/i]) || idle;
    const run = find([/sprint/i, /^run/i]) || walk;
    const attack = find([/attack/i, /slash/i, /hit/i]) || null;
    const mixer = allClips.length ? new THREE.AnimationMixer(model) : null;
    const actions = new Map();
    for (const clip of new Set([idle, walk, run, attack].filter(Boolean))) {
      actions.set(clip, mixer.clipAction(clip));
    }
    let current = idle ? actions.get(idle) : null;
    current?.play();

    const play = (clip, fade = 0.18, loop = THREE.LoopRepeat) => {
      if (!clip || !mixer) return null;
      const action = actions.get(clip) || mixer.clipAction(clip);
      actions.set(clip, action);
      action.reset().setEffectiveWeight(1).setLoop(loop, loop === THREE.LoopOnce ? 1 : Infinity).fadeIn(fade).play();
      if (current && current !== action) current.fadeOut(fade);
      current = action;
      return action;
    };

    return {
      characterId,
      mixer,
      packs: compatible,
      clips: { idle, walk, run, attack },
      play,
      update(dt) { mixer?.update(Math.min(Math.max(dt, 0), 0.1)); },
      dispose() { mixer?.stopAllAction(); mixer?.uncacheRoot(model); },
    };
  }
}

export const animationManager = new AnimationManager();
