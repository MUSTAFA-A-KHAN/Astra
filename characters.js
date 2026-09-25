import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneRigged } from 'three/addons/utils/SkeletonUtils.js';
import { createRidingAnchor } from './riding.js';

/**
 * Built-in adventurers are original, lightweight geometry;
 * optional GLBs stay on demand.
 */
export const HEROES = [
  {
    id: 'warden',
    name: 'Cael',
    title: 'The Warden',
    role: 'Vanguard',
    description:
      'A steady blade. An unbroken oath. Stand your ground with sword and shield.',
    color: '#d9b775',
    stats: { power: 90, agility: 58, magic: 24 },
    speed: 9,
    damage: 34,
    cooldown: 0.62,
    range: 6.2,
    ability: 'Sunsteel strike',
    weapon: 'Sword & shield',
  },

  {
    id: 'ranger',
    name: 'Lyra',
    title: 'The Wayfinder',
    role: 'Ranger',
    description:
      'Follow the wind beyond the familiar. A nimble scout with an unerring bow.',
    color: '#98caa2',
    stats: { power: 65, agility: 95, magic: 42 },
    speed: 10.5,
    damage: 24,
    cooldown: 0.4,
    range: 10,
    ability: 'Gale arrow',
    weapon: 'Forest bow',
  },
  

  {
    id: 'mage',
    name: 'Elowen',
    title: 'The Arcanist',
    role: 'Spellweaver',
    description:
      'Ancient light answers your call. Unravel the wild with a crystal-tipped staff.',
    color: '#baaff1',
    stats: { power: 68, agility: 55, magic: 98 },
    speed: 8.6,
    damage: 38,
    cooldown: 0.72,
    range: 12,
    ability: 'Astral pulse',
    weapon: 'Moonstone staff',
  },

  {
    id: 'rei',
    name: 'Rei',
    title: 'The Wanderer',
    role: 'Guest adventurer',
    description:
      'Your original blue-haired adventurer, ready for a new world.',
    color: '#a7d9f2',
    stats: { power: 70, agility: 86, magic: 65 },
    speed: 10,
    damage: 27,
    cooldown: 0.5,
    range: 8,
    ability: 'Spirit strike',
    weapon: 'Spirit energy',

    imported: true,
    size: '16 MB',
    model: './rigged-model-optimized.glb',

    orientationYaw: 0,

    // Trim on top of the measured stride. 1 keeps the feet
    // exactly on the ground; nudge a model that reads heavy.
    animationSpeeds: {
      walk: 1,
      run: 1,
      sprint: 1,
    },
  },
  {
    id: 'Spiderman',
    name: 'Spiderman',
    title: 'The Web Crawler',
    role: 'Guest adventurer',
    description:
      'Your original web-slinging adventurer, ready for a new world.',
    color: '#a7d9f2',
    stats: { power: 70, agility: 86, magic: 65 },
    speed: 10,
    damage: 27,
    cooldown: 0.5,
    range: 8,
    ability: 'Spirit strike',
    weapon: 'Spirit energy',

    imported: true,
    size: '24 MB',
    model: './gwen_stacy.glb',

    orientationYaw: 0,

    // Trim on top of the measured stride. 1 keeps the feet
    // exactly on the ground; nudge a model that reads heavy.
    animationSpeeds: {
      walk: 1,
      run: 1,
      sprint: 1,
    },

    // She ships a whole songbook of dances; each press of Dance
    // picks another. The hands-on-hips routines start from a pose
    // of their own and the leg-kick one never lets its leg down,
    // so only the ones that begin and end standing are here.
    clips: {
      Dance: [
        /DanceGroovy_01_Loop/,
        /DanceChickenWing/,
        /DanceSprinkler/,
        /^UAL1_Standard:Dance_Loop$/,
      ],
    },
  },
  {
    id: 'Horse',
    name: 'Horse',
    title: 'The Horse',
    role: 'Mount',
    description:
      'A loyal steed to carry you across the land. Fast and reliable, perfect for long journeys.',
    color: '#98caa2',
    stats: { power: 65, agility: 95, magic: 42 },
    imported: true,
    size: '16 MB',
    model: './horse.glb',
    speed: 10.5,
    damage: 24,
    cooldown: 0.4,
    range: 10,
    ability: 'Gale arrow',
    weapon: 'Forest bow',

    // Its "hands" are its forelegs: it wears a headlamp instead.
    flashlight: {
      bone: /^BN_Head_00/,
      kind: 'head',
      offset: [0, 0.2, 0.15],
      size: 0.8,
    },
  },

  {
    id: 'arthur',
    name: 'Arthur',
    title: 'The Outrider',
    role: 'Guest adventurer',
    description:
      'Your original frontier wanderer. A familiar face on an unfamiliar horizon.',
    color: '#d3ac87',
    stats: { power: 85, agility: 72, magic: 36 },
    speed: 12,
    damage: 32,
    cooldown: 0.58,
    range: 7,
    ability: 'Frontier strike',
    weapon: 'Outrider prowess',

    imported: true,
    size: '21 MB',
    model: './Arthur-rigged-under-25mb.glb',

    // Emotes ride in their own file. The model is 21 MB of mesh
    // and half a megabyte of clips; baking gestures into it would
    // mean reshipping all 21 MB to add a wave. Built by
    // `tools/retarget-emotes.py`.
    emotes: './arthur-emotes.glb',

    orientationYaw: 0,

    animationSpeeds: {
      walk: 1,
      run: 1,
      sprint: 1,
    },
  },

  {
    id: 'soldier',
    name: 'Soldier',
    title: 'The Soldier',
    role: 'Guest adventurer',
    description:
      'A battle-tested soldier ready for the journey.',
    color: '#8fa8b8',
    stats: { power: 80, agility: 75, magic: 20 },
    speed: 11,
    damage: 30,
    cooldown: 0.55,
    range: 7,
    ability: 'Combat strike',
    weapon: 'Military blade',

    imported: true,
    size: 'External GLB',
    model:
      'https://threejs.org/examples/models/gltf/Soldier.glb',

    // Soldier.glb faces the opposite direction from Astra movement.
    orientationYaw: Math.PI,

    animationSpeeds: {
      walk: 1,
      run: 1,
      sprint: 1,
    },
  },

  {
    id: 'female-soldier',
    name: 'Female-Soldier',
    title: 'The Soldier',
    role: 'Guest adventurer',
    description:
      'A battle-tested soldier ready for the journey.',
    color: '#8fa8b8',
    stats: { power: 80, agility: 75, magic: 20 },
    speed: 11,
    damage: 30,
    cooldown: 0.55,
    range: 7,
    ability: 'Combat strike',
    weapon: 'Military blade',

    imported: true,
    size: '92 MB',
    model:
      'https://github.com/MUSTAFA-A-KHAN/Astra/releases/download/female/realistic_female.glb',

    orientationYaw: 0,

    animationSpeeds: {
      walk: 1,
      run: 1,
      sprint: 1,
    },
  },
];

/**
 * Enemy
 */
