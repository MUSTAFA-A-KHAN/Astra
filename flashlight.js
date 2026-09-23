import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The hero's flashlight. It comes out as the street lamps come on, and goes
// away at dawn or when the player switches it off. The light is one spot light
// that never leaves the scene: hiding a light changes how many every shader
// was compiled for and recompiles them all, so switched off it is only dark.
// It casts no shadows, as the lamps do not, which keeps it affordable on a
// phone: its reach is short enough that light through a wall is rarely seen.
//
// The beam is held steady along the hero's heading rather than swinging with
// the hand, which a walk cycle carries through half a metre a stride. It keeps
// a little of the hand's own aim, so it still moves with the one holding it.
export const FLASHLIGHT_ASSET = 'assets/props/flashlight.glb';
const COLOR = new THREE.Color('#fff1dc');
// Candela, as three.js measures a spot light. The beam meets the road at a
// grazing angle, which takes most of it: this lights the ground a few strides
// ahead a little brighter than a street lamp lights the pavement beneath it.
const INTENSITY = 1000;
const REACH = 30;         // its light ends here
const ANGLE = .42;        // the beam's half-width, in radians
const PENUMBRA = .55;
const LENGTH = .42;       // the prop, in hero units: heroes stand 3.4 tall
const LENS = .6;          // where the light leaves the prop, until the model says
const PITCH = .26;        // how far below level the beam is held
const SWAY = .25;         // how much of the hand's aim the beam follows
const BEAM = 6.5;         // the visible shaft of light, which fades out by here
const BEAM_STRENGTH = .1;
const GLOW = 1.6;         // the lens and reflector, lit

const smoothstep = THREE.MathUtils.smoothstep;

/** How far out the flashlight is at a given daylight: it follows the street lamps. */
export function flashlightPower(daylight) {
  return smoothstep(1 - daylight, .55, .9);
}

