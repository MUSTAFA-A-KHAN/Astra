export const QUALITY = Object.freeze({
  low: {ratio:1,shadows:false,shadowSize:512,shadowDistance:32,drawDistance:230,vegetation: .34,water:0,particles:24,textureSize:128},
  balanced: {ratio:1.35,shadows:true,shadowSize:1024,shadowDistance:45,drawDistance:330,vegetation:.58,water:1,particles:48,textureSize:256},
  high: {ratio:1.8,shadows:true,shadowSize:2048,shadowDistance:64,drawDistance:470,vegetation:.82,water:2,particles:80,textureSize:512},
  ultra: {ratio:2,shadows:true,shadowSize:2048,shadowDistance:78,drawDistance:620,vegetation:1,water:2,particles:120,textureSize:512},
});
const levels=Object.keys(QUALITY);
export class AdaptiveQuality {
  constructor(level='high') {this.level=level;this.frameMS=16.7;this.elapsed=0;this.slow=0;this.fast=0;this.cooldown=10;this.samples=0;this.resolutionScale=1;}
  reset(level) {this.level=level;this.elapsed=0;this.slow=this.fast=0;this.cooldown=12;this.samples=0;this.resolutionScale=1;}
  sample(ms,dt,enabled=true) {
    if(!Number.isFinite(ms)||ms<=0||ms>250)return null;
    this.frameMS+=(ms-this.frameMS)*.04;this.samples++;this.elapsed+=dt;
    this.cooldown=Math.max(0,this.cooldown-dt);
    this.slow=this.frameMS>25?this.slow+dt:Math.max(0,this.slow-dt*2);
    this.fast=this.frameMS<18.2?this.fast+dt:0;
    if(!enabled||this.cooldown>0||this.samples<120)return null;
    const i=levels.indexOf(this.level);
    if(this.slow>3) {
      if(i>0)this.level=levels[i-1];
      else if(this.resolutionScale>.65)this.resolutionScale=Math.max(.65,this.resolutionScale-.1);
      else return null;
      this.cooldown=12;this.slow=this.fast=0;return this.level;
    }
    // Recovery is deliberately slower, and stops at High in auto mode.
    if(this.fast>28) {
      if(this.resolutionScale<1)this.resolutionScale=Math.min(1,this.resolutionScale+.1);
      else if(i<2)this.level=levels[i+1];else return null;
      this.cooldown=30;this.slow=this.fast=0;return this.level;
    }
    return null;
  }
}
