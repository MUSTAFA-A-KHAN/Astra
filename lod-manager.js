import * as THREE from 'three';

export class LODManager {
  constructor({ camera, high = 18, medium = 45, far = 85 } = {}) {
    this.camera = camera;
    this.high = high;
    this.medium = medium;
    this.far = far;
    this.entries = new Set();
    this.cameraPosition = new THREE.Vector3();
    this.objectPosition = new THREE.Vector3();
  }

  register(object, { high = null, medium = null, far = null } = {}) {
    const entry = {
      object,
      high: high ?? this.high,
      medium: medium ?? this.medium,
      far: far ?? this.far,
    };
    this.entries.add(entry);
    return () => this.entries.delete(entry);
  }

  update() {
    this.camera.getWorldPosition(this.cameraPosition);
    for (const entry of this.entries) {
      if (!entry.object.visible) continue;
      entry.object.getWorldPosition(this.objectPosition);
      const distance = this.cameraPosition.distanceTo(this.objectPosition);
      const level = distance < entry.high ? 0 : distance < entry.medium ? 1 : distance < entry.far ? 2 : 3;
      entry.object.userData.astraLOD = level;
      if (entry.object.userData.astraPreviousLOD !== level) {
        entry.object.userData.astraPreviousLOD = level;
        entry.object.dispatchEvent({ type: 'lodchange', level });
      }
    }
  }
}
