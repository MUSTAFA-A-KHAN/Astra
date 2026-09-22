import { TilesRenderer } from 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.5.2/+esm';
import { TilesRenderer } from 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.5.3/build/index.js';
import { CesiumIonAuthPlugin, ReorientationPlugin, GLTFExtensionsPlugin } from 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.5.3/build/index.plugins.js';

// Optional Cesium World Terrain integration for Astra.
// The terrain itself is streamed from Cesium ion; no terrain files are bundled
// into the repository. Set window.ASTRA_CESIUM_ION_TOKEN at deploy time.
// The adapter is isolated so the rest of Astra remains pure Three.js.

const DEFAULT_ASSET_ID = 1; // Cesium World Terrain

export async function createStreamedTerrain(scene, camera, renderer, {
  token = window.ASTRA_CESIUM_ION_TOKEN || '',
  assetId = DEFAULT_ASSET_ID,
  centerLongitude = 0,
  centerLatitude = 0,
  enabled = true,
} = {}) {
  if (!enabled || !token) {
    return {
      enabled: false,
      ready: false,
      update() {},
      setQuality() {},
      setTime() {},
      dispose() {},
      getHeight() { return 0; },
    };
  }

  // 3DTilesRendererJS supports Cesium Ion tilesets directly and keeps an LRU
  // cache with byte limits, making it suitable for streamed mobile terrain.
  const tiles = new TilesRenderer();
  tiles.fetchOptions.mode = 'cors';
  tiles.registerPlugin(new GLTFExtensionsPlugin());
  tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: token, assetId, autoRefreshToken: true }));
  tiles.registerPlugin(new ReorientationPlugin({
    lat: Number(window.ASTRA_TERRAIN_LAT_RAD ?? 0.0),
    lon: Number(window.ASTRA_TERRAIN_LON_RAD ?? 0.0),
    height: Number(window.ASTRA_TERRAIN_HEIGHT ?? 0),
    recenter: true,
    azimuth: Number(window.ASTRA_TERRAIN_AZIMUTH ?? 0),
  }));
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.errorTarget = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 16 : 10;

  // Keep mobile memory bounded. The renderer will retain coarser tiles when the
  // cache is full rather than growing memory without limit.
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (tiles.lruCache) {
    tiles.lruCache.maxSize = mobile ? 70 : 140;
    tiles.lruCache.maxBytesSize = mobile ? 64 * 1024 * 1024 : 160 * 1024 * 1024;
  }

  scene.add(tiles.group);

  const adapter = {
    enabled: true,
    ready: true,
    tiles,
    update() {
      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.update();
    },
    setQuality(level) {
      const low = level === 'low' || level === 'performance' || level === 0;
      const balanced = level === 'balanced';
      tiles.errorTarget = low ? 28 : balanced ? 18 : 10;
      if (tiles.lruCache) {
        tiles.lruCache.maxSize = low ? (mobile ? 45 : 80) : balanced ? (mobile ? 60 : 110) : (mobile ? 75 : 160);
        tiles.lruCache.maxBytesSize = low
          ? (mobile ? 42 : 80) * 1024 * 1024
          : balanced
            ? (mobile ? 56 : 120) * 1024 * 1024
            : (mobile ? 72 : 180) * 1024 * 1024;
      }
    },
    setTime() {},
    dispose() {
      scene.remove(tiles.group);
      tiles.dispose?.();
    },
    // Terrain height sampling is intentionally left at zero here. Astra's
    // character controller currently uses a flat playable coordinate system;
    // the next phase can wire surface sampling/foot placement without coupling
    // gameplay collision to rendering.
    getHeight() { return 0; },
  };

  return adapter;
}
