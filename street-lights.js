import * as THREE from 'three';

// The city model's lanterns glow, but nothing in it casts light. Here every
// lantern lights the city's own surfaces through a baked irradiance map, and
// the few nearest the player also hang a real light, so that the hero, the
// wisps and the crates are lit when they pass beneath one. Real lights cost
// every pixel that takes them, and a change in their number recompiles every
// shader, so there are always the same few, and the city's surfaces, already
// lit by the map, skip them.
const COLOR = new THREE.Color('#ffc27c');
const INTENSITY = 48;    // candela, as three.js measures a point light
const REACH = 18;        // a lantern's light ends here
const RANGE = 40;        // no real light for a lantern further away than this
const TEXEL = .5;        // world units per texel of the irradiance map
// Marks the real lights for the city's shader. It falls off as a decay of 2
// would, and stays distinct from 2 even at half precision.
const DECAY = 1.99;

const smoothstep = THREE.MathUtils.smoothstep;

/**
 * The irradiance, per unit of intensity, that a lantern `drop` above the ground
 * and (dx, dz) away across it casts there: the vector a surface's normal is
 * dotted with. On the ground it is exactly three.js's point light falloff.
 */
export function lanternIrradiance(dx, dz, drop, out = new THREE.Vector3()) {
  const d2 = dx * dx + dz * dz + drop * drop;
  const window = Math.max(0, 1 - (d2 / (REACH * REACH)) ** 2) ** 2;
  return out.set(dx, drop, dz).multiplyScalar(window / (d2 * Math.sqrt(d2)));
}

/**
 * Which lanterns hang the real lights, and how brightly: the `slots` nearest,
 * each fading out by the distance of the nearest lantern left without one. Two
 * lanterns only trade places at that distance, where both are dark, so no
 * light ever switches on or off at once. Returns the lanterns nearest first.
 */
export function nearestLanterns(distances, slots, weights = new Float32Array(distances.length), order = [...distances.keys()]) {
  order.sort((a, b) => distances[a] - distances[b]);
  const far = Math.min(RANGE, distances[order[slots]] ?? RANGE), near = far * .6;
  weights.fill(0);
  for (let k = 0; k < Math.min(slots, order.length); k++) weights[order[k]] = 1 - smoothstep(distances[order[k]], near, far);
  return order;
}

