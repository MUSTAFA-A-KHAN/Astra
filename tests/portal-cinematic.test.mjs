import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PORTAL_TIMING, portalShot, shotPose, landingPose, cinematicWeight, sampleKeys } from '../portal-cinematic.js';
import { PORTAL_ENTRY, createPortal, portalAwakening, stoneRise } from '../portal-world.js';

// The standing stones fly between 5.5 m and 12.4 m of the gate. No shot may
// put the camera inside that ring, or the stones would pass through the lens.
const STONE_RING = 12.6;
const rig = { gate: new THREE.Vector3(10, 2, -4), axis: new THREE.Vector3(0, 0, 1), aperture: new THREE.Vector3(10, 5.96, -4), hero: new THREE.Vector3(5.4, 2, 2.6) };

function sweep(phase, until, options) {
  const poses = [];
  for (let t = 0; t <= until + 1e-9; t += .05) {
    const shot = portalShot(phase, t, options);
    poses.push({ t, shot, pose: shotPose(shot, rig) });
  }
  return poses;
}

test('gate shots stay outside the stones and never jump between frames', () => {
  const cast = sweep('casting', PORTAL_TIMING.cast);
  const ready = sweep('ready', 20);
  const from = ready.at(-1).shot;
  const enter = sweep('entering', PORTAL_ENTRY.duration, { entry: PORTAL_ENTRY, from });
  for (const sequence of [cast, ready, enter]) {
    for (let i = 0; i < sequence.length; i++) {
      const { pose, shot, t } = sequence[i];
      for (const value of [...pose.position.toArray(), ...pose.target.toArray(), pose.fov]) assert.ok(Number.isFinite(value), `finite at ${t}`);
      assert.ok(Math.hypot(pose.position.x - rig.gate.x, pose.position.z - rig.gate.z) >= STONE_RING, `outside the stones at ${t}`);
      assert.ok(pose.position.y > rig.gate.y, 'above the gate’s ground');
      assert.ok(shot.fov >= 20 && shot.fov <= 70);
      if (i) assert.ok(pose.position.distanceTo(sequence[i - 1].pose.position) < 1.2, `no cut at ${t}`);
    }
  }
  // Each shot picks up exactly where the last one left the camera.
  assert.ok(cast.at(-1).pose.position.distanceTo(ready[0].pose.position) < 1e-9);
  assert.ok(enter[0].pose.position.distanceTo(shotPose(from, rig).position) < 1e-9);
});

test('the entry leaves a long orbit the short way round and ends on the aperture', () => {
  const from = { ...portalShot('ready', 60) };
  from.angle += Math.PI * 6;
  const early = portalShot('entering', .05, { entry: PORTAL_ENTRY, from });
  assert.ok(Math.abs(early.angle - from.angle) > 1, 'angles are unwrapped, not copied');
  assert.ok(Math.abs(Math.atan2(Math.sin(early.angle - from.angle), Math.cos(early.angle - from.angle))) < .05);
  const last = portalShot('entering', PORTAL_ENTRY.duration, { entry: PORTAL_ENTRY, from });
  assert.equal(last.look, 1);
  assert.ok(last.fov < 30, 'the crossing pushes in');
});

test('the camera blends in from the player’s view and hands it back after landing', () => {
  assert.equal(cinematicWeight('reading', 5), 0);
  assert.equal(cinematicWeight('casting', 0), 0);
  assert.equal(cinematicWeight('casting', PORTAL_TIMING.blendIn), 1);
  for (const phase of ['ready', 'entering', 'traveling', 'arriving']) assert.equal(cinematicWeight(phase, 0), 1);
  assert.equal(cinematicWeight('landing', 0), 1);
  assert.equal(cinematicWeight('landing', PORTAL_TIMING.land), 0);
  const view = { hero: new THREE.Vector3(1, 0, 2), yaw: .7, pitch: .48, distance: 14, height: 1.9, fov: 55 };
  const end = landingPose(PORTAL_TIMING.land, view), anchor = new THREE.Vector3(1, 1.9, 2);
  // The follow camera's own pose, from camera.js.
  const expected = anchor.clone().add(new THREE.Vector3(Math.sin(.7) * Math.cos(.48), Math.sin(.48), Math.cos(.7) * Math.cos(.48)).multiplyScalar(14));
  assert.ok(end.position.distanceTo(expected) < 1e-9);
  assert.ok(landingPose(0, view).position.y > end.position.y + 8, 'arrival starts high over the hero');
});

