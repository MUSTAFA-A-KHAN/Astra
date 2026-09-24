import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LocomotionController, SpatialHash } from '../physics.js';
import { createChapterTwo } from '../chapter-two-world.js';
import { CHALLENGE_RULES, readChapterTwo, RUNE_ORDER, BELL_ORDER } from '../chapter-two-script.js';

function fixture(flags = {}, options = {}) {
  const state = Object.assign(readChapterTwo({}), flags);
  const world = {
    getHeight: () => 0,
    getNormal: (x, z, out) => Object.assign(out, { x: 0, y: 1, z: 0 }),
    isWalkable: () => true,
    findWalkable: (x, z) => ({ x, y: 0, z }),
    biomeAt: (x, z) => x < -80 ? 'forest' : z > 100 ? 'yard' : x > 220 ? 'plaza' : 'city',
  };
  const collision = new SpatialHash();
  const changes = [], messages = [], damage = [];
  let unlocked = options.unlocked ?? true, time = 0, health = options.health ?? Infinity;
  const position = new THREE.Vector3();
  const chapter = createChapterTwo({
    world, collision, state,
    storyPlaces: { tobin: { x: -45, y: 0, z: -5 }, maren: { x: 0, y: 0, z: -50 } },
    isUnlocked: () => unlocked,
    onChange: entry => changes.push(entry),
    onMessage: message => messages.push(message),
    onDamage: amount => {
      damage.push(amount);
      health -= amount;
      if (health <= 0) chapter.resetChallenge();
    },
  });
  const move = (id, offset = {}) => {
    const destination = typeof id === 'string' ? chapter.places[id] : id;
    position.set(destination.x + (offset.x ?? 0), destination.y + (offset.y ?? 0), destination.z + (offset.z ?? 0));
    return chapter.nearby(position);
  };
  const use = id => {
    const action = move(id);
    assert.equal(action?.id, id, `${id} is interactable at its actual position`);
    return chapter.interact(action);
  };
  const tick = (seconds, active = true) => {
    for (let remaining = seconds; remaining > 1e-9; remaining -= .025) {
      const dt = Math.min(.025, remaining);
      time += dt;
      chapter.update(dt, time, position, { active });
    }
  };
  const attack = (overrides = {}) => chapter.attack({ position, range: 12, damage: 70, special: true, ...overrides });
  return { chapter, state, world, collision, changes, messages, damage, position, move, use, tick, attack, unlock: () => { unlocked = true; } };
}

const throughValves = { accepted: true, roots: true, bells: true, valves: true };
const throughVigil = { ...throughValves, vigil: true };

test('basic attacks respect the shared target selection while special attacks reach the wave', () => {
  const f = fixture(throughValves); f.use('beacon');
  const [first, second] = f.chapter.combatants;
  assert.equal(f.attack({special:false,target:null}).hits,0,'aiming away must not hit another enemy');
  assert.equal(f.attack({special:false,target:{}}).hits,0,'attacking a city ghost must not also hit a trial echo');
  assert.equal(f.attack({special:false,target:second,damage:10}).hits,1);
  assert.equal(first.hp,140);assert.equal(second.hp,130);
  assert.equal(f.attack({special:true,target:null,damage:10}).hits,2);
});

test('chapter interactions require unlock, the current mission, proximity and clear sight', () => {
  const f = fixture({}, { unlocked: false });
  assert.equal(f.move('chart'), null);
  assert.equal(f.chapter.interact({ id: 'chart' }), null);
  assert.equal(f.state.accepted, false);
  f.unlock();
  assert.deepEqual(f.use('chart'), { person: 'chart' });
  assert.equal(f.state.accepted, false, 'acceptance waits for the chart conversation to finish');
  f.state.accepted = true;
  for (const id of ['dusk', 'valve1', 'beacon', 'warden', 'seal']) {
    f.move(id);
    assert.equal(f.chapter.interact({ id }), null, `${id} cannot be used before its mission`);
  }
  const action = f.move('root');
  f.move('root', { x: 8 });
  f.chapter.interact(action);
  assert.equal(f.chapter.diagnostics.runeIndex, 0, 'an old prompt cannot be used after moving away');
  const root = f.chapter.places.root;
  f.collision.insert('wall', { x: root.x + 1, z: root.z, w: .2, d: 4, bottom: 0, top: 4 });
  assert.equal(f.move('root', { x: 2 }), null);
  f.chapter.interact({ id: 'root' });
  assert.equal(f.chapter.diagnostics.runeIndex, 0, 'a nearby rune cannot be reached through a wall');
  assert.equal(f.changes.length, 0);
});

