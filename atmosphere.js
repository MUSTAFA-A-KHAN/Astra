import * as THREE from 'three';

const qualityProfiles = {
  low: { clouds: 0, fogNear: 120, fogFar: 380, shadow: 34 },
  balanced: { clouds: .55, fogNear: 150, fogFar: 550, shadow: 48 },
  high: { clouds: .8, fogNear: 170, fogFar: 700, shadow: 65 },
  ultra: { clouds: 1, fogNear: 190, fogFar: 850, shadow: 82 },
};

/** A single sky draw call; all other objects retain normal Three.js PBR lighting. */
export function createAtmosphere({ scene, sun, hemi, portraitLight, renderer, lowPower = false }) {
  let quality = lowPower ? 'balanced' : 'high', hour = 15.5, daylight = 1, disposed = false;
  const direction = new THREE.Vector3(), target = new THREE.Vector3();
  const horizon = new THREE.Color(), zenith = new THREE.Color(), warm = new THREE.Color('#dfb497');
  const dayHorizon = new THREE.Color('#b7c6c7'), dayZenith = new THREE.Color('#587f9f');
  const nightHorizon = new THREE.Color('#28384b'), nightZenith = new THREE.Color('#0b172d');
  const uniforms = {
    uTime: { value: 0 }, uDay: { value: 1 }, uClouds: { value: .8 },
    uSun: { value: direction }, uHorizon: { value: horizon }, uZenith: { value: zenith },
    uSunColor: { value: new THREE.Color('#ffe2b9') },
  };
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vDirection;
      void main() { vDirection = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `
      varying vec3 vDirection;
      uniform float uTime, uDay, uClouds;
      uniform vec3 uSun, uHorizon, uZenith, uSunColor;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
      }
      void main() {
        vec3 ray=normalize(vDirection);
        float height=max(ray.y,0.);
        vec3 color=mix(uHorizon,uZenith,pow(height,.45));
        float alignment=dot(ray,uSun);
        color+=uSunColor*pow(max(alignment,0.),48.)*.16*uDay;
        float disc=smoothstep(.99991,.99997,alignment)*smoothstep(-.06,.025,uSun.y);
        color+=uSunColor*disc*2.6;
        if(uClouds>.01 && ray.y>.01) {
          vec2 p=ray.xz/(ray.y+.19)*2.4 + vec2(uTime*.004,uTime*.001);
          float n=noise(p)*.57+noise(p*2.1)*.28+noise(p*4.3)*.15;
          float cloud=smoothstep(.49,.73,n)*smoothstep(.015,.14,ray.y)*uClouds;
          vec3 cloudColor=mix(uHorizon*.78,vec3(.78,.79,.77),uDay);
          cloudColor*=.83+noise(p+3.)*.17;
          color=mix(color,cloudColor,cloud*.64);
        }
        float moon=smoothstep(.99982,.99991,dot(ray,-uSun))*(1.-uDay);
        color+=vec3(.46,.52,.61)*moon;
        float star=step(.9984,hash(floor(ray.xz/(height+.3)*310.)))*smoothstep(.12,.5,height)*(1.-uDay);
        color+=vec3(star*.28);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMaterial);
  sky.name = 'Atmospheric sky'; sky.frustumCulled = false; sky.renderOrder = -1000;
  scene.add(sky);
  const moonLight = new THREE.DirectionalLight('#a9bfdb', .1); scene.add(moonLight, moonLight.target);
  if (!scene.fog) scene.fog = new THREE.Fog(dayHorizon, 170, 700);
  sun.shadow.bias = -.00015; sun.shadow.normalBias = .045;
  sun.shadow.camera.near = .5; sun.shadow.camera.far = 280;
  function setTime(value) {
    hour = ((Number.isFinite(value) ? value : 15.5) % 24 + 24) % 24;
    const angle = (hour - 6) / 12 * Math.PI;
    direction.set(Math.cos(angle), Math.sin(angle), Math.sin(angle) * .38).normalize();
    daylight = THREE.MathUtils.smoothstep(direction.y, -.12, .28);
    const twilight = Math.pow(1 - Math.abs(direction.y), 5) * daylight;
    horizon.copy(nightHorizon).lerp(dayHorizon, daylight).lerp(warm, twilight * .52);
    zenith.copy(nightZenith).lerp(dayZenith, daylight);
    uniforms.uDay.value = daylight;
    sun.color.set('#ffedce').lerp(warm, twilight * .72);
    uniforms.uSunColor.value.copy(sun.color);
    sun.intensity = Math.max(0, direction.y) ** .45 * 3.1;
    hemi.color.set('#c6d7df').lerp(new THREE.Color('#596e91'), 1 - daylight);
    hemi.groundColor.set('#656450'); hemi.intensity = .22 + daylight * 1.65;
    moonLight.intensity = .16 * (1 - daylight);
    sun.castShadow = quality !== 'low' && direction.y > .035;
    if (scene.background?.isColor) scene.background.copy(horizon);
    renderer.toneMappingExposure = 1.02 + daylight * .07;
  }
  function setQuality(value) {
    quality = qualityProfiles[value] ? value : 'balanced';
    const profile = qualityProfiles[quality];
    uniforms.uClouds.value = profile.clouds;
    Object.assign(sun.shadow.camera, { left: -profile.shadow, right: profile.shadow, top: profile.shadow, bottom: -profile.shadow });
    sun.shadow.camera.updateProjectionMatrix();
    setTime(hour);
  }
  function update(dt, time, position, biome) {
    if (disposed) return;
    uniforms.uTime.value = time;
    sky.position.copy(position);
    const profile = qualityProfiles[quality];
    const biomeId = typeof biome === 'string' ? biome.toLowerCase() : (biome?.id || biome?.name || '').toLowerCase();
    const moisture = biomeId === 'river' || biomeId === 'lake' ? .86 : biomeId === 'forest' ? .94 : 1;
    scene.fog.near = THREE.MathUtils.damp(scene.fog.near, profile.fogNear * moisture, 1.2, dt);
    scene.fog.far = THREE.MathUtils.damp(scene.fog.far, profile.fogFar * moisture, 1.2, dt);
    scene.fog.color.lerp(horizon, 1 - Math.exp(-dt * 3));
    // Stabilize the moving shadow frustum in world units to reduce shimmer.
    const texel = profile.shadow * 2 / sun.shadow.mapSize.x;
    target.set(Math.round(position.x / texel) * texel, Math.round(position.y / texel) * texel, Math.round(position.z / texel) * texel);
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(direction, 130);
    sun.target.updateMatrixWorld();
    moonLight.position.copy(target).addScaledVector(direction, -100);
    moonLight.target.position.copy(target); moonLight.target.updateMatrixWorld();
    if (portraitLight) portraitLight.color.set('#d9e3eb');
  }
  setQuality(quality);
  return { setTime, setQuality, update,
    get diagnostics() { return { hour, daylight, sunElevation: direction.y, clouds: uniforms.uClouds.value }; },
    dispose() { if (disposed) return; disposed = true; sky.geometry.dispose(); skyMaterial.dispose(); sky.removeFromParent(); moonLight.removeFromParent(); moonLight.target.removeFromParent(); },
  };
}

/** PBR water with Fresnel sky reflection, flow, and normal ripples; no reflection pass. */
export function createWaterMaterial({ lowPower = false, basin = [-54, -38, 19, 12] } = {}) {
  const uniforms = {
    astraWaterTime: { value: 0 }, astraWaterDetail: { value: lowPower ? .4 : 1 },
    astraWaterSun: { value: new THREE.Vector3(-.4, .8, .35).normalize() },
    astraWaterSunColor: { value: new THREE.Color('#fff0d5') },
    astraWaterBasin: { value: new THREE.Vector4(...basin) },
  };
  const material = new THREE.MeshStandardMaterial({
    color: '#3c6968', roughness: .24, metalness: .12, transparent: true, opacity: .78,
    depthWrite: false, side: THREE.DoubleSide,
  });
  material.name = 'Flowing freshwater';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vAstraWaterPosition;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vAstraWaterPosition = (modelMatrix * vec4(position, 1.)).xyz;');
    shader.fragmentShader = `varying vec3 vAstraWaterPosition;
      uniform float astraWaterTime, astraWaterDetail;
      uniform vec3 astraWaterSun, astraWaterSunColor;
      uniform vec4 astraWaterBasin;\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>
        float basinRadius=length((vAstraWaterPosition.xz-astraWaterBasin.xy)/astraWaterBasin.zw);
        float waterDepth=1.-smoothstep(.15,.98,basinRadius);
        diffuseColor.rgb=mix(vec3(.16,.22,.17),vec3(.028,.105,.12),waterDepth);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float rippleA = sin(vAstraWaterPosition.x * 1.5 + vAstraWaterPosition.z * .7 + astraWaterTime * 1.4);
        float rippleB = sin(vAstraWaterPosition.z * 2.2 - vAstraWaterPosition.x * .45 - astraWaterTime * .95);
        vec3 rippleWorld = normalize(vec3(rippleA * .075, 1., rippleB * .055));
        vec3 rippleView = normalize(mat3(viewMatrix) * rippleWorld);
        normal = normalize(mix(normal, rippleView, astraWaterDetail));`)
      .replace('#include <opaque_fragment>', `
        vec3 viewWorld = normalize(cameraPosition - vAstraWaterPosition);
        float fresnel = .025 + .975 * pow(1. - max(dot(viewWorld, rippleWorld),0.),5.);
        vec3 skyReflection = mix(vec3(.34,.43,.46),vec3(.18,.30,.41),max(viewWorld.y,0.));
        outgoingLight = mix(outgoingLight,skyReflection,fresnel*.68);
        vec3 halfVector = normalize(viewWorld + astraWaterSun);
        float sparkle=pow(max(dot(rippleWorld,halfVector),0.),160.)*astraWaterDetail;
        outgoingLight+=astraWaterSunColor*sparkle*.65;
        diffuseColor.a = clamp(mix(.42,opacity,waterDepth) + fresnel*.18,.0,.96);
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'astra-water-v1';
  material.userData.update = time => { uniforms.astraWaterTime.value = time; };
  material.userData.setTime = material.userData.update;
  material.userData.setQuality = level => { uniforms.astraWaterDetail.value = level === 'low' ? .3 : level === 'balanced' ? .65 : 1; };
  material.userData.setSun = (direction, color) => { uniforms.astraWaterSun.value.copy(direction); if (color) uniforms.astraWaterSunColor.value.copy(color); };
  return material;
}
