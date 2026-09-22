export class LODManager {
  constructor({ camera, high = 18, medium = 45, far = 85 } = {}) {
    this.camera = camera;
    this.high = high;
    this.medium = medium;
    this.far = far;
    this.entries = new Set();
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
    const cameraPosition = this.camera.getWorldPosition(this._cameraPosition ||= new THREE.Vector3());
    for (const entry of this.entries) {
      if (!entry.object.visible) continue;
      const distance = cameraPosition.distanceTo(entry.object.getWorldPosition(this._objectPosition ||= new THREE.Vector3()));
      const level = distance < entry.high ? 0 : distance < entry.medium ? 1 : distance < entry.far ? 2 : 3;
      entry.object.userData.astraLOD = level;
      entry.object.dispatchEvent({ type: 'lodchange', level });
    }
  }
}
