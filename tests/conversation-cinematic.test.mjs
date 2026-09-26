import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { framing, composeView, createConversationDirector, CONVERSATION_BLEND } from '../conversation-cinematic.js';

// The hero faces someone four units north, a head shorter than they are.
const rig = { hero: { x: 0, y: 0, z: 0 }, subject: { x: 0, y: 0, z: -4 }, heroEye: 3.1, subjectEye: 2.85 };
const KINDS = ['two', 'them', 'close', 'hero', 'wide', 'read'];
// Which side of the line from the hero to the subject a point stands on: 1 or -1.
const sideOf = p => Math.sign((rig.subject.x - rig.hero.x) * (p.z - rig.hero.z) - (rig.subject.z - rig.hero.z) * (p.x - rig.hero.x));
const eye = (who, lift = 0) => new THREE.Vector3(rig[who].x, rig[who].y + rig[`${who}Eye`] + lift, rig[who].z);
// A camera set up as a shot says, for projecting points onto its screen.
function shoot(kind, side, aspect) {
  const shot = framing(kind, { ...rig, side }), view = composeView(shot.position, shot.target, shot.frame, shot.hfov, aspect);
  const camera = new THREE.PerspectiveCamera(view.fov, aspect, .1, 100);
  camera.position.copy(shot.position); camera.quaternion.copy(view.quaternion); camera.updateMatrixWorld(true);
  return { shot, camera, on: point => point.clone().project(camera) };
}
const sequence = (director, lines, dt = .5) => lines.map(who => { director.cue(who); director.update(dt); return director.diagnostics.kind; });

test('every shot keeps to one side of the line between the two of them', () => {
  for (const side of [1, -1]) for (const kind of KINDS) {
    assert.equal(sideOf(framing(kind, { ...rig, side }).position), side, `${kind} on side ${side}`);
  }
});

test('the subject falls where the shot sets it, across from whoever is nearer, on any screen', () => {
  for (const aspect of [16 / 9, 4 / 3, .46]) for (const side of [1, -1]) for (const kind of KINDS) {
    const { shot, on } = shoot(kind, side, aspect), at = on(shot.target);
    assert.ok(Math.abs(at.x - shot.frame.x) < .03 && Math.abs(at.y - shot.frame.y) < .03, `${kind} at ${aspect}: ${at.x.toFixed(3)}, ${at.y.toFixed(3)} for ${shot.frame.x.toFixed(3)}, ${shot.frame.y.toFixed(3)}`);
    // Eyes on the upper part of the picture, clear of the letterbox bars.
    assert.ok(at.y > 0 && at.y < .78, `${kind}: ${at.y}`);
  }
  for (const side of [1, -1]) {
    // Whoever is talking looks across the frame toward the one they talk to,
    // who is off the edge of it, on the other side.
    const them = shoot('them', side, 16 / 9), hero = them.on(eye('hero'));
    assert.ok(Math.sign(hero.x) === -Math.sign(them.shot.frame.x) && Math.abs(hero.x) > 1, `the hero is out of the picture, across from the face: ${hero.x}`);
    // The reverse: the hero's face across from the one they talk to.
    const reverse = shoot('hero', side, 16 / 9), subject = reverse.on(eye('subject'));
    assert.ok(Math.sign(subject.x) === -Math.sign(reverse.shot.frame.x) && Math.abs(subject.x) > 1, `the subject is out of the picture: ${subject.x}`);
    // Cut from one to the other, the two faces look opposite ways.
    assert.equal(Math.sign(them.shot.frame.x), -Math.sign(reverse.shot.frame.x));
    // Side on, both of them are in the picture.
    const two = shoot('two', side, 16 / 9);
    for (const who of ['hero', 'subject']) { const at = two.on(eye(who)); assert.ok(Math.abs(at.x) < .85 && Math.abs(at.y) < .78, `${who} in the two-shot`); }
  }
});

test('a reading is watched past the hero’s head, however near the page', () => {
  for (const near of [1.2, 1.8, 3.4, 5]) {
    const page = { x: 0, y: 0, z: -near }, shot = framing('read', { ...rig, subject: page, subjectEye: 1.3, side: 1 });
    // Where the line from the camera to the page passes the hero.
    const k = (shot.position.z - rig.hero.z) / (shot.position.z - shot.target.z);
    const passing = new THREE.Vector3().lerpVectors(shot.position, shot.target, k);
    assert.ok(Math.hypot(passing.x - rig.hero.x, passing.z - rig.hero.z) >= 1.09, `${near} away: passes ${passing.x.toFixed(2)} aside`);
  }
});

