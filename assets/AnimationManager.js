import * as THREE from 'three';

export class AnimationManager {
  constructor(assetManager) {
    this.assets = assetManager;
    this.mixer = null;
    this.clips = new Map();
    this.actions = new Map();
    this.currentState = null;
  }

  attach(root, baseAnimations = []) {
    this.detach();
    if (!root) return;
    this.mixer = new THREE.AnimationMixer(root);
    this.addClips(baseAnimations);
  }

  addClips(clips = []) {
    for (const clip of clips) if (clip) this.clips.set(clip.name, clip);
  }

  async loadPack(url, packName, progressKey) {
    if (!url) return false;
    const gltf = await this.assets.loadGLTF(url, {
      key: progressKey || packName,
      label: packName + ' animations',
      optional: true
    });
    if (!gltf) return false;
    this.addClips(gltf.animations || []);
    return true;
  }

  findClip(...names) {
    const exact = names.map(n => this.clips.get(n)).find(Boolean);
    if (exact) return exact;
    const aliases = names.map(n => n.toLowerCase());
    return [...this.clips.values()].find(clip =>
      aliases.some(n => clip.name.toLowerCase().includes(n))
    ) || null;
  }

  getAction(state, ...aliases) {
    if (!this.mixer) return null;
    if (this.actions.has(state)) return this.actions.get(state);
    const clip = this.findClip(...aliases);
    if (!clip) return null;
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.setEffectiveWeight(0);
    this.actions.set(state, action);
    return action;
  }

  crossFade(state, aliases, fade = 0.22, loop = THREE.LoopRepeat) {
    const action = this.getAction(state, ...aliases);
    if (!action) return null;
    const previous = this.currentState ? this.actions.get(this.currentState) : null;
    if (previous === action) return action;
    action.reset().setLoop(loop, Infinity).fadeIn(fade).setEffectiveWeight(1).play();
    if (previous) previous.fadeOut(fade);
    this.currentState = state;
    return action;
  }

  update(dt, timeScale = 1) {
    this.mixer?.update(dt * timeScale);
  }

  detach() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
    this.mixer = null;
    this.clips.clear();
    this.actions.clear();
    this.currentState = null;
  }
}
