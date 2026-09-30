import * as THREE from 'three';
import {
  MEMORY_IDS, MEMORY_FLAGS, LENS_FACES, LENS_TARGET, RELAY_LAMPS, RELAY_SECONDS, RECORD_FLAGS,
  chapterThreeStep, chapterThreeConversation, turnLens, lensesAligned,
} from './chapter-three-script.js';
import { OBSERVATORY_SITES } from './observatory-world.js';
import { createUnwritten } from './chapter-three-combat.js';

// The restored stones and bells gain new work after the meridian is whole.
// Reusing their grounded sites keeps the portal footprint and map streaming intact.
export function createChapterThree({ world, collision, state, sites, isUnlocked, onChange, onMessage, onDamage }) {
  const root = new THREE.Group(); root.name = 'The Shared Flame'; root.visible = false;
  const player = new THREE.Vector3(), props = [];
  const ownPlaces = {};
  let faces = [0, 0, 0], remaining = 0, lamps = new Set(), built = false;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const step = () => chapterThreeStep(state);
  const sameMap = () => !world.activeMap || world.activeMap === step().map;
  const anchors = { sharedSeal: 'seal', lensTablet: 'rootTablet', relayLedger: 'valvePanel', flame: 'beacon',
    memoryRoot: 'root', memoryRain: 'rain', memoryMoon: 'moon', lensRoot: 'root', lensRain: 'rain', lensMoon: 'moon',
    lampDusk: 'dusk', lampTide: 'tide', lampDawn: 'dawn' };
  const lensIds = ['lensRoot', 'lensRain', 'lensMoon'];
  const lampIds = ['lampDusk', 'lampTide', 'lampDawn'];
  const places = () => ({ ...Object.fromEntries(Object.entries(anchors).filter(([, site]) => sites[site]).map(([id, site]) => [id, sites[site]])), ...ownPlaces });
  const combat = createUnwritten({ root, world, collision, onDamage, onMessage,
    onVictory: () => { checkpoint('boss', 450); onMessage('The Unwritten is broken. The lost shore remembers its name. Carry the flame home.'); } });

  function candidates() {
    if (!isUnlocked() || !sameMap()) return [];
    switch (step().id) {
      case 'summons': return [['sharedSeal', 'Hear the Tidewarden’s promise']];
      case 'memories': return MEMORY_FLAGS.filter(flag => !state[flag]).map(flag => [flag, 'Listen to the keeper’s memory']);
      case 'lenses': return [['lensTablet', 'Read the linked-lens inscription'], ...lensIds.map((id, i) => [id, `Turn ${MEMORY_IDS[i]} lens · ${LENS_FACES[faces[i]]} → ${LENS_FACES[(faces[i] + 1) % 3]}`])];
      case 'relay': return [['relayLedger', 'Read the lamplighter’s ledger'], ['flame', remaining ? 'Return the shared flame' : 'Take the flame · 90-second relay'],
        ...(remaining ? lampIds.filter((id, i) => !lamps.has(RELAY_LAMPS[i])).map(id => [id, 'Light the ' + anchors[id] + ' lamp']) : [])];
      case 'threshold': return [['ilyra', 'Speak to Ilyra']];
      case 'records': return RECORD_FLAGS.filter(flag => !state[flag]).map(flag => [flag, 'Read the ' + flag.slice(6).toLowerCase() + ' memorial']);
      case 'witness': return [['oren', 'Speak to Oren']];
      case 'boss': return combat.active ? [] : [['unwritten', 'Challenge the Unwritten']];
      case 'homecoming': return [['sharedSeal', 'Share the flame with the Reach']];
      default: return [];
    }
  }
  function targets() {
    const points = places();
    return candidates().filter(([id]) => points[id]).map(([id, label]) => ({ ...points[id], id, label, type: 'chapterThree' }));
  }
  function nearby(position) {
    player.copy(position);
    return targets().filter(p => distance(position, p) < 4.8 && Math.abs(position.y - p.y) < 3 &&
      (p.id === 'sharedSeal' || collision.cameraFraction(new THREE.Vector3(position.x, position.y + 1.8, position.z), new THREE.Vector3(p.x, p.y + 1.8, p.z), .1) > .98))
      .sort((a, b) => distance(position, a) - distance(position, b))[0] || null;
  }
  function checkpoint(flag, reward) {
    if (state[flag]) return;
    state[flag] = true; onChange({ flag, reward });
  }
  function hear(person, flag) {
    // Revalidate after the conversation: stale callbacks cannot award a later mission.
    if (flag && isUnlocked() && sameMap() && chapterThreeConversation(person, state)?.sets === flag) {
      checkpoint(flag, flag === 'complete' ? 300 : flag === 'accepted' ? 50 : 35);
    }
  }
  function interact(action) {
    if (!action || nearby(player)?.id !== action.id) return null;
    const lens = lensIds.indexOf(action.id), lamp = lampIds.indexOf(action.id);
    if (lens >= 0) {
      faces = turnLens(faces, lens);
      if (lensesAligned(faces)) { checkpoint('lenses', 160); onMessage('The lenses agree. Carry their shared flame through the islet portal to the yard.'); }
      return { touched: true };
    }
    if (lamp >= 0) {
      lamps.add(RELAY_LAMPS[lamp]);
      onMessage(lamps.size === 3 ? 'All three lamps are lit. Return to the beacon before the flame fades!' : `${lamps.size} / 3 lamps lit. Keep the flame moving.`);
      return { touched: true };
    }
    if (action.id === 'flame') {
      if (!remaining) { remaining = RELAY_SECONDS; lamps.clear(); onMessage('The flame is yours. Light all three lamps, then return here within 90 seconds.'); }
      else if (lamps.size === 3) { resetChallenge(); checkpoint('relay', 200); onMessage('The flame reveals a lost shore. Read the yard portal book to reach the Ashen Observatory.'); }
      else onMessage('Light all three lamps before returning the flame. The clock is still running.');
      return { touched: true };
    }
    if (action.id === 'unwritten') { combat.start(ownPlaces.unwritten); return { touched: true }; }
    return { person: action.id };
  }
  function objective() {
    const list = targets();
    if (step().id === 'lenses') return list.find(p => p.id === 'lensTablet') || null;
    const useful = list.filter(p => p.id !== 'relayLedger' && (step().id !== 'relay' || !remaining || lamps.size === 3 || p.id !== 'flame'));
    return useful.sort((a, b) => distance(player, a) - distance(player, b))[0] || null;
  }
  function resetChallenge() { remaining = 0; lamps.clear(); combat.reset(); }
  function clearProps() {
    for (const prop of props.splice(0)) {
      prop.group.removeFromParent();
      prop.group.traverse(part => { part.geometry?.dispose(); part.material?.dispose(); });
    }
    built = false;
  }
  function syncMap() {
    resetChallenge(); faces = [0, 0, 0]; clearProps();
    for (const id of Object.keys(ownPlaces)) delete ownPlaces[id];
    if (world.activeMap === 'observatory') for (const [id, p] of Object.entries(OBSERVATORY_SITES)) {
      // The memorials stand on plinths; their reading places are in front.
      ownPlaces[id] = world.findWalkable(p.x, p.z + (id.startsWith('record') ? 3 : 0), .85);
    }
  }
  function build() {
    built = true;
    for (const [id, p] of Object.entries(ownPlaces)) {
      const group = new THREE.Group(); group.position.set(p.x, p.y, p.z); group.name = id;
      const color = id === 'oren' ? '#e8b675' : '#aebeff';
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .25, roughness: .8 });
      const add = (geometry, y, scale = 1) => { const mesh = new THREE.Mesh(geometry, material.clone()); mesh.position.y = y; mesh.scale.setScalar(scale); group.add(mesh); return mesh; };
      if (id === 'ilyra' || id === 'oren') {
        add(new THREE.CylinderGeometry(.36, .8, 2.3, 8), 1.15);
        add(new THREE.SphereGeometry(.38, 12, 8), 2.7);
        const hood = add(new THREE.ConeGeometry(.52, .9, 8), 3.05); hood.rotation.z = id === 'oren' ? .2 : -.12;
        for (const side of [-1, 1]) { const arm = add(new THREE.CylinderGeometry(.12, .18, 1.3, 6), 1.8); arm.position.x = side * .5; arm.rotation.z = side * .28; }
        const lantern = add(new THREE.OctahedronGeometry(.22), 1.2); lantern.position.x = .85; lantern.material.emissiveIntensity = 2;
      } else {
        const glyph = add(new THREE.OctahedronGeometry(id === 'unwritten' ? 1.2 : .35), id === 'unwritten' ? 3 : 2.1);
        glyph.material.emissiveIntensity = 1.6;
      }
      material.dispose(); root.add(group); props.push({ group, scenery: true, id });
    }
    for (const site of [...MEMORY_IDS, ...RELAY_LAMPS, 'beacon', 'seal']) {
      const p = sites[site];
      if (!p || (world.activeMap && world.activeMap !== (MEMORY_IDS.includes(site) ? 'forest' : site === 'seal' ? 'mesa' : 'yard'))) continue;
      const group = new THREE.Group(); group.name = `Shared flame · ${site}`; group.position.set(p.x, p.y + (MEMORY_IDS.includes(site) ? 3.1 : site === 'seal' ? .3 : 1.2), p.z);
      const material = new THREE.MeshStandardMaterial({ color: '#ffdda0', emissive: '#ffb653', emissiveIntensity: .7, metalness: .45, roughness: .35 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.75, .07, 6, 24), material); group.add(ring);
      const flame = new THREE.Mesh(new THREE.OctahedronGeometry(.24), new THREE.MeshBasicMaterial({ color: '#fff1b5' })); group.add(flame);
      const pointer = new THREE.Mesh(new THREE.ConeGeometry(.13, .35, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' })); pointer.position.y = .7; ring.add(pointer);
      root.add(group); props.push({ site, group, ring, flame });
    }
  }
  function update(dt, time, position, { active = true } = {}) {
    player.copy(position);
    root.visible = isUnlocked();
    if (!root.visible) return;
    if (!built) build();
    combat.update(dt, time, position, active);
    if (active && remaining > 0) {
      if (world.activeMap && world.activeMap !== 'yard') resetChallenge();
      else {
        remaining = Math.max(0, remaining - dt);
        if (!remaining) { lamps.clear(); onMessage('The flame faded. Take a fresh flame from the beacon and try again.'); }
      }
    }
    for (const prop of props) {
      if (prop.scenery) { if (prop.id === 'unwritten') prop.group.visible = !combat.active && !state.boss; continue; }
      const i = MEMORY_IDS.indexOf(prop.site), done = i >= 0 ? state.lenses : prop.site === 'seal' ? state.complete : state.relay || lamps.has(prop.site);
      prop.ring.rotation.z = i >= 0 ? -(state.lenses ? LENS_TARGET[i] : faces[i]) * Math.PI * 2 / 3 : 0;
      prop.flame.visible = !!done || (i >= 0 && state[MEMORY_FLAGS[i]]) || (prop.site === 'beacon' && remaining > 0);
      prop.flame.rotation.y = time * .6;
      prop.ring.material.emissiveIntensity = done ? 1.8 : .55;
    }
  }
  function status() {
    switch (step().id) {
      case 'memories': return `Memories ${MEMORY_FLAGS.filter(flag => state[flag]).length} / 3 · listen at each stone`;
      case 'lenses': return MEMORY_IDS.map((id, i) => `${id.toUpperCase()}: ${LENS_FACES[faces[i]]}${faces[i] === LENS_TARGET[i] ? ' ✓' : ''}`).join(' · ');
      case 'relay': return remaining ? `Lamps ${lamps.size} / 3 · ${Math.ceil(remaining)}s left${lamps.size === 3 ? ' · RETURN TO THE BEACON' : ''}` : 'Take a flame from the beacon · 90 seconds, including the return';
      case 'records': return `Memorials ${RECORD_FLAGS.filter(flag => state[flag]).length} / 3 · explore the lost shore`;
      case 'boss': return combat.status || 'The star chamber awaits · evade pulses, break guards, strike the exposed heart';
      default: return '';
    }
  }
  syncMap();
  return { root, nearby, interact, hear, objective, update, syncMap, resetChallenge, attack: combat.attack,
    get combatants() { return combat.fighters; },
    get places() { return places(); }, get status() { return status(); }, get mapTargets() { return targets(); },
    get diagnostics() { return { step: step().id, flags: { ...state }, faces: [...faces], remaining, lamps: [...lamps], places: places(), status: status(), combat: combat.diagnostics }; },
  };
}