test('the picture cuts when the voice changes, and holds while the same voice goes on', () => {
  const director = createConversationDirector();
  director.start(rig);
  assert.deepEqual(sequence(director, ['maren', 'maren', 'maren']), ['two', 'them', 'them']);
  director.update(4);
  assert.deepEqual(sequence(director, ['maren', 'you', 'maren', null]), ['close', 'hero', 'them', 'wide']);
  assert.equal(director.diagnostics.cuts, 6);
  // Narration first: the scene it tells of, from well back.
  director.start({ ...rig, subject: { x: 5, y: 0, z: -4 } });
  assert.deepEqual(sequence(director, [null]), ['wide']);
  // The hero speaking first still opens on the two of them.
  director.start({ ...rig, subject: { x: -5, y: 0, z: -4 } });
  assert.deepEqual(sequence(director, ['you', 'maren', 'you']), ['two', 'them', 'hero']);
  // A reading holds over the shoulder, and turns round only for the hero's own voice.
  director.start({ ...rig, subject: { x: 9, y: 0, z: 9 }, read: true });
  assert.deepEqual(sequence(director, [null, null, 'you', null]), ['read', 'read', 'hero', 'read']);
  assert.equal(director.diagnostics.cuts, 3);
});

test('it eases in and back out, and with reduced motion cuts straight in and out', () => {
  const director = createConversationDirector();
  director.start(rig); director.cue('maren');
  const weights = [];
  for (let t = 0; t < CONVERSATION_BLEND.in + .2; t += .1) weights.push(director.update(.1).weight);
  assert.ok(weights[0] > 0 && weights[0] < .1, `starts on the player's camera: ${weights[0]}`);
  assert.ok(weights.every((w, i) => !i || w >= weights[i - 1]));
  assert.equal(weights.at(-1), 1);
  director.stop();
  assert.equal(director.on, false);
  let frames = 0; while (director.update(.1) && frames < 50) frames++;
  assert.ok(Math.abs(frames * .1 - CONVERSATION_BLEND.out) < .15, `back out in ${frames * .1}s`);
  assert.equal(director.update(.1), null);

  const still = createConversationDirector();
  still.start(rig); still.cue('maren');
  assert.equal(still.update(.016, { reducedMotion: true }).weight, 1);
  // Held still: no drift.
  const first = still.update(3, { reducedMotion: true }).position.clone();
  assert.ok(first.distanceTo(still.update(3, { reducedMotion: true }).position) < 1e-9);
  still.stop();
  assert.equal(still.update(.016, { reducedMotion: true }), null);
});

test('it keeps to the side with room, and gives up a shot that does not fit for one that does', () => {
  // Everything east of the line is wall: every shot goes west of it.
  const walled = createConversationDirector({ clear: (from, to) => to.x > .5 ? .2 : 1 });
  walled.start(rig);
  for (const who of ['maren', 'maren', 'you']) { walled.cue(who); walled.update(.1); assert.equal(walled.diagnostics.side, -1); }
  // A wall close about the two of them, with no room for the camera beside
  // either: the two of them from further off instead.
  const cramped = createConversationDirector({ clear: (from, to) => Math.hypot(to.x, to.z + 2) < 4.5 ? .3 : 1 });
  cramped.start(rig);
  assert.deepEqual(sequence(cramped, ['maren', 'maren', 'you']), ['two', 'two', 'two']);
  assert.equal(cramped.diagnostics.cuts, 1, 'no cut from a shot to the same shot');
  // Nearly room: drawn in toward the face, and still the same shot.
  const close = createConversationDirector({ clear: (from, to) => Math.hypot(to.x, to.z + 2) < 4.5 ? .9 : 1 });
  close.start(rig); close.cue('maren'); close.cue('maren');
  const { position } = close.update(0), open = framing('them', { ...rig, side: close.diagnostics.side });
  assert.equal(close.diagnostics.kind, 'them');
  assert.ok(Math.abs(position.distanceTo(open.target) / open.position.distanceTo(open.target) - .87) < .01);
  // Nothing fits anywhere: the one that fits best, drawn in as far as it must be.
  const boxed = createConversationDirector({ clear: () => .1 });
  boxed.start(rig); boxed.cue('maren');
  const drawn = boxed.update(.1).position, full = framing(boxed.diagnostics.kind, { ...rig, side: boxed.diagnostics.side });
  assert.ok(drawn.distanceTo(full.target) < full.position.distanceTo(full.target) * .26);
});

test('a conversation that follows straight on from the last, with the same person, carries on from the shot on screen', () => {
  const director = createConversationDirector();
  director.start(rig); director.cue(null); director.update(.5);
  const before = director.diagnostics;
  director.start(rig); director.cue(null);
  assert.equal(director.diagnostics.cuts, before.cuts);
  assert.equal(director.diagnostics.kind, 'wide');
  // Once it is over, the next one begins afresh.
  director.stop(); for (let i = 0; i < 20; i++) director.update(.1);
  director.start(rig); director.cue('maren');
  assert.equal(director.diagnostics.kind, 'two');
});
