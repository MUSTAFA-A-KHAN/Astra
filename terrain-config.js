// Astra realistic-world configuration.
// The large terrain payload is streamed at runtime; no terrain archive is committed.

window.ASTRA_CESIUM_ION_TOKEN = window.ASTRA_CESIUM_ION_TOKEN || '';
window.ASTRA_TERRAIN_LAT = Number(window.ASTRA_TERRAIN_LAT ?? 0);
window.ASTRA_TERRAIN_LON = Number(window.ASTRA_TERRAIN_LON ?? 0);
window.ASTRA_TERRAIN_HEIGHT = Number(window.ASTRA_TERRAIN_HEIGHT ?? 0);
window.ASTRA_TERRAIN_AZIMUTH = Number(window.ASTRA_TERRAIN_AZIMUTH ?? 0);

// Runtime feature flag. Without a token, Astra retains the handcrafted fallback
// world so the published game remains playable.
window.ASTRA_REAL_WORLD_ENABLED = window.ASTRA_REAL_WORLD_ENABLED !== false;
