import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CacheManager } from './CacheManager.js';
import { assetUrl, ASSET_BASE_URL } from './config.js';

export class AssetManager {
  constructor({ renderer, progress, development = false } = {}) {
    this.renderer = renderer; this.progress = progress; this.development = development;
    this.cache = new CacheManager(); this.loader = new GLTFLoader();
    this.draco = new DRACOLoader();
    this.draco.setDecoderPath('https://threejs.org/examples/jsm/libs/draco/gltf/');
    this.loader.setDRACOLoader(this.draco);
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.ktx2 = new KTX2Loader();
    try {
      this.ktx2.setTranscoderPath('https://threejs.org/examples/jsm/libs/basis/');
      this.ktx2.detectSupport(renderer); this.loader.setKTX2Loader(this.ktx2);
    } catch (_) {}
    this.log(ASSET_BASE_URL ? 'External asset base: ' + ASSET_BASE_URL : 'Using local/static asset paths.');
  }
  log(...args) { if (this.development) console.info('[AssetManager]', ...args); }
  resolve(path) { return assetUrl(path); }
  async loadGLTF(path, { fallback, key = path, label = key, optional = false } = {}) {
    const primary = this.resolve(path);
    const tryLoad = async url => this.cache.getOrLoad(url, (requestUrl, onProgress) => new Promise((resolve, reject) => {
      this.progress?.set(key, 0.05, 'Loading ' + label + '...');
      this.loader.load(requestUrl, gltf => { this.progress?.complete(key, label + ' ready'); resolve(gltf); },
        xhr => {
          const p = xhr.total ? xhr.loaded / xhr.total : 0.1;
          this.progress?.set(key, p, xhr.total ? 'Loading ' + label + ' ' + Math.round(p * 100) + '%...' : 'Loading ' + label + '...');
        }, reject);
    }));
    try {
      return await tryLoad(primary);
    } catch (err) {
      if (fallback && primary !== fallback) { this.log('Trying fallback: ' + primary); return tryLoad(fallback); }
      this.progress?.fail(key, label + (optional ? ' unavailable — continuing' : ' failed — continuing'));
      if (optional) return null; throw err;
    }
  }
  cloneScene(gltf) {
    const scene = gltf?.scene?.clone(true); if (!scene) return null;
    scene.traverse(o => { if (o.isMesh) { o.frustumCulled = true; o.castShadow = true; o.receiveShadow = true; } });
    return scene;
  }
  disposeObject(root, { disposeMaterials = false } = {}) {
    if (!root) return;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose?.();
      if (disposeMaterials) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach(material => {
          if (!material) return;
          ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'].forEach(k => material[k]?.dispose?.());
          material.dispose?.();
        });
      }
    });
  }
}