test('wrong runes and bells reset only the current attempt and complete sequences award once', () => {
  const f = fixture({ accepted: true });
  f.use('root'); f.use('moon');
  assert.equal(f.chapter.diagnostics.runeIndex, 0);
  assert.equal(f.state.roots, false);
  for (const id of RUNE_ORDER) f.use(id);
  assert.equal(f.state.roots, true);
  f.move('moon'); f.chapter.interact({ id: 'moon' });
  assert.deepEqual(f.changes, [{ flag: 'roots', reward: 100 }]);
  f.use('dusk'); f.use('dawn');
  assert.equal(f.chapter.diagnostics.bellIndex, 0);
  assert.equal(f.state.bells, false);
  assert.equal(f.state.roots, true, 'a later mistake never discards the earlier lock');
  for (const id of BELL_ORDER) f.use(id);
  assert.equal(f.state.bells, true);
  assert.deepEqual(f.changes.map(change => change.flag), ['roots', 'bells']);
});

test('valves time from first closure, pause safely, reopen on expiry and retry in any order', () => {
  const f = fixture({ accepted: true, roots: true, bells: true });
  assert.deepEqual(f.use('valvePanel'), { person: 'valvePanel' });
  f.tick(60);
  assert.equal(f.chapter.diagnostics.valveTime, 0, 'reading the panel does not start the timer');
  f.use('valve2');
  assert.equal(f.chapter.diagnostics.valveTime, CHALLENGE_RULES.valveSeconds);
  f.tick(12);
  const remaining = f.chapter.diagnostics.valveTime;
  f.tick(90, false);
  assert.equal(f.chapter.diagnostics.valveTime, remaining, 'paused gameplay spends no trial time');
  f.chapter.interact({ id: 'valve2' });
  assert.deepEqual(f.chapter.diagnostics.valves, ['valve2'], 'a closed valve cannot count twice');
  f.use('valve1');
  f.tick(34);
  assert.equal(f.chapter.diagnostics.valveTime, 0);
  assert.deepEqual(f.chapter.diagnostics.valves, []);
  assert.equal(f.state.valves, false);
  assert.equal(f.state.bells, true);
  for (const id of ['valve3', 'valve1', 'valve2']) f.use(id);
  assert.equal(f.state.valves, true);
  assert.equal(f.chapter.diagnostics.valveTime, 0);
  assert.deepEqual(f.changes, [{ flag: 'valves', reward: 120 }]);
});

test('the beacon requires defeating every enemy in all three escalating waves', () => {
  const f = fixture(throughValves);
  f.use('beacon');
  for (const count of CHALLENGE_RULES.waveCounts) {
    assert.equal(f.chapter.combatants.filter(enemy => enemy.alive).length, count);
    const result = f.attack();
    assert.equal(result.hits, count);
    assert.equal(result.kills, 0, 'a hit alone does not complete a wave');
    f.tick(.5);
    assert.equal(f.state.vigil, false);
    assert.equal(f.chapter.combatants.filter(enemy => enemy.alive).length, count);
    const killed = f.attack({ damage: 200 });
    assert.equal(killed.kills, count);
    f.tick(2.1);
  }
  assert.equal(f.state.vigil, true);
  assert.equal(f.chapter.diagnostics.arena, null);
  assert.equal(f.chapter.combatants.length, 0);
  assert.deepEqual(f.changes, [{ flag: 'vigil', reward: 180 }]);
});

test('leaving the beacon grounds resets its waves while preserving completed locks', () => {
  const f = fixture(throughValves);
  f.use('beacon');
  f.attack({ damage: 200 }); f.tick(2.1);
  assert.equal(f.chapter.diagnostics.wave, 2);
  const previousCombatants = [...f.chapter.combatants];
  f.move('beacon', { x: 43 }); f.tick(.025);
  assert.equal(f.chapter.diagnostics.arena, null);
  assert.ok(previousCombatants.every(enemy => !enemy.alive), 'removed enemies cannot remain camera lock targets');
  assert.equal(f.state.vigil, false);
  for (const flag of Object.keys(throughValves)) assert.equal(f.state[flag], true);
  f.use('beacon');
  assert.equal(f.chapter.diagnostics.wave, 1);
  assert.equal(f.chapter.combatants.length, CHALLENGE_RULES.waveCounts[0]);
  assert.equal(f.changes.length, 0);
});

