import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WingFlight, FLIGHT, surfaceBelow, skyOver, createTidewarden } from '../tidewarden.js';

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
function run(flight, seconds, input, options) {
  for (let t = 0; t < seconds; t += 1 / 60) flight.update(1 / 60, input, options);
  return flight;
}

test('it swings round to the way it is asked at a limited rate, and flies the way it faces', () => {
  const flight = new WingFlight();
  flight.reset(new THREE.Vector3(), 0);
  run(flight, .1, { x: 1, z: 0 });
  assert.ok(flight.heading > 0 && flight.heading < FLIGHT.hoverTurn * .1 + 1e-6, `${flight.heading} turned at most a tenth of a second's worth`);
  run(flight, 4, { x: 1, z: 0 });
  assert.ok(Math.abs(wrap(flight.heading - Math.PI / 2)) < .05, `${flight.heading} faces +x`);
  const from = flight.position.clone();
  run(flight, 1, { x: 1, z: 0 });
  const moved = flight.position.clone().sub(from);
  assert.ok(moved.x > 15 && Math.abs(moved.z) < 1, `flew along +x: ${moved.toArray()}`);
  assert.ok(flight.speed > FLIGHT.cruise * .8 && flight.speed <= FLIGHT.cruise + 1e-6);
  run(flight, 4, { x: 1, z: 0, surge: true });
  assert.ok(flight.speed > FLIGHT.cruise + 10, 'sprint spurs it past its cruise');
});

test('it banks into a turn and hovers once let go', () => {
  const flight = new WingFlight();
  flight.reset(new THREE.Vector3(0, 20, 0), 0, FLIGHT.cruise);
  // A rising heading turns left; the left wing goes down.
  run(flight, .6, { x: 1, z: .3 });
  assert.ok(flight.turnRate > .5 && flight.roll < -.1, `left turn ${flight.turnRate}, roll ${flight.roll}`);
  run(flight, 8, {});
  assert.ok(flight.speed < .2 && Math.abs(flight.roll) < .02, `hovering: ${flight.speed}, ${flight.roll}`);
  const y = flight.position.y;
  run(flight, 2, {});
  assert.ok(Math.abs(flight.position.y - y) < .01, 'a hover holds its height');
});

test('it climbs and dives along the look under way, rises with jump, and keeps above the floor', () => {
  const flat = { minimum: () => 10 };
  const flight = new WingFlight();
  flight.reset(new THREE.Vector3(0, 30, 0), 0);
  run(flight, 3, { z: 1, aim: .4 }, flat);
  assert.ok(flight.position.y > 45 && flight.pitch > .2, `climbing: ${flight.position.y}, nose ${flight.pitch}`);
  run(flight, 6, { z: 1, aim: -1 }, flat);
  assert.equal(flight.position.y, 10, 'a dive levels out on the floor');
  // Looking up while hovering is only looking: it takes jump to rise.
  run(flight, 6, {}, flat);
  run(flight, 1, { aim: .6 }, flat);
  assert.equal(flight.position.y, 10);
  run(flight, 2, { rise: true }, flat);
  assert.ok(flight.position.y > 10 + FLIGHT.rise, `rose: ${flight.position.y}`);
  run(flight, 40, { rise: true }, flat);
  assert.equal(flight.position.y, FLIGHT.ceiling);
});

test('it pulls up for a roof ahead, and holds against what it cannot clear', () => {
  // A block 60 tall from x = 40.
  const minimum = x => x > 40 ? 60 : 5;
  const flight = new WingFlight();
  flight.reset(new THREE.Vector3(0, 5, 0), Math.PI / 2);
  let held = false;
  for (let t = 0; t < 12; t += 1 / 60) {
    flight.update(1 / 60, { x: 1 }, { minimum });
    if (flight.blocked) held = true;
    assert.ok(flight.position.x <= 40 || flight.position.y >= 60 - 1e-9, `inside the block at ${flight.position.toArray()}`);
  }
  assert.ok(held, 'a wall taller than it could climb in time held it back');
  assert.ok(flight.position.x > 60 && flight.position.y >= 60, `over the top: ${flight.position.toArray()}`);
});

test('it keeps within the bounds it is given', () => {
  const flight = new WingFlight();
  flight.reset(new THREE.Vector3(0, 20, 0), 0);
  run(flight, 10, { z: 1, surge: true }, { bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 } });
  assert.equal(flight.position.z, 50);
});

