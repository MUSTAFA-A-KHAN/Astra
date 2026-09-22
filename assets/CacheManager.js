export class CacheManager {
  constructor() { this.gltf = new Map(); this.loading = new Map(); this.refs = new Map(); }
  has(url) { return this.gltf.has(url); }
  get(url) { return this.gltf.get(url); }
  async getOrLoad(url, loader, onProgress) {
    if (!url) throw new Error('Asset URL is empty');
    if (this.gltf.has(url)) return this.gltf.get(url);
    if (this.loading.has(url)) return this.loading.get(url);
    const promise = loader(url, onProgress).then(asset => {
      this.gltf.set(url, asset); this.loading.delete(url); return asset;
    }).catch(err => { this.loading.delete(url); throw err; });
    this.loading.set(url, promise);
    return promise;
  }
  acquire(url) { this.refs.set(url, (this.refs.get(url) || 0) + 1); }
  release(url) {
    const next = Math.max(0, (this.refs.get(url) || 0) - 1);
    if (next) this.refs.set(url, next); else this.refs.delete(url);
  }
  refCount(url) { return this.refs.get(url) || 0; }
}
