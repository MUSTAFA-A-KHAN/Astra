import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneRigged } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Built-in adventurers are original, lightweight geometry;
 * optional GLBs stay on demand.
 */
export const HEROES = [
  {
    id: 'warden', name: 'Cael', title: 'The Warden', role: 'Vanguard',
    description: 'A steady blade. An unbroken oath. Stand your ground with sword and shield.',
    color: '#d9b775', stats: { power: 90, agility: 58, magic: 24 },
    speed: 9, damage: 34, cooldown: 0.62, range: 6.2,
    ability: 'Sunsteel strike', weapon: 'Sword & shield',
  },
  {
    id: 'ranger', name: 'Lyra', title: 'The Wayfinder', role: 'Ranger',
    description: 'Follow the wind beyond the familiar. A nimble scout with an unerring bow.',
    color: '#98caa2', stats: { power: 65, agility: 95, magic: 42 },
    speed: 10.5, damage: 24, cooldown: 0.4, range: 10,
    ability: 'Gale arrow', weapon: 'Forest bow',
  },
  {
    id: 'mage', name: 'Elowen', title: 'The Arcanist', role: 'Spellweaver',
    description: 'Ancient light answers your call. Unravel the wild with a crystal-tipped staff.',
    color: '#baaff1', stats: { power: 68, agility: 55, magic: 98 },
    speed: 8.6, damage: 38, cooldown: 0.72, range: 12,
    ability: 'Astral pulse', weapon: 'Moonstone staff',
  },
  {
    id: 'rei', name: 'Rei', title: 'The Wanderer', role: 'Guest adventurer',
    description: 'Your original blue-haired adventurer, ready for a new world.',
    color: '#a7d9f2', stats: { power: 70, agility: 86, magic: 65 },
    speed: 10, damage: 27, cooldown: 0.5, range: 8,
    ability: 'Spirit strike', weapon: 'Spirit energy',
    imported: true,
    size: '16 MB',
    model: './rigged-model-optimized.glb',
    orientationYaw: 0,
    animationSpeeds: {
      walk: 4.2,
      run: 8,
      sprint: 11.5,
    },
  },
  {
    id: 'arthur', name: 'Arthur', title: 'The Outrider', role: 'Guest adventurer',
    description: 'Your original frontier wanderer. A familiar face on an unfamiliar horizon.',
    color: '#d3ac87', stats: { power: 85, agility: 72, magic: 36 },
    speed: 19.2, damage: 32, cooldown: 0.58, range: 7,
    ability: 'Frontier strike', weapon: 'Outrider prowess',
    imported: true,
    size: '21 MB',
    model: './Arthur-rigged-under-25mb.glb',
    orientationYaw: 0,
    animationSpeeds: {
      walk: 1,
      run: 3,
      sprint: 11.5,
    },
  },
  {
    id: 'soldier', name: 'Soldier', title: 'The Soldier', role: 'Guest adventurer',
    description: 'A battle-tested soldier ready for the journey.',
    color: '#8fa8b8', stats: { power: 80, agility: 75, magic: 20 },
    speed: 18, damage: 30, cooldown: 0.55, range: 7,
    ability: 'Combat strike', weapon: 'Military blade',
    imported: true,
    size: 'External GLB',
    model: 'https://threejs.org/examples/models/gltf/Soldier.glb',
    orientationYaw: Math.PI,
    animationSpeeds: {
      walk: 2,
      run: 8.4,
      sprint: 11.8,
    },
  },
  {
    id: 'female-soldier', name: 'Female-Soldier', title: 'The Soldier', role: 'Guest adventurer',
    description: 'A battle-tested soldier ready for the journey.',
    color: '#8fa8b8', stats: { power: 80, agility: 75, magic: 20 },
    speed: 18, damage: 30, cooldown: 0.55, range: 7,
    ability: 'Combat strike', weapon: 'Military blade',
    imported: true,
    size: '92 MB',
    model: 'https://github.com/MUSTAFA-A-KHAN/Astra/releases/download/female/realistic_female.glb',
    orientationYaw: 0,
    animationSpeeds: {
      walk: 4.2,
      run: 8,
      sprint: 11.5,
    },
  },
];

/**
 * The hostiles of the Reach.
 *
 * Three's expressive robot ships with Idle, Walking, Running,
 * Punch and Death clips, which is exactly the vocabulary the
 * chase loop drives. One download serves the whole squad.
 */
export const ENEMY = {
  id: 'automaton',
  name: 'Rogue Automaton',
  title: 'The Restless',
  role: 'Hostile',
  description: 'A hollow machine still walking its old patrol.',
  color: '#9380b0',
  imported: true,
  model:
    'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
  // Shorter than an adventurer, so a crowd never reads as a wall.
  height: 2.6,
  orientationYaw: 0,
  animationSpeeds: {
    walk: 2.2,
    run: 4.4,
    sprint: 6,
  },
};

const palettes = {
  warden: {
    cloth: '#194f54',
    light: '#438080',
    dark: '#163438',
    metal: '#c7a66b',
    edge: '#f1dab0',
    leather: '#574031',
    skin: '#c79676',
    hair: '#44352d',
    boots: '#393630',
    eyes: '#448878',
  },

  ranger: {
    cloth: '#395941',
    light: '#73966b',
    dark: '#243c30',
    metal: '#ac8854',
    edge: '#dcc594',
    leather: '#715039',
    skin: '#c89470',
    hair: '#8b442d',
    boots: '#40372e',
    eyes: '#74ae86',
  },

  mage: {
    cloth: '#6a628f',
    light: '#b1a8d0',
    dark: '#363550',
    metal: '#c6bba3',
    edge: '#ece3cb',
    leather: '#47445d',
    skin: '#d9b4a2',
    hair: '#e4e5e1',
    boots: '#343446',
    eyes: '#719ece',
  },
};

