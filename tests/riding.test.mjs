import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRidingAnchor, alignRider } from '../riding.js';

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
