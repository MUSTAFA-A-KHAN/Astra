// Astra streamed terrain configuration.
//
// Cesium World Terrain is streamed from Cesium ion at runtime. Do not put an
// ion token in this file. Configure the token in your deployment environment
// or replace this assignment locally before running the game.
//
// The geographic anchor is optional. A production build should set both
// latitude and longitude to the center of the chosen playable region.

window.ASTRA_CESIUM_ION_TOKEN = window.ASTRA_CESIUM_ION_TOKEN || '';
window.ASTRA_TERRAIN_LAT = Number(window.ASTRA_TERRAIN_LAT ?? 0);
window.ASTRA_TERRAIN_LON = Number(window.ASTRA_TERRAIN_LON ?? 0);
window.ASTRA_TERRAIN_HEIGHT = Number(window.ASTRA_TERRAIN_HEIGHT ?? 0);
window.ASTRA_TERRAIN_AZIMUTH = Number(window.ASTRA_TERRAIN_AZIMUTH ?? 0);
window.ASTRA_REAL_WORLD_ENABLED = window.ASTRA_REAL_WORLD_ENABLED !== false;
