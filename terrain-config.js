// Configuration contains no credentials. To configure locally, set
// window.ASTRA_CONFIG in runtime-config.js, or use ?terrain=terrarium&lat=...&lon=...
// A runtime-config.js containing credentials must remain untracked.
const number = (value, fallback, min, max) => {
  const parsed = Number(value);
  return value !== undefined && value !== null && value !== '' && Number.isFinite(parsed)
    ? Math.max(min, Math.min(max, parsed)) : fallback;
};

export function readTerrainConfig(scope = globalThis) {
  const settings = scope.ASTRA_CONFIG?.terrain || {};
  const params = new URLSearchParams(scope.location?.search || '');
  const provider = params.get('terrain') || settings.provider || scope.ASTRA_TERRAIN_PROVIDER || 'procedural';
  return Object.freeze({
    provider: ['procedural', 'terrarium', 'real', 'cesium'].includes(provider) ? provider : 'procedural',
    // Alpine foothills, with enough local relief to make geographic shape clear.
    latitude: number(params.get('lat') ?? settings.latitude ?? scope.ASTRA_TERRAIN_LAT, 46.577, -84, 84),
    longitude: number(params.get('lon') ?? settings.longitude ?? scope.ASTRA_TERRAIN_LON, 10.718, -180, 180),
    urlTemplate: settings.urlTemplate || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    token: settings.token || scope.ASTRA_TERRAIN_TOKEN || scope.ASTRA_CESIUM_TOKEN || '',
    zoom: number(settings.zoom, 14, 8, 15),
    timeout: number(settings.timeout, 6500, 250, 20000),
    maxRetries: number(settings.maxRetries, 2, 0, 3),
    maxCachedTiles: number(settings.maxCachedTiles, 48, 9, 128),
    elevationOffset: settings.elevationOffset == null ? null : number(settings.elevationOffset, 0, -12000, 12000),
  });
}
