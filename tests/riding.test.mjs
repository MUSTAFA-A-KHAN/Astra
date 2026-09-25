import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRidingAnchor, alignRider, MountSteering, maxTurnRate } from '../riding.js';

function closeVector(actual, expected, message) {
  assert.ok(actual.distanceTo(expected) < 1e-8,
    `${message}: ${actual.toArray()} differs from ${expected.toArray()}`);
}

function worldPosition(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

function rider({ units = 1, pelvisHeight = 1.1 } = {}) {
  const avatar = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(1 / units);
  model.position.set(.08, -.12, -.04);
  avatar.add(model);
  const pelvis = new THREE.Bone();
  pelvis.position.set(.03 * units, pelvisHeight * units, -.09 * units);
  model.add(pelvis);
  const anchor = createRidingAnchor(avatar, pelvis, new THREE.Vector3(.03, pelvisHeight - .2, -.08));
  return { avatar, model, pelvis, anchor };
}

function horse() {
  const group = new THREE.Group();
  group.position.set(7, .4, -3);
  group.rotation.y = .65;
  const saddle = new THREE.Object3D();
  saddle.position.set(.24, 1.48, -.31);
  group.add(saddle);
  return { group, saddle };
}

test('riding anchors preserve the chosen seat point across differently authored pelvis offsets and scales', () => {
  for (const { units, pelvisHeight } of [
    { units: 1, pelvisHeight: .82 },
    { units: 100, pelvisHeight: 1.35 },
    { units: .01, pelvisHeight: 1.08 },
  ]) {
    const { avatar, model, pelvis } = rider({ units, pelvisHeight });
    avatar.position.set(3, 2, -4);
    avatar.rotation.set(.1, -.7, .2);
    avatar.scale.set(1.1, .9, 1.2);
    model.rotation.y = .35;
    pelvis.rotation.z = -.2;
    const seatPoint = new THREE.Vector3(.14, pelvisHeight - .22, -.17);
    const originalPoint = seatPoint.clone();
    const expectedWorld = avatar.localToWorld(seatPoint.clone());

    const anchor = createRidingAnchor(avatar, pelvis, seatPoint);

    assert.ok(anchor instanceof THREE.Object3D);
    assert.equal(anchor.parent, pelvis, 'the seat follows the animated pelvis');
    closeVector(worldPosition(anchor), expectedWorld, `authored scale ${units}`);
    closeVector(seatPoint, originalPoint, 'the supplied calibration point stays unchanged');
  }
});

test('alignment places the rider contact point on the complete saddle offset', () => {
  const { avatar, anchor } = rider({ units: 100, pelvisHeight: 1.3 });
  const { group, saddle } = horse();
  avatar.position.set(-10, 5, 8);
  avatar.rotation.y = group.rotation.y;
  avatar.scale.setScalar(1.15);
  const rotation = avatar.quaternion.clone();
  const scale = avatar.scale.clone();

  alignRider(avatar, anchor, saddle);

  closeVector(worldPosition(anchor), worldPosition(saddle), 'rider contact meets the saddle');
  assert.ok(avatar.position.y < worldPosition(saddle).y,
    'the rider origin sits below the saddle instead of adding the pelvis height above it');
  assert.ok(avatar.quaternion.equals(rotation), 'alignment preserves the riding rotation');
  closeVector(avatar.scale, scale, 'alignment preserves the avatar scale');
});

test('alignment follows animated pelvis and saddle motion without a one-frame offset', () => {
  const { avatar, pelvis, anchor } = rider({ units: 100 });
  const { group, saddle } = horse();
  const pelvisStart = pelvis.position.clone();

  for (let frame = 0; frame < 120; frame++) {
    const phase = frame / 12;
    group.position.set(7 + frame * .04, .4 + Math.sin(phase) * .08, -3 - frame * .07);
    group.rotation.y = .65 + Math.sin(phase / 2) * .4;
    saddle.position.set(.24 + Math.sin(phase) * .02, 1.48 + Math.cos(phase) * .04, -.31);
    pelvis.position.copy(pelvisStart);
    pelvis.position.y += Math.sin(phase) * 9;
    pelvis.position.z += Math.cos(phase) * 3;
    pelvis.rotation.set(.1 * Math.sin(phase), 0, .08 * Math.cos(phase));
    avatar.rotation.y = group.rotation.y;

    // No explicit matrix update: the alignment must use this frame's animation transforms.
    alignRider(avatar, anchor, saddle);

    closeVector(worldPosition(anchor), worldPosition(saddle), `animated frame ${frame}`);
  }
});

test('repeated alignment does not accumulate a position correction', () => {
  const { avatar, anchor } = rider({ units: .01, pelvisHeight: .9 });
  const { saddle } = horse();
  avatar.rotation.set(.06, -.9, -.04);
  alignRider(avatar, anchor, saddle);
  const settledPosition = avatar.position.clone();

  for (let frame = 0; frame < 240; frame++) alignRider(avatar, anchor, saddle);

  closeVector(avatar.position, settledPosition, 'the corrected avatar position remains stable');
  closeVector(worldPosition(anchor), worldPosition(saddle), 'the contact remains seated');
});

test('alignment accounts for a rotated and scaled avatar parent independently of the horse parent', () => {
  const { avatar, anchor } = rider({ units: 100, pelvisHeight: 1.2 });
  const { group, saddle } = horse();
  const avatarParent = new THREE.Group();
  avatarParent.position.set(-4, 2, 11);
  avatarParent.rotation.set(.2, 1.1, -.15);
  avatarParent.scale.set(1.3, .8, 1.7);
  avatarParent.add(avatar);
  avatar.position.set(2, 3, -1);
  avatar.rotation.set(.1, -.5, .2);
  avatar.scale.set(.9, 1.2, 1.1);
  const horseParent = new THREE.Group();
  horseParent.position.set(13, -2, -7);
  horseParent.rotation.set(-.1, -.8, .12);
  horseParent.scale.set(.8, 1.1, .9);
  horseParent.add(group);
  const rotation = avatar.quaternion.clone();
  const scale = avatar.scale.clone();

  alignRider(avatar, anchor, saddle);

  closeVector(worldPosition(anchor), worldPosition(saddle), 'contact under separate transformed parents');
  assert.equal(avatar.parent, avatarParent);
  assert.ok(avatar.quaternion.equals(rotation), 'the parent correction only translates the avatar');
  closeVector(avatar.scale, scale, 'the parent correction preserves scale');
});

// Rides the reins at 60 Hz toward a requested heading, with ground speed
// chasing the throttle the way locomotion's acceleration does.
function ride({ heading = 0, speed = 5, pace = 5, toward, seconds = 4, wobble = 0 }) {
  const reins = new MountSteering(heading), dt = 1 / 60, frames = [];
  let x = 0, z = 0;
  for (let i = 0; i < seconds * 60; i++) {
    const asked = toward + (i % 2 ? wobble : -wobble);
    const before = reins.heading;
    const out = reins.update(dt, { x: Math.sin(asked), z: Math.cos(asked), speed });
    speed += THREE.MathUtils.clamp(out.magnitude * pace - speed, -18 * dt, 18 * dt);
    x += out.x / Math.max(out.magnitude, 1e-9) * speed * dt; z += out.z / Math.max(out.magnitude, 1e-9) * speed * dt;
    const turned = Math.atan2(Math.sin(reins.heading - before), Math.cos(reins.heading - before));
    frames.push({ t: (i + 1) * dt, heading: reins.heading, turned, out, speed, x, z });
  }
  return frames;
}
const off = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

test('asked to go back the way it came, a ridden horse wheels round in an arc instead of spinning on the spot', () => {
  const frames = ride({ heading: 0, toward: Math.PI });
  assert.ok(off(frames[5].heading, 0) < .25, `no snap round: ${frames[5].heading} after 0.1 s`);
  for (const frame of frames) {
    assert.ok(Math.abs(frame.turned) <= maxTurnRate(0) / 60 + 1e-9, `turned ${frame.turned} in one frame`);
    if (off(frame.heading, Math.PI) > .05) assert.ok(frame.turned > -1e-9, `turned back by ${frame.turned} at ${frame.t} s`);
    assert.ok(off(Math.atan2(frame.out.x, frame.out.z), frame.heading) < 1e-9, 'it travels the way it faces');
  }
  const past = Math.max(...frames.map(frame => Math.atan2(Math.sin(frame.heading - Math.PI), Math.cos(frame.heading - Math.PI))).filter(a => a > -1));
  assert.ok(past < .03, `swung ${past} rad past the way back`);
  const turning = frames.filter(frame => off(frame.heading, Math.PI) > 1);
  assert.ok(Math.min(...turning.map(frame => frame.out.magnitude)) < .4, 'it eases off through the turn');
  assert.ok(Math.max(...frames.map(frame => Math.abs(frame.x))) > .5, 'the turn sweeps out an arc');
  const around = frames.find(frame => off(frame.heading, Math.PI) < .05);
  assert.ok(around && around.t > .9 && around.t < 3, `wheeled round in ${around?.t} s`);
  assert.ok(frames.at(-1).out.magnitude > .99, 'lined up again, it pushes on at full pace');
});

test('a horse turns tighter at a walk than at a gallop', () => {
  assert.ok(maxTurnRate(0) > maxTurnRate(5));
  assert.ok(maxTurnRate(5) > maxTurnRate(14));
  assert.equal(maxTurnRate(20), maxTurnRate(14));
  const quarter = frames => frames.find(frame => off(frame.heading, Math.PI / 2) < .05).t;
  const walking = quarter(ride({ speed: 5, pace: 5, toward: Math.PI / 2 }));
  const galloping = quarter(ride({ speed: 14, pace: 14, toward: Math.PI / 2 }));
  assert.ok(galloping > walking * 1.3, `a gallop takes ${galloping} s to turn a quarter, a walk ${walking} s`);
});

test('asked dead astern with a wavering stick, the horse commits to one way round', () => {
  const frames = ride({ heading: .4, toward: .4 + Math.PI, wobble: .03 });
  const direction = Math.sign(frames.find(frame => Math.abs(frame.turned) > 1e-4).turned);
  for (const frame of frames.filter(frame => off(frame.heading, .4 + Math.PI) > .1)) {
    assert.ok(frame.turned * direction > -1e-9, `turned back by ${frame.turned} at ${frame.t} s`);
  }
});

test('the horse settles onto a new line without swinging past it', () => {
  const target = -Math.PI / 4;
  const frames = ride({ heading: 0, toward: target, seconds: 3 });
  const past = Math.max(...frames.map(frame => target - frame.heading));
  assert.ok(past < .03, `swung ${past} rad past the new line`);
  assert.ok(off(frames.at(-1).heading, target) < .01);
});

test('with no request the horse holds its heading and stops pushing', () => {
  const reins = new MountSteering(1.2);
  for (let i = 0; i < 60; i++) {
    const out = reins.update(1 / 60, { x: 0, z: 0, speed: 3 });
    assert.equal(out.magnitude, 0);
  }
  assert.equal(reins.heading, 1.2);
});
