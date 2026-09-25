import * as THREE from 'three';
import { createNavigation } from './navigation.js';
import { CITY_ARRIVAL, loadCityDistrict } from './city-world.js';
import { createStreetLights } from './street-lights.js';
import { createStreamer } from './streaming.js';
import { disposeMapResources } from './map-resources.js';

const WATERLINE = -6.65;
const ARRIVALS = { city: CITY_ARRIVAL, forest: { x: -96, z: 8, radius: 1.2 }, yard: { x: 170, z: 136, radius: 1.2 } };
const CITY_SHARDS = [[0,9],[1,0],[-1,-10],[2,-20],[0,-32],[-12,9],[-23,16],[-35,23],[-42,34],[-49,17],[14,-7],[25,-13],[36,-17],[47,-26],[55,-12],[-15,-42],[16,-43],[-28,-60],[30,-63],[60,30]];
const within = (bounds, x, z) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
const districtLoaders = {
  city: loadCityDistrict,
  forest: options => import('./forest-world.js').then(({ loadForestDistrict }) => loadForestDistrict(options)),
  yard: options => import('./skibidi-world.js').then(({ loadYardDistrict }) => loadYardDistrict(options)),
};

function cityLandmarks(navigation) {
  return [
    { id: 'shrine', name: 'Moonwell Sanctuary', ...navigation.findWalkable(0, -50, 4), color: '#83e6ee' },
    { id: 'camp', name: 'Wanderer’s Camp', ...navigation.findWalkable(-45, 25, 3), color: '#ffc681' },
    { id: 'watch', name: 'Sunstone Watch', ...navigation.findWalkable(50, -20, 3), color: '#f1d087' },
  ];
}

function landmarkMarkers(root, landmarks) {
  const geometry = new THREE.OctahedronGeometry(1), ringGeometry = new THREE.TorusGeometry(2, .055, 6, 48);
  return landmarks.map(landmark => {
    const group = new THREE.Group(); group.name = landmark.name; group.position.set(landmark.x, landmark.y, landmark.z); root.add(group);
    const material = new THREE.MeshStandardMaterial({ color: landmark.color, emissive: landmark.color, emissiveIntensity: .9, metalness: .2, roughness: .3 });
    const crystal = new THREE.Mesh(geometry, material); crystal.position.y = landmark.id === 'shrine' ? 6.6 : 2.6;
    crystal.scale.set(landmark.id === 'shrine' ? .95 : .6, landmark.id === 'shrine' ? 1.7 : 1, .7); group.add(crystal);
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: landmark.color, transparent: true, opacity: .8, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .12; group.add(ring);
    const light = new THREE.PointLight(landmark.color, 5, 10, 2); light.position.y = 2.6; group.add(light);
    return { crystal, ring, light, baseHeight: crystal.position.y };
  });
}

