export class WorldStreamer {
  constructor({ assetManager } = {}) { this.assets=assetManager; this.manifest={}; this.loaded=new Map(); }
  configure(manifest) { this.manifest=manifest || {}; }
  async loadSector(key) {
    if (this.loaded.has(key)) return this.loaded.get(key);
    const url=this.manifest[key]; if (!url) return null;
    const gltf=await this.assets.loadGLTF(url,{key:'sector-'+key,label:'Sector '+key,optional:true});
    if (gltf) this.loaded.set(key,gltf); return gltf;
  }
  unloadSector(key) { this.loaded.delete(key); }
}
