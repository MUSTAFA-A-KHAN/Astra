import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEFAULT_TIMEOUT = 30000;

function cloneScene(source) {
  // SkeletonUtils would be ideal for skinned clones, but keep this static-game
  // manager dependency-free: a loaded GLTF scene is cached and one scene instance
  // is created per character only when the character actually needs a live rig.
  return source.clone(true);
}

export class AssetManager {
  constructor({ loader = new GLTFLoader(), timeout = DEFAULT_TIMEOUT, onProgress = null } = {}) {
    this.loader = loader;
    this.timeout = timeout;
    this.onProgress = onProgress;
    this.cache = new Map();
    this.pending = new Map();
    this.progress = new Map();
  }

  setProgressCallback(callback) {
    this.onProgress = callback;
  }

  getProgress(url) {
    return this.progress.get(url) ?? 0;
  }

  has(url) {
    return this.cache.has(new URL(url, window.location.href).href);
  }

  clear(url) {
    const key = new URL(url, window.location.href).href;
    this.cache.delete(key);
    this.progress.delete(key);
  }

  async load(url, { signal, timeout = this.timeout } = {}) {
    const key = new URL(url, window.location.href).href;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.pending.has(key)) return this.pending.get(key);

    const promise = this.#load(key, { signal, timeout })
      .then(asset => {
        this.cache.set(key, asset);
        return asset;
      })
      .finally(() => this.pending.delete(key));

    this.pending.set(key, promise);
    return promise;
  }

  async #load(url, { signal, timeout }) {
    this.progress.set(url, 0);
    this.#emit(url, 0);

    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(new Error('Asset loading timed out.')), timeout);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'force-cache',
      });
      if (!response.ok) throw new Error(`Asset download failed (${response.status}).`);

      const total = Number(response.headers.get('content-length')) || 0;
      const reader = response.body?.getReader();
      let buffer;

      if (!reader || !total) {
        buffer = await response.arrayBuffer();
        this.progress.set(url, 1);
        this.#emit(url, 1);
      } else {
        const chunks = [];
        let loaded = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          const progress = Math.min(0.99, loaded / total);
          this.progress.set(url, progress);
          this.#emit(url, progress);
        }
        buffer = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        buffer = buffer.buffer;
      }

      const asset = await this.loader.parseAsync(buffer, new URL('.', url).href);
      this.progress.set(url, 1);
      this.#emit(url, 1);
      return asset;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Asset loading was cancelled: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }

  async loadOptional(url, options = {}) {
    try {
      return await this.load(url, options);
    } catch (error) {
      console.warn('Optional asset unavailable:', url, error);
      return null;
    }
  }

  cloneScene(url) {
    const asset = this.cache.get(new URL(url, window.location.href).href);
    if (!asset?.scene) throw new Error(`Asset is not loaded: ${url}`);
    return cloneScene(asset.scene);
  }

  dispose(url) {
    const key = new URL(url, window.location.href).href;
    const asset = this.cache.get(key);
    if (!asset) return;
    this.#disposeGLTF(asset);
    this.cache.delete(key);
    this.progress.delete(key);
  }

  disposeAll() {
    for (const asset of this.cache.values()) this.#disposeGLTF(asset);
    this.cache.clear();
    this.pending.clear();
    this.progress.clear();
  }

  #emit(url, progress) {
    this.onProgress?.({ url, progress });
  }

  #disposeGLTF(gltf) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    const skeletons = new Set();

    for (const scene of gltf.scenes || [gltf.scene]) {
      scene?.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        for (const material of list) {
          materials.add(material);
          for (const value of Object.values(material)) {
            if (value?.isTexture) textures.add(value);
          }
        }
        if (object.isSkinnedMesh && object.skeleton) skeletons.add(object.skeleton);
      });
    }

    skeletons.forEach(skeleton => skeleton.dispose());
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => {
      texture.dispose();
      if (texture.image && typeof texture.image.close === 'function') texture.image.close();
    });
  }
}