// One vertex-colored mesh per moving segment keeps detail inexpensive on mobile GPUs.
class Sculpt {
  constructor() {
    this.parts = [];
  }

  add(
    geometry,
    color,
    position = [0, 0, 0],
    scale = [1, 1, 1],
    rotation = [0, 0, 0],
  ) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;

    if (geo !== geometry) {
      geometry.dispose();
    }

    geo.deleteAttribute('uv');

    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...rotation),
      ),
      new THREE.Vector3(...scale),
    );

    geo.applyMatrix4(transform);

    const tint = new THREE.Color(color);
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }

    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(colors, 3),
    );

    this.parts.push(geo);

    return this;
  }

  box(color, position, scale, rotation) {
    return this.add(
      new THREE.BoxGeometry(1, 1, 1),
      color,
      position,
      scale,
      rotation,
    );
  }

  ball(color, position, scale, rotation) {
    return this.add(
      new THREE.IcosahedronGeometry(1, 1),
      color,
      position,
      scale,
      rotation,
    );
  }

  gem(color, position, scale, rotation) {
    return this.add(
      new THREE.OctahedronGeometry(1),
      color,
      position,
      scale,
      rotation,
    );
  }

  cylinder(
    color,
    position,
    radiusTop,
    radiusBottom,
    height,
    sides = 8,
    scale = [1, 1, 1],
    rotation = [0, 0, 0],
  ) {
    return this.add(
      new THREE.CylinderGeometry(
        radiusTop,
        radiusBottom,
        height,
        sides,
      ),
      color,
      position,
      scale,
      rotation,
    );
  }

  beam(color, start, end, radius, sides = 6) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);

    const direction = b.clone().sub(a);

    const rotation = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize(),
      ),
    );

    return this.cylinder(
      color,
      a.add(b).multiplyScalar(0.5).toArray(),
      radius,
      radius,
      direction.length(),
      sides,
      [1, 1, 1],
      rotation.toArray().slice(0, 3),
    );
  }

  mesh(material) {
    const geometry = mergeGeometries(this.parts, false);

    this.parts.forEach(part => part.dispose());

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }
}

