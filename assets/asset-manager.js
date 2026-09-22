import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Shared GLB/GLTF loading and caching for the static browser game.
 * Parsed GLTF roots are treated as immutable templates; callers clone instances.
 */
export class AssetManager {
  constructor({ timeout = 30000 } = {}) {
    this.timeout = timeout;
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.requests = new Map();
    this.listeners = new Set();
    this.total = 0;
    this.completed = 0;
    this.bytes = 0;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get progress() {
    return this.total ? Math.min(1, this.completed / this.total) : 1;
  }

  #emit() {
    const state = { loaded: this.completed, total: this.total, progress: this.progress, bytes: this.bytes };
    this.listeners.forEach(listener => listener(state));
  }

  resolveURL(url) {
    try { return new URL(url, window.location.href).href; }
    catch { return url; }
  }

  async loadGLTF(url, { timeout = this.timeout } = {}) {
    const resolved = this.resolveURL(url);
    const cached = this.cache.get(resolved);
    if (cached) return cached;

    const pending = this.requests.get(resolved);
    if (pending) return pending;

    this.total += 1;
    this.#emit();

    const request = this.#fetchAndParse(resolved, timeout)
      .then(gltf => {
        this.cache.set(resolved, gltf);
        this.bytes += gltf.userData?.__astraBytes || 0;
        this.completed += 1;
        this.#emit();
        return gltf;
      })
      .catch(error => {
        this.completed += 1;
        this.#emit();
        throw error;
      })
      .finally(() => this.requests.delete(resolved));

    this.requests.set(resolved, request);
    return request;
  }

  async #fetchAndParse(url, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Asset download failed (${response.status}).`);
      const buffer = await response.arrayBuffer();
      const gltf = await this.loader.parseAsync(buffer, new URL('.', url).href);
      gltf.userData = gltf.userData || {};
      gltf.userData.__astraBytes = buffer.byteLength;
      return gltf;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('Asset loading took too long. Please retry.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async preload(urls) {
    const unique = [...new Set(urls.filter(Boolean).map(url => this.resolveURL(url)))];
    return Promise.all(unique.map(url => this.loadGLTF(url)));
  }

  createInstance(gltf, { name } = {}) {
    const source = gltf.scene;
    if (!source) throw new Error('GLTF asset does not contain a scene.');
    const instance = source.clone(true);
    instance.traverse(node => {
      if (node.isSkinnedMesh) {
        node.frustumCulled = false;
        if (node.skeleton) node.bind(node.skeleton.clone(), node.bindMatrix);
      }
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    if (name) instance.name = name;
    return instance;
  }

  clear(url) {
    const resolved = this.resolveURL(url);
    const gltf = this.cache.get(resolved);
    if (!gltf) return false;
    this.cache.delete(resolved);
    return true;
  }

  clearAll() {
    this.cache.clear();
    this.requests.clear();
    this.total = this.completed = this.bytes = 0;
    this.#emit();
  }
}

export const assetManager = new AssetManager();
