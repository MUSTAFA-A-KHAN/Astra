import { TilesRenderer } from 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.5.3/build/index.js';
import { CesiumIonAuthPlugin, ReorientationPlugin, GLTFExtensionsPlugin } from 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.5.3/build/index.plugins.js';

// Optional Cesium World Terrain integration for Astra.
// The terrain itself is streamed from Cesium ion; no terrain files are bundled
// into the repository. Set window.ASTRA_CESIUM_ION_TOKEN at deploy time.
// The adapter is isolated so the rest of Astra remains pure Three.js.

const DEFAULT_ASSET_ID = 1; // Cesium World Terrain
const DEG2RAD = Math.PI / 180;

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

  // Cesium World Terrain is a quantized-mesh terrain asset exposed by Cesium ion.
  // The renderer loads only the terrain tiles required by the current camera.
  const tiles = new TilesRenderer();
  tiles.fetchOptions.mode = 'cors';
  tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: token, assetId, autoRefreshToken: true }));
  tiles.registerPlugin(new ReorientationPlugin({
    // Configure geographic anchor in degrees through terrain-config.js; the
    // renderer expects radians. Defaults keep the feature opt-in and inert.
    lat: Number(window.ASTRA_TERRAIN_LAT ?? 0) * DEG2RAD,
    lon: Number(window.ASTRA_TERRAIN_LON ?? 0) * DEG2RAD,
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
