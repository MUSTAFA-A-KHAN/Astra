export class CacheManager {
  constructor({ namespace = 'astra-assets-v1' } = {}) {
    this.namespace = namespace;
    this.memory = new Map();
  }

  get(key) {
    return this.memory.get(key);
  }

  set(key, value) {
    this.memory.set(key, value);
    return value;
  }

  has(key) {
    return this.memory.has(key);
  }

  delete(key) {
    return this.memory.delete(key);
  }

  clear() {
    this.memory.clear();
  }

  async getJSON(key) {
    try {
      const raw = sessionStorage.getItem(`${this.namespace}:${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async setJSON(key, value) {
    try {
      sessionStorage.setItem(`${this.namespace}:${key}`, JSON.stringify(value));
    } catch {
      // Storage is an optimization only and must never block gameplay.
    }
  }
}
