import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAtmosphere, getCelestialState } from '../atmosphere.js';

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);

test('sun rises east, crosses the sky, and gives way to the opposing moon at night', () => {
  const sunrise = getCelestialState(6), noon = getCelestialState(12);
  const sunset = getCelestialState(18), midnight = getCelestialState(0);
  close(sunrise.sunDirection.x, 1);
  close(sunrise.sunDirection.y, 0);
  close(sunset.sunDirection.x, -1);
  close(sunset.sunDirection.y, 0);
  assert.ok(noon.sunDirection.y > .9);
  assert.ok(noon.sunIntensity > 3);
  assert.equal(noon.moonIntensity, 0);
  assert.equal(noon.daylight, 1);
  assert.equal(midnight.sunIntensity, 0);
  assert.ok(midnight.moonDirection.y > .9);
  assert.ok(midnight.moonIntensity > .4);
  assert.equal(midnight.daylight, 0);
  for (const state of [sunrise, noon, sunset, midnight]) {
    close(state.sunDirection.length(), 1);
    close(state.moonDirection.dot(state.sunDirection), -1);
  }
});

test('time wraps across midnight and transitions continuously through dusk', () => {
  for (const [input, expected] of [[24, 0], [49.5, 1.5], [-1, 23], [NaN, 15.5], [Infinity, 15.5]]) {
    assert.equal(getCelestialState(input).hour, expected);
  }
  const before = getCelestialState(23.99999), after = getCelestialState(24.00001);
  assert.ok(before.sunDirection.distanceTo(after.sunDirection) < .00001);
  close(before.moonIntensity, after.moonIntensity);
  assert.ok(getCelestialState(17.5).daylight > getCelestialState(18).daylight);
  assert.ok(getCelestialState(18).daylight > getCelestialState(18.5).daylight);
});

test('visible sky directions and shadow-casting lights follow the same orbit while the camera moves', () => {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(), hemi = new THREE.HemisphereLight();
  const renderer = { toneMappingExposure: 1 };
  scene.add(sun, sun.target, hemi);
  const atmosphere = createAtmosphere({ scene, sun, hemi, renderer });
  const sky = scene.getObjectByName('Atmospheric sky'), moon = scene.getObjectByName('Moonlight');
  for (const hour of [6, 9, 12, 18, 21, 0]) {
    atmosphere.setTime(hour);
    const cameraPosition = new THREE.Vector3(hour * 17, 24, -hour * 9);
    atmosphere.update(1 / 60, hour, cameraPosition, 'lake');
    const state = atmosphere.diagnostics;
    assert.ok(sky.position.equals(cameraPosition));
    const sunDirection = sun.position.clone().sub(sun.target.position).normalize();
    const moonDirection = moon.position.clone().sub(moon.target.position).normalize();
    assert.ok(sunDirection.distanceTo(sky.material.uniforms.uSun.value) < 1e-10);
    assert.ok(moonDirection.distanceTo(sky.material.uniforms.uMoon.value) < 1e-10);
    close(sun.intensity, state.sunIntensity);
    close(moon.intensity, state.moonIntensity);
    assert.equal(state.sunShadows, state.sunElevation > .035);
    assert.equal(state.moonShadows, state.moonElevation > .035);
    assert.equal(state.sunShadows && state.moonShadows, false);
  }
  atmosphere.setQuality('low');
  assert.equal(sun.castShadow, false);
  assert.equal(moon.castShadow, false);
  assert.equal(atmosphere.diagnostics.clouds, 0);
  atmosphere.setQuality('high');
  assert.equal(moon.castShadow, true);
  assert.equal(sun.castShadow, false);
  atmosphere.dispose();
  atmosphere.dispose();
  assert.equal(scene.getObjectByName('Atmospheric sky'), undefined);
  assert.equal(scene.getObjectByName('Moonlight'), undefined);
});
