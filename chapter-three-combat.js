import * as THREE from 'three';
import { BOSS_HP } from './chapter-three-script.js';

// The Unwritten is an armillary shell around a stolen star. Its guards are
// parts of that shell; breaking them restores the normal pulse/opening cycle.
export function createUnwritten({ root, world, collision, onDamage, onVictory, onMessage }) {
  const fighters = [];
  let centre = null, cycle = 0, phase = 1, pulsed = false;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const visible = (a, b) => collision.cameraFraction(new THREE.Vector3(a.x, a.y + 1.8, a.z), new THREE.Vector3(b.x, b.y + 1.8, b.z), .1) > .98;
  const warning = new THREE.Mesh(new THREE.RingGeometry(.2, 12, 64), new THREE.MeshBasicMaterial({ color: '#ff655b', transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false }));
  warning.rotation.x = -Math.PI / 2; warning.visible = false; root.add(warning);
  const guards = () => fighters.some(f => f.alive && !f.boss);
  const windup = () => phase === 3 ? 2.4 : 3.2;
  const open = () => !!centre && cycle >= windup() && !guards();
  function spawn(at, boss) {
    const group = new THREE.Group(); group.position.set(at.x, at.y, at.z); root.add(group);
    const shell = new THREE.Group(); shell.position.y = boss ? 4.3 : 1.8; group.add(shell);
    const material = new THREE.MeshStandardMaterial({ color: '#9383d9', emissive: '#51408c', emissiveIntensity: 1, metalness: .7, roughness: .3 });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(boss ? 1.35 : .55, 1), material); shell.add(core);
    const rings = [];
    for (let i = 0; i < (boss ? 3 : 1); i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(boss ? 2.6 + i * .35 : .9, boss ? .13 : .07, 6, 40), material.clone());
      ring.rotation.set(i * Math.PI / 3, i * .7, .4); shell.add(ring); rings.push(ring);
    }
    if (boss) for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const shard = new THREE.Mesh(new THREE.ConeGeometry(.65, 3.8, 4), material.clone());
      shard.position.set(Math.cos(a) * 3.7, Math.sin(a) * 2.6, 0); shard.rotation.z = a - Math.PI / 2; shell.add(shard);
    }
    const f = { group, shell, core, rings, material, boss, alive: true, hp: boss ? BOSS_HP : 110, cooldown: 1 };
    fighters.push(f); return f;
  }
  function reset() {
    for (const f of fighters.splice(0)) {
      f.alive = false; f.group.removeFromParent();
      const materials = new Set();
      f.group.traverse(part => { part.geometry?.dispose(); if (part.material) materials.add(part.material); });
      for (const material of materials) material.dispose();
    }
    centre = null; cycle = 0; phase = 1; pulsed = false; warning.visible = false;
  }
  function start(at) {
    reset(); centre = { ...at }; spawn(at, true);
    onMessage('The Unwritten rises. Evade the red pulse, then strike the gold heart.');
  }
  function summon() {
    cycle = 0; pulsed = false;
    for (const side of [-1, 1]) {
      const p = world.findWalkable(centre.x + side * 8, centre.z + 3, .8);
      spawn(p, false);
    }
    onMessage(`The Unwritten · phase ${phase}. Destroy both echo guards to break its shield.`);
  }
  function attack({ position, range, damage, special = false, target = null, lineOfSight = visible }) {
    let hits = 0;
    if (!centre || !Number.isFinite(damage) || damage <= 0) return { hits };
    for (const f of [...fighters]) {
      if (!f.alive || (!special && f !== target) || distance(position, f.group.position) >= range || Math.abs(position.y - f.group.position.y) > 4 || !lineOfSight(position, f.group.position)) continue;
      if (f.boss && !open()) continue;
      hits++;
      // Every phase is played even when a high-level hero deals a huge hit.
      const floor = f.boss ? (phase === 1 ? BOSS_HP * 2 / 3 : phase === 2 ? BOSS_HP / 3 : 0) : 0;
      f.hp = Math.max(floor, f.hp - damage);
      if (f.boss && f.hp === floor && phase < 3) { phase++; summon(); }
      else if (f.hp <= 0) {
        f.alive = false; f.group.visible = false;
        if (f.boss) { reset(); onVictory(); break; }
        if (!guards()) { cycle = 0; pulsed = false; onMessage('The guards fall. Watch the red pulse; the heart will open again.'); }
      }
    }
    return { hits };
  }
  function update(dt, time, position, active) {
    if (!centre) return;
    if (active) {
      if (distance(position, centre) > 38) { reset(); onMessage('The Unwritten retreats. Return to the star chamber to retry; your discoveries are safe.'); return; }
      // Small substeps preserve pulse hits across slow frames without skipping a warning.
      for (let left = dt; left > 0 && centre; left -= .05) {
        const tick = Math.min(left, .05);
        cycle += tick;
        if (cycle >= windup() + 3.4) { cycle = 0; pulsed = false; }
        if (cycle >= windup() && !pulsed) {
          pulsed = true;
          if (distance(position, centre) < 12 && position.y - world.getHeight(position.x, position.z) < 1 && visible(centre, position)) onDamage(phase === 3 ? 36 : 28);
        }
      }
      if (!centre) return; // Damage may have respawned the player.
      for (const f of fighters) if (f.alive && !f.boss) {
        f.cooldown -= dt;
        const at = f.group.position, d = distance(at, position);
        if (d > 2 && visible(at, position)) {
          const x = at.x + (position.x - at.x) / d * 4.2 * dt, z = at.z + (position.z - at.z) / d * 4.2 * dt;
          if (world.isWalkable(x, z, .7)) { at.set(x, world.getHeight(x, z), z); collision.resolve(at, .7, 3); }
        }
        if (d < 3 && Math.abs(position.y - at.y) < 2 && f.cooldown <= 0 && visible(at, position)) { f.cooldown = 1.5; onDamage(14); if (!centre) return; }
      }
    }
    warning.visible = cycle < windup(); warning.position.set(centre.x, centre.y + .08, centre.z); warning.material.opacity = .15 + .3 * cycle / windup();
    for (const f of fighters) {
      f.shell.position.y = (f.boss ? 4.3 : 1.8) + Math.sin(time * 2) * .2;
      f.rings.forEach((ring, i) => { ring.rotation.y = time * (.25 + i * .15); });
      if (f.boss) { f.material.color.set(open() ? '#ffe1a0' : '#9383d9'); f.material.emissive.set(open() ? '#ffbe58' : '#51408c'); }
    }
  }
  return { start, reset, attack, update, get fighters() { return fighters; }, get active() { return !!centre; },
    get status() { return centre ? `The Unwritten ${Math.ceil(fighters[0].hp)} / ${BOSS_HP} · phase ${phase} / 3 · ${guards() ? 'DESTROY THE ECHO GUARDS' : open() ? 'HEART EXPOSED · ATTACK' : 'EVADE THE RED PULSE'}` : ''; },
    get diagnostics() { return { active: !!centre, phase, cycle, open: open(), enemies: fighters.map(f => ({ hp: f.hp, boss: f.boss, alive: f.alive })) }; },
  };
}