// three.js's point light loop, with the street lights left out.
const POINT_LIGHT = /getPointLightInfo\( pointLight[\s\S]*?RE_Direct\([^;]*\);/;
const litByMap = THREE.ShaderChunk.lights_fragment_begin.replace(POINT_LIGHT,
  match => `if ( abs( pointLight.decay - ${DECAY.toFixed(2)} ) > .004 ) {\n${match}\n}`);

export function createStreetLights({ lanterns, materials = [], heightAt = () => 0, lights: slots = 4 }) {
  const group = new THREE.Group(); group.name = 'Street lights';
  const count = lanterns.length;
  const drops = lanterns.map(head => Math.max(.5, head.y - heightAt(head.x, head.z)));

  // Irradiance from every lantern, sampled at the ground across the district.
  const min = new THREE.Vector2(Infinity, Infinity), max = new THREE.Vector2(-Infinity, -Infinity);
  for (const lantern of lanterns) { min.min({ x: lantern.x, y: lantern.z }); max.max({ x: lantern.x, y: lantern.z }); }
  if (!count) { min.set(0, 0); max.set(0, 0); }
  min.subScalar(REACH + TEXEL); max.addScalar(REACH + TEXEL);
  const width = Math.min(1024, Math.ceil((max.x - min.x) / TEXEL)), depth = Math.min(1024, Math.ceil((max.y - min.y) / TEXEL));
  const texelX = (max.x - min.x) / width, texelZ = (max.y - min.y) / depth;
  const irradiance = new Float32Array(width * depth * 4), vector = new THREE.Vector3();
  lanterns.forEach((lantern, i) => {
    const x0 = Math.max(0, Math.floor((lantern.x - REACH - min.x) / texelX)), x1 = Math.min(width - 1, Math.ceil((lantern.x + REACH - min.x) / texelX));
    const z0 = Math.max(0, Math.floor((lantern.z - REACH - min.y) / texelZ)), z1 = Math.min(depth - 1, Math.ceil((lantern.z + REACH - min.y) / texelZ));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      lanternIrradiance(lantern.x - (min.x + (ix + .5) * texelX), lantern.z - (min.y + (iz + .5) * texelZ), drops[i], vector);
      const t = (iz * width + ix) * 4;
      irradiance[t] += vector.x; irradiance[t + 1] += vector.y; irradiance[t + 2] += vector.z;
    }
  });
  const halves = new Uint16Array(irradiance.length);
  for (let i = 0; i < irradiance.length; i++) if (irradiance[i]) halves[i] = THREE.DataUtils.toHalfFloat(irradiance[i]);
  const map = new THREE.DataTexture(halves, width, depth, THREE.RGBAFormat, THREE.HalfFloatType);
  map.magFilter = map.minFilter = THREE.LinearFilter; map.needsUpdate = true;

  const uniforms = {
    lanternMap: { value: map },
    lanternArea: { value: new THREE.Vector4(min.x, min.y, 1 / (max.x - min.x), 1 / (max.y - min.y)) },
    lanternColor: { value: new THREE.Color(0, 0, 0) },
    lanternHead: { value: count ? Math.min(...lanterns.map(lantern => lantern.y)) : 0 },
  };
  // The map is measured at the ground: faces turned up take it only below the
  // lanterns (never their own hoods), and walls only a storey above them.
  function patch(shader) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLanternWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLanternWorld = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLanternWorld;
        uniform sampler2D lanternMap;
        uniform vec4 lanternArea;
        uniform vec3 lanternColor;
        uniform float lanternHead;`)
      .replace('#include <lights_fragment_begin>', litByMap)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          vec3 lantern = texture2D(lanternMap, (vLanternWorld.xz - lanternArea.xy) * lanternArea.zw).rgb;
          lantern.y *= 1. - smoothstep(lanternHead - .6, lanternHead, vLanternWorld.y);
          lantern *= 1. - smoothstep(lanternHead + 1., lanternHead + 5., vLanternWorld.y);
          vec3 worldNormal = (vec4(normal, 0.) * viewMatrix).xyz;
          reflectedLight.directDiffuse += max(dot(worldNormal, lantern), 0.) * lanternColor * BRDF_Lambert(material.diffuseColor);
        }`);
  }
  for (const material of materials) {
    material.onBeforeCompile = patch;
    material.customProgramCacheKey = () => 'street-lights';
    material.needsUpdate = true;
  }

  const lights = Array.from({ length: slots }, (_, k) => {
    const light = new THREE.PointLight(COLOR, 0, REACH, DECAY);
    light.name = `Street light ${k + 1}`; group.add(light);
    return light;
  });

  // A soft halo, so that lanterns read as lights down the length of a street.
  // It is drawn a little in front of its lantern, or the glass would hide its core.
  const size = 64, glow = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.min(1, Math.hypot(x + .5 - size / 2, y + .5 - size / 2) / (size / 2));
    const alpha = (1 - r) ** 3 * .6 + Math.exp(-((r / .15) ** 2)) * .4;
    glow.set([255, 255, 255, Math.round(alpha * 255)], (y * size + x) * 4);
  }
  const haloTexture = new THREE.DataTexture(glow, size, size);
  haloTexture.magFilter = haloTexture.minFilter = THREE.LinearFilter; haloTexture.needsUpdate = true;
  const haloGeometry = new THREE.BufferGeometry().setFromPoints(lanterns);
  const halo = new THREE.Points(haloGeometry, new THREE.PointsMaterial({
    map: haloTexture, color: COLOR, size: 7, sizeAttenuation: true, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  halo.material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\nmvPosition.xyz -= normalize(mvPosition.xyz) * .6;\ngl_Position = projectionMatrix * mvPosition;');
  };
  halo.name = 'Lantern halos'; halo.visible = false; halo.frustumCulled = false; group.add(halo);

  const distances = new Float32Array(count), weights = new Float32Array(count);
  let order = [...distances.keys()], power = 0, enabled = slots > 0;
  function apply() {
    for (let k = 0; k < slots; k++) {
      const i = order[k];
      if (i !== undefined) lights[k].position.copy(lanterns[i]);
      lights[k].intensity = i === undefined || !enabled ? 0 : INTENSITY * power * weights[i];
    }
  }
  return {
    group,
    // Lanterns come on through dusk and go out through the morning.
    setTime(daylight) {
      power = smoothstep(1 - daylight, .55, .9);
      uniforms.lanternColor.value.copy(COLOR).multiplyScalar(INTENSITY * power);
      halo.visible = power > 0; halo.material.opacity = power * .85;
      apply();
    },
    setQuality(low) {
      enabled = slots > 0 && !low;
      for (const light of lights) light.visible = enabled;
      apply();
    },
    update(position) {
      if (!position || !count) return;
      for (let i = 0; i < count; i++) distances[i] = Math.hypot(lanterns[i].x - position.x, lanterns[i].z - position.z);
      order = nearestLanterns(distances, enabled ? slots : 0, weights, order);
      apply();
    },
    get diagnostics() {
      return { lanterns: count, power, lights: lights.filter(light => light.visible && light.intensity > 0).length };
    },
    dispose() {
      map.dispose(); haloTexture.dispose(); haloGeometry.dispose(); halo.material.dispose();
      group.removeFromParent();
    },
  };
}