function capeGeometry(width = 1.05, length = 1.5) {
  const vertices = [];
  const columns = 6;
  const rows = 5;

  const point = (x, y) => {
    const spread = 0.68 + y * 0.52;

    return [
      (x - 0.5) * width * spread,
      -y * length,
      -0.18
        - y * 0.21
        - Math.sin(x * Math.PI) * 0.14
        + Math.cos(x * Math.PI * 6) * y * 0.045,
    ];
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const a = point(x / columns, y / rows);
      const b = point((x + 1) / columns, y / rows);
      const c = point(x / columns, (y + 1) / rows);
      const d = point((x + 1) / columns, (y + 1) / rows);

      vertices.push(
        ...a,
        ...b,
        ...c,
        ...b,
        ...d,
        ...c,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );

  geometry.computeVertexNormals();

  return geometry;
}

function makeBuiltin(meta) {
  const p = palettes[meta.id];
  const mage = meta.id === 'mage';
  const ranger = meta.id === 'ranger';

  const group = new THREE.Group();
  group.name = meta.name;

  const body = new THREE.Group();
  group.add(body);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.08,
    flatShading: true,
  });

  const clothMaterial = material.clone();
  clothMaterial.side = THREE.DoubleSide;

  const glowMaterial = new THREE.MeshStandardMaterial({
    color: '#b4f5fa',
    emissive: '#4cbfdd',
    emissiveIntensity: 0.85,
    roughness: 0.32,
    flatShading: true,
  });

  const addSegment = (parent, position, sculpt) => {
    const joint = new THREE.Group();
    joint.position.set(...position);

    if (sculpt) {
      joint.add(sculpt.mesh(material));
    }

    parent.add(joint);

    return joint;
  };

  const torso = new Sculpt()
    .cylinder(
      p.cloth,
      [0, 1.95, 0],
      0.56,
      0.39,
      1.04,
      8,
      [1, 1, 0.67],
    )
    .cylinder(
      p.dark,
      [0, 1.34, 0],
      0.43,
      0.47,
      0.34,
      8,
      [1, 1, 0.69],
    )
    .cylinder(
      p.leather,
      [0, 1.59, 0],
      0.438,
      0.425,
      0.14,
      8,
      [1, 1, 0.74],
    )
    .box(
      p.metal,
      [0, 1.59, 0.328],
      [0.21, 0.19, 0.055],
    )
    .box(
      p.dark,
      [0, 1.59, 0.36],
      [0.105, 0.095, 0.028],
    )
    .cylinder(
      p.skin,
      [0, 2.65, 0],
      0.15,
      0.18,
      0.31,
      8,
    )
    .cylinder(
      p.light,
      [0, 2.48, 0],
      0.31,
      0.41,
      0.20,
      8,
      [1, 1, 0.8],
    );

  if (meta.id === 'warden') {
    torso
      .cylinder(
        p.metal,
        [0, 2.12, 0.055],
        0.51,
        0.36,
        0.57,
        8,
        [1, 1, 0.74],
      )
      .box(
        p.edge,
        [0, 2.12, 0.375],
        [0.045, 0.49, 0.04],
      )
      .gem(
        p.edge,
        [0, 2.27, 0.4],
        [0.18, 0.2, 0.045],
      )
      .gem(
        p.cloth,
        [0, 2.27, 0.44],
        [0.095, 0.105, 0.025],
      )
      .box(
        p.leather,
        [0.29, 2.35, 0.31],
        [0.11, 0.44, 0.06],
        [0, 0, -0.38],
      );

    for (const side of [-1, 1]) {
      torso
        .box(
          p.metal,
          [side * 0.26, 1.34, 0.27],
          [0.24, 0.40, 0.1],
          [0.10, 0, side * 0.16],
        )
        .box(
          p.edge,
          [side * 0.26, 1.16, 0.29],
          [0.25, 0.035, 0.10],
          [0.10, 0, side * 0.16],
        );
    }
  } else if (ranger) {
    torso
      .box(
        p.leather,
        [0.01, 2.03, 0.32],
        [0.13, 1.06, 0.055],
        [0, 0, -0.56],
      )
      .box(
        p.edge,
        [-0.10, 2.22, 0.361],
        [0.14, 0.13, 0.02],
        [0, 0, -0.56],
      )
      .cylinder(
        p.leather,
        [0.43, 1.46, -0.03],
        0.15,
        0.16,
        0.35,
        6,
      )
      .box(
        p.metal,
        [0.46, 1.52, 0.12],
        [0.10, 0.08, 0.025],
      );

    // A quiver and six feathered arrows stay merged with the chest.
    torso.cylinder(
      p.leather,
      [0.3, 2.05, -0.44],
      0.18,
      0.12,
      0.9,
      7,
      [1, 1, 1],
      [0, 0, -0.3],
    );

    for (let i = 0; i < 6; i++) {
      const x = 0.30 + (i % 3) * 0.065;
      const z = -0.46 + Math.floor(i / 3) * 0.07;

      torso.beam(
        p.edge,
        [x, 2.35, z],
        [x + 0.15, 2.98 + (i % 2) * 0.07, z],
        0.014,
        4,
      );

      torso.gem(
        p.light,
        [x + 0.145, 2.87 + (i % 2) * 0.07, z],
        [0.063, 0.14, 0.022],
        [0, 0, -0.24],
      );
    }
  } else {
    torso
      .cylinder(
        p.cloth,
        [0, 0.98, -0.015],
        0.42,
        0.65,
        1.23,
        9,
        [1, 1, 0.75],
      )
      .cylinder(
        p.edge,
        [0, 0.39, -0.015],
        0.64,
        0.655,
        0.06,
        9,
        [1, 1, 0.75],
      )
      .box(
        p.light,
        [0, 1.95, 0.345],
        [0.24, 0.99, 0.055],
      )
      .box(
        p.light,
        [0, 0.98, 0.372],
        [0.26, 1.2, 0.08],
        [-0.10, 0, 0],
      )
      .box(
        p.metal,
        [0, 1.61, 0.40],
        [0.34, 0.12, 0.06],
      )
      .gem(
        '#a6e4ec',
        [0, 2.30, 0.397],
        [0.115, 0.17, 0.055],
      )
      .beam(
        p.edge,
        [-0.22, 2.54, 0.25],
        [0, 2.26, 0.4],
        0.022,
      )
      .beam(
        p.edge,
        [0.22, 2.54, 0.25],
        [0, 2.26, 0.4],
        0.022,
      );
  }

  body.add(torso.mesh(material));

  const face = new Sculpt()
    .ball(
      p.skin,
      [0, 0.02, 0.008],
      [0.325, 0.375, 0.30],
    )
    .ball(
      p.skin,
      [-0.325, 0.01, 0],
      [0.065, 0.11, 0.065],
    )
    .ball(
      p.skin,
      [0.325, 0.01, 0],
      [0.065, 0.11, 0.065],
    )
    .ball(
      p.skin,
      [0, -0.045, 0.301],
      [0.055, 0.075, 0.060],
    )
    .box(
      '#efdfce',
      [-0.13, 0.045, 0.28],
      [0.11, 0.040, 0.035],
      [0, -0.2, 0],
    )
    .box(
      '#efdfce',
      [0.13, 0.045, 0.28],
      [0.11, 0.040, 0.035],
      [0, 0.2, 0],
    )
    .box(
      p.eyes,
      [-0.115, 0.045, 0.301],
      [0.04, 0.042, 0.016],
    )
    .box(
      p.eyes,
      [0.115, 0.045, 0.301],
      [0.04, 0.042, 0.016],
    )
    .box(
      '#533e3c',
      [0, -0.17, 0.262],
      [0.092, 0.016, 0.018],
    )
    .ball(
      p.hair,
      [0, 0.19, -0.045],
      [0.343, 0.245, 0.302],
    );

  for (let i = 0; i < 5; i++) {
    face.gem(
      p.hair,
      [(i - 2) * 0.115, 0.21 - i * 0.014, 0.235],
      [0.097, 0.16 + (i % 2) * 0.05, 0.10],
      [0, 0, -0.25],
    );
  }

  if (mage || ranger) {
    for (const side of [-1, 1]) {
      face.ball(
        p.hair,
        [side * 0.295, -0.13, -0.08],
        [0.10, 0.37, 0.22],
      );

      face.gem(
        p.hair,
        [side * 0.315, -0.39, -0.025],
        [0.095, 0.21, 0.12],
        [0, 0, side * 0.10],
      );
    }

    face.ball(
      p.hair,
      [0, -0.14, -0.25],
      [0.29, 0.33, 0.13],
    );

    if (ranger) {
      face
        .ball(
          p.hair,
          [0.13, -0.43, -0.29],
          [0.12, 0.32, 0.12],
          [-0.20, 0, -0.20],
        )
        .cylinder(
          p.metal,
          [0.10, -0.50, -0.28],
          0.11,
          0.10,
          0.07,
          6,
        );
    } else {
      face
        .box(
          p.edge,
          [0, 0.18, 0.31],
          [0.40, 0.045, 0.045],
        )
        .gem(
          '#9bdfe9',
          [0, 0.17, 0.347],
          [0.055, 0.084, 0.025],
        );
    }
  } else {
    face
      .ball(
        p.hair,
        [0, -0.20, 0.06],
        [0.265, 0.15, 0.232],
      )
      .box(
        p.skin,
        [0, -0.145, 0.285],
        [0.20, 0.13, 0.07],
      )
      .box(
        '#61483b',
        [0, -0.19, 0.323],
        [0.13, 0.025, 0.015],
      );
  }

  const head = addSegment(
    body,
    [0, 2.98, 0.025],
    face,
  );

  const hips = [];
  const knees = [];
  const shoulders = [];
  const elbows = [];

  for (const side of [-1, 1]) {
    const leg = new Sculpt()
      .cylinder(
        p.dark,
        [0, -0.255, 0],
        0.195,
        0.155,
        0.59,
        7,
        [1, 1, 0.92],
      )
      .ball(
        mage ? p.light : p.leather,
        [0, -0.51, 0.065],
        [0.165, 0.145, 0.175],
      );

    const hip = addSegment(
      body,
      [side * 0.24, 1.20, 0],
      leg,
    );

    const lower = new Sculpt()
      .cylinder(
        p.boots,
        [0, -0.26, 0],
        0.167,
        0.15,
        0.48,
        7,
      )
      .cylinder(
        p.leather,
        [0, -0.06, 0],
        0.19,
        0.177,
        0.14,
        7,
      )
      .box(
        p.boots,
        [0, -0.455, 0.09],
        [0.32, 0.20, 0.47],
      )
      .box(
        '#24292a',
        [0, -0.535, 0.09],
        [0.33, 0.065, 0.48],
      );

    if (meta.id === 'warden') {
      lower.box(
        p.metal,
        [0, -0.24, 0.15],
        [0.19, 0.30, 0.065],
      );
    }

    const knee = addSegment(
      hip,
      [0, -0.63, 0],
      lower,
    );

    hips.push(hip);
    knees.push(knee);

    const upper = new Sculpt()
      .cylinder(
        p.cloth,
        [0, -0.20, 0],
        0.20,
        0.15,
        0.5,
        7,
      )
      .ball(
        meta.id === 'warden' ? p.metal : p.light,
        [side * 0.025, 0.02, 0],
        [0.275, 0.22, 0.29],
      );

    if (meta.id === 'warden') {
      upper.ball(
        p.edge,
        [side * 0.055, 0.105, 0.06],
        [0.21, 0.067, 0.23],
      );
    }

    const shoulder = addSegment(
      body,
      [side * 0.59, 2.44, 0],
      upper,
    );

    const lowerArm = new Sculpt()
      .cylinder(
        mage ? p.cloth : p.skin,
        [0, -0.18, 0],
        0.13,
        mage ? 0.205 : 0.105,
        0.40,
        7,
      )
      .cylinder(
        mage ? p.edge : p.leather,
        [0, -0.27, 0],
        mage ? 0.198 : 0.137,
        mage ? 0.208 : 0.13,
        0.10,
        7,
      )
      .ball(
        p.skin,
        [0, -0.47, 0.015],
        [0.12, 0.16, 0.125],
      );

    if (meta.id === 'warden') {
      lowerArm.box(
        p.metal,
        [0, -0.21, 0.12],
        [0.18, 0.3, 0.07],
      );
    }

    const elbow = addSegment(
      shoulder,
      [0, -0.50, 0],
      lowerArm,
    );

    shoulders.push(shoulder);
    elbows.push(elbow);
  }

  const cape = new THREE.Group();

  cape.position.set(
    0,
    2.51,
    -0.13,
  );

  cape.add(
    new Sculpt()
      .add(
        capeGeometry(
          mage ? 1.12 : 1.14,
          ranger ? 1.02 : 1.65,
        ),
        mage ? p.dark : p.cloth,
      )
      .mesh(clothMaterial),
  );

  body.add(cape);

  const weapons = new Sculpt();
  let crystal;

  if (meta.id === 'warden') {
    weapons
      .cylinder(
        p.leather,
        [0, -0.47, 0],
        0.063,
        0.063,
        0.32,
        6,
      )
      .gem(
        p.edge,
        [0, -0.27, 0],
        [0.095, 0.10, 0.08],
      )
      .box(
        p.metal,
        [0, -0.67, 0],
        [0.48, 0.095, 0.11],
      )
      .gem(
        '#d6e3da',
        [0, -1.27, 0],
        [0.145, 0.63, 0.048],
      )
      .box(
        '#f4f1db',
        [0, -1.15, 0.045],
        [0.024, 0.75, 0.018],
      );

    const sword = weapons.mesh(material);
    sword.rotation.x = -0.25;

    elbows[1].add(sword);

    const shield = new Sculpt()
      .cylinder(
        p.metal,
        [0, -0.32, 0.22],
        0.47,
        0.47,
        0.12,
        7,
        [1, 1, 1.2],
        [Math.PI / 2, 0, 0],
      )
      .cylinder(
        p.cloth,
        [0, -0.32, 0.3],
        0.39,
        0.39,
        0.05,
        7,
        [1, 1, 1.2],
        [Math.PI / 2, 0, 0],
      )
      .gem(
        p.edge,
        [0, -0.32, 0.36],
        [0.17, 0.25, 0.055],
      )
      .gem(
        p.light,
        [0, -0.32, 0.41],
        [0.087, 0.145, 0.025],
      );

    elbows[0].add(shield.mesh(material));
  } else if (ranger) {
    const bowPoints = [
      [0.10, 0.52, 0.02],
      [0.21, 0.35, 0.04],
      [0.32, -0.08, 0.04],
      [0.27, -0.48, 0.04],
      [0.32, -0.89, 0.04],
      [0.21, -1.31, 0.04],
      [0.10, -1.48, 0.02],
    ];

    for (let i = 0; i < bowPoints.length - 1; i++) {
      weapons.beam(
        i === 2 || i === 3
          ? p.leather
          : p.metal,
        bowPoints[i],
        bowPoints[i + 1],
        0.058,
      );
    }

    weapons.beam(
      p.edge,
      bowPoints[0],
      [0.11, -0.48, -0.05],
      0.012,
      3,
    );

    weapons.beam(
      p.edge,
      [0.11, -0.48, -0.05],
      bowPoints[6],
      0.012,
      3,
    );

    weapons.beam(
      p.leather,
      [0.26, -0.50, 0.04],
      [0, -0.48, 0.02],
      0.045,
    );

    elbows[0].add(weapons.mesh(material));
  } else {
    weapons
      .beam(
        p.leather,
        [0.10, -1.77, 0.035],
        [0.10, 1.10, 0.035],
        0.063,
        7,
      )
      .cylinder(
        p.metal,
        [0.10, -0.48, 0.035],
        0.078,
        0.078,
        0.45,
        7,
      )
      .cylinder(
        p.edge,
        [0.10, 0.95, 0.035],
        0.14,
        0.075,
        0.26,
        7,
      );

    for (const side of [-1, 1]) {
      weapons
        .beam(
          p.metal,
          [0.10, 0.89, 0.035],
          [0.10 + side * 0.22, 1.14, 0.035],
          0.039,
        )
        .beam(
          p.edge,
          [0.10 + side * 0.22, 1.14, 0.035],
          [0.10 + side * 0.15, 1.40, 0.035],
          0.032,
        );
    }

    elbows[1].add(weapons.mesh(material));

    crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.23),
      glowMaterial,
    );

    crystal.position.set(
      0.10,
      1.32,
      0.035,
    );

    crystal.scale.y = 1.45;

    elbows[1].add(crystal);
  }

  let phase = 0;
  let locomotion = 0;
  let attackAmount = 0;
  let landing = 0;
  let death = 0;
  let disposed = false;
  let activeState = 'Idle';

  const animate = (
    dt,
    {
      speed = 0,
      moving = false,
      sprinting = false,
      jumping = false,
      attacking = false,
      state,
      time = 0,
    } = {},
  ) => {
    if (disposed) return;

    dt = Math.min(
      Math.max(dt, 0),
      0.1,
    );

    /**
     * IMPORTANT:
     *
     * Explicit `state` always wins.
     *
     * Without an explicit state:
     *   - stationary -> Idle
     *   - moving normally -> Walk
     *   - sprinting -> Sprint
     *
     * This prevents imported GLB characters from always
     * jumping directly into their Run animation.
     *
     * `Run` is still fully supported when game.js explicitly
     * passes state: 'Run'.
     */
    activeState =
      state ||
      (
        attacking
          ? 'Attack'
          : jumping
            ? 'Jump'
            : moving
              ? (sprinting ? 'Sprint' : 'Walk')
              : 'Idle'
      );

    attacking ||= activeState === 'Attack';

    const airborne =
      activeState === 'Jump' ||
      activeState === 'Fall';

    locomotion = THREE.MathUtils.damp(
      locomotion,
      moving &&
        !airborne &&
        activeState !== 'Dead'
        ? 1
        : 0,
      10,
      dt,
    );

    landing = THREE.MathUtils.damp(
      landing,
      activeState === 'Land' ? 1 : 0,
      18,
      dt,
    );

    death = THREE.MathUtils.damp(
      death,
      activeState === 'Dead' ? 1 : 0,
      6,
      dt,
    );

    attackAmount = THREE.MathUtils.damp(
      attackAmount,
      attacking ? 1 : 0,
      attacking ? 24 : 10,
      dt,
    );

    // Phase advances by distance travelled, including acceleration and braking.
    phase +=
      dt *
      Math.max(0, speed) /
      (
        activeState === 'Walk'
          ? 3.8
          : activeState === 'Sprint'
            ? 7.2
            : 6.2
      ) *
      Math.PI *
      2;

    const stride =
      Math.sin(phase) *
      locomotion *
      (
        activeState === 'Sprint'
          ? 0.75
          : activeState === 'Walk'
            ? 0.42
            : 0.52
      );

    body.position.y =
      Math.abs(Math.sin(phase)) *
        locomotion *
        0.065 +
      Math.sin(time * 1.8) *
        0.012 *
        (1 - locomotion) -
      landing * 0.14;

    body.rotation.x =
      locomotion *
        (
          activeState === 'Sprint'
            ? 0.075
            : activeState === 'Walk'
              ? 0.018
              : 0.025
        ) +
      (airborne ? -0.05 : 0) +
      (activeState === 'Hit' ? -0.15 : 0);

    body.rotation.z =
      death * 1.35;

    body.rotation.y =
      Math.sin(phase) *
        locomotion *
        0.045 -
      attackAmount * 0.30;

    head.rotation.y =
      Math.sin(time * 0.55) *
      0.075 *
      (1 - locomotion);

    head.rotation.x =
      Math.sin(time * 1.15) *
      0.02;

    hips[0].rotation.x = stride;
    hips[1].rotation.x = -stride;

    knees[0].rotation.x =
      -Math.max(0, -Math.sin(phase)) *
      locomotion *
      0.65;

    knees[1].rotation.x =
      -Math.max(0, Math.sin(phase)) *
      locomotion *
      0.65;

    if (airborne) {
      hips[0].rotation.x = -0.3;
      hips[1].rotation.x = 0.25;

      knees[0].rotation.x = -0.7;
      knees[1].rotation.x = -0.45;
    }

    shoulders[0].rotation.x =
      -stride * 0.65 -
      attackAmount *
        (ranger ? 1.35 : 0.40);

    shoulders[1].rotation.x =
      stride * 0.65 -
      attackAmount *
        (
          ranger
            ? 1.45
            : mage
              ? 0.55
              : 2.20
        );

    shoulders[0].rotation.z =
      0.10 +
      Math.sin(time * 1.8) * 0.014;

    shoulders[1].rotation.z =
      -0.10 -
      attackAmount * 0.23;

    elbows[0].rotation.x =
      -0.16 -
      locomotion * 0.10 -
      attackAmount *
        (
          ranger
            ? 0.08
            : 0.3
        );

    elbows[1].rotation.x =
      -0.12 -
      locomotion * 0.15 -
      attackAmount *
        (
          ranger
            ? 0.9
            : 0.15
        );

    cape.rotation.x =
      -0.06 -
      locomotion * 0.24 +
      Math.sin(time * 3.3) * 0.055;

    cape.rotation.z =
      Math.sin(time * 2.7) * 0.025 +
      stride * 0.07;

    if (crystal) {
      crystal.rotation.y =
        time * 0.85;

      glowMaterial.emissiveIntensity =
        0.85 +
        Math.sin(time * 2.5) * 0.15 +
        attackAmount * 0.6;
    }
  };

  animate(0, {});

  return {
    group,
    meta,
    height: 3.4,
    animate,

    get diagnostics() {
      return {
        imported: false,
        animations: ['procedural'],
        activeAction: activeState,
        state: activeState,
        orientationYaw: 0,
        rootMotion: 'in-place',
        disposed,
      };
    },

    dispose() {
      if (disposed) return;

      disposed = true;

      // Some variants do not use every prepared material.
      disposeObject(
        group,
        [
          material,
          clothMaterial,
          glowMaterial,
        ],
      );
    },
  };
}

