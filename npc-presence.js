import * as THREE from 'three';
import { NPC_GESTURES } from './assets/animations/npc-gestures.js';

const clamp = THREE.MathUtils.clamp;
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
const BONE_NAMES = {
  head: /(?:Head)(?:_\d+)?$/i,
  chest: /(?:Spine2)(?:_\d+)?$/i,
  rightArm: /(?:RightArm|R_UpperArm)(?:_\d+)?$/i,
  leftArm: /(?:LeftArm|L_UpperArm)(?:_\d+)?$/i,
  rightForearm: /(?:RightForeArm|R_Forearm)(?:_\d+)?$/i,
  leftForearm: /(?:LeftForeArm|L_Forearm)(?:_\d+)?$/i,
};

// Authored quaternion clips retargeted from actor space onto either Mixamo or
// Bip001. Looking up the actual bind axes avoids assuming those rigs agree.
export function createNpcPresence(part, { name, place, radius = 10 } = {}) {
  const { model, mixer } = part;
  const bones = {};
  model.traverse(node => {
    if (!node.isBone) return;
    for (const [key, pattern] of Object.entries(BONE_NAMES)) if (pattern.test(node.name)) bones[key] = node;
  });
  mixer?.update(0);
  model.updateWorldMatrix(true, true);
  const actorRotation = model.getWorldQuaternion(new THREE.Quaternion());
  const axes = new Map(Object.values(bones).map(bone => [bone, bone.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(actorRotation)]));
  const euler = new THREE.Euler(), q = new THREE.Quaternion(), basisInverse = new THREE.Quaternion();
  const actions = {};
  for (const [gesture, performance] of Object.entries(NPC_GESTURES)) {
    const tracks = [];
    const channels = new Set(performance.keys.flatMap(([, pose]) => Object.keys(pose)));
    for (const key of channels) {
      const bone = bones[key]; if (!bone) continue;
      const basis = axes.get(bone), values = [];
      basisInverse.copy(basis).invert();
      for (const [, pose] of performance.keys) {
        const [x, y, z] = pose[key] ?? [0, 0, 0];
        // Maren keeps her staff and her reserved posture; her gestures are smaller.
        const weight = name === 'maren' && key !== 'head' ? .4 : 1;
        q.setFromEuler(euler.set(x * weight, y * weight, z * weight));
        q.premultiply(basis).multiply(basisInverse).normalize();
        values.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, performance.keys.map(([time]) => time), values));
    }
    if (tracks.length && mixer) {
      const clip = new THREE.AnimationClip(`Astra_${gesture}`, performance.duration, tracks, THREE.AdditiveAnimationBlendMode);
      const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
      actions[gesture] = action;
    }
  }
  const idle = part.idle ?? (mixer && part.clips[0] ? mixer.clipAction(part.clips[0]) : null);
  const talk = part.talk ?? null;
  idle?.play();
  let base = idle, gesture = null, gestureTime = 0, current = null;
  let mode = 'idle', near = false, previousSpeaking = false, elapsed = 0, nextGlance = 5.5;
  let reaction = null, reactionTime = 0, headYaw = 0, stopped = false;
  const head = bones.head, headBase = head?.quaternion.clone();
  const parentRotation = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  const worldUp = new THREE.Vector3(0, 1, 0), localUp = new THREE.Vector3();

  function play(key, force = false) {
    if (!actions[key] || (gesture === key && !force)) return;
    const next = actions[key];
    if (current && current !== next) current.fadeOut(.2);
    next.reset().setEffectiveWeight(1).fadeIn(.2).play();
    current = next; gesture = key; gestureTime = 0;
  }
  function changeBase(wanted) {
    if (!wanted || wanted === base) return;
    wanted.reset().setEffectiveWeight(1).play();
    base?.crossFadeTo(wanted, .35, false); base = wanted;
  }
  function react(feeling = 'concern') {
    const key = /point|direct/i.test(feeling) ? 'Point' : /deny|anger|angry|shake/i.test(feeling) ? 'Shake' : 'Concern';
    reaction = key; reactionTime = 0; play(key, true);
  }
  return {
    react,
    update(dt, time, player, { conversation = false, speaking = false, feeling = '' } = {}) {
      if (stopped || !model.visible || model.parent?.visible === false) return;
      dt = Math.max(0, Math.min(dt, .1)); elapsed += dt; gestureTime += dt;
      const distance = Math.hypot(player.x - place.x, player.z - place.z);
      const wasNear = near;
      near = distance < radius * (near ? 1.2 : 1);
      if (reaction) {
        reactionTime += dt;
        if (reactionTime >= NPC_GESTURES[reaction].duration) reaction = null;
      }
      if (speaking && !previousSpeaking) {
        if (/point|direct|warn|fear|concern|angry|anger|shake|deny/i.test(feeling)) react(feeling);
        else if (!reaction) play('Talk', true);
      } else if (!speaking && previousSpeaking && conversation && !reaction) {
        play('Listen', true);
      } else if (near && !wasNear && !conversation && !reaction) play('Notice', true);
      previousSpeaking = speaking;
      mode = reaction ? 'reacting' : speaking ? 'speaking' : conversation ? 'listening' : near ? 'attentive' : 'idle';
      changeBase(speaking && talk ? talk : idle);
      const finished = !gesture || gestureTime >= (NPC_GESTURES[gesture]?.duration ?? 0);
      if (!reaction && finished) {
        if (speaking) play('Talk', true);
        else if (conversation) play('Listen', true);
        else if (elapsed >= nextGlance) { play(near ? 'Listen' : 'LookAround', true); nextGlance = elapsed + 8.5; }
        else { gesture = null; current = null; }
      }
      // Feet stay anchored. Head attention leads the slower body turn, with a
      // bounded eyeline so an approach from behind cannot twist the neck around.
      const target = near || conversation ? Math.atan2(player.x - place.x, player.z - place.z) : place.facing || 0;
      const offset = angle(target - model.rotation.y);
      model.rotation.y += clamp(offset * (1 - Math.exp(-dt * (conversation ? 3 : 1.7))), -dt * 1.5, dt * 1.5);
      headYaw += ((near || conversation ? clamp(angle(target - model.rotation.y), -.42, .42) : 0) - headYaw) * (1 - Math.exp(-dt * 7));
      // Undo only our previous eyeline before the mixer writes this frame.
      // Unkeyed neck/head bones would otherwise accumulate a permanent twist.
      if (head) head.quaternion.copy(headBase);
      mixer?.update(dt);
      if (head) {
        headBase.copy(head.quaternion);
        head.parent.getWorldQuaternion(parentRotation).invert();
        localUp.copy(worldUp).applyQuaternion(parentRotation);
        rotation.setFromAxisAngle(localUp, headYaw);
        head.quaternion.premultiply(rotation).normalize();
      }
    },
    get diagnostics() {
      return { mode, near, speaking: previousSpeaking, gesture, reaction, headYaw: +headYaw.toFixed(3), bones: Object.keys(bones), clips: Object.keys(actions) };
    },
    dispose() {
      stopped = true;
      if (head) head.quaternion.copy(headBase);
      for (const action of Object.values(actions)) { action.stop(); mixer.uncacheClip(action.getClip()); }
    },
  };
}