/** A stable world interface whose terrain and resources belong to one map. */
export async function createPortalWorld(scene, { lowPower = false, loaders = districtLoaders } = {}) {
  const root = new THREE.Group(); root.name = 'The Verdant Reach';
  const streaming = createStreamer({ quality: lowPower ? 'low' : 'high' });
  let active = null, loadingMap = null, stagedMap = null, disposed = false, daylight = 1, quality = lowPower ? 'low' : 'high';
  // Only plain bounds survive a visit, never a model or navigation closure.
  const knownBounds = new Map();
  function applySettings(record) {
    const low = quality === 'low' || quality === 'performance' || quality === 0;
    record.district.setQuality?.(low); record.lights?.setQuality(low);
    record.district.setTime?.(daylight); record.lights?.setTime(daylight);
    for (const marker of record.markers) {
      marker.light.visible = !low;
      marker.crystal.material.emissiveIntensity = .75 + (1 - daylight) * .65;
      marker.light.intensity = 2 + (1 - daylight) * 7;
    }
  }
  function release(record) {
    if (!record) return;
    streaming.removeTree(record.root);
    record.lights?.dispose();
    disposeMapResources(record.root);
    // Navigation's triangle grids and loader closures go with the meshes.
    record.navigation = null; record.district = null; record.lights = null; record.markers.length = 0;
  }
  async function loadMap(map) {
    const district = await loaders[map]({ lowPower: quality === 'low', waterline: WATERLINE });
    const mapRoot = new THREE.Group(); mapRoot.name = `Portal destination: ${map}`; mapRoot.add(district.root);
    const record = { map, root: mapRoot, district, navigation: null, lights: null, markers: [], landmarks: [] };
    try {
      record.navigation = createNavigation([district.terrain], district.bounds, { arrival: ARRIVALS[map] });
      if (map === 'city') {
        record.landmarks = cityLandmarks(record.navigation);
        record.markers = landmarkMarkers(mapRoot, record.landmarks);
        record.lights = createStreetLights({ lanterns: district.lanterns ?? [], materials: district.materials ?? [], heightAt: record.navigation.getHeight, lights: lowPower ? 2 : 4 });
        mapRoot.add(record.lights.group);
      }
      const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color: '#355a64', roughness: .34, metalness: .25 }));
      water.name = 'Harbour water'; water.rotation.x = -Math.PI / 2; water.position.y = WATERLINE; water.receiveShadow = true; mapRoot.add(water);
      applySettings(record);
      return record;
    } catch (error) { release(record); throw error; }
  }
  function attach(record) {
    root.add(record.root);
    for (const mesh of record.district.meshes) streaming.add(mesh);
    knownBounds.set(record.map, { ...record.district.bounds });
  }
  active = await loadMap('city'); attach(active); scene.add(root);
  // Keep city story coordinates and saved shard indices stable. Other map
  // slots stay empty while travel is story driven.
  const landmarks = active.landmarks.map(landmark => ({ ...landmark }));
  const diagnostics = {
    ready: true, provider: 'astra-world-map', portalTravel: true,
    get activeMap() { return active?.map ?? null; },
    get residentMaps() { return [...new Set([active?.map, stagedMap].filter(Boolean))]; },
    get loadingMap() { return loadingMap; },
    get asset() { return active?.district.asset ?? null; },
    get assets() { return active ? [active.district.asset] : []; },
    get meshCount() { return active?.district.meshes.length ?? 0; },
    get triangleCount() { return active?.navigation.diagnostics.triangleCount ?? 0; },
    get surfaceCount() { return active?.navigation.diagnostics.surfaceCount ?? 0; },
    get colliderCount() { return active?.navigation.colliders.length ?? 0; },
    get reachableCells() { return active?.navigation.diagnostics.reachableCells ?? 0; },
    get streetLights() { return active?.lights?.diagnostics ?? null; },
    get streaming() { return streaming.diagnostics; },
    get forestReachable() { return active?.map === 'forest'; },
    get yardReachable() { return active?.map === 'yard'; },
    plazaReachable: false, woodReachable: false, mesaReachable: false,
  };
  return {
    root, landmarks, streaming, diagnostics, portalTravel: true,
    shardPositions: [...CITY_SHARDS, ...Array(28).fill(null)],
    enemyPositions: [[-9,-17],[12,-30],[-17,-38],[28,-24],[-33,-12],[45,-42]],
    get activeMap() { return active?.map ?? null; },
    get bounds() { return active.district.bounds; },
    get colliders() { return active.navigation.colliders; },
    get spawn() { return active.navigation.spawn; },
    getHeight(...args) { return active.navigation.getHeight(...args); },
    getSupportHeight(...args) { return active.navigation.getSupportHeight(...args); },
    getNormal(...args) { return active.navigation.getNormal(...args); },
    isWalkable(...args) { return active.navigation.isWalkable(...args); },
    findWalkable(...args) { return active.navigation.findWalkable(...args); },
    biomeAt(x, z) {
      for (const [map, bounds] of knownBounds) if (within(bounds, x, z)) return map;
      return x < -75 ? 'forest' : x > 115 && z > 110 ? 'yard' : 'city';
    },
    stepHeightAt() { return undefined; },
    setQuality(level) { quality = level; streaming.setQuality(level === 'performance' || level === 0 ? 'low' : level); if (active) applySettings(active); },
    setTime(hour) { daylight = THREE.MathUtils.clamp(Math.sin((hour - 6) / 12 * Math.PI) * 1.4, 0, 1); if (active) applySettings(active); },
    update(dt, time, position) {
      if (!active) return;
      streaming.update(position); active.lights?.update(position);
      for (let i = 0; i < active.markers.length; i++) {
        const marker = active.markers[i]; marker.crystal.rotation.y = time * .35 + i;
        marker.crystal.position.y = marker.baseHeight + Math.sin(time * 1.2 + i) * .16;
        marker.ring.material.opacity = .6 + Math.sin(time * .9 + i) * .12;
      }
    },
    stream() { return Promise.resolve(); },
    async travelTo(map, { prepare } = {}) {
      if (disposed) throw new Error('This world has been disposed.');
      if (!Object.hasOwn(ARRIVALS, map) || typeof loaders[map] !== 'function') throw new Error(`Unknown portal destination: ${map}`);
      if (loadingMap) throw new Error('A portal crossing is already in progress.');
      if (active.map === map) return { ...active.navigation.spawn };
      loadingMap = map;
      let candidate = null;
      try {
        candidate = await loadMap(map); stagedMap = map;
        await prepare?.(candidate.root);
        if (disposed) throw new Error('This world was disposed while crossing.');
        applySettings(candidate);
        // Prepare while the source is usable; commit only when ready.
        attach(candidate);
        const source = active; active = candidate; candidate = null;
        release(source);
        streaming.update(active.navigation.spawn);
        return { ...active.navigation.spawn };
      } catch (error) { if (candidate) release(candidate); throw error; }
      finally { loadingMap = null; stagedMap = null; }
    },
    dispose() { disposed = true; release(active); active = null; streaming.clear(); root.removeFromParent(); },
  };
}
