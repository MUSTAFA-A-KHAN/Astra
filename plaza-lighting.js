import * as THREE from 'three';
import { PLAZA_LIGHT_SOURCES } from './plaza-light-sources.js';

const SLOTS = 4, REACH = 18, INTENSITY = 68;
// Distinguishes these lights in the plaza shader: its night illumination is
// already baked, while characters and moving props need normal PBR lighting.
const DECAY = 1.95;
const POINT_LIGHT = /getPointLightInfo\( pointLight[\s\S]*?RE_Direct\([^;]*\);/;
const bakedLighting = THREE.ShaderChunk.lights_fragment_begin.replace(POINT_LIGHT,
  match => `if ( abs( pointLight.decay - ${DECAY} ) > .004 ) {\n${match}\n}`);

export function createPlazaLights({ transform = {}, sources = PLAZA_LIGHT_SOURCES } = {}) {
  const group = new THREE.Group(); group.name = 'Plaza lights';
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), transform.rotation ?? 0),
    new THREE.Vector3().setScalar(transform.scale ?? 1));
  const lanterns = sources.map(source => new THREE.Vector3().fromArray(source).applyMatrix4(matrix));
  const lights = Array.from({ length: SLOTS }, (_, index) => {
    const light = new THREE.PointLight('#ffc27c', 0, REACH, DECAY);
    light.name = `Plaza light ${index + 1}`;
    group.add(light);
    return light;
  });
  const distances = new Float32Array(lanterns.length), order = [...lanterns.keys()];
  const chest = new THREE.Vector3(), patchedMaterials = new Map();
  let power = 0, slots = SLOTS, positioned = false;

  function apply() {
    // Lights hand over where their weight reaches zero, avoiding a visible
    // pop as the nearest lamps change. Distances include height, so downstairs
    // lights cannot displace nearby lights when the hero climbs upstairs.
    const far = Math.min(REACH, distances[order[slots]] ?? REACH), near = far * .5;
    for (let k = 0; k < lights.length; k++) {
      const index = order[k], light = lights[k];
      if (index !== undefined) light.position.copy(lanterns[index]);
      const weight = index === undefined || k >= slots || !positioned ? 0 :
        1 - THREE.MathUtils.smoothstep(distances[index], near, far);
      light.intensity = INTENSITY * power * weight;
    }
  }

  return {
    group,
    setTime(daylight) {
      power = THREE.MathUtils.smoothstep(1 - daylight, .55, .9);
      apply();
    },
    setQuality(level) {
      // Mobile still receives local hero lighting. Keep the same visible
      // objects even at zero intensity, so quality/time never changes the
      // renderer's light count or recompiles every material's shader.
      slots = level === 'low' || level === true ? 2 : SLOTS;
      apply();
    },
    update(position) {
      if (!position) return;
      chest.set(position.x, (position.y ?? 0) + 1.4, position.z);
      for (let i = 0; i < lanterns.length; i++) distances[i] = lanterns[i].distanceTo(chest);
      order.sort((a, b) => distances[a] - distances[b]);
      positioned = true;
      apply();
    },
    excludeScenery(model) {
      model.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!material?.emissiveMap || patchedMaterials.has(material)) continue;
          const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
          const key = cacheKey.call(material);
          patchedMaterials.set(material, { compile, cacheKey });
          material.onBeforeCompile = function(shader, renderer) {
            compile.call(this, shader, renderer);
            shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', bakedLighting);
          };
          material.customProgramCacheKey = () => `${key}:plaza-baked-lighting`;
          material.needsUpdate = true;
        }
      });
    },
    get diagnostics() {
      return { lanterns: lanterns.length, power, slots,
        lights: lights.filter(light => light.intensity > 0).length,
        active: lights.filter(light => light.intensity > 0).map(light => ({
          x: light.position.x, y: light.position.y, z: light.position.z, intensity: light.intensity,
        })),
      };
    },
    dispose() {
      for (const [material, { compile, cacheKey }] of patchedMaterials) {
        material.onBeforeCompile = compile; material.customProgramCacheKey = cacheKey; material.needsUpdate = true;
      }
      patchedMaterials.clear();
      for (const light of lights) light.dispose();
      group.removeFromParent();
    },
  };
}
