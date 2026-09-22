import * as THREE from 'three';

export class LODManager {
  constructor(camera) {
    this.camera = camera;
    this.lods = new Set();
    this.distancePolicies = new Set();
    this.tick = 0;
  }

  createLevels(high, medium, low, distances = [10, 30]) {
    const lod = new THREE.LOD();
    if (high) lod.addLevel(high, 0);
    if (medium) lod.addLevel(medium, distances[0]);
    if (low) lod.addLevel(low, distances[1]);
    this.lods.add(lod);
    return lod;
  }

  addDistancePolicy(root, { medium = 30, far = 60, onMedium, onFar } = {}) {
    if (!root) return null;
    const policy = { root, medium, far, onMedium, onFar, last: -1 };
    this.distancePolicies.add(policy);
    return policy;
  }

  update() {
    if (++this.tick % 3) return;
    for (const lod of this.lods) lod.update(this.camera);
    for (const policy of this.distancePolicies) {
      const distance = this.camera.position.distanceTo(policy.root.getWorldPosition(new THREE.Vector3()));
      const state = distance >= policy.far ? 2 : distance >= policy.medium ? 1 : 0;
      if (state === policy.last) continue;
      policy.last = state;
      if (state === 1) policy.onMedium?.();
      if (state === 2) policy.onFar?.();
    }
  }

  remove(lod) { this.lods.delete(lod); }
  removeDistancePolicy(policy) { this.distancePolicies.delete(policy); }
}