test('the surface below is the tallest roof under the wings, never a post or an invisible wall', () => {
  const colliders = [
    { x: 10, z: 0, w: 4, d: 4, top: 30 },
    { x: 0, z: 6, r: .3, top: 40, slender: true },
    { x: -6, z: 0, w: 1, d: 40, top: 50, noCamera: true },
    { x: 0, z: -5, r: .4 },
  ];
  const collision = { query: (minX, minZ, maxX, maxZ) => colliders.filter(c => c.x + (c.r ?? c.w / 2) >= minX && c.x - (c.r ?? c.w / 2) <= maxX && c.z + (c.r ?? c.d / 2) >= minZ && c.z - (c.r ?? c.d / 2) <= maxZ) };
  const world = { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, getHeight: () => .5 };
  const below = surfaceBelow({ world, collision, waterline: -6 });
  assert.equal(below(0, 0, 5), 4, 'someone standing about counts as about a person tall');
  assert.equal(below(0, 0, 9), 30, 'the roof eight units off is under the wings, and the taller post and wall are not');
  assert.equal(below(0, 20, 4), .5);
  assert.equal(below(300, 0), -6, 'off the map there is only the water');
  assert.deepEqual(skyOver(world.bounds, 10), { minX: -110, maxX: 110, minZ: -110, maxZ: 110 });
});

function ray() {
  const model = new THREE.Group(), bone = new THREE.Bone();
  bone.position.set(0, 6, -10); model.add(bone);
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(new THREE.AnimationClip('Swim', 1, []));
  const seat = { x: 0, y: 8, z: -12 };
  const tidewarden = createTidewarden({
    model, action, seat, carrier: bone, water: { x: -100, z: 0, radius: 20, period: 40 }, waterline: -5,
    berth: { x: -40, z: 0, heading: Math.PI, call: { x: -30, z: 0 } }, bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 },
    floor: (x, z) => x > -45 ? 1 : -5,
  });
  const holder = new THREE.Group(); holder.add(tidewarden.rig);
  return { tidewarden, mixer };
}
function play(tidewarden, seconds, options = {}, from = 0) {
  let time = from;
  for (; time < from + seconds; time += 1 / 60) tidewarden.update(1 / 60, time, options);
  return time;
}

test('the Tidewarden circles until called, comes to the berth, and carries its rider from the seat', () => {
  const { tidewarden } = ray();
  assert.equal(tidewarden.mode, 'circling');
  let time = play(tidewarden, 3);
  const circled = tidewarden.position.clone();
  assert.ok(Math.abs(Math.hypot(circled.x + 100, circled.z) - 20) < 1e-6, 'it keeps to its circle');
  assert.ok(Math.abs(circled.y - (-5 + 8)) < 1e-6, 'its seat stands above the water by the seat height');
  // It swims head first round the circle.
  const ahead = new THREE.Vector3(Math.sin(tidewarden.heading), 0, Math.cos(tidewarden.heading));
  const along = new THREE.Vector3(-(circled.z), 0, circled.x + 100).normalize();
  assert.ok(ahead.dot(along) > .95, `faces along the circle: ${ahead.dot(along)}`);

  assert.equal(tidewarden.ride(), false, 'nobody can climb on out on the water');
  assert.equal(tidewarden.call(), true);
  assert.equal(tidewarden.mode, 'summoned');
  time = play(tidewarden, 12, { player: { x: -30, z: 0 } }, time);
  assert.equal(tidewarden.mode, 'waiting');
  // Over the quay the seat clears the ground by the seat height and its clearance.
  assert.deepEqual(tidewarden.berth, { x: -40, y: 1 + 8 + FLIGHT.clearance, z: 0, heading: Math.PI, call: { x: -30, z: 0 } });
  assert.ok(tidewarden.position.distanceTo(new THREE.Vector3(-40, tidewarden.berth.y, 0)) < .4);
  // The seat is carried by the bone, and sits at the rig's origin.
  const seat = tidewarden.saddle.getWorldPosition(new THREE.Vector3());
  assert.ok(seat.distanceTo(tidewarden.rig.position) < 1e-6, `seat ${seat.toArray()} at ${tidewarden.rig.position.toArray()}`);

  assert.equal(tidewarden.ride(), true);
  for (let t = 0; t < 2; t += 1 / 60) { tidewarden.fly(1 / 60, { x: 0, z: 1, rise: true }); tidewarden.update(1 / 60, time += 1 / 60); }
  assert.equal(tidewarden.mode, 'ridden');
  assert.ok(tidewarden.position.y > tidewarden.berth.y + 10, 'it climbs under its rider');
  assert.ok(tidewarden.rig.position.equals(tidewarden.position));
  assert.ok(tidewarden.saddle.getWorldPosition(new THREE.Vector3()).distanceTo(tidewarden.position) < 1e-6, 'the rider stays in the seat in flight');
});

