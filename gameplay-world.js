import * as THREE from 'three';
import { createHero } from './characters.js';

// A few authored interactions, rather than a costly rigid body for every city prop.
export async function createGameplayWorld(scene, world, collision) {
  // Use the same fitted, in-place animation rig as the imported adventurers.
  // Finish loading before interactions are enabled so the mount is always visible.
  const horseModel = await createHero('Horse');
  const root = new THREE.Group(); root.name = 'City activities'; scene.add(root);
  const wood = new THREE.MeshStandardMaterial({ color: '#71503b', roughness: .95 });
  const iron = new THREE.MeshStandardMaterial({ color: '#343d42', metalness: .65, roughness: .5 });
  const stone = new THREE.MeshStandardMaterial({ color: '#899787', roughness: .95 });
  const gold = new THREE.MeshStandardMaterial({ color: '#bd975e', roughness: .8 });
  function box(parent, size, xyz, material = wood) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...xyz); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const stations = [{ id: 'arrival', x: world.spawn.x, z: world.spawn.z, r: 2 }];
  const colliderIds = [];
  const addCollider = (id, shape) => { colliderIds.push(id); collision.insert(id, shape); };
  // Navigation only knows the imported city. Reserve new footprints separately so
  // several requests snapping to the same clear street cannot overlap each other.
  function reserveSpot(id, x, z, radius = 2) {
    const free = p => stations.every(other => Math.hypot(p.x - other.x, p.z - other.z) >= radius + other.r + .65);
    let found = world.findWalkable(x, z, radius);
    if (!free(found)) {
      found = null;
      for (let ring = 1; ring <= 24 && !found; ring++) {
        const distance = ring * 3, count = Math.max(12, Math.ceil(distance * 1.7));
        for (let i = 0; i < count; i++) {
          const px = x + Math.cos(i / count * Math.PI * 2) * distance;
          const pz = z + Math.sin(i / count * Math.PI * 2) * distance;
          if (!free({ x: px, z: pz })) continue;
          if (world.isWalkable && !world.isWalkable(px, pz, radius)) continue;
          const candidate = world.findWalkable(px, pz, radius);
          if (free(candidate)) { found = candidate; break; }
        }
      }
    }
    if (!found) throw new Error(`No clear location for city activity: ${id}`);
    stations.push({ id, x: found.x, z: found.z, r: radius });
    return found;
  }
  const spot = (id, dx, dz, radius = 2) => reserveSpot(id, world.spawn.x + dx, world.spawn.z + dz, radius);
  const at = point => { const group = new THREE.Group(); group.position.set(point.x, point.y, point.z); root.add(group); return group; };

  const camp = world.landmarks.find(l => l.id === 'camp');
  const firePoint = reserveSpot('campfire', camp.x, camp.z, .8);
  const lookout = spot('lookout', 9, 9, 3.5), platform = at(lookout), deckHeight = 4.2;
  platform.name = 'Ladder lookout';
  box(platform, [4, .24, 3.4], [0, deckHeight - .12, 0]);
  for (const x of [-1.8, 1.8]) for (const z of [-1.5, 1.5]) {
    box(platform, [.2, deckHeight, .2], [x, deckHeight / 2, z]);
    addCollider(`lookout-${x}-${z}`, { x: lookout.x + x, z: lookout.z + z, w: .2, d: .2, bottom: lookout.y, top: lookout.y + deckHeight });
  }
  for (const x of [-.55, .55]) box(platform, [.12, deckHeight + .25, .12], [x, deckHeight / 2, 1.9]);
  for (let y = .3; y < deckHeight; y += .42) box(platform, [1.2, .09, .12], [0, y, 1.9], gold);
  box(platform, [4, .12, .12], [0, deckHeight + 1, -1.6]);
  const climbable = { id: 'lookout', x: lookout.x, z: lookout.z + 2.1, bottom: lookout.y, top: lookout.y + deckHeight, r: 1.8, exit: { x: lookout.x, z: lookout.z + .9 } };
  addCollider('lookout-deck', { x: lookout.x, z: lookout.z, w: 4, d: 3.4, bottom: lookout.y + deckHeight - .24, top: lookout.y + deckHeight, walkable: true });

  const pool = spot('wading-pool', -12, 9, 3.7), basin = at(pool);
  basin.name = 'Moonwell wading pool';
  const waterMaterial = new THREE.MeshStandardMaterial({ color: '#52b9c4', transparent: true, opacity: .62, metalness: .15, roughness: .2, depthWrite: false });
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.8, 40), waterMaterial);
  water.rotation.x = -Math.PI / 2; water.position.y = .72; basin.add(water);
  // Basin walls hold the raised water, with a broad ramp through the near side.
  for (let i = 0; i < 40; i++) {
    const angle = (i + .5) / 40 * Math.PI * 2;
    if (Math.cos(angle) > .91) continue;
    const x = Math.sin(angle) * 2.95, z = Math.cos(angle) * 2.95;
    const wall = box(basin, [.47, .84, .24], [x, .42, z], stone); wall.rotation.y = angle;
    addCollider(`basin-wall-${i}`, { x: pool.x + x, z: pool.z + z, r: .24, bottom: pool.y, top: pool.y + .84 });
  }
  const rampGeometry = new THREE.BufferGeometry();
  rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.95,0,2, .95,0,2, -.95,.82,2.8, .95,.82,2.8, -.95,0,3.6, .95,0,3.6,
  ], 3));
  rampGeometry.setIndex([0,2,1,1,2,3,2,4,3,3,4,5,0,4,2,1,3,5,0,1,4,1,5,4]);rampGeometry.computeVertexNormals();
  const ramp = new THREE.Mesh(rampGeometry, stone);ramp.receiveShadow = ramp.castShadow = true;basin.add(ramp);
  const waterZones = [{ id: 'moonwell-pool', x: pool.x, z: pool.z, r: 2.8, surface: pool.y + .72 }];

  const horsePoint = spot('horse', 3.5, 1.5, 2), horse = at(horsePoint); horse.name = 'Trail horse';
  horse.add(horseModel.group);
  const mount = { group: horse, position: horse.position, mounted: false, seatHeight: 2.35 };

  const crates = [];
  for (let i = 0; i < 2; i++) {
    const p = spot(`crate-${i}`, -3.5 - i * 2.8, -3, 1);
    const group = at(p); group.name = 'Pushable supply crate';
    box(group, [1.15, 1.15, 1.15], [0, .58, 0]);
    for (const z of [-.59, .59]) box(group, [1.2, .12, .08], [0, .6, z], gold);
    crates.push({ id: `supply-${i}`, group, position: group.position, radius: .7, height: 1.2, mass: 2 });
  }
  const market = at(reserveSpot('market', camp.x + 5, camp.z, 2.1)); market.name = 'Camp market';
  box(market, [3, .18, 1.4], [0, 1.3, 0]);
  for (const x of [-1.4, 1.4]) box(market, [.12, 2.9, .12], [x, 1.45, 0]);
  box(market, [3.4, .16, 2.1], [0, 2.9, 0], new THREE.MeshStandardMaterial({ color: '#5f8677' }));
  addCollider('market-stall', { x: market.position.x, z: market.position.z, w: 3, d: 1.4, bottom: market.position.y, top: market.position.y + 3 });
  const forge = at(reserveSpot('smithy', camp.x - 4, camp.z, 1.6)); forge.name = 'Camp smithy';
  box(forge, [1.5, .55, 1], [0, .4, 0], stone); box(forge, [1.8, .25, .7], [0, 1, 0], iron);
  addCollider('smithy-anvil', { x: forge.position.x, z: forge.position.z, w: 1.8, d: 1, bottom: forge.position.y, top: forge.position.y + 1.125 });
  const fire = at(firePoint);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(.5, 1.2, 7), new THREE.MeshBasicMaterial({ color: '#ffb254', transparent: true, opacity: .85 }));
  flame.position.y = .7; fire.add(flame);
  box(fire, [1.25, .2, .2], [0, .1, 0]); box(fire, [.2, .2, 1.25], [0, .1, 0]);
  const light = new THREE.PointLight('#ffa34f', 5, 10); light.position.y = 1.3; fire.add(light);
  const sources = [
    { type: 'market', position: market.position, strength: .6 },
    { type: 'blacksmith', position: forge.position, strength: .6 },
    { type: 'fire', position: fire.position, strength: .5 },
    { type: 'water', position: basin.position, strength: .7 },
    { type: 'animals', position: horse.position, strength: .45 },
  ];
  const onDeck = (x, z) => Math.abs(x - lookout.x) < 2 && Math.abs(z - lookout.z) < 1.7;
  const onRamp = (x, z) => Math.abs(x - pool.x) <= .95 && z - pool.z >= 2 && z - pool.z <= 3.6;
  const rampHeight = z => pool.y + .82 * (1 - Math.abs(z - pool.z - 2.8) / .8);
  const terrain = {
    getHeight: (x, z) => world.getHeight(x, z),
    stepHeightAt: (x, z) => world.stepHeightAt?.(x, z),
    getNormal(x, z, out, feetY) {
      if (!onRamp(x, z)) return world.getNormal(x, z, out, feetY);
      out.x = 0;out.y = 1;out.z = (z - pool.z < 2.8 ? -1 : 1) * .82 / .8;
      const length = Math.hypot(out.y, out.z);out.y /= length;out.z /= length;return out;
    },
    getSupportHeight(x, z, feetY, stepHeight) {
      const support = world.getSupportHeight?.(x, z, feetY, stepHeight) ?? world.getHeight(x, z);
      if (onDeck(x, z) && feetY >= climbable.top - .35) return climbable.top;
      return onRamp(x, z) ? Math.max(support, rampHeight(z)) : support;
    },
  };
  return {
    root, terrain, waterZones, climbables: [climbable], crates, mount, sources, stations,
    update(dt, time, speed = 0) {
      flame.scale.setScalar(.93 + Math.sin(time * 13) * .07); light.intensity = 4 + Math.sin(time * 11);
      water.material.opacity = .6 + Math.sin(time * .7) * .04;
      const ridingSpeed = mount.mounted ? speed : 0;
      horseModel.animate(dt, { speed: ridingSpeed, moving: ridingSpeed > .1, time });
    },
    getStats() { return { mounted: mount.mounted, mount: { x: horse.position.x, y: horse.position.y, z: horse.position.z, model: horseModel.meta.model, height: horseModel.height, seatHeight: mount.seatHeight, animation: horseModel.diagnostics }, stations, climbables: [climbable], waterZones, crates: crates.map(c => ({ id: c.id, x: c.position.x, y: c.position.y, z: c.position.z })) }; },
    dispose() {
      horseModel.dispose();
      const geometries = new Set(), materials = new Set();
      for (const id of colliderIds) collision.remove(id);
      root.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
      for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); root.removeFromParent();
    },
  };
}
