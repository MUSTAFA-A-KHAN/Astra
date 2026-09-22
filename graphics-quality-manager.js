export class GraphicsQualityManager {
  constructor({ renderer, sun, world, streamedTerrain, touchDevice = false }) {
    this.renderer = renderer;
    this.sun = sun;
    this.world = world;
    this.streamedTerrain = streamedTerrain;
    this.touchDevice = touchDevice;
    this.presets = {
      low: { ratio: 1, shadows: false },
      balanced: { ratio: 1.35, shadows: true },
      high: { ratio: 1.8, shadows: true },
    };
    this.quality = touchDevice ? 'balanced' : 'high';
    this.resolutionScale = 1;
  }

  apply(value, adaptive = false) {
    this.quality = value;
    const preset = this.presets[value] || this.presets.balanced;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, preset.ratio) * this.resolutionScale);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    this.world?.setQuality?.(value);
    this.streamedTerrain?.setQuality?.(value);
    this.renderer.shadowMap.needsUpdate = true;
    return { quality: value, adaptive };
  }

  setResolutionScale(scale) {
    this.resolutionScale = Math.min(1, Math.max(0.7, scale));
    this.apply(this.quality);
  }

  getStats() {
    return {
      quality: this.quality,
      pixelRatio: this.renderer.getPixelRatio(),
      shadows: this.renderer.shadowMap.enabled,
    };
  }
}