// One of the drowned of the Long Tide: see story-script.js.
export const ENEMY = {
  id: 'wisp',
  name: 'Restless Wisp',
  title: 'The Restless',
  role: 'Hostile',
  description:
    'Someone the sea took, still drifting where they drowned.',
  color: '#9380b0',
  imported: true,
  model: './assets/story/restless-wisp.glb',
  height: 3,
  orientationYaw: 0,

  animationSpeeds: {
    walk: 1,
    run: 1,
    sprint: 1,
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

/**
 * Lightweight geometry builder.
 */
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
    const geo = geometry.index
      ? geometry.toNonIndexed()
      : geometry;

    if (geo !== geometry) {
      geometry.dispose();
    }

    geo.deleteAttribute('uv');

    const transform =
      new THREE.Matrix4().compose(
        new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...rotation),
        ),
        new THREE.Vector3(...scale),
      );

    geo.applyMatrix4(transform);

    const tint = new THREE.Color(color);

    const count =
      geo.attributes.position.count;

    const colors =
      new Float32Array(count * 3);

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

  box(
    color,
    position,
    scale,
    rotation,
  ) {
    return this.add(
      new THREE.BoxGeometry(1, 1, 1),
      color,
      position,
      scale,
      rotation,
    );
  }

  ball(
    color,
    position,
    scale,
    rotation,
  ) {
    return this.add(
      new THREE.IcosahedronGeometry(1, 1),
      color,
      position,
      scale,
      rotation,
    );
  }

  gem(
    color,
    position,
    scale,
    rotation,
  ) {
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

  beam(
    color,
    start,
    end,
    radius,
    sides = 6,
  ) {
    const a =
      new THREE.Vector3(...start);

    const b =
      new THREE.Vector3(...end);

    const direction =
      b.clone().sub(a);

    const rotation =
      new THREE.Euler().setFromQuaternion(
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
    const geometry =
      mergeGeometries(
        this.parts,
        false,
      );

    this.parts.forEach(
      part => part.dispose(),
    );

    this.parts.length = 0;

    const mesh =
      new THREE.Mesh(
        geometry,
        material,
      );

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }
}

function capeGeometry(
  width = 1.05,
  length = 1.5,
) {
  const vertices = [];

  const columns = 6;
  const rows = 5;

  const point = (x, y) => {
    const spread =
      0.68 + y * 0.52;

    return [
      (x - 0.5) *
        width *
        spread,

      -y * length,

      -0.18 -
        y * 0.21 -
        Math.sin(x * Math.PI) * 0.14 +
        Math.cos(x * Math.PI * 6) *
          y *
          0.045,
    ];
  };

  for (let y = 0; y < rows; y++) {
    for (
      let x = 0;
      x < columns;
      x++
    ) {
      const a =
        point(
          x / columns,
          y / rows,
        );

      const b =
        point(
          (x + 1) / columns,
          y / rows,
        );

      const c =
        point(
          x / columns,
          (y + 1) / rows,
        );

      const d =
        point(
          (x + 1) / columns,
          (y + 1) / rows,
        );

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

  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      vertices,
      3,
    ),
  );

  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Where a hero carries the flashlight: the part of the rig that
 * holds it, and the prop's place in that part's frame.
 *
 * `point` is in the hero's own space. The prop is laid there
 * pointing the way the hero faces, a little below level, for the
 * pose the rig is in when this is measured — at rest, so that it
 * swings with the hand from there rather than from a T-pose.
 */
function flashlightGrip(
  root,
  holder,
  point,
  { kind = 'hand', size = 1, pitch = 0.12 } = {},
) {
  root.updateMatrixWorld(true);

  const place =
    new THREE.Matrix4().compose(
      point,
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        pitch,
      ),
      new THREE.Vector3(1, 1, 1),
    );

  const local =
    holder.matrixWorld
      .clone()
      .invert()
      .multiply(root.matrixWorld)
      .multiply(place);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  local.decompose(
    position,
    quaternion,
    scale,
  );

  return {
    kind,
    parent: holder,
    position,
    quaternion,
    // What one unit of the hero's space measures in the holder's.
    scale: scale.x * size,
  };
}

function makeBuiltin(meta) {
  const p = palettes[meta.id];

  const mage =
    meta.id === 'mage';

  const ranger =
    meta.id === 'ranger';

  const group =
    new THREE.Group();

  group.name =
    meta.name;

  const body =
    new THREE.Group();

  group.add(body);

  const material =
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.08,
      flatShading: true,
    });

  const clothMaterial =
    material.clone();

  clothMaterial.side =
    THREE.DoubleSide;

  const glowMaterial =
    new THREE.MeshStandardMaterial({
      color: '#b4f5fa',
      emissive: '#4cbfdd',
      emissiveIntensity: 0.85,
      roughness: 0.32,
      flatShading: true,
    });

  const addSegment = (
    parent,
    position,
    sculpt,
  ) => {
    const joint =
      new THREE.Group();

    joint.position.set(
      ...position,
    );

    if (sculpt) {
      joint.add(
        sculpt.mesh(material),
      );
    }

    parent.add(joint);

    return joint;
  };

  const torso =
    new Sculpt()
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
      const x =
        0.30 +
        (i % 3) * 0.065;

      const z =
        -0.46 +
        Math.floor(i / 3) * 0.07;

      torso.beam(
        p.edge,
        [x, 2.35, z],
        [
          x + 0.15,
          2.98 +
            (i % 2) * 0.07,
          z,
        ],
        0.014,
        4,
      );

      torso.gem(
        p.light,
        [
          x + 0.145,
          2.87 +
            (i % 2) * 0.07,
          z,
        ],
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

  body.add(
    torso.mesh(material),
  );

  const face =
    new Sculpt()
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
      [
        (i - 2) * 0.115,
        0.21 - i * 0.014,
        0.235,
      ],
      [
        0.097,
        0.16 +
          (i % 2) * 0.05,
        0.10,
      ],
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

  const head =
    addSegment(
      body,
      [0, 2.98, 0.025],
      face,
    );

  const hips = [];
  const knees = [];
  const shoulders = [];
  const elbows = [];

  for (const side of [-1, 1]) {
    const leg =
      new Sculpt()
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
          mage
            ? p.light
            : p.leather,
          [0, -0.51, 0.065],
          [0.165, 0.145, 0.175],
        );

    const hip =
      addSegment(
        body,
        [side * 0.24, 1.20, 0],
        leg,
      );

    const lower =
      new Sculpt()
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

    const knee =
      addSegment(
        hip,
        [0, -0.63, 0],
        lower,
      );

    hips.push(hip);
    knees.push(knee);

    const upper =
      new Sculpt()
        .cylinder(
          p.cloth,
          [0, -0.20, 0],
          0.20,
          0.15,
          0.5,
          7,
        )
        .ball(
          meta.id === 'warden'
            ? p.metal
            : p.light,
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

    const shoulder =
      addSegment(
        body,
        [side * 0.59, 2.44, 0],
        upper,
      );

    const lowerArm =
      new Sculpt()
        .cylinder(
          mage
            ? p.cloth
            : p.skin,
          [0, -0.18, 0],
          0.13,
          mage
            ? 0.205
            : 0.105,
          0.40,
          7,
        )
        .cylinder(
          mage
            ? p.edge
            : p.leather,
          [0, -0.27, 0],
          mage
            ? 0.198
            : 0.137,
          mage
            ? 0.208
            : 0.13,
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

    const elbow =
      addSegment(
        shoulder,
        [0, -0.50, 0],
        lowerArm,
      );

    shoulders.push(shoulder);
    elbows.push(elbow);
  }

  const cape =
    new THREE.Group();

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
        mage
          ? p.dark
          : p.cloth,
      )
      .mesh(clothMaterial),
  );

  body.add(cape);

  const weapons =
    new Sculpt();

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

    const sword =
      weapons.mesh(material);

    sword.rotation.x =
      -0.25;

    elbows[1].add(sword);

    const shield =
      new Sculpt()
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

    elbows[0].add(
      shield.mesh(material),
    );
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

    for (
      let i = 0;
      i < bowPoints.length - 1;
      i++
    ) {
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

    elbows[0].add(
      weapons.mesh(material),
    );
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
          [
            0.10 + side * 0.22,
            1.14,
            0.035,
          ],
          0.039,
        )
        .beam(
          p.edge,
          [
            0.10 + side * 0.22,
            1.14,
            0.035,
          ],
          [
            0.10 + side * 0.15,
            1.40,
            0.035,
          ],
          0.032,
        );
    }

    elbows[1].add(
      weapons.mesh(material),
    );

    crystal =
      new THREE.Mesh(
        new THREE.OctahedronGeometry(
          0.23,
        ),
        glowMaterial,
      );

    crystal.position.set(
      0.10,
      1.32,
      0.035,
    );

    crystal.scale.y =
      1.45;

    elbows[1].add(crystal);
  }

  /**
   * The hand left free by the weapons, which raises the flashlight
   * ahead of the hero after dark. The warden has neither hand free
   * and carries it on the shield instead.
   */
  const freeHand =
    mage ? 0 : ranger ? 1 : null;

  const HOLD_SHOULDER = -0.3;
  const HOLD_ELBOW = -0.95;

  let phase = 0;
  let locomotion = 0;
  let attackAmount = 0;
  let landing = 0;
  let death = 0;
  let hold = 0;
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
      holding = false,
      state,
      time = 0,
    } = {},
  ) => {
    if (disposed) return;

    dt = Math.min(
      Math.max(dt, 0),
      0.1,
    );

    activeState =
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
      activeState === 'Attack';

    const airborne =
      activeState === 'Jump' ||
      activeState === 'Fall';

    locomotion =
      THREE.MathUtils.damp(
        locomotion,
        moving &&
          !airborne &&
          activeState !== 'Dead'
          ? 1
          : 0,
        10,
        dt,
      );

    landing =
      THREE.MathUtils.damp(
        landing,
        activeState === 'Land'
          ? 1
          : 0,
        18,
        dt,
      );

    death =
      THREE.MathUtils.damp(
        death,
        activeState === 'Dead'
          ? 1
          : 0,
        6,
        dt,
      );

    attackAmount =
      THREE.MathUtils.damp(
        attackAmount,
        attacking ? 1 : 0,
        attacking ? 24 : 10,
        dt,
      );

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
      Math.abs(
        Math.sin(phase),
      ) *
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
      (activeState === 'Hit'
        ? -0.15
        : 0);

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

    hips[0].rotation.x =
      stride;

    hips[1].rotation.x =
      -stride;

    knees[0].rotation.x =
      -Math.max(
        0,
        -Math.sin(phase),
      ) *
      locomotion *
      0.65;

    knees[1].rotation.x =
      -Math.max(
        0,
        Math.sin(phase),
      ) *
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
      Math.sin(time * 1.8) *
        0.014;

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

    // The flashlight is held out ahead, with a little of the
    // stride left in it. A strike still takes the arm with it.
    hold =
      THREE.MathUtils.damp(
        hold,
        holding && freeHand !== null ? 1 : 0,
        8,
        dt,
      );

    if (hold > 0.001) {
      const k = hold * (1 - attackAmount);

      shoulders[freeHand].rotation.x = THREE.MathUtils.lerp(
        shoulders[freeHand].rotation.x,
        HOLD_SHOULDER + (freeHand ? stride : -stride) * 0.12,
        k,
      );

      elbows[freeHand].rotation.x = THREE.MathUtils.lerp(
        elbows[freeHand].rotation.x,
        HOLD_ELBOW,
        k,
      );
    }

    cape.rotation.x =
      -0.06 -
      locomotion * 0.24 +
      Math.sin(time * 3.3) *
        0.055;

    cape.rotation.z =
      Math.sin(time * 2.7) *
        0.025 +
      stride * 0.07;

    if (activeState === 'Read') {
      body.rotation.x = .12;
      shoulders[0].rotation.x = shoulders[1].rotation.x = -.65;
      elbows[0].rotation.x = elbows[1].rotation.x = -.9;
    } else if (activeState === 'Cast') {
      shoulders[0].rotation.x = -1.4;
      shoulders[1].rotation.x = -1.65 + Math.sin(time * 2) * .12;
      elbows[0].rotation.x = -.8;
      elbows[1].rotation.x = -.3;
    } else if (activeState === 'Climb') {
      const reach = Math.sin(time * 5) * .45;
      shoulders[0].rotation.x = -2.5 + reach;
      shoulders[1].rotation.x = -2.5 - reach;
      hips[0].rotation.x = -.55 - reach;
      hips[1].rotation.x = -.55 + reach;
      knees[0].rotation.x = knees[1].rotation.x = -.8;
    } else if (activeState === 'Ride') {
      body.position.y = -1.15;
      hips[0].rotation.x = hips[1].rotation.x = -1.15;
      knees[0].rotation.x = knees[1].rotation.x = -1.1;
      shoulders[0].rotation.x = shoulders[1].rotation.x = -.8;
    } else if (activeState === 'Swim') {
      body.rotation.x = -.7;
      shoulders[0].rotation.x = Math.sin(time * 3) * 1.1;
      shoulders[1].rotation.x = -Math.sin(time * 3) * 1.1;
    }

    if (crystal) {
      crystal.rotation.y =
        time * 0.85;

      glowMaterial.emissiveIntensity =
        0.85 +
        Math.sin(time * 2.5) *
          0.15 +
        attackAmount * 0.6;
    }
  };

  animate(0, {});

  const ridingAnchor = createRidingAnchor(group, body, new THREE.Vector3(0, 1.15, 0));

  /**
   * Measured with the free arm in its holding pose, so the prop
   * points ahead once the arm is raised. The warden's lamp is
   * bolted to the face of the shield, near its upper rim.
   */
  let flashlightMount;

  if (freeHand === null) {
    group.updateMatrixWorld(true);

    flashlightMount =
      flashlightGrip(
        group,
        elbows[0],
        elbows[0].localToWorld(
          new THREE.Vector3(0, -0.02, 0.44),
        ),
        { kind: 'shield', size: 0.8, pitch: 0.08 },
      );
  } else {
    shoulders[freeHand].rotation.x = HOLD_SHOULDER;
    elbows[freeHand].rotation.x = HOLD_ELBOW;
    group.updateMatrixWorld(true);

    flashlightMount =
      flashlightGrip(
        group,
        elbows[freeHand],
        elbows[freeHand].localToWorld(
          new THREE.Vector3(0, -0.47, 0.02),
        ),
        // Sized to show past a fist this broad.
        { size: 1.3 },
      );

    animate(0, {});
  }

  return {
    group,
    meta,
    height: 3.4,
    animate,
    flashlightMount,
    ridingAnchor,

    // The starter heroes are built from primitives and have no
    // gesture clips. Reporting none keeps callers from having to
    // ask whether a character is imported.
    emotes: {},
    cue: () => 0,

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

/**
 * Dispose a complete THREE hierarchy.
 */
function disposeObject(
  object,
  extraMaterials = [],
) {
  const geometries =
    new Set();

  const materials =
    new Set(extraMaterials);

  const textures =
    new Set();

  const images =
    new Set();

  const skeletons =
    new Set();

  object.traverse(child => {
    if (child.geometry) {
      geometries.add(
        child.geometry,
      );
    }

    const list =
      Array.isArray(child.material)
        ? child.material
        : child.material
          ? [child.material]
          : [];

    for (const material of list) {
      materials.add(material);

      for (
        const value of Object.values(
          material,
        )
      ) {
        if (value?.isTexture) {
          textures.add(value);
        }
      }
    }

    if (
      child.isSkinnedMesh &&
      child.skeleton
    ) {
      skeletons.add(
        child.skeleton,
      );
    }
  });

  skeletons.forEach(
    skeleton =>
      skeleton.dispose(),
  );

  geometries.forEach(
    geometry =>
      geometry.dispose(),
  );

  materials.forEach(
    material =>
      material.dispose(),
  );

  textures.forEach(texture => {
    if (texture.image) {
      images.add(
        texture.image,
      );
    }

    texture.dispose();
  });

  images.forEach(image => {
    if (
      typeof image.close ===
      'function'
    ) {
      image.close();
    }
  });

  object.removeFromParent();
}

/**
 * Load an imported GLB.
 */
function loadImportedScene(
  url,
  timeout = 30000,
) {
  return new Promise(
    (resolve, reject) => {
      const controller =
        new AbortController();

      let settled = false;

      const timer =
        setTimeout(() => {
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
          signal:
            controller.signal,
          credentials:
            'same-origin',
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

          return new GLTFLoader()
            .parseAsync(
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
                discarded.add(
                  scene,
                );
              }
            }

            disposeObject(
              discarded,
            );

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
    },
  );
}

/**
 * Clips that ship beside a model rather than inside it.
 *
 * A companion GLB carries the character's skeleton and nothing
 * else — no mesh, no textures — so gestures cost half a megabyte
 * instead of a reshipped model. Its bone names and rest skeleton
 * match the model's, so the tracks bind straight onto the loaded
 * rig and behave like clips that were always there.
 *
 * Every character shares one download per URL: the clips are
 * immutable here, and `inPlaceClip` clones before it edits.
 */
const companionClips = new Map();

function loadCompanionClips(url) {
  if (!url) {
    return Promise.resolve([]);
  }

  if (!companionClips.has(url)) {
    companionClips.set(
      url,
      loadImportedScene(url)
        .then(gltf => {
          // The skeleton was only ever the carrier; the clips
          // reference bones by name, not by object.
          if (gltf.scene) {
            disposeObject(
              gltf.scene,
            );
          }

          return (
            gltf.animations || []
          );
        })
        .catch(error => {
          // A missing gesture file is not worth failing a
          // character over — they simply have no emotes.
          console.warn(
            `[characters] companion clips unavailable: ${url}`,
            error,
          );

          return [];
        }),
    );
  }

  return companionClips.get(
    url,
  );
}

/**
 * A bone whose position carries the character over the ground,
 * when the rig's root bone does not. Some exporters number every
 * node — `mixamorigHips_01` — and a hips bone is the hips either
 * way.
 */
const ROOT_NAME =
  /(hips|pelvis|root)$|hips(_\d+)+$/i;

/**
 * How fast a locomotion clip's own root motion would carry the
 * character across the ground, in world units per second.
 *
 * This is the number that plants the feet: played back at
 * `worldSpeed / stride`, a clip advances its legs exactly as far
 * as the character actually travels. Measure it before
 * `inPlaceClip` strips the translation away; clips authored in
 * place carry no stride and report 0.
 */
function clipStrideSpeed(
  clip,
  model,
) {
  if (
    !clip ||
    !(clip.duration > 0)
  ) {
    return 0;
  }

  for (
    const track of clip.tracks
  ) {
    if (
      !track.name.endsWith(
        '.position',
      ) ||
      track.getValueSize() !== 3
    ) {
      continue;
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
      !ROOT_NAME.test(
        nodeName || '',
      )
    ) {
      continue;
    }

    const values = track.values;
    const last = values.length - 3;

    if (last < 3) {
      return 0;
    }

    // Track values live in the node's parent space, so the
    // parent's world scale turns a stride into world units.
    const parent =
      node?.parent || model;

    parent.updateWorldMatrix(
      true,
      false,
    );

    const scale =
      new THREE.Vector3();

    parent.matrixWorld.decompose(
      new THREE.Vector3(),
      new THREE.Quaternion(),
      scale,
    );

    const dx =
      (values[last] - values[0]) *
      scale.x;

    const dz =
      (values[last + 2] - values[2]) *
      scale.z;

    return (
      Math.hypot(dx, dz) /
      clip.duration
    );
  }

  return 0;
}

/**
 * Remove horizontal root translation.
 *
 * This keeps the game responsible for movement while
 * preserving the actual leg/limb animation.
 *
 * "Horizontal" has to be measured, not assumed. A root track is
 * written in its parent node's space, and that space is only
 * Y-up if the model was authored that way — Arthur's bind pose is
 * rotated a quarter turn, so pinning his X and Z would flatten
 * the bob his legs are standing on and let his real horizontal
 * drift straight through. Projecting onto the character's own up
 * axis keeps whichever components actually carry height and
 * removes whichever actually carry travel, and reduces to pinning
 * X and Z for every model that is Y-up to begin with.
 */
function inPlaceClip(
  clip,
  model,
  rootPositions,
  height,
) {
  const sanitized =
    clip.clone();

  sanitized.tracks =
    sanitized.tracks.map(
      track => {
        if (
          !track.name.endsWith(
            '.position',
          ) ||
          track.getValueSize() !== 3
        ) {
          return track;
        }

        const binding =
          THREE.PropertyBinding
            .parseTrackName(
              track.name,
            );

        const nodeName =
          binding.objectName ===
          'bones'
            ? binding.objectIndex
            : binding.nodeName;

        const node =
          THREE.PropertyBinding
            .findNode(
              model,
              nodeName,
            );

        const rootBone =
          node?.isBone &&
          !node.parent?.isBone;

        if (
          !rootBone &&
          node !== model &&
          !ROOT_NAME.test(
            nodeName || '',
          )
        ) {
          return track;
        }

        if (
          !rootPositions.has(
            track.name,
          )
        ) {
          // The character's up axis, expressed in the space this
          // track is written in.
          const up =
            new THREE.Vector3(
              0,
              1,
              0,
            );

          if (node?.parent) {
            node.parent.updateWorldMatrix(
              true,
              false,
            );

            up.applyMatrix3(
              new THREE.Matrix3()
                .setFromMatrix4(
                  node.parent
                    .matrixWorld,
                )
                .invert(),
            );
          }

          /**
           * One world unit, counted in the units this track is
           * written in — whatever `up` grew or shrank by on its
           * way into the node's space. It is what makes the
           * character's own height comparable with the numbers
           * the track carries.
           */
          const perWorldUnit =
            up.length() || 1;

          up.normalize();

          rootPositions.set(
            track.name,
            {
              origin:
                new THREE.Vector3(
                  track.values[0],
                  track.values[1],
                  track.values[2],
                ),
              up,
              perWorldUnit,
            },
          );
        }

        const {
          origin,
          up,
          perWorldUnit,
        } =
          rootPositions.get(
            track.name,
          );

        const sample =
          new THREE.Vector3();

        /**
         * A root that starts a whole body away from where this
         * character stands was never authored against this rig.
         * A clip baked in another skeleton's world space arrives
         * in that skeleton's units, measured from that scene's
         * origin, and the axis its travel ran down is rarely the
         * one this rig calls up — an imported sprint can sit 780
         * units out along exactly the axis Arthur's quarter turn
         * makes vertical, which is how a sprint becomes flight.
         *
         * The height in such a track is not height, so there is
         * nothing in it worth keeping. Pinning it outright holds
         * the hips where the character stands and leaves the clip
         * to the legs, which are rotations, and do transfer.
         */
        const stray =
          sample
            .set(
              track.values[0],
              track.values[1],
              track.values[2],
            )
            .sub(origin)
            .dot(up);

        const foreign =
          Math.abs(stray) >
          height * perWorldUnit;

        for (
          let i = 0;
          i < track.values.length;
          i += 3
        ) {
          sample
            .set(
              track.values[i],
              track.values[i + 1],
              track.values[i + 2],
            )
            .sub(origin);

          // Keep only what the up axis carries; the rest was
          // the character walking away from the game's position.
          const rise =
            foreign
              ? 0
              : sample.dot(up);

          sample
            .copy(up)
            .multiplyScalar(rise)
            .add(origin);

          track.values[i] =
            sample.x;

          track.values[i + 1] =
            sample.y;

          track.values[i + 2] =
            sample.z;
        }

        return track;
      },
    );

  return sanitized;
}

/**
 * Find an animation using several aliases.
 */
function findAnimation(
  clips,
  patterns,
) {
  for (const pattern of patterns) {
    const result =
      clips.find(clip =>
        pattern.test(
          clip.name,
        ),
      );

    if (result) {
      return result;
    }
  }

  return null;
}

/**
 * The name of the clip a state plays — or of every clip, for a
 * state that picks one of several.
 */
function clipNames(value) {
  return Array.isArray(value)
    ? value.map(clip => clip.name)
    : value?.name ?? null;
}

/**
 * Whether a clip was authored to repeat. Every baker says so in
 * the name: `Dance_Loop`, `Read_Loop_01`.
 */
function looping(clip) {
  return /loop/i.test(clip.name);
}

/**
 * How long a gesture is held. A one-shot runs its length; a loop
 * a second long would be over before anyone saw it, so it repeats
 * for a few seconds.
 */
function holdFor(clip) {
  return looping(clip)
    ? clip.duration *
        Math.max(
          1,
          Math.round(
            6 / clip.duration,
          ),
        )
    : clip.duration;
}

/**
 * One of several clips at random, other than the one just played
 * when there is a choice.
 */
function pickClip(
  clips,
  previous,
) {
  const fresh =
    clips.length > 1
      ? clips.filter(
          clip => clip !== previous,
        )
      : clips;

  return fresh[
    Math.floor(
      Math.random() *
        fresh.length,
    )
  ];
}

/**
 * Imported GLB character.
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

  const model =
    gltf.scene;

  if (!model) {
    throw new Error(
      `The ${meta.name} model did not contain a scene.`,
    );
  }

  const group =
    new THREE.Group();

  group.name =
    meta.name;

  group.add(model);

  model.updateMatrixWorld(
    true,
  );

  const bounds =
    new THREE.Box3()
      .setFromObject(model);

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

  /**
   * Normalize model height.
   */
  model.scale.multiplyScalar(
    targetHeight / size.y,
  );

  model.updateMatrixWorld(
    true,
  );

  bounds.setFromObject(
    model,
  );

  const center =
    bounds.getCenter(
      new THREE.Vector3(),
    );

  /**
   * Orientation wrapper.
   *
   * Animation never modifies this wrapper.
   */
  const facing =
    new THREE.Group();

  facing.name =
    'Asset orientation';

  facing.rotation.y =
    meta.orientationYaw || 0;

  group.add(facing);

  /**
   * Fitted wrapper.
   */
  const fitted =
    new THREE.Group();

  facing.add(fitted);

  fitted.add(model);

  fitted.position.set(
    -center.x,
    -bounds.min.y,
    -center.z,
  );

  /**
   * Character mesh setup.
   */
  model.traverse(child => {
    if (!child.isMesh) {
      return;
    }

    child.castShadow = true;
    child.receiveShadow = true;

    // Imported animations can extend beyond original bounds.
    child.frustumCulled = false;

    const materials =
      Array.isArray(
        child.material,
      )
        ? child.material
        : [child.material];

    materials
      .filter(Boolean)
      .forEach(material => {
        if (
          'roughness' in
          material
        ) {
          material.roughness =
            Math.max(
              0.48,
              material.roughness,
            );
        }
      });
  });

  const sourceClips = [
    ...(gltf.animations || []),
    ...(await loadCompanionClips(
      meta.emotes,
    )),
  ];

  /**
   * IMPORTANT:
   *
   * Print every animation and duration.
   * This lets us immediately see what each GLB contains.
   */
  console.group(
    `[${meta.name}] GLB Animation Diagnostics`,
  );

  console.log(
    'Model:',
    meta.model,
  );

  console.log(
    'Animation count:',
    sourceClips.length,
  );

  for (const clip of sourceClips) {
    console.log(
      `Animation: ${clip.name}`,
      {
        duration: clip.duration,
        tracks:
          clip.tracks.length,
        tracksInfo:
          clip.tracks.map(
            track => ({
              name:
                track.name,
              valueSize:
                track.getValueSize(),
            }),
          ),
      },
    );
  }

  console.groupEnd();

  const rootPositions =
    new Map();

  /**
   * Establish idle/root origin first.
   */
  const sourceIdle =
    findAnimation(
      sourceClips,
      [
        /^idle$/i,
        /idle/i,
        /standing/i,
      ],
    );

  if (sourceIdle) {
    inPlaceClip(
      sourceIdle,
      model,
      rootPositions,
      targetHeight,
    );
  }

  /**
   * Sanitize all clips.
   */
  const clips =
    sourceClips.map(clip =>
      inPlaceClip(
        clip,
        model,
        rootPositions,
        targetHeight,
      ),
    );

  const mixer =
    clips.length
      ? new THREE.AnimationMixer(
          model,
        )
      : null;

  /**
   * The soles, and where they rest on the floor.
   *
   * Measured on the mesh rather than the bones: where a foot bone
   * sits inside the shoe depends on who rigged it, and a rest pose
   * on tiptoe puts it a hand's width above a sole flat on the
   * ground. What counts is the shoe. So these are the lowest of
   * the mesh's vertices in the rest pose — the pose the model was
   * fitted to the ground in, before any clip has moved a bone —
   * and where they rest now is the floor.
   *
   * Only a character with feet: a wisp drifts, and is left to.
   */
  let footed = false;

  model.traverse(node => {
    if (
      node.isBone &&
      /(foot|toe)/i.test(node.name)
    ) {
      footed = true;
    }
  });

  const soleAt =
    new THREE.Vector3();

  // World to the fitted model's space, as of the last `pose`.
  const toFitted =
    new THREE.Matrix4();

  // Where one vertex of a skinned mesh is in the current pose, in
  // the fitted model's space.
  const heightOf = (mesh, index) => {
    soleAt.fromBufferAttribute(
      mesh.geometry.attributes.position,
      index,
    );

    mesh.applyBoneTransform(
      index,
      soleAt,
    );

    return soleAt
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(toFitted).y;
  };

  /**
   * [mesh, vertex] pairs: every vertex in the bottom tenth of the
   * body in the rest pose, thinned to a few hundred. That is the
   * feet and nothing else, and enough of them that a heel or a
   * toe touching down is always among them.
   */
  const soles = [];

  // `updateMatrixWorld`, not `updateWorldMatrix`: only the first
  // refreshes a skinned mesh's bind inverse, and one left from
  // before the model was fitted puts every vertex out by the fit.
  const pose = () => {
    fitted.updateWorldMatrix(
      true,
      false,
    );

    fitted.updateMatrixWorld(true);

    toFitted
      .copy(fitted.matrixWorld)
      .invert();
  };

  if (footed && mixer) {
    pose();

    const low = [];
    let floor = Infinity;

    model.traverse(mesh => {
      if (!mesh.isSkinnedMesh) {
        return;
      }

      const count =
        mesh.geometry.attributes.position.count;

      // A sparse pass is plenty to find the feet, and a dense
      // mesh is not worth skinning whole to do it.
      const step =
        Math.max(
          1,
          Math.ceil(count / 15000),
        );

      for (let i = 0; i < count; i += step) {
        const y = heightOf(mesh, i);

        floor = Math.min(floor, y);
        low.push([mesh, i, y]);
      }
    });

    const feet = low.filter(
      ([, , y]) =>
        y < floor + targetHeight * 0.1,
    );

    const every =
      Math.max(
        1,
        Math.ceil(feet.length / 400),
      );

    for (let i = 0; i < feet.length; i += every) {
      soles.push(feet[i]);
    }
  }

  const lowestSole = () => {
    // The mixer has moved the bones since they were last drawn.
    pose();

    let lowest = Infinity;

    for (const [mesh, index] of soles) {
      lowest = Math.min(
        lowest,
        heightOf(mesh, index),
      );
    }

    return lowest;
  };

  const restSole =
    soles.length
      ? lowestSole()
      : 0;

  /**
   * Animation lookup helper.
   */
  const find = patterns =>
    findAnimation(
      clips,
      patterns,
    );

  /**
   * IDLE
   */
  const idle =
    find([
      /^idle$/i,
      /idle/i,
      /standing/i,
    ]) ||
    clips.find(
      clip =>
        !/t.?pose/i.test(
          clip.name,
        ),
    ) ||
    clips[0];

  /**
   * WALK
   *
   * We deliberately prioritize explicit walking
   * animations before generic movement clips.
   */
  const walk =
    find([
      /^walk$/i,
      /^walking$/i,
      /^walk[_ -]?forward$/i,
      /walk.*forward/i,
      /walking/i,
      /walk/i,
    ]);

  /**
   * RUN
   */
  const run =
    find([
      // A mount gallops rather than runs, and the clip ships
      // namespaced — `Skeleton|Gallop` — so it has to be
      // matched by gait name ahead of the generic run
      // patterns, which would otherwise claim `Jump_Run`.
      /^gallop$/i,
      /gallop/i,
      /^run$/i,
      /^running$/i,
      /^run[_ -]?forward$/i,
      /run.*forward/i,
      /running/i,
      /run/i,
      /^jog$/i,
      /jog.*forward/i,
      /jog/i,
    ]);

  /**
   * SPRINT
   */
  const sprint =
    find([
      /^sprint$/i,
      /sprint/i,
      /fast.*run/i,
    ]) ||
    run ||
    walk;

  /**
   * Jump
   */
  const jump =
    find([
      /^jump$/i,
      /jump.*loop/i,
      /jump.*start/i,
      /jump/i,
    ]);

  /**
   * Fall
   */
  const fall =
    find([
      /fall/i,
      /airborne/i,
    ]) ||
    jump;

  /**
   * Land
   */
  const land =
    find([
      /^land$/i,
      /landing/i,
      /land/i,
    ]);

  /**
   * Attack
   */
  const attack =
    find([
      // The restless wisp's clip is spelt "Action_Atack".
      /at+ack/i,
      /slash/i,
      /punch/i,
      /swing/i,
      /strike/i,
    ]);

  /**
   * Hit
   */
  const hit =
    find([
      /hit/i,
      /damage/i,
      /hurt/i,
      /reaction/i,
    ]);

  /**
   * Death
   */
  const dead =
    find([
      /death/i,
      /dead/i,
      /die/i,
    ]);

  /**
   * EMOTES
   *
   * Played on demand rather than driven by movement, so they are
   * looked up the same way but kept apart from the state machine's
   * fallbacks: a character without them simply has none, instead
   * of silently miming an idle.
   *
   * The patterns stay loose because the same gesture arrives under
   * different names depending on who baked it — a Samba is
   * `Dance` out of `tools/retarget-emotes.py` and
   * `michelle:SambaDance` out of a web rigger.
   *
   * A character can name its own clips for a state instead, in
   * its meta's `clips`. Every pattern there contributes one, so a
   * state given several becomes a set to choose from: a character
   * with a dozen dances does a different one each time.
   */
  const pool = patterns => [
    ...new Set(
      patterns
        .map(pattern => find([pattern]))
        .filter(Boolean),
    ),
  ];

  const lookup = (state, patterns) => {
    const own = meta.clips?.[state];

    if (!own) {
      return find(patterns);
    }

    const chosen = pool(own);

    return chosen.length > 1
      ? chosen
      : chosen[0] || null;
  };

  const emoteClips = {
    Dance:
      lookup('Dance', [
        /^dance$/i,
        /samba/i,
        /dance/i,
      ]),

    Nod:
      lookup('Nod', [
        /^nod$/i,
        /agree/i,
        /^yes$/i,
      ]),

    Shake:
      lookup('Shake', [
        /^shake$/i,
        /head.?shake/i,
        /disagree/i,
        /^no$/i,
      ]),

    Sad:
      lookup('Sad', [
        /^sad$/i,
        /sad/i,
        /defeat/i,
      ]),

    Wave:
      lookup('Wave', [
        /^wave$/i,
        /wave/i,
      ]),

    Cheer:
      lookup('Cheer', [
        /^cheer$/i,
        /heel.?click/i,
        /cheer/i,
        /excited/i,
        /celebrat/i,
      ]),

    Point:
      lookup('Point', [
        /^point$/i,
        /point/i,
      ]),

    Stomp:
      lookup('Stomp', [
        /^stomp$/i,
        /stomp/i,
        /frustrat/i,
      ]),

    Salute:
      lookup('Salute', [
        /^salute$/i,
        /salute/i,
        /hat.?tip/i,
      ]),

    // Whole word only: `Sitting` is not a song.
    Sing:
      lookup('Sing', [
        /^sing$/i,
        /(^|[^a-z])sing([^a-z]|$)/i,
      ]),
  };

  /**
   * ACTIONS
   *
   * What the character does to the world rather than how they
   * feel about it: speaking up, pressing a rune, putting a
   * shoulder to a crate, kneeling at a valve. The game asks for
   * these by situation, never by key, and a character without one
   * just stands through the moment.
   */
  const actionClips = {
    Talk:
      lookup('Talk', [
        /^talk(ing)?$/i,
        /idle.?talk/i,
        /conv.*talk/i,
      ]),

    Interact:
      lookup('Interact', [
        /^interact$/i,
        /interact/i,
      ]),

    Push:
      lookup('Push', [
        /^push$/i,
        /push/i,
      ]),

    Kneel:
      lookup('Kneel', [
        /fixing/i,
        /kneel/i,
        /repair/i,
      ]),
  };

  for (const table of [
    emoteClips,
    actionClips,
  ]) {
    for (const key of Object.keys(
      table,
    )) {
      if (!table[key]) {
        delete table[key];
      }
    }
  }

  /**
   * READING
   *
   * A book is taken out, read, and put away again: an intro that
   * plays once into the reading loop, and an outro on the way
   * back to standing. Either end may be missing and the loop
   * alone still reads; without a loop there is no reading at all.
   */
  const reading = {
    enter:
      find([
        /stand.?trans.?(spell.?)?book/i,
        /read.?start/i,
      ]),

    loop:
      lookup('Read', [
        /^read(ing)?$/i,
        /read.*loop/i,
        /reading/i,
      ]),

    exit:
      find([
        /(spell.?)?book.?trans.?stand/i,
        /read.?stop/i,
      ]),
  };

  const sequences =
    reading.loop
      ? { Read: reading }
      : {};

  /**
   * INJURED
   *
   * Badly hurt, a character nurses the wound: standing hunched
   * over it, walking with a limp. Only the stand and the walk
   * change. A hero with a wound can still run for it.
   */
  const hurtIdle =
    find([
      /injur.*idle/i,
      /wounded.*idle/i,
      /hurt.*idle/i,
    ]);

  const hurtWalk =
    find([
      /injur.*walk/i,
      /wounded.*walk/i,
      /limp/i,
    ]);

  /**
   * FIDGETS
   *
   * Left standing long enough, a character looks about, scratches
   * an itch, sniffs at themselves. Each plays through once, from
   * the idle and back to it.
   */
  const fidgets =
    pool(
      meta.clips?.Fidget || [
        /stand.*idle.*look.?around/i,
        /idle.*scratch/i,
        /stinky.?pits/i,
        /stinky.?bum/i,
        /fidget/i,
      ],
    );

  console.group(
    `[${meta.name}] Selected Animations`,
  );

  console.log(
    'Idle:',
    idle?.name || 'NONE',
  );

  console.log(
    'Walk:',
    walk?.name || 'NONE',
  );

  console.log(
    'Run:',
    run?.name || 'NONE',
  );

  console.log(
    'Sprint:',
    sprint?.name || 'NONE',
  );

  console.log(
    'Jump:',
    jump?.name || 'NONE',
  );

  console.log(
    'Fall:',
    fall?.name || 'NONE',
  );

  console.log(
    'Land:',
    land?.name || 'NONE',
  );

  console.log(
    'Attack:',
    attack?.name || 'NONE',
  );

  console.log(
    'Hit:',
    hit?.name || 'NONE',
  );

  console.log(
    'Death:',
    dead?.name || 'NONE',
  );

  console.log(
    'Emotes:',
    Object.entries(
      emoteClips,
    ).map(
      ([state, clip]) =>
        `${state} -> ${clipNames(clip)}`,
    ),
  );

  console.log(
    'Actions:',
    Object.entries(
      actionClips,
    ).map(
      ([state, clip]) =>
        `${state} -> ${clipNames(clip)}`,
    ),
  );

  console.log(
    'Read:',
    Object.values(reading).map(
      clip => clip?.name || 'NONE',
    ),
  );

  console.log(
    'Injured:',
    hurtIdle?.name || 'NONE',
    hurtWalk?.name || 'NONE',
  );

  console.log(
    'Fidgets:',
    fidgets.map(clip => clip.name),
  );

  console.groupEnd();

  /**
   * Measured gait speeds, in world units per second.
   *
   * Each sanitized clip keeps its source's index, so the original
   * root motion is still there to measure. A clip authored in
   * place reports no stride, and falls back to a share of body
   * height per second — the proportions a walk, a run and a
   * sprint hold across characters of any size.
   */
  const strideOf = clip => {
    const measured =
      clipStrideSpeed(
        sourceClips[
          clips.indexOf(clip)
        ],
        model,
      );

    // An in-place clip still drifts a few billionths of a unit.
    // Anything slower than a crawl is that float noise, not a
    // stride, and must fall through to the estimate.
    return measured >
      targetHeight * 0.15
      ? measured
      : 0;
  };

  const stride = {
    walk:
      strideOf(walk) ||
      targetHeight * 0.8,

    run:
      strideOf(run) ||
      targetHeight * 1.9,

    sprint:
      strideOf(sprint) ||
      targetHeight * 2.6,

    // A limp covers less ground a step than a walk does.
    hurt:
      strideOf(hurtWalk) ||
      targetHeight * 0.55,
  };

  // Gait selection assumes the band is ordered, whatever the
  // source clips happen to measure.
  stride.run = Math.max(
    stride.run,
    stride.walk * 1.4,
  );

  stride.sprint = Math.max(
    stride.sprint,
    stride.run,
  );

  /**
   * A character breaks into the next gait at the geometric mean
   * of the two strides, so each clip runs nearest its authored
   * speed. Sprint stays a deliberate input unless the model
   * actually ships a distinct sprint.
   */
  const runAbove =
    Math.sqrt(
      stride.walk * stride.run,
    );

  const sprintAbove =
    sprint && sprint !== run
      ? Math.sqrt(
          stride.run *
            stride.sprint,
        )
      : Infinity;

  console.log(
    `[${meta.name}] gait speeds`,
    {
      stride,
      runAbove,
      sprintAbove,
    },
  );

  /**
   * State → clip mapping.
   */
  const stateClips = {
    Idle:
      idle,

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

    Wade: walk || idle,
    Climb: find([/climb/i]) || walk || idle,
    Swim: find([/swim/i]) || walk || idle,
    Ride: find([/horse.*rid|riding|mounted|sit.*idle/i]) || idle,

    // No `|| idle` fallback: an emote the character does not have
    // should not be requestable at all, which `emotes` below is
    // how the caller finds out.
    ...emoteClips,
    ...actionClips,

    Cast: find([/cast|spell.*release|magic.*attack/i]) || actionClips.Interact || attack || idle,

    // The loop; its way in and out are in `sequences`.
    ...(reading.loop && {
      Read: reading.loop,
    }),
  };

  /**
   * Build actions.
   */
  const actions =
    new Map();

  for (
    const clip of new Set(
      [
        ...Object.values(
          stateClips,
        ).flat(),
        reading.enter,
        reading.exit,
        hurtIdle,
        hurtWalk,
        ...fidgets,
      ].filter(Boolean),
    )
  ) {
    actions.set(
      clip,
      mixer.clipAction(
        clip,
      ),
    );
  }

  /**
   * One-shot animations.
   *
   * A gesture that is not a loop plays through once and holds its
   * last frame, so the fade back to standing starts from where it
   * ended rather than from a flash of its first frame.
   */
  for (
    const clip of [
      land,
      attack,
      hit,
      dead,
      reading.enter,
      reading.exit,
      ...fidgets,
      ...[
        ...Object.values(emoteClips),
        actionClips.Interact,
        actionClips.Kneel,
      ]
        .flat()
        .filter(
          clip =>
            clip &&
            !looping(clip),
        ),
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
      .clampWhenFinished =
      true;
  }

  /**
   * TURNS
   *
   * A mount ships each gait bent both ways, named after its
   * straight clip — `Skeleton|Walk_L`, `Skeleton|Gallop_R`.
   * While it is being steered the gait blends toward the side
   * it is turning to, so it leans into the curve instead of
   * sliding round on a straight stride.
   */
  const turnVariant = (clip, side) =>
    clips.find(
      other =>
        other.name.startsWith(clip.name) &&
        new RegExp(`^[_ -]?${side}$`, 'i').test(
          other.name.slice(clip.name.length),
        ),
    );

  /**
   * [left, right] turn actions, keyed by the gait's straight
   * action.
   */
  const turnActions =
    new Map();

  for (
    const clip of new Set(
      [walk, run, sprint].filter(Boolean),
    )
  ) {
    const left = turnVariant(clip, 'l(eft)?');
    const right = turnVariant(clip, 'r(ight)?');

    if (left && right) {
      turnActions.set(
        actions.get(clip),
        [left, right].map(turn => mixer.clipAction(turn)),
      );
    }
  }

  /**
   * How fast the character must be turning, in radians per
   * second, before the turn clip plays outright. A gentler
   * curve blends it part way.
   */
  const fullTurnRate = 1.5;

  /**
   * FEET ON THE FLOOR
   *
   * A character's clips come from wherever the clips came from,
   * and they do not all agree on where the floor is. Every
   * standing clip — the idle, if it carries the hips' height, and
   * each gesture — is sampled once, here, before anything plays.
   *
   * Most only disagree by a constant: an idle retargeted from a
   * taller rig stands a hand's width in the air all the way
   * through. Those are moved to the floor once, by the lowest
   * their feet go anywhere in the clip, so a jump for joy still
   * leaves the ground.
   *
   * Some hold the hips at one height while the legs fold beneath
   * them — a clip with no track for the hips, or one whose track
   * never moves — and a kneel hangs in the air. Those are planted
   * as they play: lowered, frame by frame, until the lowest foot
   * rests on the floor.
   *
   * The gaits, jumps and falls are left exactly as they were.
   */
  const rooted =
    new Set(
      clips.filter(clip =>
        clip.tracks.some(track =>
          rootPositions.has(track.name),
        ),
      ),
    );

  let hips = null;

  model.traverse(node => {
    if (
      !hips &&
      node.isBone &&
      /(hips|pelvis)(_\d+)*$/i.test(node.name)
    ) {
      hips = node;
    }
  });

  const hipsAt =
    new THREE.Vector3();

  const standing = [
    ...new Set(
      [
        rooted.has(idle) && idle,
        hurtIdle,
        ...Object.values(emoteClips),
        ...Object.values(actionClips),
        ...Object.values(reading),
        ...fidgets,
      ]
        .flat()
        .filter(Boolean),
    ),
  ];

  // [action, how far it is moved], for the first kind.
  const lifted = [];

  // Actions of the second kind.
  const planted = [];

  if (soles.length) {
    for (const clip of standing) {
      const action =
        actions.get(clip).play();

      let lowest = Infinity;
      let highest = -Infinity;
      let hipsLow = Infinity;
      let hipsHigh = -Infinity;

      for (let i = 0; i <= 8; i++) {
        action.time =
          (clip.duration * i) / 8;

        mixer.update(0);

        const sole =
          lowestSole();

        lowest = Math.min(lowest, sole);
        highest = Math.max(highest, sole);

        if (hips) {
          const y =
            fitted.worldToLocal(
              hips.getWorldPosition(
                hipsAt,
              ),
            ).y;

          hipsLow = Math.min(hipsLow, y);
          hipsHigh = Math.max(hipsHigh, y);
        }
      }

      action.stop();

      // Without a hips bone to watch, feet that rise are enough.
      const hipsStill =
        !hips ||
        hipsHigh - hipsLow <
          targetHeight * 0.01;

      const folds =
        hipsStill &&
        highest - lowest >
          targetHeight * 0.03;

      if (folds) {
        planted.push(action);
      } else {
        lifted.push([
          action,
          restSole - lowest,
        ]);
      }
    }
  }

  let grounding = 0;

  let current =
    idle
      ? actions.get(idle)
      : null;

  if (current) {
    current
      .setEffectiveWeight(1)
      .play();
  }

  /**
   * FLASHLIGHT
   *
   * Carried in the left hand, measured in the idle pose so the
   * prop points ahead with the arm at rest. The grip is inside
   * the fist: most of the way from the wrist to the knuckles, or,
   * for a rig without fingers, a little past the wrist. A meta
   * `flashlight` names a different bone and where on it the
   * light sits — a mount has no hands to hold one.
   */
  const flashlightMount = (() => {
    const spec =
      meta.flashlight || {};

    const matches =
      spec.bone instanceof RegExp
        ? name => spec.bone.test(name)
        : spec.bone
          ? name => name === spec.bone
          // Some exporters number every node: `mixamorigLeftHand_011`.
          : name => /left_?hand(_\d+)?$/i.test(name);

    let holder = null;

    model.traverse(node => {
      if (!holder && node.isBone && matches(node.name)) {
        holder = node;
      }
    });

    if (!holder) {
      return null;
    }

    mixer?.update(0);
    group.updateMatrixWorld(true);

    const inHero = object =>
      group.worldToLocal(
        object.getWorldPosition(
          new THREE.Vector3(),
        ),
      );

    const wrist =
      inHero(holder);

    const fingers =
      holder.children.filter(
        child => child.isBone,
      );

    const point =
      spec.offset
        ? wrist.clone().add(
            new THREE.Vector3(...spec.offset),
          )
        : fingers.length
          ? wrist.clone().lerp(
              fingers
                .reduce(
                  (sum, finger) => sum.add(inHero(finger)),
                  new THREE.Vector3(),
                )
                .divideScalar(fingers.length),
              0.6,
            )
          : wrist.clone().add(
              wrist.clone()
                .sub(inHero(holder.parent))
                .multiplyScalar(0.3),
            );

    return flashlightGrip(
      group,
      holder,
      point,
      {
        kind: spec.kind || 'hand',
        size: spec.size || 1,
        pitch: spec.pitch ?? 0.12,
      },
    );
  })();

  let disposed = false;
  let activeState = 'Idle';

  /**
   * Animation playback multiplier.
   */
  let playbackRate = 1;

  let lean = 0;
  let landing = 0;
  let death = 0;

  /**
   * How far into its turn clips the gait has blended: 1 is
   * fully turning left, -1 fully right.
   */
  let turning = 0;

  /**
   * A clip played through once between two states — a book being
   * opened on the way into reading, or closed on the way out.
   */
  let bridge = null;

  /**
   * For a state with several clips, the one it is playing; and the
   * states the caller has already picked for with `cue`, so
   * entering them does not pick again.
   */
  const picked = {};
  const cued = new Set();

  const clipOf = state => {
    const options =
      stateClips[state];

    return Array.isArray(options)
      ? (picked[state] ??= pickClip(options))
      : options;
  };

  /**
   * How long the character has stood idle, how long they will
   * stand before fidgeting, and the fidget playing, if one is.
   */
  let idleFor = 0;
  let restlessAfter = 9;
  let fidgeting = null;
  let lastFidget = null;

  const finished = action =>
    action.time >=
    action.getClip().duration - 1e-4;

  /**
   * Per-character trim on top of the measured gait, for models
   * whose clips read a little heavy or a little light. 1 means
   * "play it exactly as fast as the character is travelling".
   */
  const speeds =
    meta.animationSpeeds || {
      walk: 1,
      run: 1,
      sprint: 1,
    };

  const baseHeight =
    fitted.position.y;

  // Feet are the model origin, but a rider meets the saddle at the pelvis.
  // Measure in fitted space so imported sizes and sitting root offsets agree.
  mixer?.update(0);
  const pelvis = hips;
  const seatPoint = pelvis
    ? group.worldToLocal(pelvis.getWorldPosition(new THREE.Vector3()))
    : new THREE.Vector3(0, targetHeight * .5, 0);
  // The seated mesh contacts the saddle about .27 units below the hip joint.
  seatPoint.y -= targetHeight * .08;
  const ridingAnchor = createRidingAnchor(group, pelvis || group, seatPoint);


  /**
   * Emotes this character can actually play, and how long each
   * one runs. The caller drives them by passing the state name
   * back into `animate`, and needs the duration to know when to
   * hand control back to movement. A state with several clips
   * reports its first; `cue` says which is coming, and for how
   * long.
   */
  const emotes =
    Object.fromEntries(
      Object.entries(
        emoteClips,
      ).map(
        ([state, clip]) => [
          state,
          holdFor(
            [clip].flat()[0],
          ),
        ],
      ),
    );

  return {
    group,
    meta,
    height: targetHeight,
    mixer,
    emotes,
    flashlightMount,
    ridingAnchor,

    /**
     * Get a gesture or an action ready: choose which of its clips
     * plays next, and say how many seconds it runs. The caller
     * holds the state that long, then hands back to movement.
     * Nothing to play is 0.
     */
    cue(state) {
      const options =
        stateClips[state];

      if (
        disposed ||
        !options ||
        state in sequences
      ) {
        return 0;
      }

      if (Array.isArray(options)) {
        picked[state] =
          pickClip(
            options,
            picked[state],
          );

        // Already in it, the new clip simply takes over.
        if (state !== activeState) {
          cued.add(state);
        }
      }

      return holdFor(
        clipOf(state),
      );
    },

    get diagnostics() {
      return {
        imported: true,

        animations:
          clips.map(
            clip => clip.name,
          ),

        selectedAnimations: {
          idle:
            idle?.name ||
            null,

          walk:
            walk?.name ||
            null,

          run:
            run?.name ||
            null,

          sprint:
            sprint?.name ||
            null,

          jump:
            jump?.name ||
            null,

          fall:
            fall?.name ||
            null,

          land:
            land?.name ||
            null,

          attack:
            attack?.name ||
            null,

          hit:
            hit?.name ||
            null,

          dead:
            dead?.name ||
            null,

          emotes:
            Object.fromEntries(
              Object.entries(
                emoteClips,
              ).map(
                ([
                  state,
                  clip,
                ]) => [
                  state,
                  clipNames(clip),
                ],
              ),
            ),

          actions:
            Object.fromEntries(
              Object.entries(
                actionClips,
              ).map(
                ([
                  state,
                  clip,
                ]) => [
                  state,
                  clipNames(clip),
                ],
              ),
            ),

          read:
            reading.loop
              ? {
                  enter:
                    reading.enter?.name ||
                    null,
                  loop:
                    reading.loop.name,
                  exit:
                    reading.exit?.name ||
                    null,
                }
              : null,

          injured: {
            idle:
              hurtIdle?.name ||
              null,
            walk:
              hurtWalk?.name ||
              null,
          },

          fidgets:
            fidgets.map(
              clip => clip.name,
            ),

          // [left, right] turn clips, for the gaits that have them.
          turns:
            Object.fromEntries(
              Object.entries({
                walk,
                run,
                sprint,
              })
                .filter(([, clip]) =>
                  turnActions.has(actions.get(clip)),
                )
                .map(([gait, clip]) => [
                  gait,
                  turnActions
                    .get(actions.get(clip))
                    .map(turn => turn.getClip().name),
                ]),
            ),
        },

        activeAction:
          current
            ?.getClip()
            ?.name ||
          null,

        turning,

        // How far a hipless gesture has been lowered to the floor.
        grounding,

        // The turn clip carrying most of the stride, if either is.
        turnAction:
          Math.abs(turning) > 0.5
            ? turnActions
                .get(current)
                ?.[turning > 0 ? 0 : 1]
                .getClip()
                .name ?? null
            : null,

        state:
          activeState,

        // The idle fidget or the way into or out of a state,
        // while one is playing.
        fidget:
          fidgeting?.name ||
          null,

        bridge:
          bridge?.name ||
          null,

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
        // Badly hurt: stand hunched and walk with a limp.
        injured = false,
        // Whether standing still long enough may turn into a
        // fidget. Off while listening to someone.
        fidget = true,
        moving = false,
        sprinting = false,
        jumping = false,
        attacking = false,
        // Radians per second, positive to the character's left.
        turnRate = 0,
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
       * State priority:
       *
       * Explicit state
       * ↓
       * Attack
       * ↓
       * Jump
       * ↓
       * Sprint
       * ↓
       * Walk
       * ↓
       * Idle
       */
      /**
       * The gait follows how fast the character is actually
       * travelling. Choosing it from a `moving` flag alone is
       * what made every hero stroll at sprinting speed.
       */
      const gait =
        sprinting ||
        speed >= sprintAbove
          ? 'Sprint'
          : speed >= runAbove
            ? 'Run'
            : 'Walk';

      const nextState =
        state ||
        (
          attacking
            ? 'Attack'
            : jumping
              ? 'Jump'
              : moving
                ? gait
                : 'Idle'
        );

      attacking ||=
        nextState === 'Attack';

      /**
       * Ways in and out. A state with an intro plays it once before
       * its loop, and one with an outro plays that on the way back
       * to standing: a book is closed and put away, not dropped.
       * Anything but standing still cuts the outro short.
       */
      if (nextState !== activeState) {
        bridge =
          sequences[nextState]?.enter ||
          (
            nextState === 'Idle'
              ? sequences[activeState]?.exit
              : null
          ) ||
          null;

        // A state with several clips picks afresh each time it is
        // entered, unless the caller has just picked with `cue`.
        if (
          Array.isArray(
            stateClips[nextState],
          ) &&
          !cued.delete(nextState)
        ) {
          picked[nextState] =
            pickClip(
              stateClips[nextState],
              picked[nextState],
            );
        }
      }

      if (
        bridge &&
        current?.getClip() === bridge &&
        finished(current)
      ) {
        bridge = null;
      }

      /**
       * Fidgets. Standing still long enough plays one through,
       * then the idle takes back over and the wait starts again.
       */
      if (
        nextState === 'Idle' &&
        fidget &&
        !injured &&
        !bridge &&
        fidgets.length
      ) {
        idleFor += dt;

        if (
          !fidgeting &&
          idleFor > restlessAfter
        ) {
          fidgeting =
            pickClip(
              fidgets,
              lastFidget,
            );
        }
      } else {
        idleFor = 0;
        fidgeting = null;
      }

      if (
        fidgeting &&
        current?.getClip() === fidgeting &&
        finished(current)
      ) {
        lastFidget = fidgeting;
        fidgeting = null;
        idleFor = 0;
        restlessAfter =
          8 + Math.random() * 10;
      }

      const limping =
        injured &&
        nextState === 'Walk' &&
        !!hurtWalk;

      /**
       * Get animation for state.
       */
      const next =
        actions.get(
          bridge ||
          fidgeting ||
          (
            injured &&
            nextState === 'Idle' &&
            hurtIdle
          ) ||
          (limping && hurtWalk) ||
          clipOf(nextState) ||
          idle,
        );

      /**
       * Smooth transition.
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

        // A gait's turn clips fade with it, starting in step.
        for (const turn of turnActions.get(next) || []) {
          turn
            .reset()
            .fadeIn(0.18)
            .play();
        }

        current?.fadeOut(
          0.18,
        );

        for (const turn of turnActions.get(current) || []) {
          turn.fadeOut(0.18);
        }

        current = next;
      }

      /**
       * Locomotion states.
       */
      const locomotion =
        nextState === 'Walk' ||
        nextState === 'Run' ||
        nextState === 'Sprint';

      /**
       * Match the stride to the travel.
       *
       * A flat multiplier cannot do this: it leaves the feet
       * skating whenever movement speed and the clip's authored
       * speed disagree. Dividing by the gait's measured stride
       * plants them, and the clamp keeps a character who outruns
       * their own animation from looking frantic.
       */
      let targetRate = 1;

      if (
        locomotion &&
        Number.isFinite(speed)
      ) {
        const reference =
          limping
            ? stride.hurt
            : nextState === 'Walk'
              ? stride.walk
              : nextState === 'Sprint'
                ? stride.sprint
                : stride.run;

        const trim =
          nextState === 'Walk'
            ? speeds.walk
            : nextState === 'Sprint'
              ? speeds.sprint
              : speeds.run;

        targetRate =
          THREE.MathUtils.clamp(
            speed / reference,
            0.65,
            1.75,
          ) * (trim || 1);
      }

      // Opening a book should not keep the page waiting.
      if (bridge) {
        targetRate = 1.3;
      }

      /**
       * Smooth playback-rate changes.
       */
      playbackRate =
        THREE.MathUtils.damp(
          playbackRate,
          targetRate,
          12,
          dt,
        );

      current?.setEffectiveTimeScale(
        playbackRate,
      );

      /**
       * Lean into turns.
       *
       * The straight stride hands its weight to the turn clip on
       * the side the character is turning to, in proportion to
       * how hard. Weights are set beneath any fade still running,
       * and the blend eases, so a flick of the stick does not
       * snap the body round.
       */
      const turns =
        turnActions.get(current);

      turning =
        THREE.MathUtils.damp(
          turning,
          turns &&
            locomotion &&
            Number.isFinite(turnRate)
            ? THREE.MathUtils.clamp(
                turnRate / fullTurnRate,
                -1,
                1,
              )
            : 0,
          8,
          dt,
        );

      if (turns) {
        const [left, right] = turns;

        current.weight = 1 - Math.abs(turning);
        left.weight = Math.max(turning, 0);
        right.weight = Math.max(-turning, 0);

        // Each keeps step with the straight stride.
        for (const turn of turns) {
          turn.setEffectiveTimeScale(
            playbackRate *
              turn.getClip().duration /
              current.getClip().duration,
          );
        }
      }

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
            land.duration /
              0.28,
          ),
        );
      }

      activeState =
        nextState;

      /**
       * Advance animation.
       */
      mixer?.update(dt);

      // Each in proportion to how much of the pose it makes up, so
      // the body settles through a crossfade instead of dropping
      // at the end of it. An action that has never played still
      // reports full weight, hence asking if it is scheduled.
      grounding = 0;

      for (const [action, by] of lifted) {
        if (action.isScheduled()) {
          grounding +=
            action.getEffectiveWeight() * by;
        }
      }

      let hipless = 0;

      for (const action of planted) {
        if (action.isScheduled()) {
          hipless +=
            action.getEffectiveWeight();
        }
      }

      if (hipless > 0.001) {
        grounding +=
          Math.min(hipless, 1) *
          (restSole - lowestSole());
      }

      /**
       * Procedural fallback adjustments.
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
        landing +
        grounding;
    },

    /**
     * Snap back to idle with no crossfade, for a rig that is
     * being reused — a respawn should not fade out of the death
     * pose it was left clamped in.
     */
    reset() {
      if (disposed) {
        return;
      }

      mixer?.stopAllAction();

      playbackRate = 1;
      activeState = 'Idle';
      lean = 0;
      landing = 0;
      death = 0;
      turning = 0;
      bridge = null;
      fidgeting = null;
      idleFor = 0;
      grounding = 0;
      cued.clear();

      facing.rotation.x = 0;
      facing.rotation.z = 0;
      fitted.position.y = baseHeight;

      current =
        idle
          ? actions.get(idle)
          : null;

      current
        ?.reset()
        .setEffectiveWeight(1)
        .setEffectiveTimeScale(1)
        .play();
    },

    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;

      mixer?.stopAllAction();

      mixer?.uncacheRoot(
        model,
      );

      if (shared) {
        group.removeFromParent();
      } else {
        disposeObject(
          group,
        );
      }
    },
  };
}

/**
 * Create a hero.
 */
export async function createHero(
  id = 'warden',
) {
  const meta =
    HEROES.find(
      hero =>
        hero.id === id,
    ) ||
    HEROES[0];

  const hero =
    meta.imported
      ? await makeImported(
          meta,
        )
      : makeBuiltin(
          meta,
        );

  console.log(
    'Selected character:',
    hero.meta.name,
  );

  console.log(
    'Animations:',
    hero.diagnostics.animations,
  );

  console.log(
    'Selected animations:',
    hero.diagnostics.selectedAnimations,
  );

  console.log(
    'Diagnostics:',
    hero.diagnostics,
  );

  return hero;
}

/**
 * Build count automatons from a single download.
 *
 * Every member gets its own skeleton and mixer.
 * Geometry/materials/textures remain shared.
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
              scene:
                cloneRigged(
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
      member =>
        member.dispose(),
    );

    disposeObject(
      source.scene,
    );

    throw error;
  }

  return {
    members,
    meta,

    dispose() {
      members.forEach(
        member =>
          member.dispose(),
      );

      disposeObject(
        source.scene,
      );
    },
  };
}
