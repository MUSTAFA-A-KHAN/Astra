export class GraphicsQualityManager {
  constructor() {
    this.levels = {
      high: { pixelRatio: 1, shadows: true, shadowMap: 2048 },
      balanced: { pixelRatio: 0.9, shadows: true, shadowMap: 1024 },
      low: { pixelRatio: 0.7, shadows: false, shadowMap: 512 },
    };
    this.quality = 'high';
    this.listeners = new Set();
  }
  configure(renderer, scene, level = 'balanced') {
    this.quality = this.levels[level] ? level : 'balanced';
    const settings = this.levels[this.quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatio * 2));
    renderer.shadowMap.enabled = settings.shadows;
    return settings;
  }
  setQuality(level) {
    if (!this.levels[level]) return false;
    this.quality = level;
    this.listeners.forEach(listener => listener(level, this.levels[level]));
    return true;
  }
  get settings() { return this.levels[this.quality]; }
}
export const graphicsQualityManager = new GraphicsQualityManager();
