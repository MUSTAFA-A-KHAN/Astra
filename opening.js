import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fit } from './model-fit.js';
import { OPENING_LINES, OPENING_TITLE, openingClue, openingChoice } from './opening-script.js';

// Owns only the arrival-square incident. Combat, conversations, navigation,
// audio, save and camera collision continue to use the game's existing systems.
export function createOpening({ scene, world, state, places: storyPlaces, audio, voiceOf,
  onChange, onEncounter, onComplete, onSpeak, onPulse, onChoice, reducedMotion = false }) {
  const root = new THREE.Group(); root.name = 'The bell beneath the tide'; scene.add(root);
  const arrival = { ...world.spawn };
  const at = (x, z) => { const p = world.findWalkable(x, z, 1); return { x: p.x, y: world.getHeight(p.x, p.z), z: p.z }; };
  const places = {
    lantern: at(arrival.x - 4.5, arrival.z - 4),
    memorial: { ...storyPlaces.notice },
    echo: at(arrival.x + 1, arrival.z - 8),
    tobin: { ...storyPlaces.tobin },
  };
  let elapsed = 0, beat = -1, started = false, summoned = false, choosing = false, disposed = false;
  let activeFile = null, beatElapsed = 0;
  const cinema = document.getElementById('opening-cinema');
  const subtitle = document.getElementById('opening-subtitle');
  const choices = document.getElementById('opening-choices');
  const caption = document.getElementById('opening-caption');
  let captionLife = 0;
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .85, ...extra });
  const wood = material('#493d35'), iron = material('#383f42'), silver = material('#afdfec', { emissive: '#65bddd', emissiveIntensity: 1.2 });
  const lantern = new THREE.Group(); lantern.name = 'Warm lantern washed onto dry cobbles';
  lantern.position.set(places.lantern.x, places.lantern.y, places.lantern.z); root.add(lantern);
  // Immediate, small readable silhouette; replaced by the already licensed GLB.
  const standin = new THREE.Group(); lantern.add(standin);
  const cage = new THREE.Mesh(new THREE.BoxGeometry(.6, 1, .6), iron); cage.position.y = .55;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(.45, .68, .62), silver); glass.position.y = .58;
  standin.add(cage, glass);
  const loader = new GLTFLoader();
  let loadedLantern = null;
  const ready = loader.loadAsync(new URL('./assets/story/old-lantern.glb', import.meta.url).href).then(gltf => {
    if (disposed) return;
    loadedLantern = fit(gltf.scene, 1.2, 'height'); lantern.add(loadedLantern); standin.visible = false;
  }).catch(() => {});
  // Broken slats, a snapped mooring ring, salt water and a line of wet prints.
  const debris = new THREE.Group(); debris.position.copy(lantern.position); root.add(debris);
  const boardGeometry = new THREE.BoxGeometry(1.8, .12, .27);
  for (let i = 0; i < 5; i++) {
    const slat = new THREE.Mesh(boardGeometry, wood); slat.position.set((i % 3 - 1) * .8, .09, 1.5 + i * .25); slat.rotation.y = i * 1.7; debris.add(slat);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.35, .065, 5, 15, Math.PI * 1.65), iron); ring.rotation.x = -Math.PI / 2; ring.position.set(-.6, .1, .1); debris.add(ring);
  const wet = new THREE.MeshBasicMaterial({ color: '#6b9ca7', transparent: true, opacity: .3, depthWrite: false });
  for (let i = 0; i < 8; i++) {
    const mark = new THREE.Mesh(new THREE.CircleGeometry(.19, 8), wet); mark.rotation.x = -Math.PI / 2; mark.scale.y = 1.6;
    const x = places.lantern.x + i * .38, z = places.lantern.z - 1 - i * .5;
    mark.position.set(x + (i % 2 ? .25 : -.25), world.getHeight(x, z) + .045, z); root.add(mark);
  }
  const light = new THREE.PointLight('#7cdfff', 0, 13, 1.8); light.position.copy(lantern.position).y += 1.3; root.add(light);
  const rift = new THREE.Group(); rift.position.set(places.echo.x, places.echo.y + .07, places.echo.z); root.add(rift);
  const glow = new THREE.MeshBasicMaterial({ color: '#85ceec', transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false });
  const loops = [1, 1.45, 2.2].map((radius, i) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, .025, 4, 36), glow); mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = i; rift.add(mesh); return mesh;
  });
  const particles = new Float32Array(32 * 3);
  for (let i = 0; i < 32; i++) { const a = i * 2.399; particles[i * 3] = Math.sin(a) * (1 + i % 4 * .3); particles[i * 3 + 1] = (i % 9) * .35; particles[i * 3 + 2] = Math.cos(a) * (1 + i % 4 * .3); }
  const particleGeometry = new THREE.BufferGeometry(); particleGeometry.setAttribute('position', new THREE.BufferAttribute(particles, 3));
  const motes = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: '#b7ecff', size: .095, transparent: true, opacity: .8, depthWrite: false })); rift.add(motes);
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.2), silver); root.add(marker);
  const film = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 48 };
  const active = () => state.stage !== 'complete';
  const cinematic = () => started && ['prologue', 'breach'].includes(state.stage);
  const setStage = stage => {
    state.stage = stage; elapsed = beatElapsed = 0; beat = -1; activeFile = null;
    audio.hush(); onChange?.(); sync();
  };
  function sync() {
    const filmOn = cinematic(); cinema.hidden = !filmOn;
    document.body.classList.toggle('opening-cinematic', filmOn);
    choices.hidden = !choosing;
    document.body.classList.toggle('opening-choice', choosing);
    document.getElementById('opening-title').textContent = state.stage === 'breach' ? 'THE STREET REMEMBERS' : OPENING_TITLE;
  }
  function speakBeat(line) {
    subtitle.textContent = line[1]; activeFile = voiceOf(line[0], line[1]);
    if (activeFile) audio.speak(activeFile); else audio.hush();
  }
  function preload(lines) { for (const [who, text] of [...lines].reverse()) { const file = voiceOf(who, text); if (file) audio.load(file, true); } }
  function start() {
    if (disposed || !active()) return;
    started = true; sync();
    preload(OPENING_LINES.prologue); preload(OPENING_LINES.breach);
    if (cinematic()) audio.play(state.stage === 'prologue' ? 'bellToll' : 'riftBreach', { volume: .72 });
    if (state.stage === 'encounter') summon();
  }
  function summon() { if (!summoned) { summoned = true; onEncounter?.(places.echo); } }
  function skip() {
    if (!cinematic()) return;
    const breach = state.stage === 'breach';
    setStage(breach ? 'encounter' : 'investigate');
    if (breach) summon();
    else showCaption('The bell has no rope. Something still answered. Find the lantern and the memorial.');
  }
  function showCaption(text, life = 6) { caption.textContent = text; captionLife = life; caption.hidden = false; }
  function objective() {
    if (!active()) return null;
    if (state.stage === 'witness') return places.tobin;
    if (state.stage === 'investigate') return state.lantern ? places.memorial : places.lantern;
    if (['encounter', 'breach'].includes(state.stage)) return places.echo;
    return places.lantern;
  }
  function nearby(player) {
    if (!active() || cinematic() || choosing) return null;
    const pool = state.stage === 'investigate' ? [['lantern', 'Inspect the drowned lantern'], ['memorial', 'Read the scratched memorial']].filter(([id]) => !state[id])
      : state.stage === 'choice' ? [['lantern', 'Decide the echo’s fate']]
      : state.stage === 'witness' ? [['tobin', 'Ask Tobin about the bell']] : [];
    for (const [id, label] of pool) {
      const p = places[id];
      if (Math.hypot(player.x - p.x, player.z - p.z) < (id === 'tobin' ? 5 : 4.1) && Math.abs(player.y - p.y) < 3) return { type: 'opening', id, label, ...p };
    }
    return null;
  }
  function interact(action) {
    if (!action || !active() || choosing) return;
    if (state.stage === 'investigate') {
      const id = action.id; if (state[id] || !['lantern', 'memorial'].includes(id)) return;
      onSpeak?.(id === 'lantern' ? 'openingLantern' : 'openingMemorial', OPENING_LINES[id], () => {
        if (!openingClue(state, id)) return;
        onChange?.();
        if (state.stage === 'breach') { elapsed = beatElapsed = 0; beat = -1; audio.play('riftBreach', { volume: .85 }); onPulse?.(places.echo, '#99e4ff'); }
        else showCaption(id === 'lantern' ? 'Fresh scratches on an old memorial. Someone else was here tonight.' : 'The warm lantern is still burning nearby.');
        sync();
      });
    } else if (state.stage === 'choice') {
      choosing = true; audio.hush(); sync(); document.querySelector('[data-opening-choice="mercy"]').focus();
    } else if (state.stage === 'witness' && action.id === 'tobin') {
      onSpeak?.('tobin', OPENING_LINES[state.choice === 'mercy' ? 'witnessMercy' : 'witnessSeal'], () => {
        setStage('complete'); caption.hidden = true; onComplete?.();
      });
    }
  }
  function choose(choice) {
    if (!choosing || !openingChoice(state, choice)) return;
    choosing = false; onChange?.(); sync();
    audio.play('wardPulse', { volume: .7 }); onPulse?.(places.lantern, choice === 'mercy' ? '#c5fff0' : '#d7ba83');
    onChoice?.(choice);
    onSpeak?.('openingEcho', OPENING_LINES[choice], () => showCaption('Tobin, at the west jetty, has heard that bell before. Follow the light.', 7));
  }
  function defeat() {
    if (state.stage !== 'encounter') return;
    setStage('choice'); audio.play('wardPulse', { volume: .45 });
    showCaption(OPENING_LINES.released[0][1]);
    const line = OPENING_LINES.released[0], file = voiceOf(line[0], line[1]); if (file) audio.speak(file);
  }
  function update(dt, time, player, { running = true, paused = false } = {}) {
    root.visible = running && (!world.activeMap || world.activeMap === 'city');
    if (!running) {
      cinema.hidden = choices.hidden = caption.hidden = true;
      document.body.classList.remove('opening-cinematic', 'opening-choice');
      return;
    }
    if (paused) return;
    if (captionLife > 0) { captionLife -= dt; caption.hidden = captionLife <= 0; }
    const agitated = ['breach', 'encounter', 'choice'].includes(state.stage);
    light.intensity = active() ? (agitated ? 5 : 2.5) + (reducedMotion ? 0 : Math.sin(time * 2) * .6) : .6;
    rift.visible = agitated || !!state.choice;
    if (rift.visible) {
      const scale = state.stage === 'breach' ? Math.min(1, .1 + elapsed / 3) : state.choice ? .4 : 1;
      rift.scale.setScalar(scale); motes.rotation.y = reducedMotion ? 0 : time * .15;
      for (let i = 0; i < loops.length; i++) loops[i].rotation.z = (reducedMotion ? 0 : time * .1) * (i % 2 ? -1 : 1);
    }
    const goal = objective(); marker.visible = !!goal && !cinematic() && state.stage !== 'witness';
    if (goal) marker.position.set(goal.x, goal.y + 2.3 + (reducedMotion ? 0 : Math.sin(time * 2) * .12), goal.z);
    if (!cinematic()) { if (state.stage === 'encounter') summon(); return; }
    elapsed += dt; beatElapsed += dt;
    const lines = state.stage === 'prologue' ? OPENING_LINES.prologue : OPENING_LINES.breach;
    if (beat < 0) { beat = 0; beatElapsed = 0; speakBeat(lines[0]); }
    const minimum = state.stage === 'prologue' ? [6.5, 6, 4.5][beat] : 4.5;
    // Wait for actual recorded speech, with a bounded fallback for bad audio.
    if (beatElapsed >= minimum && (!activeFile || !audio.saying(activeFile) || beatElapsed > 12)) {
      if (++beat < lines.length) { beatElapsed = 0; speakBeat(lines[beat]); }
      else skip();
    }
    audio.setMusicState('suspicion');
  }
  function shot(player) {
    if (!cinematic()) return null;
    const p = state.stage === 'breach' ? places.echo : beat === 1 ? places.memorial : beat >= 2 ? places.lantern : arrival;
    film.target.set(p.x, p.y + (beat === 1 ? 2 : 1.1), p.z);
    const orbit = reducedMotion ? 0 : Math.min(elapsed, 22) * .018;
    const radius = state.stage === 'breach' ? 8 : beat <= 0 ? 17 : beat === 1 ? 8 : 5;
    film.position.set(p.x + Math.sin(.4 + orbit) * radius, p.y + (beat <= 0 ? 9 : 3.5), p.z + Math.cos(.4 + orbit) * radius);
    film.fov = beat <= 0 ? 52 : 44; return film;
  }
  const skipButton = document.getElementById('opening-skip'); skipButton.addEventListener('click', skip);
  const buttons = [...document.querySelectorAll('[data-opening-choice]')];
  const handlers = buttons.map(button => { const handler = () => choose(button.dataset.openingChoice); button.addEventListener('click', handler); return handler; });
  return {
    root, places, state, ready, start, skip, update, shot, objective, nearby, interact, defeat,
    get active() { return active(); }, get cinematic() { return cinematic(); }, get locked() { return cinematic() || choosing; },
    get tension() { return ['breach', 'encounter'].includes(state.stage) ? 1 : active() ? .4 : 0; },
    get diagnostics() { return { ...state, active: active(), cinematic: cinematic(), choosing, elapsed, beat, places, lanternLoaded: !!loadedLantern }; },
    dispose() { disposed = true; root.removeFromParent(); skipButton.removeEventListener('click', skip); buttons.forEach((b, i) => b.removeEventListener('click', handlers[i])); }
  };
}