test('asked to land, it comes in over the ground, and once its rider is off it swims home', () => {
  const { tidewarden } = ray();
  let time = play(tidewarden, 1);
  tidewarden.call(); time = play(tidewarden, 12, { player: { x: -30, z: 0 } }, time);
  tidewarden.ride();
  for (let t = 0; t < 3; t += 1 / 60) tidewarden.fly(1 / 60, { x: 1, z: 0, rise: true });
  assert.equal(tidewarden.land({ x: 10, y: 1, z: 30 }), true);
  assert.equal(tidewarden.mode, 'landing');
  time = play(tidewarden, 20, {}, time);
  assert.equal(tidewarden.mode, 'landed');
  assert.deepEqual(tidewarden.spot, { x: 10, y: 1, z: 30, hover: tidewarden.spot.hover });
  assert.ok(Math.hypot(tidewarden.position.x - 10, tidewarden.position.z - 30) < .1);
  assert.ok(Math.abs(tidewarden.position.y - (1 + 8 + 1.2)) < .5, `hangs just over it: ${tidewarden.position.y}`);
  assert.equal(tidewarden.release(), true);
  assert.equal(tidewarden.mode, 'returning');
  assert.equal(tidewarden.spot, null);
  play(tidewarden, 30, {}, time);
  assert.equal(tidewarden.mode, 'circling');
  assert.ok(Math.abs(Math.hypot(tidewarden.position.x + 100, tidewarden.position.z) - 20) < .5, 'back on its circle');
});

test('left waiting at an empty quay, it goes home by itself', () => {
  const { tidewarden } = ray();
  tidewarden.call();
  let time = play(tidewarden, 12, { player: { x: -30, z: 0 } });
  assert.equal(tidewarden.mode, 'waiting');
  time = play(tidewarden, 8, { player: { x: 60, z: 0 } }, time);
  assert.equal(tidewarden.mode, 'waiting', 'it gives the rider a while');
  play(tidewarden, 4, { player: { x: 60, z: 0 } }, time);
  assert.equal(tidewarden.mode, 'returning');
});

test('a camera inside its body or wings sees through it, and not along its tail', () => {
  const model = new THREE.Group(), bone = new THREE.Bone(); model.add(bone);
  // A body 20 wide and 10 tall from its belly, 30 long, its head toward -z.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 30)); hull.position.set(0, 5, 0); model.add(hull);
  const action = new THREE.AnimationMixer(model).clipAction(new THREE.AnimationClip('Swim', 1, []));
  const shown = [];
  const tidewarden = createTidewarden({
    model, action, seat: { x: 0, y: 8, z: -10 }, carrier: bone, water: { x: 0, z: 0, radius: 20, period: 40 }, waterline: -5,
    berth: { x: 40, z: 0, heading: 0, call: { x: 50, z: 0 } }, bounds: skyOver({ minX: -100, maxX: 100, minZ: -100, maxZ: 100 }),
    floor: () => -5, fade: k => shown.push(k),
  });
  tidewarden.update(1 / 60, 0);
  const seat = tidewarden.position.clone(), ahead = new THREE.Vector3(Math.sin(tidewarden.heading), 0, Math.cos(tidewarden.heading));
  for (let i = 0; i < 30; i++) tidewarden.see(seat.clone().add(new THREE.Vector3(0, 1, 0)), 1 / 60);
  assert.ok(shown.at(-1) < .25, `faded inside: ${shown.at(-1)}`);
  for (let i = 0; i < 120; i++) tidewarden.see(seat.clone().addScaledVector(ahead, -20).setY(seat.y + 1), 1 / 60);
  assert.equal(shown.at(-1), 1, 'solid again from above its tail');
  const calls = shown.length;
  tidewarden.see(seat.clone().addScaledVector(ahead, 40), 1 / 60);
  assert.equal(shown.length, calls, 'left alone while it is solid');
});
