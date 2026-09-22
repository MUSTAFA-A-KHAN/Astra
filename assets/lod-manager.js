import * as THREE from 'three';

export class LODManager {
  create(model, distances = [18, 45]) {
    if (!model) return null;
    const lod = new THREE.LOD();
    const high = model;
    const medium = high.clone(true);
    const low = high.clone(true);
    medium.traverse(node => {
      if (node.isMesh) node.material = node.material?.clone?.() || node.material;
    });
    low.traverse(node => { if (node.isMesh) node.visible = true; });
    lod.addLevel(high, 0);
    lod.addLevel(medium, distances[0]);
    lod.addLevel(low, distances[1]);
    return lod;
  }
  update(lod, camera) { lod?.update(camera); }
}
export const lodManager = new LODManager();
