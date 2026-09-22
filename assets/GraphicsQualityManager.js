export const QUALITY = Object.freeze({ LOW:'LOW', MEDIUM:'MEDIUM', HIGH:'HIGH', ULTRA:'ULTRA' });
const TIERS = {
  LOW:    { pixelRatio:1,    shadowMap:512,  shadowFar:450,  environmentDistance:450 },
  MEDIUM: { pixelRatio:1.25, shadowMap:768,  shadowFar:700,  environmentDistance:650 },
  HIGH:   { pixelRatio:1.5,  shadowMap:1024, shadowFar:1000, environmentDistance:900 },
  ULTRA:  { pixelRatio:2,    shadowMap:2048, shadowFar:1400, environmentDistance:1200 }
};
export class GraphicsQualityManager {
  constructor({ renderer, sun, city, mobile = false } = {}) {
    this.renderer=renderer; this.sun=sun; this.city=city; this.mobile=mobile; this.tier=this.detect();
  }
  detect() {
    const cores=navigator.hardwareConcurrency||4, memory=navigator.deviceMemory||4;
    const coarse=matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints>0;
    if (coarse && (cores<=4 || memory<=4)) return QUALITY.LOW;
    if (coarse) return QUALITY.MEDIUM;
    if (cores>=12 && memory>=8) return QUALITY.ULTRA;
    return cores>=8 && memory>=6 ? QUALITY.HIGH : QUALITY.MEDIUM;
  }
  apply(tier=this.tier) {
    this.tier=tier; const t=TIERS[tier];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,t.pixelRatio));
    this.renderer.shadowMap.enabled=tier!==QUALITY.LOW;
    this.sun.shadow.mapSize.set(t.shadowMap,t.shadowMap); this.sun.shadow.camera.far=t.shadowFar;
    this.sun.castShadow=tier!==QUALITY.LOW;
    return t;
  }
  settings() { return TIERS[this.tier]; }
}
