import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Everything in the Reach is made locally. Static scenery is merged by material,
// so a grove of trees costs the same number of draw calls as one tree.
export function createWorld(scene, { lowPower = false } = {}) {
  const root = new THREE.Group();
  root.name = 'The Verdant Reach';
  scene.add(root);
  const colliders = [];
  const landmarks = [
    { name: 'Moonwell Sanctuary', x: 0, z: -50, color: '#83e6ee' },
    { name: 'Wanderer’s Camp', x: -45, z: 25, color: '#ffc681' },
    { name: 'Sunstone Watch', x: 50, z: -20, color: '#f1d087' },
  ];
  let seed = 928431;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const between = (a, b) => a + rand() * (b - a);
  const groups = new Map();
  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const materials = {
    stone: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .97, flatShading: true }),
    foliage: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .9, flatShading: true }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, flatShading: true }),
    detail: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .96, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .48, metalness: .35, flatShading: true }),
    canvas: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .95, side: THREE.DoubleSide, flatShading: true }),
    far: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, flatShading: true }),
  };
  const primitives = {
    box: new THREE.BoxGeometry(1, 1, 1),
    rock: new THREE.IcosahedronGeometry(1, 0),
    leaf: new THREE.IcosahedronGeometry(1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
    taper: new THREE.CylinderGeometry(.7, 1, 1, 7),
    cone: new THREE.ConeGeometry(1, 1, 7),
    sphere: new THREE.SphereGeometry(1, 10, 7),
  };
  function add(shape, material, tint, x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0, shadow = true) {
    const original = typeof shape === 'string' ? primitives[shape] : shape;
    const geometry = original.index ? original.toNonIndexed() : original.clone();
    geometry.deleteAttribute('uv');
    position.set(x, y, z); scale.set(sx, sy, sz); euler.set(rx, ry, rz);
    quaternion.setFromEuler(euler); matrix.compose(position, quaternion, scale);
    geometry.applyMatrix4(matrix);
    color.set(tint);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const key = `${material}-${shadow}`;
    if (!groups.has(key)) groups.set(key, { material, shadow, geometries: [] });
    groups.get(key).geometries.push(geometry);
  }
  function obstacle(x, z, r) { colliders.push({ x, z, r }); }
  function stone(x, y, z, size, tint = '#758475') {
    add('rock', 'stone', tint, x, y, z, size * between(.85, 1.35), size * .7, size, 0, rand() * 6.28);
  }
  function beam(a, b, width, tint = '#564936', material = 'wood') {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const mid = from.clone().add(to).multiplyScalar(.5);
    const direction = to.sub(from);
    const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
    add('cylinder', material, tint, mid.x, mid.y, mid.z, width, direction.length(), width, rotation.x, rotation.y, rotation.z);
  }

  const curves = [
    [[0, 45], [0, 20], [-3, 3], [2, -17], [0, -38], [0, -60], [0, -94]],
    [[0, 20], [-15, 21], [-30, 28], [-45, 25], [-71, 32], [-108, 40]],
    [[0, -15], [17, -12], [31, -21], [50, -20], [69, -26], [102, -42]],
    [[-1, -36], [-17, -44], [-30, -60], [-51, -69], [-89, -83]],
  ].map(points => new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, .035, z))));
  const pathPoints = curves.map(curve => curve.getPoints(65));
  function distanceToPaths(x, z) {
    let best = 1e8;
    for (const path of pathPoints) for (let i = 0; i < path.length; i += 2) {
      const p = path[i]; best = Math.min(best, (x - p.x) ** 2 + (z - p.z) ** 2);
    }
    return Math.sqrt(best);
  }
  function nearLandmark(x, z, margin = 0) {
    return Math.hypot(x, z + 53) < 22 + margin || Math.hypot(x + 45, z - 25) < 12 + margin || Math.hypot(x - 50, z + 20) < 9 + margin || Math.hypot(x + 54, z + 38) < 22 + margin;
  }

  // A low polygon meadow with subtle color variation keeps the ground legible
  // even on a small screen. All traversable terrain stays at y=0.
  const groundGeometry = new THREE.PlaneGeometry(1100, 1100, 78, 78).toNonIndexed();
  groundGeometry.rotateX(-Math.PI / 2);
  const groundColors = new Float32Array(groundGeometry.attributes.position.count * 3);
  const groundPosition = groundGeometry.attributes.position;
  for (let i = 0; i < groundPosition.count; i += 3) {
    const x = groundPosition.getX(i), z = groundPosition.getZ(i);
    const warmth = .5 + .23 * Math.sin(x * .027 + z * .039) + between(-.035, .035);
    color.set('#4d7660').lerp(new THREE.Color('#78925b'), warmth);
    for (let k = 0; k < 3; k++) color.toArray(groundColors, (i + k) * 3);
  }
  groundGeometry.setAttribute('color', new THREE.BufferAttribute(groundColors, 3));
  const ground = new THREE.Mesh(groundGeometry, materials.stone);
  ground.receiveShadow = true; root.add(ground);

  curves.forEach((curve, index) => {
    const points = curve.getPoints(140);
    const positions = [], colors = [];
    const baseWidth = index === 0 ? 3.7 : 2.8;
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i], q = points[i + 1];
      const normal = new THREE.Vector3(q.z - p.z, 0, p.x - q.x).normalize();
      const widthA = baseWidth + Math.sin(i * .37) * .16;
      const widthB = baseWidth + Math.sin((i + 1) * .37) * .16;
      const a = p.clone().addScaledVector(normal, widthA), b = p.clone().addScaledVector(normal, -widthA);
      const c = q.clone().addScaledVector(normal, widthB), d = q.clone().addScaledVector(normal, -widthB);
      color.set(index === 0 ? '#b6ae83' : '#a5a47b').multiplyScalar(between(.97, 1.04));
      for (const v of [a, b, c, b, d, c]) { positions.push(v.x, .037 + index * .002, v.z); colors.push(color.r, color.g, color.b); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials.stone); mesh.receiveShadow = true; root.add(mesh);
    for (let i = 5; i < points.length - 5; i += 4) {
      const p = points[i];
      const side = rand() > .5 ? 1 : -1;
      const tangent = curve.getTangent(i / (points.length - 1));
      stone(p.x + tangent.z * (baseWidth + .4) * side, .11, p.z - tangent.x * (baseWidth + .4) * side, between(.22, .55), '#939c7a');
    }
  });

  // Mountains are deliberately outside the play space, arranged in two layers.
  for (let layer = 0; layer < 2; layer++) {
    const count = layer === 0 ? 27 : 22;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + layer * .16;
      const radius = layer === 0 ? between(265, 350) : between(175, 235);
      const height = layer === 0 ? between(90, 150) : between(35, 87);
      const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
      const tint = layer === 0 ? ['#638782', '#739792', '#7a9a8e'][i % 3] : ['#537b65', '#5c8068', '#618669'][i % 3];
      add('cone', 'far', tint, x, height * .42 - 9, z, between(65, 110), height, between(57, 90), 0, angle, 0, false);
      if (layer === 1) add('sphere', 'far', '#66846a', x * .76, -9, z * .76, 47, between(20, 31), 43, 0, angle, 0, false);
    }
  }
  for (let i = 0; i < 13; i++) {
    const x = between(-260, 260), z = between(-340, -190), y = between(93, 142);
    for (let k = 0; k < 4; k++) add('sphere', 'far', '#d6ddd0', x + k * 12, y + Math.sin(k) * 4, z, 16, 5 + rand() * 4, 9, 0, 0, 0, false);
  }

  function tree(x, z, size, autumn = false) {
    const twist = rand() * 6.28;
    const trunk = size * .27;
    add('taper', 'wood', '#5d5c43', x, size * 1.9, z, trunk, size * 3.8, trunk, 0, twist, -.05);
    add('taper', 'wood', '#69704b', x, size * .19, z, size * .58, size * .38, size * .58, 0, twist);
    beam([x, size * 2.3, z], [x + size * .95, size * 4.1, z + size * .4], size * .16, '#666348');
    const shades = autumn ? ['#b2b868', '#bdbe6c', '#d0c77c'] : ['#3c7458', '#4e8560', '#6c9a6a'];
    for (let j = 0; j < 5; j++) {
      const angle = twist + j * 2.4;
      const s = j === 0 ? 1.6 : between(1.05, 1.45);
      const shift = j === 0 ? 0 : size * 1.04;
      add('leaf', 'foliage', shades[j % 3], x + Math.sin(angle) * shift, size * (j === 0 ? 5.15 : 4.1 + j * .17), z + Math.cos(angle) * shift, size * s, size * s * .8, size * s, 0, angle, 0, true);
    }
    obstacle(x, z, size * .42);
  }
  [[-20, 8, 2.5], [24, 3, 2.8], [-16, -23, 2.2], [22, -40, 2.6], [-31, 42, 2.2], [34, 33, 2.4], [-26, -70, 2.6]].forEach(([x, z, s], i) => tree(x, z, s, i % 3 === 0));
  let treeCount = 0;
  for (let i = 0; i < 850 && treeCount < 142; i++) {
    const x = between(-132, 132), z = between(-130, 125);
    if (distanceToPaths(x, z) < 9 || nearLandmark(x, z, 4) || Math.hypot(x, z - 18) < 20) continue;
    if (colliders.some(c => Math.hypot(x - c.x, z - c.z) < 8)) continue;
    tree(x, z, between(1.5, 2.9), rand() < .16); treeCount++;
  }
  for (let i = 0; i < 93; i++) {
    const x = between(-126, 126), z = between(-124, 123);
    if (distanceToPaths(x, z) < 6 || nearLandmark(x, z, 1) || Math.hypot(x, z - 18) < 12) continue;
    const s = between(.7, 2.3);
    stone(x, s * .42, z, s, ['#84917d', '#738779', '#8b947e'][i % 3]);
    if (s > 1.15) obstacle(x, z, s * .8);
    if (i % 3 === 0) add('leaf', 'foliage', '#688653', x + s * .1, s * .87, z, s * .65, s * .18, s * .6, 0, rand() * 6.28);
  }

  // The sanctuary's enormous, weathered gateway is visible from the arrival path.
  const ruinStone = ['#aeb6a2', '#bac0a8', '#919f91', '#a1b19b'];
  const ringSegments = 11;
  function archBlock(a0, a1) {
    const inner = 10.6, outer = 13, depth = 3.3;
    const p = [];
    const vertices = [];
    for (const z of [-depth / 2, depth / 2]) for (const r of [inner, outer]) for (const a of [a0, a1]) vertices.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
    for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
      for (const index of [a, b, c, a, c, d]) vertices[index].toArray(p, p.length);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geometry.computeVertexNormals(); return geometry;
  }
  for (const side of [-1, 1]) {
    const x = side * 11.8;
    add('box', 'stone', '#929f8d', x, .45, -67, 5.2, .9, 5.1);
    add('box', 'stone', '#b1baa4', x, 1.1, -67, 4.3, .6, 4.3);
    for (let i = 0; i < 5; i++) add('box', 'stone', ruinStone[i % 4], x + Math.sin(i) * .07, 2.6 + i * 2.5, -67, 2.6 + rand() * .1, 2.42, 3.25, 0, between(-.025, .025));
    add('box', 'stone', '#bec5aa', x, 14.1, -67, 3.7, .8, 4);
    obstacle(x, -67, 2.6);
    // Climbing moss follows the outer edge instead of obscuring the silhouette.
    for (let i = 0; i < 7; i++) add('leaf', 'foliage', '#6b895e', x + side * .9, 2 + i * 1.85, -65.3, .95, .65, .35, 0, rand() * 4);
  }
  for (let i = 0; i < ringSegments; i++) {
    const block = archBlock(i / ringSegments * Math.PI + .009, (i + 1) / ringSegments * Math.PI - .009);
    add(block, 'stone', ruinStone[i % 4], 0, 14.1, -67);
    block.dispose();
  }
  add('rock', 'metal', '#d6c693', 0, 26.8, -65.1, 1.5, 2.1, .4, 0, 0, 0);
  // Fragments, columns, and a quiet courtyard beyond the gate.
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? -1 : 1, x = side * between(17, 24), z = -51 - Math.floor(i / 2) * 11;
    const h = between(3.6, 8);
    add('cylinder', 'stone', '#9eaa95', x, .3, z, 2.2, .6, 2.2);
    add('cylinder', 'stone', ruinStone[i % 4], x, h / 2 + .6, z, 1.3, h, 1.3);
    add('box', 'stone', '#a4b396', x, h + .8, z, 3.2, .5, 3.2, 0, .18);
    obstacle(x, z, 2);
    stone(x + 2.7, .45, z + 1.7, 1.1, '#a1ad98');
  }
  for (let i = 0; i < 20; i++) {
    const angle = rand() * 6.28, r = between(18, 24);
    const x = Math.sin(angle) * r, z = -64 + Math.cos(angle) * r;
    if (Math.abs(x) < 5) continue;
    stone(x, .55, z, between(.8, 1.8), '#9fab90');
  }
  for (let i = 0; i < 3; i++) add('cylinder', 'stone', ['#929d88', '#b2baa1', '#c6cbb2'][i], 0, .1 + i * .18, -50, 5.8 - i * .9, .22, 5.8 - i * .9, 0, i * .2);
  add('cylinder', 'stone', '#687f78', 0, 1.03, -50, 1.7, 1.1, 1.7);
  add('cylinder', 'metal', '#b6b998', 0, 1.66, -50, 1.9, .18, 1.9);
  obstacle(0, -50, 2.2);
  const crystalMaterial = new THREE.MeshStandardMaterial({ color: '#96f4ec', emissive: '#39bfc7', emissiveIntensity: .55, roughness: .22, metalness: .12, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), crystalMaterial);
  crystal.position.set(0, 4.7, -50); crystal.scale.set(1.2, 2.7, 1.2); crystal.castShadow = true; root.add(crystal);
  const glyphMaterial = new THREE.MeshBasicMaterial({ color: '#a0eee0', transparent: true, opacity: .65, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.7, .026, 4, 52), glyphMaterial);
  halo.rotation.x = Math.PI / 2; halo.position.set(0, 2.3, -50); root.add(halo);
  const sanctuaryOrbs = [];
  for (const side of [-1, 1]) {
    add('cylinder', 'stone', '#8d9c8c', side * 7.6, 1.3, -44.5, .6, 2.6, .75);
    add('cylinder', 'metal', '#b6b789', side * 7.6, 2.65, -44.5, .8, .15, .8);
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(.5), crystalMaterial);
    orb.position.set(side * 7.6, 3.3, -44.5); root.add(orb); sanctuaryOrbs.push(orb);
    obstacle(side * 7.6, -44.5, .8);
  }

  // A reed-lined pool, with a dark stone shelf and soft concentric ripples.
  const pondCenter = new THREE.Vector2(-54, -38);
  const pondOutline = [];
  for (let i = 0; i < 56; i++) {
    const a = i / 56 * Math.PI * 2, r = 1 + .075 * Math.sin(a * 3) + .035 * Math.cos(a * 7);
    pondOutline.push(new THREE.Vector2(pondCenter.x + Math.cos(a) * 19 * r, pondCenter.y + Math.sin(a) * 12 * r));
  }
  function flatShape(outline, y, material) {
    const geometry = new THREE.ShapeGeometry(new THREE.Shape(outline));
    geometry.rotateX(-Math.PI / 2);
    // ShapeGeometry maps its second coordinate to -z after rotation.
    geometry.scale(1, 1, -1); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material); mesh.position.y = y; mesh.receiveShadow = true; root.add(mesh); return mesh;
  }
  const shoreMaterial = new THREE.MeshStandardMaterial({ color: '#899379', roughness: 1, side: THREE.DoubleSide });
  flatShape(pondOutline.map(v => new THREE.Vector2(pondCenter.x + (v.x - pondCenter.x) * 1.075, pondCenter.y + (v.y - pondCenter.y) * 1.1)), .046, shoreMaterial);
  const waterMaterial = new THREE.MeshStandardMaterial({ color: '#448d8e', emissive: '#254d4e', emissiveIntensity: .17, roughness: .25, metalness: .34, side: THREE.DoubleSide });
  flatShape(pondOutline, .066, waterMaterial);
  const rippleMaterial = new THREE.MeshBasicMaterial({ color: '#b4d8c3', transparent: true, opacity: .17, depthWrite: false });
  const ripples = [];
  for (let i = 0; i < 4; i++) {
    const ripple = new THREE.Mesh(new THREE.RingGeometry(1.97, 2, 48), rippleMaterial);
    ripple.rotation.x = -Math.PI / 2; ripple.position.set(-57 + (i % 2) * 9, .076, -41 + Math.floor(i / 2) * 7); root.add(ripple); ripples.push(ripple);
  }
  // A circle collider keeps characters on the bank rather than walking on water.
  obstacle(-60, -38, 11.7); obstacle(-48, -38, 11.3);
  for (let i = 0; i < pondOutline.length; i += 3) {
    const p = pondOutline[i];
    if (i % 2 === 0) stone(p.x, .28, p.y, between(.5, 1.05), '#7d9388');
    for (let j = 0; j < 4; j++) {
      const x = p.x + between(-.6, .6), z = p.y + between(-.6, .6), h = between(.65, 1.6);
      add('cone', 'detail', '#9ca56b', x, h * .5, z, .055, h, .055, 0, rand() * 6.28, between(-.15, .15), false);
      if (j === 0) add('cylinder', 'detail', '#827252', x, h, z, .1, .3, .1, 0, 0, 0, false);
    }
  }
  for (let i = 0; i < 10; i++) {
    const x = between(-67, -42), z = between(-43, -33);
    add('cylinder', 'detail', '#83a273', x, .095, z, between(.3, .6), .02, between(.3, .5), 0, rand() * 6.28, 0, false);
    if (i % 3 === 0) add('rock', 'detail', '#dfc9ae', x, .18, z, .17, .14, .17, 0, 0, 0, false);
  }

  // The camp: stitched canvas, rope ridge, a bedroll, provisions, and a small fire.
  const tentGeometry = new THREE.BufferGeometry();
  const tentVertices = [
    -5, .2, 4, 0, 5.5, 4, -5, .2, -4, 0, 5.5, 4, 0, 5.5, -4, -5, .2, -4,
    0, 5.5, 4, 5, .2, 4, 5, .2, -4, 0, 5.5, 4, 5, .2, -4, 0, 5.5, -4,
    -5, .2, -4, 0, 5.5, -4, 5, .2, -4,
  ];
  tentGeometry.setAttribute('position', new THREE.Float32BufferAttribute(tentVertices, 3)); tentGeometry.computeVertexNormals();
  add(tentGeometry, 'canvas', '#c5ac79', -48, 0, 34, 1, 1, 1); tentGeometry.dispose();
  beam([-48, .1, 38.3], [-48, 5.9, 38.3], .12);
  beam([-48, .1, 29.7], [-48, 5.9, 29.7], .12);
  beam([-48, 5.6, 39], [-48, 5.6, 29], .12);
  for (const side of [-1, 1]) {
    beam([-48 + side * 5, .2, 38], [-48 + side * 6.5, .2, 39], .035, '#c3b493');
    add('box', 'wood', '#71634a', -48 + side * 6.5, .35, 39, .12, .7, .12, 0, 0, side * -.25);
  }
  colliders.push({ x: -48, z: 34, w: 10.2, d: 8.2 });
  add('box', 'canvas', '#687c72', -49.5, .17, 35.4, 1.6, .25, 3.6);
  add('cylinder', 'canvas', '#728774', -49.5, .5, 36.6, .36, 1.7, .36, 0, 0, Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const x = -56.7 + (i % 2) * 1.6, z = 30.8 + Math.floor(i / 2) * 1.55;
    add('box', 'wood', '#887454', x, .7, z, 1.5, 1.4, 1.4, 0, .08);
    for (const offset of [-.51, .51]) add('box', 'wood', '#b09a6d', x, .73, z + offset, 1.58, 1.52, .1, 0, .08);
    obstacle(x, z, 1);
  }
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * 6.28;
    stone(-43 + Math.cos(a) * 1.25, .23, 24 + Math.sin(a) * 1.25, .42, '#838c78');
  }
  for (let i = 0; i < 3; i++) add('cylinder', 'wood', '#4e4838', -43, .25 + i * .09, 24, .18, 1.8, .18, Math.PI / 2, i * 1.05);
  obstacle(-43, 24, 1.35);
  const flameMaterial = new THREE.MeshBasicMaterial({ color: '#ffb45d', transparent: true, opacity: .86, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.OctahedronGeometry(1), flameMaterial);
  flame.position.set(-43, .98, 24); flame.scale.set(.48, 1.15, .45); root.add(flame);
  const flameCore = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color: '#ffe6a1' }));
  flameCore.position.set(-43, .65, 24.1); flameCore.scale.set(.29, .55, .28); root.add(flameCore);
  beam([-39, .6, 28.4], [-35.8, .6, 28.4], .55, '#76634c');
  obstacle(-37.4, 28.4, 1.8);
  // Small trail signs make the interconnected spaces feel inhabited.
  for (const [x, z, rot] of [[-8, 17, -.2], [12, -10, .3], [-6.7, -33, -.4]]) {
    add('box', 'wood', '#6e6348', x, 1.7, z, .24, 3.4, .24);
    add('box', 'wood', '#a69569', x, 2.8, z, 2.1, .65, .18, 0, rot);
    add('box', 'wood', '#928761', x + .3, 1.95, z, 1.8, .55, .18, 0, -rot);
    obstacle(x, z, .32);
  }

  // A warmer landmark balances the blue sanctuary on the eastern trail.
  for (let i = 0; i < 3; i++) add('box', 'stone', ruinStone[i], 50, .18 + i * .34, -20, 7 - i * 1.2, .35, 7 - i * 1.2, 0, Math.PI / 4);
  add('taper', 'stone', '#aaa98e', 50, 4.7, -20, 1.5, 7.2, 1.5, 0, Math.PI / 4);
  add('cone', 'metal', '#d2ba79', 50, 9.2, -20, 1.13, 1.8, 1.13, 0, Math.PI / 4);
  for (const y of [2, 7.7]) add('box', 'metal', '#c2b98b', 50, y, -20, 2.65, .3, 2.65, 0, Math.PI / 4);
  const amberMaterial = new THREE.MeshStandardMaterial({ color: '#f7d890', emissive: '#daa849', emissiveIntensity: .7, roughness: .3 });
  const sunstone = new THREE.Mesh(new THREE.OctahedronGeometry(.8), amberMaterial);
  sunstone.position.set(50, 5.8, -18.8); sunstone.scale.set(.65, 1.5, .45); root.add(sunstone);
  obstacle(50, -20, 2.8);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * 6.28;
    const x = 50 + Math.sin(a) * 9, z = -20 + Math.cos(a) * 9;
    if (Math.abs(z + 20) < 4) continue;
    stone(x, .7, z, 1.5, '#b0ad8e'); obstacle(x, z, 1.2);
  }

  // One merged groundcover mesh, rather than thousands of little scene objects.
  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-.15, 0, 0, .03, 1, .07, .15, 0, 0, 0, 0, -.15, -.04, .8, .02, 0, 0, .15], 3));
  bladeGeometry.computeVertexNormals();
  for (let i = 0; i < 1750; i++) {
    const x = between(-115, 115), z = between(-115, 115);
    if (distanceToPaths(x, z) < 4.8 || nearLandmark(x, z, -3) || Math.hypot(x, z - 18) < 4) continue;
    const size = between(.3, .9);
    add(bladeGeometry, 'detail', ['#7f9a63', '#94a76d', '#5f8959'][i % 3], x, .02, z, size, size, size, 0, rand() * 6.28, 0, false);
    if (i % 6 === 0) {
      add('rock', 'detail', i % 12 === 0 ? '#dfc78d' : '#b5b1d3', x, size * .9, z, .16, .12, .16, 0, 0, 0, false);
    }
  }
  bladeGeometry.dispose();
  // Foreground wildflowers form a few deliberate patches beside the trail.
  for (const [cx, cz] of [[-8, 8], [8, -2], [-18, 29], [13, 35], [8, -39]]) {
    for (let i = 0; i < 24; i++) {
      const x = cx + between(-2.5, 2.5), z = cz + between(-2.5, 2.5), height = between(.3, .65);
      add('cone', 'detail', '#6e8b5b', x, height / 2, z, .035, height, .035, 0, 0, 0, false);
      add('rock', 'detail', i % 3 ? '#eee0b2' : '#c4badb', x, height, z, .13, .09, .13, 0, rand() * 6.28, 0, false);
    }
  }

  const staticMeshes = [];
  for (const { material, shadow, geometries } of groups.values()) {
    const geometry = mergeGeometries(geometries, false);
    if (geometry) {
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, materials[material]);
      mesh.castShadow = shadow; mesh.receiveShadow = material !== 'far';
      mesh.userData.worldShadow = shadow; root.add(mesh); staticMeshes.push(mesh);
    }
    geometries.forEach(geometry => geometry.dispose());
  }
  Object.values(primitives).forEach(geometry => geometry.dispose());

  const particleCount = 80;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleBase = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    particleBase[i * 3] = between(-34, 34);
    particleBase[i * 3 + 1] = between(.6, 8);
    particleBase[i * 3 + 2] = between(-38, 38);
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setDrawRange(0, lowPower ? 32 : particleCount);
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: '#f3e5ae', size: .075, transparent: true, opacity: .52, depthWrite: false, sizeAttenuation: true }));
  particles.frustumCulled = false; root.add(particles);
  let quality = lowPower ? 'low' : 'high';
  let daylight = 1;
  function setQuality(level) {
    quality = level;
    const low = level === 'low' || level === 'performance' || level === 0;
    particleGeometry.setDrawRange(0, low ? 32 : particleCount);
    ripples.forEach((ripple, i) => { ripple.visible = !low || i < 2; });
    // Shadows are renderer-controlled; retain the architectural shapes at every quality.
    for (const mesh of staticMeshes) mesh.castShadow = mesh.userData.worldShadow && (!low || mesh.material !== materials.foliage);
  }
  function setTime(hour) {
    daylight = THREE.MathUtils.clamp(Math.sin((hour - 6) / 12 * Math.PI) * 1.4, 0, 1);
    crystalMaterial.emissiveIntensity = .55 + (1 - daylight) * .8;
    amberMaterial.emissiveIntensity = .7 + (1 - daylight) * .8;
    glyphMaterial.opacity = .5 + (1 - daylight) * .35;
    particles.material.opacity = .35 + (1 - daylight) * .4;
  }
  function update(dt, time, playerPosition) {
    crystal.rotation.y = time * .28;
    crystal.position.y = 4.7 + Math.sin(time * 1.35) * .22;
    halo.position.y = 2.3 + Math.sin(time * .8) * .12;
    halo.rotation.z = time * .12;
    sanctuaryOrbs.forEach((orb, i) => { orb.rotation.y = time * .5 + i; orb.position.y = 3.3 + Math.sin(time * 1.8 + i * 2) * .1; });
    flame.scale.y = 1 + Math.sin(time * 13) * .13 + Math.sin(time * 21) * .07;
    flame.rotation.y = time * .9;
    flameCore.scale.y = .56 + Math.sin(time * 17) * .08;
    ripples.forEach((ripple, i) => { const s = .3 + ((time * .12 + i * .24) % 1) * 2.1; ripple.scale.set(s, s, 1); });
    const anchorX = playerPosition?.x ?? 0, anchorZ = playerPosition?.z ?? 18;
    const count = quality === 'low' || quality === 'performance' || quality === 0 ? 32 : particleCount;
    for (let i = 0; i < count; i++) {
      const p = i * 3;
      particlePositions[p] = anchorX + particleBase[p] + Math.sin(time * .14 + i * 2) * .7;
      particlePositions[p + 1] = particleBase[p + 1] + Math.sin(time * .5 + i) * .35;
      particlePositions[p + 2] = anchorZ + particleBase[p + 2] + Math.cos(time * .11 + i) * .6;
    }
    particleGeometry.attributes.position.needsUpdate = true;
  }
  setQuality(quality);
  update(0, 0, { x: 0, z: 18 });
  return {
    colliders, spawn: { x: 0, z: 18 }, landmarks, update, setQuality, setTime,
    dispose() {
      const geometries = new Set(), usedMaterials = new Set();
      root.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) usedMaterials.add(object.material);
      });
      geometries.forEach(geometry => geometry.dispose());
      usedMaterials.forEach(material => material.dispose());
      scene.remove(root);
    },
  };
}
