import { TilesRenderer } from 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.5.3/build/index.js';
import { CesiumIonAuthPlugin, ReorientationPlugin, GLTFExtensionsPlugin } from 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.5.3/build/index.plugins.js';

const DEFAULT_ASSET_ID = 1;
const DEG2RAD = Math.PI / 180;

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export async function createStreamedTerrain(scene, camera, renderer, {
  token = window.ASTRA_CESIUM_ION_TOKEN || '',
  assetId = DEFAULT_ASSET_ID,
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

  const tiles = new TilesRenderer();
  tiles.fetchOptions.mode = 'cors';
  tiles.registerPlugin(new CesiumIonAuthPlugin({
    apiToken: token,
    assetId,
    autoRefreshToken: true,
  }));
  tiles.registerPlugin(new GLTFExtensionsPlugin());
  tiles.registerPlugin(new ReorientationPlugin({
    lat: Number(window.ASTRA_TERRAIN_LAT ?? 0) * DEG2RAD,
    lon: Number(window.ASTRA_TERRAIN_LON ?? 0) * DEG2RAD,
    height: Number(window.ASTRA_TERRAIN_HEIGHT ?? 0),
    recenter: true,
    azimuth: Number(window.ASTRA_TERRAIN_AZIMUTH ?? 0),
  }));

  const mobile = isMobileDevice();
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.errorTarget = mobile ? 18 : 10;

  if (tiles.lruCache) {
    tiles.lruCache.maxSize = mobile ? 70 : 140;
    tiles.lruCache.maxBytesSize = mobile ? 64 * 1024 * 1024 : 160 * 1024 * 1024;
  }

  scene.add(tiles.group);

  return {
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
      tiles.errorTarget = low ? 30 : balanced ? 18 : 10;
      if (tiles.lruCache) {
        tiles.lruCache.maxSize = low
          ? (mobile ? 45 : 80)
          : balanced
            ? (mobile ? 60 : 110)
            : (mobile ? 75 : 160);
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
    getHeight() {
      return 0;
    },
  };
}
