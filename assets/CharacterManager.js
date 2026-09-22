import { AnimationManager } from './AnimationManager.js';
import { CHARACTER_DEFINITIONS } from './config.js';

export class CharacterManager {
  constructor({ assetManager, player, loading } = {}) {
    this.assets=assetManager; this.player=player; this.loading=loading;
    this.definitions=CHARACTER_DEFINITIONS; this.cache=new Map(); this.active=null; this.switching=null; this.animationPacks=new Map();
  }
  definition(id) { return this.definitions[id] || this.definitions.rei; }
  async getCharacter(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const def=this.definition(id);
    const gltf=await this.assets.loadGLTF(def.base,{fallback:def.fallbackBase,key:'char-'+id,label:def.name});
    const entry={id,def,gltf,model:null,manager:null}; this.cache.set(id,entry); return entry;
  }
  async activate(id) {
    if (this.active?.id===id) return this.active;
    if (this.switching) return this.switching;
    this.switching=(async()=>{
      const entry=await this.getCharacter(id);
      const previous=this.active;
      const oldPosition=this.player.group.position.clone(), oldFacing=this.player.facing, oldDisplayYaw=this.player.displayYaw, oldVelocity=this.player.velocity.clone();
      this.detachEntry(previous);
      const model=this.assets.cloneScene(entry.gltf); entry.model=model;
      this.player.group.add(model); this.player.model=model;
      const manager=new AnimationManager(this.assets); manager.attach(model,entry.gltf.animations||[]); entry.manager=manager;
      this.player.mixerManager=manager;
      this.player.mixer=manager.mixer;
      this.player.group.position.copy(oldPosition); this.player.facing=oldFacing; this.player.displayYaw=oldDisplayYaw; this.player.velocity.copy(oldVelocity);
      this.active=entry;
      this.loading?.complete('char-'+id,entry.def.name+' ready');
      return entry;
    })().finally(()=>{this.switching=null;});
    return this.switching;
  }
  async ensureAnimationPack(pack) {
    const entry=this.active; if (!entry) return false;
    const path=entry.def.sharedAnimationPacks?.[pack] || entry.def.animations?.[pack]; if (!path || entry.manager?.clips.size && this.animationPacks.has(entry.id+':'+pack)) return true;
    const loaded=await entry.manager?.loadPack(path,pack,'anim-'+entry.id+'-'+pack);
    if (loaded) this.animationPacks.set(entry.id+':'+pack,true);
    return !!loaded;
  }
  preloadLikely() { return this.ensureAnimationPack('combat').catch(()=>false); }
  detachEntry(entry) {
    if (!entry?.model) return;
    entry.manager?.detach(); this.player.group.remove(entry.model);
    this.assets.disposeObject(entry.model,{disposeMaterials:false});
    entry.model=null; entry.manager=null;
    if (this.player.model===entry.model) this.player.model=null;
  }
}