test('a navigation fallback cannot strand a required echo outside the beacon arena', () => {
  const f = fixture(throughValves);
  const beacon = f.chapter.places.beacon;
  f.world.findWalkable = () => ({ x: beacon.x + 100, y: beacon.y, z: beacon.z });
  f.use('beacon');
  for (const count of CHALLENGE_RULES.waveCounts) {
    const living = f.chapter.combatants.filter(enemy => enemy.alive);
    assert.equal(living.length, count);
    assert.ok(living.every(enemy => enemy.group.position.distanceTo(f.position) < 18));
    assert.equal(f.attack({ damage: 200 }).kills, count, 'fallback spawns remain reachable by the player');
    f.tick(2.1);
  }
  assert.equal(f.state.vigil, true);
});

test('the Hollow Warden blocks attacks until its pulse and awards victory only on defeat', () => {
  const f = fixture(throughVigil);
  f.use('warden');
  assert.deepEqual(f.attack({ damage: 999 }), { hits: 0, kills: 0, bossShielded: true });
  assert.equal(f.chapter.combatants[0].hp, CHALLENGE_RULES.bossHP);
  f.tick(15, false);
  assert.equal(f.chapter.diagnostics.bossTime, 0, 'the boss clock pauses with gameplay');
  assert.equal(f.damage.length, 0);
  f.tick(3.45);
  assert.deepEqual(f.damage, [32], 'the pulse damages a grounded player inside its circle');
  assert.equal(f.attack({ damage: 150 }).hits, 1);
  assert.equal(f.chapter.combatants[0].hp, CHALLENGE_RULES.bossHP - 150);
  assert.equal(f.state.warden, false);
  f.tick(1);
  assert.deepEqual(f.damage, [32], 'one pulse does not hit on every vulnerable frame');
  assert.equal(f.attack({ damage: 500 }).kills, 1);
  assert.equal(f.state.warden, true);
  assert.equal(f.state.complete, false, 'the player must still return the voice to the Moonwell');
  assert.equal(f.chapter.diagnostics.arena, null);
  f.attack({ damage: 999 });
  assert.deepEqual(f.changes, [{ flag: 'warden', reward: 250 }]);
});

test('the pulse can be escaped by distance or a timed jump and the shield returns next cycle', () => {
  for (const offset of [{ x: 11 }, { y: 2.3 }]) {
    const f = fixture(throughVigil);
    f.use('warden');
    f.move('warden', offset);
    f.tick(3.45);
    assert.deepEqual(f.damage, [], `safe position ${JSON.stringify(offset)} escapes the pulse`);
    assert.equal(f.attack().hits, 1, 'the shield opens after the pulse');
    f.tick(3.6);
    assert.equal(f.attack().bossShielded, true, 'the shield closes for the next telegraph');
    assert.equal(f.state.warden, false);
  }
});

test('player defeat resets an unfinished arena without erasing completed missions', () => {
  const f = fixture(throughVigil, { health: 32 });
  f.use('warden');
  assert.doesNotThrow(() => f.tick(3.45), 'the damage callback may synchronously clear the arena');
  assert.equal(f.chapter.diagnostics.arena, null);
  assert.equal(f.chapter.combatants.length, 0);
  assert.equal(f.state.warden, false);
  for (const flag of Object.keys(throughVigil)) assert.equal(f.state[flag], true);
  f.use('warden');
  assert.equal(f.chapter.combatants[0].hp, CHALLENGE_RULES.bossHP);
  assert.equal(f.chapter.diagnostics.bossTime, 0);
  assert.equal(f.changes.length, 0);
});

test('a correctly timed jump with the actual locomotion physics clears the boss pulse', () => {
  const f = fixture(throughVigil);
  f.use('warden');
  f.tick(3.1);
  const locomotion = new LocomotionController(f.position, new THREE.Vector3(), f.world, f.collision);
  locomotion.requestJump();
  for (let frame = 0; frame < 48; frame++) {
    locomotion.update(1 / 120);
    f.tick(1 / 120);
  }
  assert.ok(f.position.y > 1 && f.position.y < 2.2, 'the ordinary jump rises around 1.5 metres');
  assert.deepEqual(f.damage, [], 'jumping at the end of the telegraph avoids the pulse');
});
