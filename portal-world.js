import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const PORTAL_ASSET = 'map/portal/european_and_american_game_scencemagic_portal.glb';
export const PORTAL_BOOK_ASSET = 'assets/story/lore-book.glb';
const PHASES = new Set(['dormant', 'reading', 'casting', 'ready', 'traveling']);
const BOOK_OFFSET = new THREE.Vector3(-4.6, 0, 4.8);
const READ_OFFSET = new THREE.Vector3(-4.6, 0, 6.6);

// Portal props live outside district roots. Moving the same props between maps
// keeps the book available while a district is downloaded or released.
export function createPortal({ world, collision } = {}) {
  const root = new THREE.Group(); root.name = 'The keeper’s spellbook and sleeping gate';
  const gate = new THREE.Group(); gate.name = 'Sleeping portal'; root.add(gate);
  const lectern = new THREE.Group(); lectern.name = 'Keeper’s spellbook lectern'; lectern.position.copy(BOOK_OFFSET); root.add(lectern);
  const reader = new THREE.Group(); reader.name = 'Spellbook reading position'; reader.position.copy(READ_OFFSET); root.add(reader);
  const bookMount = new THREE.Group(); bookMount.name = 'Visible open spellbook'; bookMount.position.y = 1.95; bookMount.rotation.x = .22; lectern.add(bookMount);
  let phase = 'dormant', progress = 0, disposed = false, loadPromise = null;
  let modelLoaded = false, bookLoaded = false, modelError = null, bookError = null;
  const loadedGlow = [], bookGlow = [], colliderIds = [];
  const stone = new THREE.MeshStandardMaterial({ color: '#626b68', roughness: .95 });
  const darkStone = new THREE.MeshStandardMaterial({ color: '#3e4947', roughness: .9 });
  const gold = new THREE.MeshStandardMaterial({ color: '#b39a65', metalness: .4, roughness: .7 });
  const paper = new THREE.MeshStandardMaterial({ color: '#eee0b8', roughness: .95, emissive: '#91e9df', emissiveIntensity: 0 });
  const cover = new THREE.MeshStandardMaterial({ color: '#264b50', metalness: .15, roughness: .65 });
  const ink = new THREE.MeshStandardMaterial({ color: '#436d68', roughness: .9, emissive: '#6cf6eb', emissiveIntensity: 0 });
  const runeMaterial = new THREE.MeshBasicMaterial({ color: '#71e9e5', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });

  function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z);
    object.castShadow = object.receiveShadow = !material.transparent; parent.add(object); return object;
  }
  function box(parent, size, position, material) { return mesh(parent, new THREE.BoxGeometry(...size), material, ...position); }

  const fallbackGate = new THREE.Group(); fallbackGate.name = 'Stone gate fallback'; gate.add(fallbackGate);
  mesh(fallbackGate, new THREE.CylinderGeometry(3.9, 4.3, .45, 32), stone, 0, .225);
  const arch = mesh(fallbackGate, new THREE.TorusGeometry(3, .42, 8, 40), stone, 0, 4);
  arch.scale.y = 1.18;
  mesh(fallbackGate, new THREE.TorusGeometry(2.77, .07, 6, 48), gold, 0, 4, .3).scale.y = 1.18;
  for (const x of [-2.9, 2.9]) {
    box(fallbackGate, [.8, 3.5, 1], [x, 1.95, 0], stone);
    box(fallbackGate, [1.2, .32, 1.3], [x, .55, 0], darkStone);
  }
  mesh(lectern, new THREE.CylinderGeometry(.78, .95, .2, 8), stone, 0, .1);
  mesh(lectern, new THREE.CylinderGeometry(.27, .4, 1.55, 8), darkStone, 0, .95);
  mesh(lectern, new THREE.CylinderGeometry(.34, .34, .13, 8), gold, 0, 1.5);
  box(lectern, [1.9, .18, 1.25], [0, 1.82, 0], stone).rotation.x = .22;

  // An open physical book is present from the first frame, including on a
  // failed model request. The two pages and their ink are separate meshes.
  const fallbackBook = new THREE.Group(); fallbackBook.name = 'Open spellbook fallback'; bookMount.add(fallbackBook);
  for (const side of [-1, 1]) {
    const page = new THREE.Group(); page.position.x = side * .4; page.rotation.z = side * .1; fallbackBook.add(page);
    box(page, [.8, .065, .95], [0, 0, 0], cover);
    box(page, [.74, .065, .87], [0, .06, 0], paper);
    for (let line = 0; line < 5; line++) box(page, [.42 - (line % 2) * .1, .008, .023], [0, .1, -.22 + line * .1], ink);
    const seal = mesh(page, new THREE.TorusGeometry(.075, .014, 3, 6), gold, 0, .104, .32); seal.rotation.x = -Math.PI / 2;
  }
  box(fallbackBook, [.065, .14, 1], [0, .01, 0], gold);

  const aperture = new THREE.Group(); aperture.name = 'Awakened portal aperture'; aperture.position.set(0, 4, .38); gate.add(aperture);
  const surfaceMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, awaken: { value: 0 }, travel: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec2 vUv;
      uniform float time;
      uniform float awaken;
      uniform float travel;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float radius = length(p);
        float edge = 1.0 - smoothstep(0.86, 1.0, radius);
        float angle = atan(p.y, p.x);
        float spiral = 0.5 + 0.5 * sin(angle * 4.0 - radius * 17.0 + time * 2.3);
        float inner = pow(1.0 - min(radius, 1.0), 2.0);
        vec3 color = mix(vec3(0.06, 0.20, 0.34), vec3(0.21, 0.91, 0.86), spiral * 0.65 + inner * 0.25);
        color += vec3(0.52, 0.69, 0.73) * inner * travel;
        gl_FragColor = vec4(color, edge * awaken * (0.55 + spiral * 0.24 + travel * 0.15));
      }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
  const surface = mesh(aperture, new THREE.CircleGeometry(2.65, 64), surfaceMaterial);
  const runes = new THREE.Group(); runes.name = 'Waking runes'; aperture.add(runes);
  const runeGeometry = new THREE.BoxGeometry(.12, .32, .035);
  for (let i = 0; i < 18; i++) {
    const angle = i / 18 * Math.PI * 2;
    const rune = mesh(runes, runeGeometry, runeMaterial, Math.sin(angle) * 2.8, Math.cos(angle) * 2.8, .04);
    rune.rotation.z = -angle + (i % 2 ? .45 : 0);
  }
  const edge = mesh(aperture, new THREE.TorusGeometry(2.68, .035, 4, 64), runeMaterial, 0, 0, .02);
  const spell = new THREE.Group(); spell.name = 'Spell flowing from the book'; root.add(spell);
  const sparkGeometry = new THREE.OctahedronGeometry(.065);
  const sparks = Array.from({ length: 16 }, () => mesh(spell, sparkGeometry, runeMaterial));
  const bookHalo = mesh(lectern, new THREE.TorusGeometry(1.15, .022, 4, 40), runeMaterial, 0, .24); bookHalo.rotation.x = -Math.PI / 2;
  const start = new THREE.Vector3(), end = new THREE.Vector3(), currentBook = new THREE.Vector3();

  const worldPosition = object => object.getWorldPosition(new THREE.Vector3());
  const places = {
    get portal() { return worldPosition(gate); },
    get book() { return worldPosition(lectern); },
    get reading() { return worldPosition(reader); },
    get casting() { return worldPosition(reader); },
  };

  function clearColliders() { for (const id of colliderIds) collision?.remove(id); colliderIds.length = 0; }
  function place(point, facing = 0) {
    if (disposed) return;
    root.position.set(point.x, point.y ?? world?.getHeight(point.x, point.z) ?? 0, point.z); root.rotation.y = facing;
    lectern.position.copy(BOOK_OFFSET); reader.position.copy(READ_OFFSET); root.updateMatrixWorld(true);
    for (const object of [lectern, reader]) {
      const position = worldPosition(object), height = world?.getHeight(position.x, position.z);
      if (Number.isFinite(height)) object.position.y += height - position.y;
    }
    root.updateMatrixWorld(true); clearColliders();
    if (collision) {
      const position = places.book, id = `portal-lectern-${root.id}`;
      collision.insert(id, { x: position.x, z: position.z, r: .8, bottom: position.y, top: position.y + 2.25 }); colliderIds.push(id);
    }
    return places;
  }
  function nearby(position) {
    if (disposed || !root.visible || phase !== 'dormant') return null;
    const book = places.book;
    if (Math.hypot(position.x - book.x, position.z - book.z) > 3.4 || Math.abs(position.y - book.y) > 2.8) return null;
    if (collision?.cameraFraction) {
      const from = new THREE.Vector3(position.x, position.y + 2.7, position.z);
      const to = new THREE.Vector3(book.x, book.y + 2.7, book.z);
      if (collision.cameraFraction(from, to, .05) < .97) return null;
    }
    return { type: 'portal', id: 'keeper-spellbook', label: 'Read the keeper’s spellbook', x: book.x, y: book.y, z: book.z };
  }
  function setPhase(next, amount = 0) {
    if (!PHASES.has(next)) throw new Error(`Unknown portal phase: ${next}`);
    phase = next; progress = THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
    refreshEffects();
  }
  function refreshEffects() {
    const awakening = phase === 'casting' ? progress : phase === 'ready' || phase === 'traveling' ? 1 : 0;
    const reading = phase === 'reading' || phase === 'casting';
    aperture.visible = awakening > 0; spell.visible = phase === 'casting'; bookHalo.visible = reading;
    surfaceMaterial.uniforms.awaken.value = awakening;
    surfaceMaterial.uniforms.travel.value = phase === 'traveling' ? 1 : 0;
    runeMaterial.opacity = reading ? .55 + awakening * .35 : awakening * .85;
    paper.emissiveIntensity = reading ? .25 : 0; ink.emissiveIntensity = reading ? 1 : 0;
    for (const material of loadedGlow) material.emissiveIntensity = awakening * .85;
    for (const material of bookGlow) material.emissiveIntensity = reading ? .55 : .08;
  }
  function update(dt, time) {
    if (disposed) return;
    surfaceMaterial.uniforms.time.value = Number.isFinite(time) ? time : surfaceMaterial.uniforms.time.value + dt;
    const elapsed = surfaceMaterial.uniforms.time.value;
    runes.rotation.z = elapsed * .12; edge.scale.setScalar(1 + Math.sin(elapsed * 2) * .008);
    bookHalo.rotation.z = elapsed * .2;
    if (spell.visible) {
      bookMount.getWorldPosition(currentBook); start.copy(root.worldToLocal(currentBook));
      aperture.getWorldPosition(end); root.worldToLocal(end);
      for (let i = 0; i < sparks.length; i++) {
        const t = (elapsed * .42 + i / sparks.length) % 1;
        sparks[i].position.lerpVectors(start, end, t);
        sparks[i].position.y += Math.sin(t * Math.PI) * 1.35;
        sparks[i].position.x += Math.sin(t * Math.PI * 7 + i) * .14;
        sparks[i].rotation.set(elapsed, i + elapsed, 0);
      }
    }
  }

  // Each imported asset owns its materials and textures. This also handles a
  // request completing after the portal itself was disposed.
  function release(object) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    object.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of node.material ? Array.isArray(node.material) ? node.material : [node.material] : []) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) { texture.dispose(); texture.source?.data?.close?.(); }
    object.removeFromParent();
  }

  async function load({ prepare } = {}) {
    if (disposed) return diagnostics();
    if (loadPromise) return loadPromise;
    loadPromise = Promise.allSettled([
      loadModel(PORTAL_ASSET, async source => {
        // The supplied core is an always-emissive plane, separate from the
        // stone arch. Its original animation must not awaken a sleeping gate.
        source.rotation.y = Math.PI / 2; source.updateMatrixWorld(true);
        const frameBounds = new THREE.Box3(), coreCenter = new THREE.Vector3();
        const frame = [];
        source.traverse(node => {
          if (!node.isMesh) return;
          if (/Plane001_/.test(node.name)) new THREE.Box3().setFromObject(node).getCenter(coreCenter);
          if (/shi_aiStandardSurface4SG/.test(node.name)) { frame.push(node); frameBounds.union(new THREE.Box3().setFromObject(node)); }
          else node.visible = false;
        });
        if (frame.length === 0 || frameBounds.isEmpty()) throw new Error('Portal asset has no stone frame.');
        const scale = 8 / (frameBounds.max.y - frameBounds.min.y);
        source.scale.setScalar(scale); source.position.set(-coreCenter.x * scale, -frameBounds.min.y * scale, -coreCenter.z * scale);
        for (const node of frame) {
          node.castShadow = node.receiveShadow = true;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            material.emissiveIntensity = 0; material.roughness = Math.max(material.roughness, .75);
            if (!loadedGlow.includes(material)) loadedGlow.push(material);
          }
        }
        await prepare?.(source);
        if (disposed) return;
        gate.add(source); fallbackGate.visible = false; modelLoaded = true;
        aperture.position.set(0, (coreCenter.y - frameBounds.min.y) * scale, .035);
        aperture.scale.set(2.49 / 2.65, 2.29 / 2.65, 1); refreshEffects();
      }, error => { modelError = error.message; }),
      loadModel(PORTAL_BOOK_ASSET, async source => {
        // This export stands its page spread upright; lay the spine on the
        // lectern before measuring so the hero can read the open pages above.
        source.rotation.x = -Math.PI / 2; source.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(source), size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
        const scale = 1.7 / size.x; source.scale.setScalar(scale);
        source.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale);
        source.traverse(node => {
          if (!node.isMesh) return;
          node.castShadow = node.receiveShadow = true;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (material.emissive) { material.emissiveIntensity = .08; bookGlow.push(material); }
          }
        });
        await prepare?.(source);
        if (disposed) return;
        bookMount.add(source); fallbackBook.visible = false; bookLoaded = true; refreshEffects();
      }, error => { bookError = error.message; }),
    ]).then(() => diagnostics());
    return loadPromise;
  }
  async function loadModel(path, accept, failed) {
    let source;
    try {
      source = (await new GLTFLoader().loadAsync(new URL(path, import.meta.url).href)).scene;
      if (!disposed) await accept(source);
      if (disposed) release(source);
    } catch (error) {
      if (source) release(source);
      failed(error instanceof Error ? error : new Error(String(error)));
    }
  }
  function diagnostics() {
    return { phase, progress, modelLoaded, bookLoaded, modelError, bookError, bookVisible: !disposed && root.visible && lectern.visible && bookMount.visible,
      apertureVisible: !disposed && aperture.visible, portal: places.portal, book: places.book, reading: places.reading, disposed };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; clearColliders(); release(root); root.clear(); loadedGlow.length = 0; bookGlow.length = 0;
  }
  refreshEffects();
  return { root, places, place, nearby, setPhase, update, load, diagnostics, dispose };
}
