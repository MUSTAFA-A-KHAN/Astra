// Pure terrain math: game coordinates are metres, +X east and +Z south.
export const EARTH_RADIUS = 6378137;
export const WORLD_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;
export const POND = Object.freeze({ x: -54, z: -38, radiusX: 19, radiusZ: 12, level: -1.2 });
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(min, max, value) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hash2(x, z, seed = 928431) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash2(ix, iz), hash2(ix + 1, iz), sx), lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), sx), sz) * 2 - 1;
}

function rawHeight(x, z) {
  const distance = Math.hypot(x, z);
  const foothills = smoothstep(80, 300, distance);
  const ridges = (1 - Math.abs(noise2(x * .005 + 4.5, z * .005 - 2.1))) ** 3;
  const rolling = noise2(x * .009 + 1.3, z * .009 + 6.1) * 18 + noise2(x * .026 - 3, z * .026 + 8) * 4;
  const shoulder = 17 * Math.exp(-((x - 60) ** 2 / 1900 + (z - 48) ** 2 / 2600));
  const westernHill = 13 * Math.exp(-((x + 77) ** 2 / 2000 + (z + 87) ** 2 / 2800));
  return rolling + shoulder + westernHill + noise2(x * .095, z * .095) * .42 + foothills * (16 + ridges * 82);
}

const originHeight = rawHeight(0, 18);
const clearings = [
  { x: 0, z: 18, inner: 9, outer: 24, height: 0 },
  { x: 0, z: -50, inner: 7, outer: 17, height: rawHeight(0, -50) - originHeight },
  { x: -45, z: 25, inner: 9, outer: 20, height: rawHeight(-45, 25) - originHeight },
  { x: 50, z: -20, inner: 7, outer: 15, height: rawHeight(50, -20) - originHeight },
];

export function pondDistance(x, z) {
  return Math.hypot((x - POND.x) / POND.radiusX, (z - POND.z) / POND.radiusZ);
}

export function proceduralHeight(x, z) {
  let height = rawHeight(x, z) - originHeight;
  for (const clearing of clearings) {
    const distance = Math.hypot(x - clearing.x, z - clearing.z);
    if (distance < clearing.outer) height = lerp(clearing.height, height, smoothstep(clearing.inner, clearing.outer, distance));
  }
  const pond = pondDistance(x, z);
  if (pond < 1.5) {
    const basin = POND.level - 2.5 + smoothstep(.3, 1.08, pond) * 3.3;
    height = lerp(basin, height, smoothstep(1.05, 1.5, pond));
  }
  return height;
}

export function decodeTerrarium(red, green, blue) {
  return red * 256 + green + blue / 256 - 32768;
}

export function mercatorFromDegrees(latitude, longitude) {
  const lat = clamp(latitude, -85.05112878, 85.05112878) * Math.PI / 180;
  return { x: longitude / 360 + .5, y: .5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI) };
}

export function localToTile(x, z, zoom, latitude, longitude) {
  const origin = mercatorFromDegrees(latitude, longitude);
  const scale = WORLD_CIRCUMFERENCE * Math.cos(latitude * Math.PI / 180);
  const count = 2 ** zoom;
  return { x: (origin.x + x / scale) * count, y: (origin.y + z / scale) * count };
}

export function tileToLocal(x, y, zoom, latitude, longitude) {
  const origin = mercatorFromDegrees(latitude, longitude);
  const scale = WORLD_CIRCUMFERENCE * Math.cos(latitude * Math.PI / 180);
  const count = 2 ** zoom;
  return { x: (x / count - origin.x) * scale, z: (y / count - origin.y) * scale };
}

// Matches the PlaneGeometry diagonal (lower-left to upper-right), not a
// bilinear approximation: collision and the displayed triangle share a plane.
export function triangleHeight(h00, h10, h01, h11, x, z) {
  return x + z <= 1 ? h00 + (h10 - h00) * x + (h01 - h00) * z
    : h11 + (h01 - h11) * (1 - x) + (h10 - h11) * (1 - z);
}

export function sampleGrid(data, width, height, x, y) {
  const px = clamp(x, 0, width - 1), py = clamp(y, 0, height - 1);
  const ix = Math.floor(px), iy = Math.floor(py);
  const nextX = Math.min(ix + 1, width - 1), nextY = Math.min(iy + 1, height - 1);
  return lerp(lerp(data[iy * width + ix], data[iy * width + nextX], px - ix),
    lerp(data[nextY * width + ix], data[nextY * width + nextX], px - ix), py - iy);
}
