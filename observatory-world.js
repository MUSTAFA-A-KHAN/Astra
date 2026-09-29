import * as THREE from 'three';

export const OBSERVATORY_CENTRE = Object.freeze({ x: 400, z: -320 });
export const OBSERVATORY_ARRIVAL = Object.freeze({ x: 449, z: -303, radius: 1.2 });
export const OBSERVATORY_SITES = Object.freeze({
  ilyra: { x: 431, z: -310 }, oren: { x: 400, z: -273 },
  recordNorth: { x: 400, z: -369 }, recordWest: { x: 351, z: -320 }, recordEast: { x: 442, z: -348 },
  unwritten: OBSERVATORY_CENTRE,
});

// An original, self-contained island: no extra model downloads or settings toggle.
export async function loadObservatoryDistrict() {
  const root = new THREE.Group(); root.name = 'The Ashen Observatory';
  const stone = new THREE.MeshStandardMaterial({ color: '#41445a', roughness: .95 });
  const edge = new THREE.MeshStandardMaterial({ color: '#242738', roughness: 1 });
  const gold = new THREE.MeshStandardMaterial({ color: '#bfa274', metalness: .65, roughness: .4 });
  const pale = new THREE.MeshStandardMaterial({ color: '#92919b', roughness: .93 });
  const glow = new THREE.MeshBasicMaterial({ color: '#8b9edb' });
  const add = (geometry, material, x, y, z, name) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.position.set(x, y, z); mesh.receiveShadow = true; mesh.castShadow = true; root.add(mesh); return mesh;
  };
  const { x, z } = OBSERVATORY_CENTRE;
  const ground = add(new THREE.CircleGeometry(76, 64), stone, x, 3, z, 'observatory-ground'); ground.rotation.x = -Math.PI / 2;
  add(new THREE.CylinderGeometry(76, 56, 18, 32), edge, x, -6.05, z, 'observatory-cliff');
  // The ancient terrace rests on fractured basalt, not an unbroken cylinder.
  for (let i = 0; i < 32; i++) {
    const a = i * Math.PI / 16, radius = 71 + Math.sin(i * 9.1) * 2;
    const rock = add(new THREE.DodecahedronGeometry(1, 0), edge, x + Math.cos(a) * radius, -2.5, z + Math.sin(a) * radius, 'observatory-rock');
    rock.scale.set(7 + i % 3, 8 + i % 5, 7); rock.rotation.set(i * .31, a, .2);
  }
  // Shallow stonework is visual; the continuous terrace remains the ground
  // surface so seams cannot catch the player or change pulse dodge heights.
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), pale, 288);
  tiles.name = 'observatory-mosaic'; const pose = new THREE.Object3D();
  let tile = 0;
  for (const radius of [23, 39, 55, 70]) for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2;
    pose.position.set(x + Math.cos(a) * radius, 3.025, z + Math.sin(a) * radius);
    pose.rotation.set(0, -a, 0); pose.scale.set(1.1, .035, radius * Math.PI / 40); pose.updateMatrix();
    tiles.setMatrixAt(tile++, pose.matrix);
    tiles.setColorAt(tile - 1, new THREE.Color().setHSL(.12, .06, .38 + (i % 5) * .065));
  }
  root.add(tiles);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const road = add(new THREE.PlaneGeometry(4.5, 47), pale, x + Math.cos(a) * 46, 3.012, z + Math.sin(a) * 46, 'observatory-walk');
    road.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - a);
  }
  for (const radius of [10, 20, 58, 72]) {
    const ring = add(new THREE.RingGeometry(radius, radius + .16, 96), gold, x, 3.025, z, 'observatory-inlay'); ring.rotation.x = -Math.PI / 2;
  }
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, height = [6, 9, 4, 12][i % 4];
    const px = x + Math.cos(a) * 68, pz = z + Math.sin(a) * 68;
    add(new THREE.CylinderGeometry(1.2, 1.65, height, 6), stone, px, 3 + height / 2, pz, 'observatory-solid');
    add(new THREE.OctahedronGeometry(.65), glow, px, height + 4, pz, 'observatory-star');
  }
  // The star chamber's roof fell, leaving pairs of fluted piers and fragments
  // of its gold-lined dome. Wide openings preserve combat and walking routes.
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI / 6, radius = 27;
    for (const side of [-1, 1]) {
      const px = x + Math.cos(a) * radius + Math.sin(a) * side * 3;
      const pz = z + Math.sin(a) * radius - Math.cos(a) * side * 3;
      const height = i === 2 ? 4 + side : 9;
      add(new THREE.CylinderGeometry(.65, 1, height, 8), pale, px, 3 + height / 2, pz, 'observatory-solid');
      add(new THREE.CylinderGeometry(1.2, 1.3, .5, 8), stone, px, 3.25, pz, 'observatory-solid');
      if (i !== 2) add(new THREE.BoxGeometry(2, .6, 2), pale, px, 12, pz, 'observatory-capital');
    }
    if (i !== 2) {
      const arch = add(new THREE.TorusGeometry(3, .55, 6, 24, Math.PI), pale, x + Math.cos(a) * radius, 12, z + Math.sin(a) * radius, 'observatory-arch');
      arch.rotation.y = Math.PI / 2 - a;
    }
  }
  // Broken armillary instruments give each memorial a silhouette of its own.
  for (const [i, id] of ['recordNorth', 'recordWest', 'recordEast'].entries()) {
    const p = OBSERVATORY_SITES[id];
    const instrument = add(new THREE.TorusGeometry(3.8, .16, 8, 48, Math.PI * (1.4 + i * .15)), gold, p.x, 6.5, p.z - 3, 'observatory-instrument');
    instrument.rotation.set(.25 + i * .3, i * .8, .3);
    add(new THREE.CylinderGeometry(.65, 1, 2.5, 6), stone, p.x, 4.25, p.z, 'observatory-solid');
  }
  root.updateMatrixWorld(true);
  const meshes = []; root.traverse(part => { if (part.isMesh) meshes.push(part); });
  return { root, meshes, bounds: { minX: x - 76, maxX: x + 76, minZ: z - 76, maxZ: z + 76 },
    terrain: { layout: root, ground: /^observatory-ground$/, solid: /^observatory-solid$/, relative: true, standing: 1.2, reach: 2, walkable: Infinity },
    asset: 'observatory-world.js', setQuality(low) { for (const mesh of meshes) mesh.castShadow = !low && mesh !== ground; },
  };
}
