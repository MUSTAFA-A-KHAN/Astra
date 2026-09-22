// Optional Cesium World Terrain integration for Astra.
//
// IMPORTANT: the 3D Tiles/Cesium dependencies are loaded lazily. Astra must
// still boot normally when no Cesium token is configured or when that optional
// CDN is unavailable.

const DEFAULT_ASSET_ID = 1;
const DEG2RAD = Math.PI / 180;
const TILES_URL = 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.5.3/build/index.js';
const PLUGINS_URL = 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.5.3/build/index.plugins.js';

const disabledTerrain = () => ({
  enabled: false,
  ready: false,
  update() {},
  setQuality() {},
  setTime() {},
  dispose() {},
  getHeight() { return 0; },
});

export async function createStreamedTerrain(scene, camera, renderer, {
  token = window.ASTRA_CESIUM_ION_TOKEN || '',
  assetId = DEFAULT_ASSET_ID,
  enabled = true,
} = {}) {
  // This is the normal Astra path. Do not even contact the optional Cesium
  // CDN when real-world mode is not configured.
  if (!enabled || !token) return disabledTerrain();

  try {
    const [{ TilesRenderer }, { CesiumIonAuthPlugin, ReorientationPlugin, GLTFExtensionsPlugin }] =
      await Promise.all([
        import(TILES_URL),
        import(PLUGINS_URL),
      ]);

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

    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    tiles.errorTarget = mobile ? 16 : 10;

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
        tiles.errorTarget = low ? 28 : balanced ? 18 : 10;
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
      getHeight() { return 0; },
    };
  } catch (error) {
    console.warn('Optional real-world terrain could not be loaded. Using Astra terrain.', error);
    return disabledTerrain();
  }
}
