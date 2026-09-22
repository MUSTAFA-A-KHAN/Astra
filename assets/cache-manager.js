export class CacheManager {
  constructor() {
    this.namespaces = new Map();
  }
  namespace(name) {
    if (!this.namespaces.has(name)) this.namespaces.set(name, new Map());
    return this.namespaces.get(name);
  }
  get(namespace, key) { return this.namespace(namespace).get(key); }
  set(namespace, key, value) { this.namespace(namespace).set(key, value); return value; }
  has(namespace, key) { return this.namespace(namespace).has(key); }
  delete(namespace, key) { return this.namespace(namespace).delete(key); }
  clear(namespace) {
    if (namespace) this.namespaces.delete(namespace);
    else this.namespaces.clear();
  }
}
export const cacheManager = new CacheManager();
