import * as THREE from 'three';

export class LoadingManager {
  constructor() {
    this.items = new Map();
    this.listeners = new Set();
  }
  track(id, promise) {
    this.items.set(id, promise);
    const notify = () => {
      const snapshot = { pending: [...this.items.keys()] };
      this.listeners.forEach(listener => listener(snapshot));
    };
    notify();
    return promise.finally(() => { this.items.delete(id); notify(); });
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  get pending() { return this.items.size; }
}
export const loadingManager = new LoadingManager();
