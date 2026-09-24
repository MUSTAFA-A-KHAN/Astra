import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The third district: a lamplit market street and its cathedral, built block
// by block, standing on a plinth in the harbour east of the city. It arrives
// in two parts. tools/fbx-to-glb.mjs bakes the supplied FBX, its atlas and its
// night-time lightmap into the model, tiled so the renderer can skip what is
// out of view, and writes beside it a footprint of everything at street level.
// The footprint is under a megabyte: the plaza can be walked, and is drawn in
// outline, from the moment the world opens, while the model streams in after.
// Both are rebuilt from the supplied source with:
//   MESHOPT=1 CHUNK=24 FOOTPRINT=21 MAX_TEXTURE=2048 node tools/fbx-to-glb.mjs \
//     plaza-night-time/source/plaza01_night.fbx.br plaza-night-time/plaza-night.glb \
//     plaza-night-time/textures plaza-night-time/materials.json
export const PLAZA_ASSET = 'plaza-night-time/plaza-night.glb';
export const PLAZA_FOOTPRINT = 'plaza-night-time/plaza-night-footprint.glb';
// The model measures in blocks. At 1.8 a block a hero stands as tall as the
// player the street was built around. A quarter turn runs the market street
// east, on the line of the road out of the spawn; y puts the plinth's rim at
// the height of the city pavement it is reached from.
export const PLAZA_TRANSFORM = { scale:1.8, rotation:-Math.PI/2, x:360, y:-34.65, z:-5.4 };
// Its streets are laid at block 19, the pavements and the plinth's rim half a
// block higher, and the market square and shop floors a block higher still.
// A half-block step is a stair to climb here, not a wall; a whole block is.
export const PLAZA_STEP = .95;
// On the rim at the end of the market street, in blocks: the crossing lands here.
const STREET_END = { x:13, z:87.6 };

// Compact rectangles extracted offline from every storey of the supplied model.
// Floor heights are kept separately, so a roof never replaces the room below it.
// Vertical faces retain their actual bottom and top rather than becoming columns
// extending from street level. Rebuild with node tools/plaza-navigation.mjs.
export const PLAZA_NAVIGATION = 'plaza-night-time/plaza-navigation.json';
export function createPlazaTerrain(data) {
  if (data.version !== 1) throw new Error('Unsupported plaza navigation data.');
  const points = [];
  for (const [y, x0, z0, x1, z1] of data.floors) {
    points.push(x0,y,z0, x0,y,z1, x1,y,z1, x0,y,z0, x1,y,z1, x1,y,z0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const layout = new THREE.Mesh(geometry); layout.name = 'plaza-floor'; place(layout);
  const transform = new THREE.Matrix4().copy(layout.matrixWorld), corner = new THREE.Vector3();
  const colliders = [];
  function box(x0, z0, x1, z1, bottom, top, extra = {}) {
    const a = corner.set(x0, bottom, z0).applyMatrix4(transform).clone();
    const b = corner.set(x1, top, z1).applyMatrix4(transform);
    colliders.push({ x:(a.x+b.x)/2, z:(a.z+b.z)/2, w:Math.max(.025,Math.abs(a.x-b.x)), d:Math.max(.025,Math.abs(a.z-b.z)), bottom:a.y, top:b.y, ...extra });
  }
  for (const [axis, plane, u0, y0, u1, y1] of data.walls) {
    if (axis === 0) box(plane,u0,plane,u1,y0,y1,{walkable:true,stepable:true});
    else box(u0,plane,u1,plane,y0,y1,{walkable:true,stepable:true});
  }
  for (const [y, x0, z0, x1, z1] of data.ceilings) box(x0,z0,x1,z1,y,y+.02,{ceilingOnly:true});
  return { layout, ground:/plaza-floor/, layered:true, floorLimit:PLAZA_TRANSFORM.y+20.5*PLAZA_TRANSFORM.scale, colliders };
}

function place(object) {
  object.position.set(PLAZA_TRANSFORM.x, PLAZA_TRANSFORM.y, PLAZA_TRANSFORM.z);
  object.rotation.y = PLAZA_TRANSFORM.rotation;
  object.scale.setScalar(PLAZA_TRANSFORM.scale);
  object.updateMatrixWorld(true);
  return object;
}

function loader() {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

export async function loadPlazaDistrict({ lowPower = false } = {}) {
  const footprintURL = new URL(PLAZA_FOOTPRINT, import.meta.url), assetURL = new URL(PLAZA_ASSET, import.meta.url);
  const [footprint, navigationData] = await Promise.all([loader().loadAsync(footprintURL.href), fetch(new URL(PLAZA_NAVIGATION, import.meta.url)).then(response => { if (!response.ok) throw new Error('The plaza navigation could not load.'); return response.json(); })]);
  const outline = footprint.scene;
  const root = new THREE.Group(); root.name = 'Lantern Plaza';
  // The navigator reads floors and walls from its own copy, which never
  // reaches the renderer. Until the model arrives, the footprint stands in
  // for it, in plain stone: the streets and the foot of every wall.
  const terrain = createPlazaTerrain(navigationData);
  const stone = new THREE.MeshStandardMaterial({ color:'#595d63', roughness:.95, flatShading:true, side:THREE.DoubleSide });
  outline.traverse(mesh => { if (mesh.isMesh) { mesh.material.dispose(); mesh.material = stone; mesh.receiveShadow = true; } });
  place(outline); outline.name = 'Lantern Plaza footprint';
  root.add(outline);
  const box = new THREE.Box3().setFromObject(outline);
  const bounds = { minX:box.min.x, maxX:box.max.x, minZ:box.min.z, maxZ:box.max.z };
  const landing = new THREE.Vector3(STREET_END.x, 19.5, STREET_END.z).applyMatrix4(outline.matrixWorld);

  const tiles = [], materials = new Set();
  let daylight = 1, level = lowPower ? 'balanced' : 'high', state = 'waiting', loading = null;
  function applyTime() {
    // The lightmap is the street as it looks at night, lamps and all. It is
    // the light the plaza is seen by after dark, and a faint warmth by day.
    for (const material of materials) if (material.emissiveMap) material.emissiveIntensity = .1 + (1 - daylight) * .9;
  }
  function applyQuality() {
    for (const tile of tiles) tile.castShadow = level === 'high';
    for (const material of materials) if (material.map) material.map.anisotropy = level === 'low' ? 1 : 4;
  }
  return {
    root, bounds, landing, asset:PLAZA_ASSET,
    terrain,
    // Fetches the model and puts it in place of the footprint, once prepare
    // (given the model, before it is shown) has finished. Safe to call again.
    load(prepare) {
      loading ??= (async () => {
        state = 'loading';
        const model = place((await loader().loadAsync(assetURL.href)).scene);
        model.traverse(mesh => {
          if (!mesh.isMesh) return;
          mesh.receiveShadow = true;
          materials.add(mesh.material);
          tiles.push(mesh);
        });
        applyTime(); applyQuality();
        await prepare?.(model);
        root.add(model); outline.removeFromParent();
        outline.traverse(mesh => mesh.geometry?.dispose()); stone.dispose();
        state = 'ready';
      })().catch(error => { state = 'failed'; loading = null; throw error; });
      return loading;
    },
    setTime(value) { daylight = value; applyTime(); },
    setQuality(value) { level = ['low', 'balanced', 'high'].includes(value) ? value : 'high'; applyQuality(); },
    get diagnostics() {
      return { state, tiles:tiles.length, drawn:tiles.filter(tile => tile.visible).length };
    },
  };
}
