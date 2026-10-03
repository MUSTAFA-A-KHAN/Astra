import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNpcPresence } from '../npc-presence.js';

function fixture() {
  const scene = new THREE.Group(), model = new THREE.Group(); scene.add(model);
  const chest = new THREE.Bone(); chest.name = 'mixamorigSpine2_04'; chest.position.y = 1;
  const head = new THREE.Bone(); head.name = 'mixamorigHead_06'; head.position.y = 1;
  model.add(chest); chest.add(head);
  for (const side of ['Right', 'Left']) {
    const arm = new THREE.Bone(), forearm = new THREE.Bone();
    arm.name = `mixamorig${side}Arm_09`; forearm.name = `mixamorig${side}ForeArm_010`;
    chest.add(arm); arm.add(forearm);
  }
  const mixer = new THREE.AnimationMixer(model);
  const idleClip = new THREE.AnimationClip('Idle', 2, [new THREE.QuaternionKeyframeTrack(`${chest.name}.quaternion`, [0, 2], [0, 0, 0, 1, 0, 0, 0, 1])]);
  const talkClip = idleClip.clone(); talkClip.name = 'Talk';
  const part = { model, mixer, clips: [idleClip, talkClip], idle: mixer.clipAction(idleClip), talk: mixer.clipAction(talkClip) };
  const presence = createNpcPresence(part, { name: 'tobin', place: { x: 0, z: 0, facing: 0 } });
  return { presence, model, head, mixer, scene };
}

test('an approaching player gets one notice reaction, then listening and speech have distinct performances', () => {
  const { presence, model } = fixture();
  const player = { x: 2, z: 4 };
  presence.update(.016, 0, player);
  assert.equal(presence.diagnostics.gesture, 'Notice');
  assert.equal(presence.diagnostics.mode, 'attentive');
  for (let i = 0; i < 100; i++) presence.update(.016, i * .016, player);
  assert.equal(presence.diagnostics.gesture, null, 'proximity does not retrigger notice every frame');
  presence.update(.016, 2, player, { conversation: true, speaking: true });
  assert.equal(presence.diagnostics.mode, 'speaking');
  assert.equal(presence.diagnostics.gesture, 'Talk');
  presence.update(.016, 2.016, player, { conversation: true, speaking: false });
  assert.equal(presence.diagnostics.mode, 'listening');
  assert.equal(presence.diagnostics.gesture, 'Listen');
  assert.deepEqual(model.position.toArray(), [0, 0, 0], 'performances never slide the character feet');
  presence.dispose();
});

test('attention has distance hysteresis, bounded head turns, and no accumulating skeletal twist', () => {
  const { presence, head, model } = fixture();
  presence.update(.016, 0, { x: 9, z: 0 });
  presence.update(.016, 1, { x: 11, z: 0 });
  assert.equal(presence.diagnostics.near, true);
  presence.update(.016, 2, { x: 13, z: 0 });
  assert.equal(presence.diagnostics.near, false);
  for (let i = 0; i < 2000; i++) {
    presence.update(.016, 3 + i * .016, { x: 0, z: -3 });
    assert.ok(Math.abs(presence.diagnostics.headYaw) <= .421);
    assert.ok(Math.abs(head.quaternion.length() - 1) < 1e-6);
  }
  assert.ok(Math.abs(Math.abs(model.rotation.y) - Math.PI) < .001, 'body turns toward a player arriving behind it');
  presence.dispose();
});

test('an incident reaction interrupts conversation, finishes, and releases animation bindings on disposal', () => {
  const { presence, head, model, mixer } = fixture();
  presence.react('fear');
  presence.update(.1, 0, { x: 0, z: 3 }, { conversation: true });
  assert.equal(presence.diagnostics.reaction, 'Concern');
  assert.equal(presence.diagnostics.mode, 'reacting');
  for (let i = 0; i < 26; i++) presence.update(.1, i / 10, { x: 0, z: 3 }, { conversation: true });
  assert.equal(presence.diagnostics.reaction, null);
  assert.equal(presence.diagnostics.mode, 'listening');
  assert.equal(presence.diagnostics.gesture, 'Listen');
  model.visible = false;
  const time = mixer.time;
  presence.update(.1, 4, { x: 3, z: 0 });
  assert.equal(mixer.time, time, 'hidden NPCs do not spend animation work');
  presence.dispose();
  const pose = head.quaternion.toArray(); model.visible = true;
  presence.update(.1, 5, { x: 3, z: 0 });
  assert.deepEqual(head.quaternion.toArray(), pose);
  assert.equal(mixer.stats.actions.inUse, 1, 'only the existing idle action remains');
});
