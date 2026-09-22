import * as THREE from 'three';
export class LODManager {
  constructor(camera) { this.camera=camera; this.lods=new Set(); this.tick=0; }
  createLevels(high, medium, low, distances=[10,30]) {
    const lod = new THREE.LOD(); if (high) lod.addLevel(high,0); if (medium) lod.addLevel(medium,distances[0]); if (low) lod.addLevel(low,distances[1]);
    this.lods.add(lod); return lod;
  }
  update() {
    if (++this.tick % 3) return;
    for (const lod of this.lods) lod.update(this.camera);
  }
  remove(lod) { this.lods.delete(lod); }
}
