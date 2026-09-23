import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStreetLights, lanternIrradiance, nearestLanterns } from '../street-lights.js';

const street = () => Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i * 12, 4.8, 0));

test('the map falls off as a three.js point light does on the ground below it', () => {
  const drop = 4.3, distance = 18;
  for (const across of [0, 2, 5, 9]) {
    const d = Math.hypot(across, drop);
    const window = Math.max(0, 1 - (d / distance) ** 4) ** 2;
    const expected = window / (d * d) * (drop / d);
    assert.ok(Math.abs(lanternIrradiance(across, 0, drop).y - expected) < 1e-12);
  }
  assert.equal(lanternIrradiance(0, 18, 4.3).length(), 0);
  // It points back at the lantern, so walls facing away take none of it.
  assert.ok(lanternIrradiance(3, 0, 4.3).x > 0);
});

test('real lights hand over between lanterns without switching on or off at once', () => {
  const lanterns = street(), slots = 3;
  let previous = null;
  for (let x = -20; x <= 110; x += .05) {
    const distances = lanterns.map(l => Math.hypot(l.x - x, l.z - 3));
    const weights = new Float32Array(lanterns.length);
    const order = nearestLanterns(distances, slots, weights);
    assert.ok(weights.filter(w => w > 0).length <= slots);
    for (const i of order.slice(slots)) assert.equal(weights[i], 0);
    if (previous) for (let i = 0; i < weights.length; i++) assert.ok(Math.abs(weights[i] - previous[i]) < .02, `lantern ${i} jumps at x=${x.toFixed(2)}`);
    previous = weights;
  }
});

test('lanterns light only at night, with a fixed number of real lights', () => {
  const material = new THREE.MeshStandardMaterial();
  const lights = createStreetLights({ lanterns: street(), materials: [material], heightAt: () => .45, lights: 3 });
  const pointLights = lights.group.children.filter(child => child.isPointLight);
  assert.equal(pointLights.length, 3);
  lights.setTime(1); lights.update(new THREE.Vector3(12, 0, 2));
  assert.equal(lights.diagnostics.lights, 0);
  lights.setTime(0); lights.update(new THREE.Vector3(12, 0, 2));
  assert.equal(lights.diagnostics.power, 1);
  assert.ok(lights.diagnostics.lights > 0);
  // Performance quality hides them rather than removing them: the count never changes.
  lights.setQuality(true);
  assert.equal(lights.group.children.filter(child => child.isPointLight).length, 3);
  assert.equal(lights.diagnostics.lights, 0);
  lights.dispose();
});

test('the city shader takes the map and leaves out the street lights', () => {
  const material = new THREE.MeshPhysicalMaterial();
  createStreetLights({ lanterns: street(), materials: [material] });
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /vLanternWorld = /);
  assert.match(shader.fragmentShader, /texture2D\(lanternMap/);
  assert.match(shader.fragmentShader, /if \( abs\( pointLight\.decay - 1\.99 \) > \.004 \) \{\s*getPointLightInfo/);
  assert.doesNotMatch(shader.fragmentShader, /#include <lights_fragment_begin>/);
  assert.ok(shader.uniforms.lanternMap.value.isDataTexture);
});