test('keys ease through without overshooting their ends', () => {
  const keys = [[0, { v: 0 }], [1, { v: 10 }], [3, { v: 4 }]];
  assert.equal(sampleKeys(keys, -1).v, 0);
  assert.equal(sampleKeys(keys, 1).v, 10);
  assert.equal(sampleKeys(keys, 9).v, 4);
  assert.ok(sampleKeys(keys, .01).v < .1, 'starts from rest');
});

test('the awakening raises every stone before the aperture opens', () => {
  const count = 9;
  const lastStoneUp = [...Array(100).keys()].map(i => i / 100).find(p => stoneRise('casting', p, count - 1, count) >= 1);
  const apertureOpens = [...Array(100).keys()].map(i => i / 100).find(p => portalAwakening('casting', p).open > 0);
  assert.ok(stoneRise('casting', .05, 0, count) > 0, 'the first stone breaks ground at once');
  assert.ok(apertureOpens > .5 && lastStoneUp <= .7);
  assert.deepEqual(portalAwakening('ready'), { glow: 1, open: 1 });
  assert.equal(stoneRise('dormant', 1, 0, count), 0);
  assert.equal(stoneRise('reading', 1, 0, count), 0);
});

test('the traveller walks round to the dais, is lifted over its tier and drawn into the aperture', () => {
  const portal = createPortal({ world: { getHeight: () => 3 } });
  portal.place({ x: 20, y: 3, z: -8 }, Math.PI / 2);
  const reading = portal.places.reading, foot = portal.places.foot, gate = portal.places.portal, aperture = portal.places.aperture;
  const start = portal.entryPose(0);
  assert.ok(start.position.distanceTo(reading) < 1e-6, 'sets off from the reading spot');
  let previous = start.position.clone(), fastest = 0, veiled = null;
  for (let t = 1 / 30; t <= PORTAL_ENTRY.duration + .2; t += 1 / 30) {
    const pose = portal.entryPose(t), moved = pose.position.distanceTo(previous) * 30;
    if (pose.stage === 'walk') {
      assert.equal(pose.position.y, 3, 'walks on the ground');
      // The feet are placed from the speed the gait is told; it must be the real one.
      assert.ok(Math.abs(moved - pose.speed) < .35, `gait speed matches travel at ${t.toFixed(2)}`);
      fastest = Math.max(fastest, pose.speed);
    }
    if (pose.stage === 'float' && Math.hypot(pose.position.x - gate.x, pose.position.z - gate.z) < 4.4) {
      assert.ok(pose.position.y - 3 > 1.1, 'clears the dais’s metre-high first tier');
    }
    if (pose.veil && veiled === null) veiled = pose.position.clone();
    previous.copy(pose.position);
  }
  assert.ok(fastest > 2 && fastest < 3, 'a walking pace, not a run');
  assert.ok(portal.entryPose(PORTAL_ENTRY.walk + .1).position.distanceTo(foot) < 1e-6, 'pauses at the foot of the dais');
  assert.ok(Math.abs(portal.entryPose(PORTAL_ENTRY.walk + .1).yaw - Math.atan2(gate.x - foot.x, gate.z - foot.z)) < 1e-6, 'facing the ring');
  const end = portal.entryPose(PORTAL_ENTRY.duration);
  assert.equal(end.done, true);
  assert.ok(Math.abs(end.position.y + 1.2 - aperture.y) < 1e-6, 'drawn up to stand in the aperture');
  assert.ok(veiled && Math.hypot(veiled.x - gate.x, veiled.z - gate.z) < 1, 'the light takes them at the ring');
  assert.equal(portal.entryClear(), true, 'a gate without its turning arch never holds the traveller back');
  portal.dispose();
});
