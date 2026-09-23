import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlazaLights } from '../plaza-lighting.js';
import { PLAZA_LIGHT_SOURCES } from '../plaza-light-sources.js';

const street = () => Array.from({ length: 9 }, (_, i) => [i * 8, 4, 0]);

test('plaza lamps illuminate at night and stay available in low quality', () => {
  const lighting = createPlazaLights({ sources: street() });
  lighting.update(new THREE.Vector3(16, 0, 1));
  lighting.setTime(1);
  assert.equal(lighting.diagnostics.lights, 0);
  lighting.setTime(0);
  assert.ok(lighting.diagnostics.lights > 0);
  const resident = lighting.group.children.slice();
  lighting.setQuality('low');
  assert.equal(lighting.diagnostics.slots, 2);
  assert.ok(lighting.diagnostics.lights > 0);
  assert.ok(lighting.diagnostics.lights <= 2);
  assert.deepEqual(lighting.group.children, resident);
  assert.ok(resident.every(light => light.isPointLight && light.visible && !light.castShadow));
  lighting.setTime(1);
  assert.ok(resident.every(light => light.visible && light.intensity === 0));
  lighting.dispose();
});

test('upper-floor lamps take priority when the hero climbs above street lamps', () => {
  const lighting = createPlazaLights({ sources: [
    [-2, 3, 0], [2, 3, 0], [0, 3, -2], [0, 3, 2], [0, 24, 0], [4, 24, 0],
  ] });
  lighting.setTime(0); lighting.setQuality('low');
  lighting.update(new THREE.Vector3(0, 22, 0));
  assert.equal(lighting.diagnostics.lights, 2);
  assert.ok(lighting.diagnostics.active.every(light => light.y === 24));
  lighting.update(new THREE.Vector3(-2, 0, 0));
  assert.ok(lighting.diagnostics.lights > 0);
  assert.ok(lighting.diagnostics.active.every(light => light.y === 3));
  lighting.dispose();
});

test('real lights follow plaza placement and fade completely outside their range', () => {
  const transform = { x: 360, y: -34.65, z: -5.4, scale: 1.8, rotation: -Math.PI / 2 };
  const lighting = createPlazaLights({ transform, sources: [[1, 2, 3]] });
  lighting.setTime(0);
  lighting.update(new THREE.Vector3(354.6, -33, -3.6));
  const [light] = lighting.diagnostics.active;
  assert.ok(light && light.intensity > 0);
  assert.ok(Math.abs(light.x - 354.6) < 1e-10);
  assert.ok(Math.abs(light.y + 31.05) < 1e-10);
  assert.ok(Math.abs(light.z + 3.6) < 1e-10);
  lighting.update(new THREE.Vector3(0, 0, 18));
  assert.equal(lighting.diagnostics.lights, 0);
  lighting.dispose();
});

test('walking between lamp clusters does not abruptly switch their light', () => {
  const lighting = createPlazaLights({ sources: street() });
  lighting.setTime(0); lighting.setQuality('low');
  let previous = new Map();
  for (let x = -20; x <= 85; x += .05) {
    lighting.update(new THREE.Vector3(x, 0, 1));
    const current = new Map(lighting.diagnostics.active.map(light => [light.x, light.intensity]));
    for (const key of new Set([...current.keys(), ...previous.keys()])) {
      assert.ok(Math.abs((current.get(key) ?? 0) - (previous.get(key) ?? 0)) < 2,
        `Light at ${key} changed abruptly when hero reached ${x}`);
    }
    previous = current;
  }
  lighting.dispose();
});

test('baked scenery skips plaza lights while hero materials retain normal PBR lighting', () => {
  const lighting = createPlazaLights({ sources: street() });
  const baked = new THREE.MeshStandardMaterial({ emissiveMap: new THREE.Texture() });
  const originalCompile = shader => { shader.uniforms.original = { value: 1 }; };
  baked.onBeforeCompile = originalCompile;
  const hero = new THREE.MeshStandardMaterial();
  const model = new THREE.Group(); model.add(new THREE.Mesh(new THREE.BoxGeometry(), baked));
  lighting.excludeScenery(model); lighting.excludeScenery(model);
  const shader = () => ({ uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader });
  const sceneryShader = shader(), heroShader = shader();
  baked.onBeforeCompile(sceneryShader); hero.onBeforeCompile(heroShader);
  assert.equal(sceneryShader.uniforms.original.value, 1);
  assert.match(sceneryShader.fragmentShader, /abs\( pointLight.decay - 1.95 \)/);
  assert.doesNotMatch(sceneryShader.fragmentShader, /#include <lights_fragment_begin>/);
  assert.match(heroShader.fragmentShader, /#include <lights_fragment_begin>/);
  lighting.dispose();
  assert.equal(baked.onBeforeCompile, originalCompile);
  model.children[0].geometry.dispose(); baked.emissiveMap.dispose(); baked.dispose(); hero.dispose();
});

test('supplied lamp positions cover the street and upper storeys', () => {
  assert.ok(PLAZA_LIGHT_SOURCES.length > 300);
  assert.ok(PLAZA_LIGHT_SOURCES.every(source => source.length === 3 && source.every(Number.isFinite)));
  assert.ok(PLAZA_LIGHT_SOURCES.some(([, y]) => y > 40));
  assert.ok(PLAZA_LIGHT_SOURCES.some(([, y]) => y > 20 && y < 25));
  const lighting = createPlazaLights({ sources: [] });
  lighting.update(new THREE.Vector3()); lighting.setTime(0);
  assert.equal(lighting.diagnostics.lights, 0);
  lighting.dispose();
});