function radialTexture(size, profile) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x + .5 - size / 2, y + .5 - size / 2) / (size / 2);
    const texel = profile(Math.min(r, 1));
    for (let c = 0; c < 4; c++) data[(y * size + x) * 4 + c] = Math.round(THREE.MathUtils.clamp(texel[c], 0, 1) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

export function createFlashlight() {
  const group = new THREE.Group(); group.name = 'Flashlight';

  // What the beam draws across a wall: a hot centre, a wide spill that warms
  // toward its edge, and the faint ring a reflector leaves between them.
  const cookie = radialTexture(128, r => {
    const value = Math.exp(-((r / .2) ** 2)) * .6 + .4 * (1 - smoothstep(r, .45, 1)) + .14 * Math.exp(-(((r - .58) / .06) ** 2));
    return [value, value * (.98 - .08 * r), value * (.94 - .2 * r), 1];
  });
  const light = new THREE.SpotLight(COLOR, 0, REACH, ANGLE, PENUMBRA, 2);
  light.name = 'Flashlight beam'; light.map = cookie;
  group.add(light, light.target);

  // The shaft of light through the night air, brightest across its middle.
  const beamGeometry = new THREE.CylinderGeometry(Math.tan(ANGLE * .8) * BEAM, .03, BEAM, 24, 1, true)
    .rotateX(Math.PI / 2).translate(0, 0, BEAM / 2);
  const beamMaterial = new THREE.ShaderMaterial({
    uniforms: { color: { value: COLOR }, strength: { value: 0 } },
    vertexShader: `varying float vAlong; varying vec3 vNormal, vView;
      void main() {
        vAlong = position.z / ${BEAM.toFixed(2)};
        vec4 view = modelViewMatrix * vec4(position, 1.);
        vView = -view.xyz; vNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `uniform vec3 color; uniform float strength;
      varying float vAlong; varying vec3 vNormal, vView;
      void main() {
        float across = abs(dot(normalize(vNormal), normalize(vView)));
        float along = pow(1. - vAlong, 1.8) * smoothstep(0., .08, vAlong);
        gl_FragColor = vec4(color, strength * along * across * across);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.name = 'Flashlight shaft'; beam.visible = false;

  // Glare, for when the lens is turned toward the camera.
  const glareTexture = radialTexture(64, r => [1, 1, 1, (1 - r) ** 3 * .6 + Math.exp(-((r / .15) ** 2)) * .4]);
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glareTexture, color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  glare.name = 'Flashlight glare'; glare.scale.setScalar(1.1); glare.visible = false;
  group.add(beam, glare);

  // The prop, in the frame tools/pack-flashlight.py bakes it into: one unit
  // long, the grip at its origin and the lens looking down +Z.
  const holder = new THREE.Group(); holder.name = 'Flashlight grip'; holder.visible = false;
  const lens = new THREE.Object3D(); lens.name = 'Flashlight lens'; lens.position.z = LENS;
  holder.add(lens);

  const aim = new THREE.Vector3(0, 0, 1), desired = new THREE.Vector3(), hand = new THREE.Vector3();
  const origin = new THREE.Vector3(), toCamera = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, 1);
  let prop = null, glowing = [], mount = null, power = 0, level = 1, enabled = true, shaft = true, aimed = false, disposed = false;

  function apply() {
    const on = mount ? power * level : 0;
    light.intensity = INTENSITY * on;
    holder.visible = on > .01;
    beam.visible = shaft && holder.visible;
    beamMaterial.uniforms.strength.value = BEAM_STRENGTH * on;
    glare.visible = holder.visible;
    for (const material of glowing) material.emissiveIntensity = GLOW * on;
    if (!holder.visible) aimed = false;
  }

  return {
    group,
    get out() { return holder.visible; },
    get enabled() { return enabled; },
    /** Sets whether it is used at night, at once; `toggle` fades it instead. */
    set enabled(value) { enabled = !!value; level = enabled ? 1 : 0; apply(); },
    /** Whether it is dark enough for the flashlight to come out. */
    get dark() { return power > .01; },
    get prop() { return prop; },

    async load(url = FLASHLIGHT_ASSET) {
      const gltf = await new GLTFLoader().loadAsync(url);
      if (disposed) return null;
      prop = gltf.scene; prop.name = 'Flashlight model';
      const anchor = prop.getObjectByName('Lens');
      if (anchor) lens.position.copy(anchor.position);
      prop.traverse(mesh => {
        if (!mesh.isMesh) return;
        // A light cannot be lit by itself, and the prop is too small to shadow anything.
        mesh.castShadow = mesh.receiveShadow = false;
        if (mesh.material.emissiveMap) glowing.push(mesh.material);
      });
      holder.add(prop);
      apply();
      return prop;
    },

    /** Puts the flashlight in a hero's hand, or wherever `hero.flashlightMount` says it is carried. */
    attach(hero) {
      mount = hero?.flashlightMount || (hero && {
        kind: 'body', parent: hero.group, position: new THREE.Vector3(.5, (hero.height || 3.4) * .55, .35),
        quaternion: new THREE.Quaternion(), scale: 1,
      }) || null;
      holder.removeFromParent();
      if (mount) {
        mount.parent.add(holder);
        holder.position.copy(mount.position); holder.quaternion.copy(mount.quaternion);
        holder.scale.setScalar(LENGTH * mount.scale);
      }
      aimed = false;
      apply();
    },

    toggle() { enabled = !enabled; return enabled; },

    setTime(daylight) { power = flashlightPower(daylight); apply(); },

    setQuality(value) { shaft = value !== 'low'; apply(); },

    /** Follows the hand. `facing` is the hero's heading; the camera turns the lens's glare toward it. */
    update(dt, { facing = 0, camera } = {}) {
      level = THREE.MathUtils.damp(level, enabled ? 1 : 0, 9, dt);
      apply();
      if (!holder.visible) return;
      lens.getWorldPosition(origin);
      desired.set(Math.sin(facing) * Math.cos(PITCH), -Math.sin(PITCH), Math.cos(facing) * Math.cos(PITCH));
      hand.set(0, 0, 1).transformDirection(holder.matrixWorld);
      desired.lerp(hand, SWAY).normalize();
      if (aimed) aim.lerp(desired, 1 - Math.exp(-12 * dt)).normalize();
      else { aim.copy(desired); aimed = true; }
      light.position.copy(origin);
      light.target.position.copy(origin).add(aim);
      beam.position.copy(origin);
      beam.quaternion.setFromUnitVectors(forward, aim);
      glare.position.copy(origin).addScaledVector(aim, .05);
      const toward = camera ? Math.max(0, aim.dot(toCamera.copy(camera.position).sub(origin).normalize())) : 0;
      glare.material.opacity = power * level * toward * toward * .9;
    },

    get diagnostics() {
      return {
        ready: !!prop, enabled, out: holder.visible, mount: mount?.kind || null,
        power, level, intensity: light.intensity, shaft: beam.visible,
        position: light.position.toArray(), direction: aim.toArray(),
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      holder.removeFromParent(); group.removeFromParent();
      cookie.dispose(); glareTexture.dispose(); glare.material.dispose();
      beamGeometry.dispose(); beamMaterial.dispose(); light.dispose();
      prop?.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const value of Object.values(mesh.material)) if (value?.isTexture) value.dispose();
        mesh.material.dispose();
      });
    },
  };
}