function disposeObject(
  object,
  extraMaterials = [],
) {
  const geometries = new Set();
  const materials = new Set(extraMaterials);
  const textures = new Set();
  const images = new Set();
  const skeletons = new Set();

  object.traverse(child => {
    if (child.geometry) {
      geometries.add(child.geometry);
    }

    const list = Array.isArray(child.material)
      ? child.material
      : child.material
        ? [child.material]
        : [];

    for (const material of list) {
      materials.add(material);

      for (const value of Object.values(material)) {
        if (value?.isTexture) {
          textures.add(value);
        }
      }
    }

    if (child.isSkinnedMesh && child.skeleton) {
      skeletons.add(child.skeleton);
    }
  });

  skeletons.forEach(
    skeleton => skeleton.dispose(),
  );

  geometries.forEach(
    geometry => geometry.dispose(),
  );

  materials.forEach(
    material => material.dispose(),
  );

  textures.forEach(texture => {
    if (texture.image) {
      images.add(texture.image);
    }

    texture.dispose();
  });

  images.forEach(image => {
    if (typeof image.close === 'function') {
      image.close();
    }
  });

  object.removeFromParent();
}

function loadImportedScene(
  url,
  timeout = 30000,
) {
  // Fetch can be aborted; parsing cannot.
  // A late parse must still release its images.
  return new Promise((resolve, reject) => {
    const controller =
      new AbortController();

    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      controller.abort();

      reject(
        new Error(
          'Character loading took too long. Please select it again to retry.',
        ),
      );
    }, timeout);

    const absoluteURL =
      new URL(
        url,
        window.location.href,
      );

    fetch(
      absoluteURL,
      {
        signal: controller.signal,
        credentials: 'same-origin',
      },
    )
      .then(response => {
        if (!response.ok) {
          throw new Error(
            `Character download failed (${response.status}).`,
          );
        }

        return response.arrayBuffer();
      })
      .then(buffer => {
        if (settled) {
          return null;
        }

        return new GLTFLoader().parseAsync(
          buffer,
          new URL(
            '.',
            absoluteURL,
          ).href,
        );
      })
      .then(gltf => {
        if (!gltf) {
          return;
        }

        if (settled) {
          const discarded =
            new THREE.Group();

          for (
            const scene of new Set(
              gltf.scenes ||
              [gltf.scene],
            )
          ) {
            if (scene) {
              discarded.add(scene);
            }
          }

          disposeObject(discarded);
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(gltf);
      })
      .catch(error => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Remove horizontal root translation only.
 * Finger, limb and vertical gait tracks stay intact.
 */
function inPlaceClip(
  clip,
  model,
  rootPositions,
) {
  const sanitized = clip.clone();

  sanitized.tracks =
    sanitized.tracks.map(track => {
      if (
        !track.name.endsWith('.position') ||
        track.getValueSize() !== 3
      ) {
        return track;
      }

      const binding =
        THREE.PropertyBinding.parseTrackName(
          track.name,
        );

      const nodeName =
        binding.objectName === 'bones'
          ? binding.objectIndex
          : binding.nodeName;

      const node =
        THREE.PropertyBinding.findNode(
          model,
          nodeName,
        );

      const rootBone =
        node?.isBone &&
        !node.parent?.isBone;

      if (
        !rootBone &&
        node !== model &&
        !/(hips|pelvis|root)$/i.test(
          nodeName || '',
        )
      ) {
        return track;
      }

      // All clips use the idle clip's horizontal root origin.
      // Locking each clip to its own first key produces a visible
      // pop every time the gait changes.
      if (
        !rootPositions.has(track.name)
      ) {
        rootPositions.set(
          track.name,
          [
            track.values[0],
            track.values[2],
          ],
        );
      }

      const origin =
        rootPositions.get(track.name);

      for (
        let i = 0;
        i < track.values.length;
        i += 3
      ) {
        track.values[i] =
          origin[0];

        track.values[i + 2] =
          origin[1];
      }

      return track;
    });

  return sanitized;
}

/**
 * `preloaded` reuses an already downloaded glTF, so a squad of
 * clones costs one request. `shared` marks a rig whose geometry,
 * materials and textures belong to that source and must outlive it:
 * such a rig releases only its own skeleton and mixer.
 */
async function makeImported(
  meta,
  {
    preloaded = null,
    shared = false,
  } = {},
) {
  const gltf =
    preloaded ||
    await loadImportedScene(
      meta.model,
    );

  const model = gltf.scene;

  if (!model) {
    throw new Error(
      `The ${meta.name} model did not contain a scene.`,
    );
  }

  const group = new THREE.Group();
  group.name = meta.name;
  group.add(model);

  model.updateMatrixWorld(true);

  const bounds =
    new THREE.Box3().setFromObject(
      model,
    );

  const size =
    bounds.getSize(
      new THREE.Vector3(),
    );

  const targetHeight =
    meta.height || 3.4;

  if (
    !Number.isFinite(size.y) ||
    size.y < 0.001
  ) {
    if (shared) {
      group.removeFromParent();
    } else {
      disposeObject(group);
    }

    throw new Error(
      `The ${meta.name} model has invalid dimensions.`,
    );
  }

  // Normalize character height.
  model.scale.multiplyScalar(
    targetHeight / size.y,
  );

  model.updateMatrixWorld(true);

  bounds.setFromObject(model);

  const center =
    bounds.getCenter(
      new THREE.Vector3(),
    );

  // Offset the wrapper so root animation does not overwrite normalization.
  // Facing belongs to an unanimated wrapper, never to the imported rig.
  //
  // Three's sample Soldier faces -Z;
  // Astra's movement convention is +Z.
  const facing = new THREE.Group();
  facing.name =
    'Asset orientation';

  facing.rotation.y =
    meta.orientationYaw || 0;

  group.add(facing);

  const fitted =
    new THREE.Group();

  facing.add(fitted);
  fitted.add(model);

  fitted.position.set(
    -center.x,
    -bounds.min.y,
    -center.z,
  );

  model.traverse(child => {
    if (!child.isMesh) {
      return;
    }

    child.castShadow = true;
    child.receiveShadow = true;

    // Imported animation bounds can exclude extended limbs
    // or the upper body.
    child.frustumCulled = false;

    const materials =
      Array.isArray(child.material)
        ? child.material
        : [child.material];

    materials
      .filter(Boolean)
      .forEach(material => {
        if ('roughness' in material) {
          material.roughness =
            Math.max(
              0.48,
              material.roughness,
            );
        }
      });
  });

  const sourceClips =
    gltf.animations || [];

  const rootPositions =
    new Map();

  const sourceIdle =
    sourceClips.find(
      clip => /idle/i.test(clip.name),
    );

  if (sourceIdle) {
    inPlaceClip(
      sourceIdle,
      model,
      rootPositions,
    );
  }

  const clips =
    sourceClips.map(clip =>
      inPlaceClip(
        clip,
        model,
        rootPositions,
      ),
    );

  const mixer =
    clips.length
      ? new THREE.AnimationMixer(model)
      : null;

  const find = pattern =>
    clips.find(
      clip =>
        pattern.test(
          clip.name,
        ),
    );

  const idle =
    find(/idle|standing/i) ||
    clips.find(
      clip =>
        !/t.?pose/i.test(
          clip.name,
        ),
    ) ||
    clips[0];

  /**
   * More permissive animation detection.
   *
   * Some GLBs call their animation:
   *   Walk
   *   Walking
   *   walk_forward
   *   WalkForward
   *   Jog
   *
   * So don't unnecessarily reject valid walk clips.
   */
  const walk =
    find(/^walk/i) ||
    find(/walk/i) ||
    find(/jog.*forward|jog$/i);

  const run =
    find(/^run/i) ||
    find(/run/i) ||
    find(
      /jog.*forward|jog$/i,
    ) ||
    find(/sprint/i) ||
    walk;

  const sprint =
    find(/sprint/i) ||
    run;

  const jump =
    find(/^jump$|jump.*loop/i) ||
    find(/jump.*start/i);

  const fall =
    find(/fall|airborne/i) ||
    jump;

  const land =
    find(/land/i);

  const attack =
    find(
      /attack|slash|punch|swing/i,
    );

  const hit =
    find(
      /hit|damage|hurt/i,
    );

  const dead =
    find(
      /death|dead|die/i,
    );

  /**
   * State-to-clip mapping.
   *
   * Walk is now a real first-class locomotion state.
   */
  const stateClips = {
    Idle: idle,

    Walk:
      walk ||
      run ||
      idle,

    Run:
      run ||
      walk ||
      idle,

    Sprint:
      sprint ||
      run ||
      walk ||
      idle,

    Jump:
      jump ||
      idle,

    Fall:
      fall ||
      jump ||
      idle,

    Land:
      land ||
      idle,

    Attack:
      attack ||
      idle,

    Hit:
      hit ||
      idle,

    Dead:
      dead ||
      idle,
  };

  const actions = new Map();

  for (
    const clip of new Set(
      Object.values(
        stateClips,
      ).filter(Boolean),
    )
  ) {
    actions.set(
      clip,
      mixer.clipAction(clip),
    );
  }

  for (
    const clip of [
      land,
      attack,
      hit,
      dead,
    ].filter(Boolean)
  ) {
    actions
      .get(clip)
      .setLoop(
        THREE.LoopOnce,
        1,
      );

    actions
      .get(clip)
      .clampWhenFinished = true;
  }

  let current =
    idle
      ? actions.get(idle)
      : null;

  if (current) {
    current.play();
  }

  let disposed = false;
  let activeState = 'Idle';
  let playbackRate = 1;
  let lean = 0;
  let landing = 0;
  let death = 0;

  const baseHeight =
    fitted.position.y;

  const speeds =
    meta.animationSpeeds || {
      walk: 4.2,
      run: 8,
      sprint: 11.5,
    };

  return {
    group,
    meta,
    height: targetHeight,
    mixer,

    get diagnostics() {
      return {
        imported: true,
        animations:
          clips.map(
            clip => clip.name,
          ),
        activeAction:
          current?.getClip()
            .name || null,
        state: activeState,
        playbackRate,
        orientationYaw:
          facing.rotation.y,
        rootMotion:
          'in-place',
        disposed,
      };
    },

    animate(
      dt,
      {
        speed = 0,
        moving = false,
        sprinting = false,
        jumping = false,
        attacking = false,
        state,
        time = 0,
      } = {},
    ) {
      if (disposed) {
        return;
      }

      dt = Math.min(
        Math.max(dt, 0),
        0.1,
      );

      /**
       * Animation state priority:
       *
       * 1. Explicit `state`
       * 2. Attack
       * 3. Jump
       * 4. Sprint
       * 5. Walk
       * 6. Idle
       *
       * Previously normal movement became Run here.
       * That is why the Walk animation disappeared.
       */
      const nextState =
        state ||
        (
          attacking
            ? 'Attack'
            : jumping
              ? 'Jump'
              : moving
                ? (
                    sprinting
                      ? 'Sprint'
                      : 'Walk'
                  )
                : 'Idle'
        );

      attacking ||=
        nextState === 'Attack';

      const next =
        actions.get(
          stateClips[nextState] ||
          idle,
        );

      /**
       * Smoothly transition between animation states.
       */
      if (
        next &&
        next !== current
      ) {
        next
          .reset()
          .setEffectiveWeight(1)
          .fadeIn(0.18)
          .play();

        current?.fadeOut(0.18);

        current = next;
      }

      /**
       * All locomotion states drive the gait.
       */
      const locomotion =
        nextState === 'Walk' ||
        nextState === 'Run' ||
        nextState === 'Sprint';

      /**
       * Determine animation playback speed
       * from the actual animation selected.
       */
      const clip =
        current?.getClip();

      const referenceSpeed =
        /walk/i.test(
          clip?.name || '',
        )
          ? speeds.walk
          : /sprint/i.test(
              clip?.name || '',
            )
            ? speeds.sprint
            : speeds.run;

      /**
       * Adjust animation playback rate
       * based on actual movement speed.
       */
      const targetRate =
        locomotion &&
        Number.isFinite(speed)
          ? THREE.MathUtils.clamp(
              speed /
                referenceSpeed,
              0.12,
              2.5,
            )
          : 1;

      playbackRate =
        THREE.MathUtils.damp(
          playbackRate,
          targetRate,
          16,
          dt,
        );

      current?.setEffectiveTimeScale(
        playbackRate,
      );

      /**
       * Landing should be short and snappy.
       */
      if (
        nextState === 'Land' &&
        land
      ) {
        current?.setEffectiveTimeScale(
          Math.max(
            1,
            land.duration / 0.28,
          ),
        );
      }

      activeState =
        nextState;

      mixer?.update(dt);

      /**
       * Small procedural adjustments
       * for states not explicitly animated
       * by the imported GLB.
       */
      lean =
        THREE.MathUtils.damp(
          lean,
          nextState === 'Hit' &&
          !hit
            ? -0.12
            : attacking &&
              !attack
              ? 0.07
              : 0,
          18,
          dt,
        );

      landing =
        THREE.MathUtils.damp(
          landing,
          nextState === 'Land' &&
          !land
            ? 0.09
            : 0,
          20,
          dt,
        );

      death =
        THREE.MathUtils.damp(
          death,
          nextState === 'Dead' &&
          !dead
            ? 1.25
            : 0,
          6,
          dt,
        );

      facing.rotation.x =
        lean;

      facing.rotation.z =
        death +
        (
          attacking &&
          !attack
            ? Math.sin(
                time * 22,
              ) * 0.025
            : 0
        );

      fitted.position.y =
        baseHeight -
        landing;
    },

    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;

      mixer?.stopAllAction();
      mixer?.uncacheRoot(model);

      if (shared) {
        group.removeFromParent();
      } else {
        disposeObject(group);
      }
    },
  };
}

export async function createHero(
  id = 'warden',
) {
  const meta =
    HEROES.find(
      hero => hero.id === id,
    ) ||
    HEROES[0];

  return meta.imported
    ? makeImported(meta)
    : makeBuiltin(meta);
}
/**
 * Build `count` automatons from a single download.
 *
 * Every member gets its own skeleton and mixer so they can walk
 * out of step, while geometry, materials and textures stay shared.
 * Those shared buffers belong to the squad, not to any one member,
 * so only `squad.dispose()` releases them.
 */
export async function createEnemySquad(
  count = 1,
  meta = ENEMY,
) {
  const source =
    await loadImportedScene(
      meta.model,
    );

  const members = [];

  try {
    for (
      let i = 0;
      i < count;
      i++
    ) {
      members.push(
        await makeImported(
          meta,
          {
            preloaded: {
              scene: cloneRigged(
                source.scene,
              ),
              animations:
                source.animations,
            },
            shared: true,
          },
        ),
      );
    }
  } catch (error) {
    members.forEach(
      member => member.dispose(),
    );

    disposeObject(source.scene);
    throw error;
  }

  return {
    members,
    meta,

    dispose() {
      members.forEach(
        member => member.dispose(),
      );

      // The source still owns every shared buffer.
      disposeObject(source.scene);
    },
  };
}
