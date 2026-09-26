import * as THREE from 'three';
import { createWorld, daylightAt } from './world-map.js';
import { createAtmosphere } from './atmosphere.js';
import { createFlashlight } from './flashlight.js';
import { SpatialHash, LocomotionController, PropPhysics, RagdollController } from './physics.js';
import { FollowCamera } from './camera.js';
import { GameAudio } from './audio.js';
import { createGameplayWorld } from './gameplay-world.js';
import { alignRider, MountSteering } from './riding.js';
import { HEROES, createHero, createEnemySquad } from './characters.js';
import { createStory } from './story.js';
import { CHAPTER, PEOPLE, STEPS, INTRO, storyStep, readStory, conversation, whisper } from './story-script.js';
import { CHAPTER_TWO, CHAPTER_TWO_STEPS, CHAPTER_TWO_PEOPLE, readChapterTwo, chapterTwoStep, chapterTwoConversation } from './chapter-two-script.js';
import { createChapterTwo } from './chapter-two-world.js';
import { createPortal, PORTAL_ENTRY } from './portal-world.js';
import { PORTAL_TIMING, portalShot, shotPose, landingPose, cinematicWeight } from './portal-cinematic.js';
import { portalRoute, portalConversation } from './portal-script.js';

const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer:coarse)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const SAVE_KEY = 'astra-journey-v1';
function readSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } }
const saved = readSave();
const finite = (v, fallback, min = 0, max = 1e7) => Number.isFinite(v) ? clamp(v, min, max) : fallback;
const progress = { xp: finite(saved.xp, 0), kills: finite(saved.kills, 0), restored: saved.restored === true, collected: new Set(Array.isArray(saved.collected) ? saved.collected.filter(v => Number.isInteger(v) && v >= 0) : []), story: readStory(saved) };
progress.chapterTwo = readChapterTwo(saved);
const chapterTwoUnlocked = () => progress.restored && progress.story.farewell;
const currentChapter = () => chapterTwoUnlocked() ? CHAPTER_TWO : CHAPTER;
const speakers = { ...PEOPLE, ...CHAPTER_TWO_PEOPLE, portalBook: { name: 'The keeper’s spellbook', color: '#bceee6', read: true } };
let portalJourney = null;
// Where the player has put each on-screen control, as a fraction of
// the viewport: a phone that rotates, or a window that resizes, keeps
// the thumb rest in the same corner instead of the same pixel. An
// absent control has never been moved and stays where the stylesheet
// puts it.
const CONTROLS = ['joystick','sprint','attack','ability','jump','view'];
// Camera perspectives, cycled by the view button. Each one is a pitch,
// a distance and a field of view; the player is free to drag and zoom
// away from any of them afterwards, which is why these are a starting
// posture rather than a mode the camera is locked into.
const VIEWS = [
  { id: 'follow', name: 'Follow', pitch: .48, radius: 14, fov: 55 },
  // The close one phone games run: nearly level with the hero, a
  // step behind them, and pushed off to one side so the body is
  // not standing in front of everything worth seeing.
  { id: 'close', name: 'Close', pitch: .1, radius: 2, fov: 70, shoulder: .8, height: 3 },
  { id: 'shoulder', name: 'Shoulder', pitch: .3, radius: 8.5, fov: 62 },
  { id: 'wide', name: 'Wide', pitch: .4, radius: 23, fov: 52 },
  { id: 'overhead', name: 'Overhead', pitch: .88, radius: 21, fov: 55 },
];
const readLayout = stored => Object.fromEntries(CONTROLS
  .map(control => [control, stored?.[control]])
  .filter(([, spot]) => Number.isFinite(spot?.x) && Number.isFinite(spot?.y))
  .map(([control, spot]) => [control, { x: clamp(spot.x, 0, 1), y: clamp(spot.y, 0, 1) }]));
const preferences = { quality: ['auto','low','balanced','high'].includes(saved.quality) ? saved.quality : 'auto', sound: saved.sound !== false, showFPS: saved.showFPS === true, time: finite(saved.time, 15.5, 0, 24), flashlight: saved.flashlight !== false, layout: readLayout(saved.layout), view: VIEWS.some(view => view.id === saved.view) ? saved.view : VIEWS[0].id, plaza: saved.plaza === true, nightwood: saved.nightwood === true, mesa: saved.mesa === true };
// One city day lasts twenty minutes of active play. Menus pause the clock.
const DAY_LENGTH_SECONDS = 20 * 60;
const formatTime = hour => {
  const minutes = Math.floor((((hour % 24) + 24) % 24) * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
let hero = null, heroMeta = HEROES[0], screen = 'lobby', switching = false, sessionStarted = false, contextLost = false;
preferences.volumes = Object.fromEntries(['master','effects','ambience','music'].map(key => [key, finite(saved.volumes?.[key], key === 'music' ? .45 : .8, 0, 1)]));
const audio = new GameAudio({ enabled: preferences.sound });
audio.setVolumes(preferences.volumes);
let toastTimeout, audioContext, time = 0, health = 100, attackTimer = 0, abilityTimer = 0, hurtTimer = 0, emoting = null, emoteUntil = 0, greetUntil = 0;
let lockTarget = null, aiming = false, cinematic = false, combatMemory = 0, victoryTime = 0;
let lastSave = 0, dirtySave = false, previewYaw = .23;
const level = () => Math.floor(progress.xp / 150) + 1;
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...preferences, xp: progress.xp, kills: progress.kills, restored: progress.restored, collected: [...progress.collected], story: progress.story, chapterTwo: progress.chapterTwo, map: world.activeMap || 'city', hero: heroMeta.id })); dirtySave = false; }
  catch { /* Private browsing and full storage must never stop play. */ }
}
// A toast marked `after` waits for the one on screen instead of replacing it:
// the story's next step is announced once a wisp has finished whispering.
const toastQueue = [];
function toast(message, { after = false } = {}) {
  if (after && $('toast').classList.contains('visible')) { toastQueue.push(message); return; }
  $('toast-text').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { if (toastQueue.length) toast(toastQueue.shift()); else $('toast').classList.remove('visible'); }, 3800);
}
function sound() {
  audio.play('interaction', { volume: .35 });
}
// Safari mutes Web Audio while an iPhone or iPad is in silent mode unless the page declares a playback session.
function enableAudio() { if (!preferences.sound) return; try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; audioContext ||=new (window.AudioContext || window.webkitAudioContext)(); audio.setContext(audioContext); audioContext.resume().catch(() => {}); } catch {} }
// iPadOS suspends ("interrupted") the context after app switches, calls or locking; only a gesture may restart it.
for (const type of ['touchend', 'click', 'keydown']) addEventListener(type, () => { if (preferences.sound && audioContext && audioContext.state !== 'running') audioContext.resume().catch(() => {}); }, { capture: true, passive: true });
// Shown under the audio setting so a device without developer tools can still report what the sound engine is doing.
function audioStatus() { const stats = audio.getStats(); return stats.state === 'locked' ? 'Starts when you enter the city.' : `Engine ${stats.state} · ${stats.format === 'm4a' ? 'AAC' : 'Ogg'} · ${stats.loaded} sounds loaded${stats.failed.length ? ` · ${stats.failed.length} failed` : ''}`; }

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fbcb0');
scene.fog = new THREE.Fog('#a8c2b0', 100, 390);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, .15, 650);
const renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: touch ? 'default' : 'high-performance', alpha: false });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-label', 'Drag to look around the world');
$('scene').append(renderer.domElement);
const hemi = new THREE.HemisphereLight('#d5ece3', '#64704b', 2.5); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe0a4', 3.1); sun.position.set(-45, 65, 38); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 180 });
sun.shadow.bias = -.0003; sun.shadow.normalBias = .08; scene.add(sun, sun.target);
const portraitLight = new THREE.DirectionalLight('#d1ecea', 1.6); portraitLight.position.set(3, 6, 27); scene.add(portraitLight);
const atmosphere = createAtmosphere({ scene, sun, hemi, portraitLight, renderer, lowPower: touch });
// The hero takes a flashlight out after dark. Its model downloads alongside the
// world's; without it the light still shines, from an empty hand.
const flashlight = createFlashlight(); flashlight.enabled = preferences.flashlight; scene.add(flashlight.group);
const flashlightModel = flashlight.load().catch(error => console.warn('The flashlight model did not load; its light still shines.', error));
let world;
try {
  $('load-message').textContent = 'Preparing the Verdant Reach…';
  world = await createWorld(scene, { portalTravel: true, lowPower: touch, plaza: preferences.plaza, nightwood: preferences.nightwood, mesa: preferences.mesa });
} catch (error) {
  $('load-message').textContent = 'The Reach could not load. Check your connection and try again.';
  $('retry-button').hidden = false;
  throw error;
}
const groundHeight = (x, z) => world.getHeight(x, z);
// The Reach is two districts: the ambience, the sky and the HUD all ask which.
const region = () => world.biomeAt(position.x, position.z);
const spawn = new THREE.Vector3(world.spawn.x, groundHeight(world.spawn.x, world.spawn.z), world.spawn.z);
const camp = world.landmarks.find(landmark => landmark.id === 'camp') || world.landmarks[1];
const avatar = new THREE.Group(); scene.add(avatar); avatar.position.copy(spawn);
const position = spawn.clone(), velocity = new THREE.Vector3();
const stage = new THREE.Group(); stage.position.copy(spawn); scene.add(stage);
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 3.05, .3, 48), new THREE.MeshStandardMaterial({ color: '#627365', roughness: .88 })); pedestal.position.y = .06; pedestal.receiveShadow = true; stage.add(pedestal);
const stageRing = new THREE.Mesh(new THREE.TorusGeometry(2.53, .025, 5, 64), new THREE.MeshBasicMaterial({ color: '#e2d29d' })); stageRing.rotation.x = Math.PI / 2; stageRing.position.y = .22; stage.add(stageRing);
const blobCanvas = document.createElement('canvas'); blobCanvas.width = blobCanvas.height = 64;
const blobCtx = blobCanvas.getContext('2d'); const gradient = blobCtx.createRadialGradient(32,32,0,32,32,32); gradient.addColorStop(0,'#061d17aa'); gradient.addColorStop(1,'#061d1700'); blobCtx.fillStyle = gradient; blobCtx.fillRect(0,0,64,64);
const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.4,3.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blobCanvas), transparent: true, depthWrite: false })); blob.rotation.x = -Math.PI / 2; scene.add(blob);

// Static obstacle buckets limit collision checks to objects near the player.
const collision = new SpatialHash();
world.colliders.forEach((collider, index) => collision.insert(`city-${index}`, collider));
const activities = await createGameplayWorld(scene, world, collision);
// The Last Keeper's people and places. Their models stream in after the game
// starts; who stands where is known already, so they can be spoken to at once.
let story = createStory({ world, activities, collision });
scene.add(story.root); story.setState({ restored: progress.restored });
const currentStep = () => chapterTwoUnlocked() ? chapterTwoStep(progress.chapterTwo) : STEPS[storyStep(progress)];
const questIndex = () => chapterTwoUnlocked() ? STEPS.length + CHAPTER_TWO_STEPS.indexOf(currentStep()) : storyStep(progress);
const chapterTwo = createChapterTwo({ world, collision, state: progress.chapterTwo, storyPlaces: story.places, isUnlocked: chapterTwoUnlocked,
  onChange: ({ flag, reward }) => { gainXP(reward); save(); sound(); react('Cheer'); if(flag==='warden'){victoryTime=10;audio.play('victory');} },
  onMessage: message => toast(message),
  onDamage: amount => { if(hurtTimer>0)return; health=Math.max(0,health-amount);hurtTimer=.8;combatMemory=5;audio.play('hit',{position,volume:.7});if(health<=0)respawnPlayer();updateHUD(); },
});
scene.add(chapterTwo.root);
const portal = createPortal({ world, reducedMotion }); scene.add(portal.root);
const inCity = () => !world.activeMap || world.activeMap === 'city';
const cityExtraColliders = new Map();
function placePortal() {
  const anchor = inCity() ? { x: -52, z: 32 } : world.spawn;
  // Both the dais and its reader need clear ground. Search locally so the
  // portal never asks the player to stand inside the imported scenery.
  let chosen = null;
  for (let r = 0; r <= 36 && !chosen; r += 3) for (let i = 0; i < 16 && !chosen; i++) {
    const x = anchor.x + Math.cos(i * Math.PI / 8) * r, z = anchor.z + Math.sin(i * Math.PI / 8) * r;
    if (!world.isWalkable(x, z, 2.4)) continue;
    const point = { x, y: groundHeight(x,z), z };
    for (let facing = 0; facing < Math.PI * 2; facing += Math.PI / 2) {
      portal.place(point, facing);
      const { book, reading } = portal.places;
      if ([book, reading].every(p => world.isWalkable(p.x,p.z,.85) && Math.abs(groundHeight(p.x,p.z)-point.y)<.6)
        && Object.values(chapterTwo.places).every(p => Math.hypot(p.x-book.x,p.z-book.z)>6)
        && (!inCity() || Object.values(story.places).every(p => Math.hypot(p.x-book.x,p.z-book.z)>6))) { chosen = point; break; }
    }
  }
  if (!chosen) portal.place(world.findWalkable(anchor.x,anchor.z,2.4));
  portal.setPhase('dormant');
}
placePortal();
const questObjective = () => chapterTwoUnlocked() ? (currentStep().map !== (world.activeMap || 'city') ? portal.places.book : chapterTwo.objective()) : story.objective(currentStep().id);
const locomotion = new LocomotionController(position, velocity, activities.terrain, collision, { waterZones: activities.waterZones, climbables: activities.climbables });
// A ridden horse keeps its own heading and wheels round rather than turning on the spot.
const reins = new MountSteering();
const propPhysics = new PropPhysics(activities.terrain, collision);
for (const crate of activities.crates) propPhysics.addBody(crate);
const followCamera = new FollowCamera(camera, activities.terrain, collision);
function collide(p, radius = .65) {
  collision.resolve(p, radius, 3.3);
  const bounds = world.bounds;
  p.x=clamp(p.x,bounds.minX+radius,bounds.maxX-radius); p.z=clamp(p.z,bounds.minZ+radius,bounds.maxZ-radius);
}

const QUALITY = { low:{ratio:1,shadows:false}, balanced:{ratio:1.35,shadows:true}, high:{ratio:1.8,shadows:true} };
let quality = touch ? 'balanced' : 'high', resolutionScale = 1, frameMS = 16.7, frameSamples = 0, sampleTime = 0, lastAdapt = 0;
function applyQuality(value, adaptive = false) {
  quality = value; const q = QUALITY[value];
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.ratio) * resolutionScale); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = q.shadows; sun.castShadow = q.shadows;
  world.setQuality(value); atmosphere.setQuality(value); flashlight.setQuality(value); renderer.shadowMap.needsUpdate = true;
  $('quality-status').textContent = `${preferences.quality === 'auto' ? 'Adaptive' : 'Graphics'} · ${value === 'low' ? 'Performance' : value === 'high' ? 'High' : 'Balanced'}`;
  if (adaptive) lastAdapt = time;
}
applyQuality(preferences.quality === 'auto' ? quality : preferences.quality);
function setTime(hour) {
  preferences.time = ((hour % 24) + 24) % 24;
  atmosphere.setTime(preferences.time);
  world.setTime(preferences.time);
  flashlight.setTime(daylightAt(preferences.time));
  const label = $('time-value');
  if (label) label.textContent = formatTime(preferences.time);
}
setTime(preferences.time);

const sigils = [ '<path d="m16 3 11 4v14L16 31 5 21V7Z M16 8v16m-5-10h10"/>', '<path d="M11 3c20 8 20 20 0 28L11 3Zm0 14h18m-4-4 4 4-4 4"/>', '<path d="m16 2 7 9-7 9-7-9Zm0 18v11M6 5 3 2m23 3 3-3M5 19l-3 3m25-3 3 3"/>', '<path d="m16 2 12 14-12 14L4 16Zm0 7 6 7-6 7-6-7Z"/>', '<path d="M3 19h26M7 19 11 7h10l4 12M9 24h14M11 29h10"/>' ];
$('character-roster').innerHTML = HEROES.map((h,i)=>`<button class="character-card" data-hero="${h.id}" aria-label="Select ${h.name}, ${h.title}${h.imported ? `, optional ${h.size} download` : ''}" aria-pressed="false" style="--hero-color:${h.color}"><span class="character-sigil"><svg viewBox="0 0 32 34" aria-hidden="true">${sigils[i]}</svg></span><span><strong>${h.name}</strong><small>${h.imported ? h.size+' · GUEST' : h.role.toUpperCase()}</small></span></button>`).join('');
function updateHeroUI() {
  $('hero-name').replaceChildren(document.createTextNode(heroMeta.name), Object.assign(document.createElement('span'),{textContent:heroMeta.title}));
  $('hero-role').textContent=heroMeta.weapon.toUpperCase(); $('hero-description').textContent=heroMeta.description;
  $('hero-ability').textContent=heroMeta.ability; $('hud-name').textContent=heroMeta.name; $('lobby-button').textContent=heroMeta.name[0];
  $('preview-label').textContent=`${heroMeta.name.toUpperCase()} · LEVEL ${String(level()).padStart(2,'0')}`;
  $('hero-stats').innerHTML=Object.entries(heroMeta.stats).map(([name,value])=>`<div class="hero-stat"><div><small>${name.toUpperCase()}</small><strong>${value}</strong></div><div class="stat-track"><i style="width:${value}%"></i></div></div>`).join('');
  $('ability-label').textContent=heroMeta.id==='ranger'?'Gale':heroMeta.id==='warden'?'Sunsteel':'Pulse';
  document.querySelectorAll('[data-hero]').forEach(b=>{ const selected=b.dataset.hero===heroMeta.id; b.classList.toggle('selected',selected); b.setAttribute('aria-pressed',String(selected)); });
  $('roster-count').textContent=`${String(HEROES.indexOf(heroMeta)+1).padStart(2,'0')} / 05`;
}
async function selectHero(id) {
  if(switching || (hero && heroMeta.id===id)) return;
  switching=true; $('play-button').disabled=true;
  const meta=HEROES.find(h=>h.id===id)||HEROES[0];
  $('character-loading').hidden=false; $('character-loading-text').textContent=meta.imported?`Loading ${meta.name} · ${meta.size}…`:'Preparing adventurer…';
  try {
    const next=await createHero(meta.id);
    // Moved across first: the old hero's disposal takes everything still in its rig.
    flashlight.attach(next);
    if(hero){avatar.remove(hero.group);hero.dispose();}
    hero=next;heroMeta=meta;avatar.add(hero.group);previewYaw=.23;updateHeroUI();syncEmotes();save();
    // A new adventurer says hello from the pedestal, if they have a wave.
    greetUntil=screen==='lobby'?time+hero.cue('Wave'):0;
  } catch (error) { console.warn('Character unavailable:',error); toast('That adventurer could not load. Your current hero is ready.'); }
  finally {switching=false;$('character-loading').hidden=true;$('play-button').disabled=!hero;}
}
$('character-roster').addEventListener('click',e=>{const b=e.target.closest('[data-hero]');if(b)selectHero(b.dataset.hero);});

// Collectibles share one mesh, material, and GPU buffer.
// An empty slot belongs to a district that is turned off: it keeps its place, unseen.
const shardPositions = (world.shardPositions || [[0,9],[1,0],[-1,-10],[2,-20],[0,-32],[-12,9],[-23,16],[-35,23],[-42,34],[-49,17],[14,-7],[25,-13],[36,-17],[47,-26],[55,-12],[-15,-42],[16,-43],[-28,-60],[30,-63],[60,30],[-65,-10],[66,-48],[-25,60],[25,48]]).map(spot=>{if(!spot)return null;const point=world.findWalkable(spot[0],spot[1]);return [point.x,point.z];});
// Each district across the water adds shards, so a save is checked against the world it loads into.
for(const i of progress.collected)if(i>=shardPositions.length)progress.collected.delete(i);
const shardMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.48),new THREE.MeshStandardMaterial({color:'#c1f6df',emissive:'#43a995',emissiveIntensity:.8,metalness:.2,roughness:.25}),shardPositions.length); shardMesh.frustumCulled=false; scene.add(shardMesh);
// The Moonwell's own crystal takes over from the stand-in once it arrives.
story.shard().then(({geometry,material})=>{shardMesh.geometry.dispose();shardMesh.material.dispose();shardMesh.geometry=geometry;shardMesh.material=material;}).catch(error=>console.warn('The shard model did not load; the stand-in stays.',error));
const dummy=new THREE.Object3D();
const enemyGeo=new THREE.IcosahedronGeometry(.85,1),enemyMat=new THREE.MeshStandardMaterial({color:'#9380b0',emissive:'#3c235c',emissiveIntensity:.65,roughness:.5});
const eyeGeo=new THREE.SphereGeometry(.12,6,4),eyeMat=new THREE.MeshBasicMaterial({color:'#ffdbaf'});
const enemies=(world.enemyPositions || [[-9,-17],[12,-30],[-17,-38],[28,-24],[-33,-12],[45,-42]]).map(([x,z],i)=>{
  const point=world.findWalkable(x,z);x=point.x;z=point.z;
  const group=new THREE.Group(),wisp=new THREE.Group(),core=new THREE.Mesh(enemyGeo,enemyMat); wisp.add(core);
  for(const side of [-1,1]){const eye=new THREE.Mesh(eyeGeo,eyeMat);eye.position.set(side*.27,.18,.72);wisp.add(eye);}
  group.add(wisp);group.position.set(x,groundHeight(x,z)+1.4,z);scene.add(group);return{group,wisp,core,x,z,hp:80,index:i,hit:0,alive:true,rig:null,swing:0,dying:0,respawn:0};
});
// The drowned take shape once their shared model lands: pale, half-seen, lit
// from within. A failed download leaves the stand-in wisps in play rather than
// emptying the field.
createEnemySquad(enemies.length).then(squad=>{
  squad.members.forEach((rig,i)=>{const e=enemies[i];e.rig=rig;e.wisp.visible=false;e.group.add(rig.group);e.group.position.y=groundHeight(e.group.position.x,e.group.position.z);});
  const spectral=new Set();for(const rig of squad.members)rig.group.traverse(o=>{if(o.isMesh){o.castShadow=false;for(const m of [o.material].flat())spectral.add(m);}});
  for(const m of spectral){m.transparent=true;m.opacity=.78;m.depthWrite=false;if(m.emissive){m.emissive.set('#9fe2ff');m.emissiveIntensity=.55;}}
}).catch(error=>console.warn('Enemy model unavailable:',error));
// The Reach refills itself: a released wisp drifts back out of its
// old patrol once the player is far enough away not to see it arrive.
const RESPAWN_DELAY=9,RESPAWN_CLEARANCE=26;
for (const enemy of enemies) enemy.ragdoll = new RagdollController(enemy.group.position, activities.terrain, collision, { rotation: enemy.group.rotation, radius: .65 });
function revive(e){
  e.ragdoll.reset(); e.group.rotation.x=e.group.rotation.z=0;
  e.alive=true;e.hp=80;e.hit=0;e.swing=0;e.dying=0;e.respawn=0;
  e.group.position.set(e.x,groundHeight(e.x,e.z)+(e.rig?0:1.4),e.z);e.group.scale.setScalar(1);e.group.visible=true;e.rig?.reset();
}
const effectGroup=new THREE.Group();scene.add(effectGroup);
const pulse=new THREE.Mesh(new THREE.TorusGeometry(1,.045,5,40),new THREE.MeshBasicMaterial({color:'#c3f0d5',transparent:true,opacity:0,depthWrite:false}));pulse.rotation.x=-Math.PI/2;effectGroup.add(pulse);
let pulseAge=2,pulseSize=5;
const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,1,6),new THREE.MeshBasicMaterial({color:'#e3eec0',transparent:true,opacity:0,depthWrite:false}));effectGroup.add(bolt);let boltAge=1;
const direction=new THREE.Vector3(),targetPoint=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
function showPulse(x,z,size,color) { pulse.position.set(x,groundHeight(x,z)+.3,z);pulse.material.color.set(color);pulseAge=0;pulseSize=size; }
function gainXP(amount) {const previous=level();progress.xp+=amount;dirtySave=true;if(level()>previous){health=100;toast(`Level ${level()} · Your light grows stronger`);sound();react('Cheer');}updateHUD();}
$('quest-eyebrow').textContent=`${CHAPTER.eyebrow} · ${CHAPTER.title.toUpperCase()}`;
// The step the tracker last showed: when the story moves on, the new step is
// announced once, and the tracker flashes to draw the eye to it.
let shownStep=questIndex();
function updateHUD(){
  $('health-fill').style.width=`${health}%`;$('health-meter').setAttribute('aria-valuenow',Math.ceil(health));$('health-label').textContent=`${Math.ceil(health)} / 100`;
  $('xp-fill').style.width=`${progress.xp%150/150*100}%`;$('xp-meter').setAttribute('aria-valuenow',Math.round(progress.xp%150/150*100));$('level-label').textContent=`LV. ${level()}`;$('shards-label').textContent=`${progress.collected.size} shards`;
  const index=questIndex(),step=currentStep(),complete=step.id==='complete',chapter=currentChapter();
  $('quest-eyebrow').textContent=`${chapter.eyebrow} · ${chapter.title.toUpperCase()}`;
  const card=document.querySelector('.journey-card');
  if(chapterTwoUnlocked()&&card.dataset.chapter!=='two'){
    card.dataset.chapter='two';card.querySelector('.eyebrow').textContent='CHAPTER TWO';
    card.querySelector('h2').textContent=CHAPTER_TWO.title;
    card.querySelector('p').textContent='A stolen voice. Three ancient locks. Follow the tide from Pine Islet to the old pumping yard and face the Hollow Warden.';
    card.querySelector('.location-tag').textContent='CITY · ISLET · YARD';
  }
  const value=step.goal?Math.min(step.goal,step.count(progress)):complete?1:0;
  $('quest-title').textContent=step.title;$('quest-description').textContent=step.description;
  const status=$('chapter-status');status.hidden=!chapterTwoUnlocked()||complete;
  if(!status.hidden){const goal=chapterTwo.objective(),distance=goal?Math.round(Math.hypot(goal.x-position.x,goal.z-position.z)):0;status.textContent=chapterTwo.status||`${step.where} · ${distance} paces · follow the gold map marker`;}
  $('quest-count').textContent=step.goal?`${value} / ${step.goal}`:complete?'COMPLETE':`◇ ${step.where}`;$('quest-fill').style.width=`${step.goal?value/step.goal*100:complete?100:0}%`;
  // Held back through the finale, so it lands after the keeper has gone.
  if(index!==shownStep&&!finale){
    shownStep=index;const tracker=document.querySelector('.quest-tracker');tracker.classList.remove('updated');void tracker.offsetWidth;tracker.classList.add('updated');
    toast(complete?`${chapter.title} · Chapter complete`:`New task · ${step.title}`,{after:true});
  }
}
function attack(special=false){
  if(screen!=='game'||dialog.open||chat||portalJourney||document.hidden||!hero||contextLost)return;
  if(special?abilityTimer>0:attackTimer>0)return;
  if(special)abilityTimer=7;attackTimer=heroMeta.cooldown;
  cinematic=false; combatMemory=5; audio.play('sword', { position, volume: special ? .9 : .65 });
  const range=special?heroMeta.range+5:heroMeta.range,damage=(special?heroMeta.damage*2:heroMeta.damage)+(level()-1)*3;
  let nearest=null,best=range;
  for(const e of [...enemies,...chapterTwo.combatants]){if(!e.alive)continue;const d=Math.hypot(e.group.position.x-position.x,e.group.position.z-position.z);if(d<best){nearest=e;best=d;}}
  if(lockTarget?.alive && position.distanceTo(lockTarget.group.position)<range)nearest=lockTarget;
  if(aiming&&!special&&nearest){const dx=nearest.group.position.x-position.x,dz=nearest.group.position.z-position.z;if((-Math.sin(yaw)*dx-Math.cos(yaw)*dz)/Math.max(.01,Math.hypot(dx,dz))<.82)nearest=null;}
  if(nearest && (Math.abs(nearest.group.position.y-position.y)>4 || collision.cameraFraction(new THREE.Vector3(position.x,position.y+1.8,position.z),new THREE.Vector3(nearest.group.position.x,nearest.group.position.y+1.8,nearest.group.position.z),.1)<.98))nearest=null;
  if(nearest){avatar.rotation.y=Math.atan2(nearest.group.position.x-position.x,nearest.group.position.z-position.z);}
  const targets=special?enemies.filter(e=>e.alive&&Math.abs(e.group.position.y-position.y)<4&&Math.hypot(e.group.position.x-position.x,e.group.position.z-position.z)<range&&collision.cameraFraction(new THREE.Vector3(position.x,position.y+1.8,position.z),new THREE.Vector3(e.group.position.x,e.group.position.y+1.8,e.group.position.z),.1)>.98):nearest&&enemies.includes(nearest)?[nearest]:[];
  for(const e of targets){
    e.hp-=damage;e.hit=.3;audio.play('hit',{position:e.group.position,volume:.6});
    if(e.hp<=0){
      e.alive=false;e.respawn=RESPAWN_DELAY;e.dying=2.6;
      const dx=e.group.position.x-position.x,dz=e.group.position.z-position.z,d=Math.max(.1,Math.hypot(dx,dz));
      e.ragdoll.start({x:dx/d*4,y:2,z:dz/d*4});
      if(lockTarget===e)lockTarget=null;
      progress.kills++;gainXP(35);toast(`${whisper(progress.kills)} · +35 experience`);
      if(!enemies.some(other=>other.alive&&position.distanceTo(other.group.position)<20)){victoryTime=7;combatMemory=0;react('Cheer');}
    }
  }
  const trialHit=chapterTwo.attack({position,range,damage,special,target:nearest,lineOfSight:(a,b)=>collision.cameraFraction(new THREE.Vector3(a.x,a.y+1.8,a.z),new THREE.Vector3(b.x,b.y+1.8,b.z),.1)>.98});
  if(trialHit.hits){audio.play('hit',{position,volume:.6});showPulse(position.x,position.z,range,heroMeta.color);}
  if(special){showPulse(position.x,position.z,range,heroMeta.color);if(heroMeta.id==='warden'){health=Math.min(100,health+20);updateHUD();}}
  else if(nearest){targetPoint.copy(nearest.group.position);direction.copy(targetPoint).sub(position).add(new THREE.Vector3(0,-1.6,0));bolt.position.copy(position).add(new THREE.Vector3(0,1.6,0)).addScaledVector(direction,.5);bolt.scale.set(1,direction.length(),1);bolt.quaternion.setFromUnitVectors(up,direction.normalize());bolt.material.color.set(heroMeta.color);boltAge=0;}
  else showPulse(position.x,position.z,2.5,heroMeta.color);
  updateHUD();
}
function nearbyInteraction(){
  if(portalJourney)return null;
  const book = portal.nearby(position); if(book)return book;
  if(!inCity())return chapterTwo.nearby(position);
  if(activities.mount.mounted)return {type:'mount',label:'Dismount'};
  if(locomotion.climbing)return {type:'climb',label:'Let go of ladder'};
  if(position.distanceTo(activities.mount.position)<4)return {type:'mount',label:'Ride trail horse'};
  const ladder=activities.climbables.find(c=>Math.hypot(position.x-c.x,position.z-c.z)<(c.r||1.8)&&position.y<c.top+.5);
  if(ladder)return {type:'climb',label:'Climb lookout · forward / back',ladder};
  if(!finale){const trial=chapterTwo.nearby(position);if(trial)return trial;const person=story.nearby(position,STEPS[storyStep(progress)].id);if(person)return person;}
  if(activities.crates.some(c=>position.distanceTo(c.position)<2.8))return {type:'push',label:'Push supply crate'};
  return null;
}
function interact(){
  if(screen!=='game'||dialog.open||chat||portalJourney)return;
  const action=nearbyInteraction();if(!action)return;
  if(action.type==='portal'){readPortalBook();return;}
  if(action.type==='chapterTwo'){
    if(action.id===closed.person&&performance.now()-closed.at<400)return;
    const result=chapterTwo.interact(action);
    if(result?.person){const entry=chapterTwoConversation(result.person,progress.chapterTwo);if(entry)begin(result.person,entry.lines,()=>heardChapterTwo(entry));}
    // Hands on the lock: a rune is touched and a bell struck standing,
    // a valve wheel and the beacon's kindling are down at knee height.
    else if(action.id!=='warden'){avatar.rotation.y=Math.atan2(action.x-position.x,action.z-position.z);perform(/^valve\d/.test(action.id)||action.id==='beacon'?'Kneel':'Interact');}
    sound();updateHUD();return;
  }
  // The press that closes a conversation is not also the one that opens it again.
  if(action.type==='story'){if(action.person!==closed.person||performance.now()-closed.at>400)talk(action.person);return;}
  if(action.type==='mount'){
    const mount=activities.mount;
    if(mount.mounted){
      const point=world.findWalkable(position.x+2,position.z,.6,position.y);const candidate=new THREE.Vector3(point.x,point.y,point.z);collide(candidate,.52);position.copy(candidate);mount.mounted=false;locomotion.reset();
    }else if(locomotion.grounded){mount.mounted=true;position.copy(mount.position);lockTarget=null;aiming=cinematic=false;locomotion.reset();reins.reset(mount.group.rotation.y);avatar.rotation.y=mount.group.rotation.y;}
    syncCameraControls();audio.play('interaction');return;
  }
  if(action.type==='climb'){if(locomotion.climbing)locomotion.stopClimb();else{locomotion.startClimb(action.ladder);cinematic=false;}return;}
  if(action.type==='push'){const dir={x:Math.sin(avatar.rotation.y),z:Math.cos(avatar.rotation.y)};propPhysics.push(position,dir,8,3);audio.play('landing',{position,volume:.3});perform('Push',1.4);}
}

/**
 * CONVERSATIONS
 *
 * A conversation holds the hero still, turns them and the camera toward
 * whoever is speaking, and pages through the lines one press at a time. The
 * world keeps running behind it, but nothing in it can reach the player: the
 * wisps wait, and the clock only ticks. A line types itself out; a press
 * mid-line finishes it, the next press moves on, and Escape skips to the end,
 * which still counts as having heard it all.
 */
let chat=null,finale=false,closed={person:null,at:0};
function talk(person){
  const entry=conversation(person,STEPS[storyStep(progress)].id,{camp:world.biomeAt(camp.x,camp.z)});if(!entry)return;
  begin(person,entry.lines,()=>heard(entry));
}
function begin(person,lines,onEnd){
  const place=person==='portalBook'?portal.places.book:chapterTwo.places[person]||story.places[person]||story.places.maren;
  const dx=place.x-position.x,dz=place.z-position.z;
  chat={person,lines,index:0,shown:0,onEnd,yaw:Math.atan2(-dx,-dz)+.6};
  avatar.rotation.y=Math.atan2(dx,dz);lockTarget=null;aiming=cinematic=false;resetInput();syncCameraControls();
  story.talking=person;document.body.classList.add('conversing');$('conversation').hidden=false;sound();showLine();
}
function showLine(){
  const [who,text]=chat.lines[chat.index],host=speakers[chat.person],reading=!host.title;
  const speaker=who==='you'?{name:heroMeta.name,title:'You',color:heroMeta.color}:who?speakers[who]:reading?host:null;
  // A notice, a ledger or an inscription is read from start to finish;
  // with a person, the hero talks with their hands on their own lines
  // and stands and listens to the rest.
  chat.pose=host.read?'Read':who==='you'?'Talk':undefined;
  $('conversation').classList.toggle('narration',!who);
  $('conversation').style.setProperty('--speaker',speaker?.color||'var(--gold)');
  $('conversation-name').textContent=speaker?.name||'';$('conversation-title').textContent=speaker?.title||'';
  chat.text=text;chat.shown=reducedMotion?text.length:0;$('conversation-text').textContent=reducedMotion?text:'';
  $('conversation-next-label').textContent=chat.index<chat.lines.length-1?'Continue':'Done';
}
function advance(){
  if(!chat)return;
  if(chat.shown<chat.text.length){chat.shown=chat.text.length;$('conversation-text').textContent=chat.text;return;}
  if(++chat.index<chat.lines.length){sound();showLine();return;}
  endConversation();
}
function endConversation(){
  if(!chat)return;
  const {onEnd,person}=chat;chat=null;closed={person,at:performance.now()};story.talking=null;
  $('conversation').hidden=true;document.body.classList.remove('conversing');
  // Back to the view the player had chosen, eased rather than cut.
  settling=.9;resetInput();onEnd?.();
}
// What having heard a conversation to the end changes.
function heard(entry){
  if(entry.finale){awaken();return;}
  if(entry.sets&&!progress.story[entry.sets]){
    progress.story[entry.sets]=true;save();
    if(entry.sets==='notice')toast('Something about that last name stays with you.');
    if(entry.sets==='farewell'){gainXP(100);victoryTime=8;audio.play('victory');}
    else if(entry.sets!=='notice')gainXP(40);
  }
  // What the words leave the hero feeling, once the panel has gone.
  if(entry.react)react(entry.react);
  updateHUD();
}
function heardChapterTwo(entry){
  if(!chapterTwoUnlocked()||!entry.sets||progress.chapterTwo[entry.sets])return;
  progress.chapterTwo[entry.sets]=true;
  gainXP(entry.sets==='complete'?300:50);save();
  if(entry.sets==='complete'){victoryTime=12;audio.play('victory');react('Cheer');showPulse(story.places.maren.x,story.places.maren.z,24,'#c6fff0');toast('The Drowned Meridian · Chapter complete · +300 experience');}
  updateHUD();
}
// The chapter's end: the light goes into the well, the Hart comes, and the
// keeper goes home. The save records it first, so closing the game partway
// through still keeps it.
async function awaken(){
  finale=true;progress.restored=true;gainXP(150);save();
  audio.play('victory');showPulse(story.places.maren.x,story.places.maren.z,22,'#b8f3e0');victoryTime=12;
  await story.awaken();
  begin('maren',conversation('maren','finale').lines,async()=>{
    // Waved off as she walks into the light.
    react('Wave',6);
    await story.depart();finale=false;
    toast('The Moonwell awakens · The Keeper is at rest · +150 experience');updateHUD();
  });
}
$('conversation').addEventListener('click',advance);
// Skipping still counts as hearing it all: the story never hangs on a line.
function skipConversation(){if(chat){chat.index=chat.lines.length-1;chat.shown=Infinity;endConversation();}}

// The next map downloads while the hero reads. Its prepared scene waits at
// the gate until the spoken spell and the step into the portal have finished.
async function prepareModel(object) {
  object.traverse(mesh=>{for(const material of [mesh.material].flat())for(const value of Object.values(material||{}))if(value?.isTexture)renderer.initTexture(value);});
  if(renderer.compileAsync)await renderer.compileAsync(object,camera,scene);
}
function portalStatus(text, covered=false) {
  $('portal-status').hidden=!text; $('portal-status').textContent=text;
  $('portal-veil').classList.toggle('visible',covered);
}
// Letterbox the screen and set the HUD aside while the crossing plays.
function portalCinema(on){document.body.classList.toggle('portal-cinematic',on);}
function readPortalBook() {
  const route=portalRoute(progress,world.activeMap || 'city');
  if(route.lockedReason){begin('portalBook',portalConversation(route).lines);return;}
  if(!locomotion.grounded || activities.mount.mounted)return;
  const reading=portal.places.reading;
  position.set(reading.x,groundHeight(reading.x,reading.z),reading.z);avatar.position.copy(position);locomotion.reset();
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const journey=portalJourney={route,phase:'reading',elapsed:0,readFinished:false,ready:false,waited:0,entered:0,weight:0,shot:{},pose:null,release};
  portal.setPhase('reading');
  begin('portalBook',portalConversation(route).lines,()=>{journey.readFinished=true;});
  $('interaction-hint').hidden=true;
  world.travelTo(route.destination,{prepare:async object=>{
    await prepareModel(object);journey.ready=true;await gate;
  }}).then(async arrival=>{
    await arriveThroughPortal(arrival);
    // The light clears over the far shore and the camera comes down to the hero.
    yaw=openYaw();followCamera.reset(position,yaw,pitch,radius);
    journey.phase='landing';journey.elapsed=0;portalStatus('');
    showPulse(position.x,position.z,5,'#9deee6');audio.play('interaction',{volume:.6,rate:.8});
    save();updateHUD();toast(`${route.mapName} · The keeper’s spell carries you safely through.`);
  }).catch(error=>{
    console.warn('The portal passage could not open.',error);
    if(chat?.person==='portalBook'){chat.onEnd=null;endConversation();}
    journey.release();portalJourney=null;portal.setPhase('dormant');portalStatus('');portalCinema(false);resetInput();
    position.y=groundHeight(position.x,position.z);avatar.position.copy(position);locomotion.reset();
    followCamera.reset(position,yaw,pitch,radius);
    toast('The passage faded. Your journey is safe. Read the book again to retry.');
  });
}
const turnTo=(from,to,rate,dt)=>from+Math.atan2(Math.sin(to-from),Math.cos(to-from))*(1-Math.exp(-rate*dt));
// The far shore may put a wall or a cart where the old view looked from.
// Keep the player's heading if its view is clear, else the nearest one that is.
function openYaw(){
  const view=currentView(),lift=Math.max(.08,pitch),anchor=new THREE.Vector3(position.x,position.y+(view.height||1.9),position.z),to=new THREE.Vector3();
  let best=yaw,clearest=-1;
  for(let i=0;i<16;i++){
    const angle=yaw+Math.ceil(i/2)*(i%2?1:-1)*Math.PI/8;
    to.set(anchor.x+Math.sin(angle)*Math.cos(lift)*radius,anchor.y+Math.sin(lift)*radius,anchor.z+Math.cos(angle)*Math.cos(lift)*radius);
    const fraction=followCamera.safeFraction(anchor,to);
    if(fraction>clearest+.05){best=angle;clearest=fraction;}
    if(fraction>=.99)break;
  }
  return best;
}
/**
 * THE CROSSING
 *
 * reading → casting → ready → entering → traveling → arriving → landing.
 * The hero reads the book, then casts: the gate's stones break out of the
 * ground and its aperture opens while the camera takes over. Once the far
 * shore has loaded, and the turning arch has left the way clear, the hero
 * walks round to the foot of the dais and the gate draws them in. The light
 * covers the swap of maps, and clears over the hero on the other side.
 */
function updatePortalJourney(dt) {
  const j=portalJourney;if(!j)return;
  j.elapsed+=dt;
  if(j.phase==='reading') {
    if(!chat)hero.animate(dt,{state:'Read',fidget:false,time});
    if(j.readFinished && j.elapsed>=1.8){
      j.phase='casting';j.elapsed=0;filmed.reach=1;filmed.boom=0;portalStatus('Speaking the keeper’s spell…');portalCinema(true);
      const gate=portal.places.portal,foot=portal.places.foot;
      j.rig={gate,aperture:portal.places.aperture,axis:foot.sub(gate).setY(0).normalize(),hero:position};
    }
  } else if(j.phase==='casting') {
    const p=j.rig.gate;avatar.rotation.y=turnTo(avatar.rotation.y,Math.atan2(p.x-position.x,p.z-position.z),8,dt);
    hero.animate(dt,{state:'Cast',fidget:false,time});portal.setPhase('casting',Math.min(1,j.elapsed/PORTAL_TIMING.cast));
    if(j.elapsed>=PORTAL_TIMING.cast){
      j.phase='ready';j.elapsed=0;portal.setPhase('ready');showPulse(p.x,p.z,8,'#9deee6');
      audio.play('interaction',{volume:.75,rate:.7});j.shake=Math.max(j.shake||0,.6);
    }
  } else if(j.phase==='ready') {
    hero.animate(dt,{state:'Read',fidget:false,time});
    if(j.ready)j.waited+=dt;
    portalStatus(j.ready?'The passage is open.':'The spell holds. The far shore is taking shape…');
    // The arch keeps turning; set off only when its footing stones will be
    // clear of the way in, or after a long wait whatever they are doing.
    if(j.ready&&j.elapsed>=.8&&(portal.entryClear()||j.waited>12)){
      j.phase='entering';j.elapsed=0;j.entered=0;j.from={...j.shot};portalStatus('Stepping between the tides…');
    }
  } else if(j.phase==='entering'||j.phase==='traveling'||j.phase==='arriving') {
    j.entered+=dt;
    const step=portal.entryPose(j.entered),turn=avatar.rotation.y;
    position.copy(step.position);avatar.position.copy(position);
    avatar.rotation.y=turnTo(turn,step.yaw,step.stage==='walk'?7:4,dt);
    hero.animate(dt,{speed:step.speed,moving:step.speed>.05,turnRate:dt>0?(avatar.rotation.y-turn)/dt:0,fidget:false,time});
    if(j.phase==='entering'&&step.veil){
      j.phase='traveling';j.elapsed=0;portal.setPhase('traveling');portalStatus(`Crossing to ${j.route.mapName}…`,true);
      audio.play('interaction',{volume:.6,rate:1.25});
    } else if(j.phase==='traveling'&&j.elapsed>=.45){j.phase='arriving';j.release();}
  } else if(j.phase==='landing') {
    hero.animate(dt,{speed:0,fidget:false,time});
    if(j.elapsed>=PORTAL_TIMING.land){portalJourney=null;portalCinema(false);resetInput();settling=0;return;}
  }
  directPortalShot(j,dt);
}
// Where the cinematic camera wants to be this frame. The arrival is shot
// round the hero; everything before it round the gate.
function directPortalShot(j,dt) {
  // With reduced motion the camera cuts between still shots and hands back at once.
  j.weight=reducedMotion?(j.phase==='reading'||j.phase==='landing'?0:1):cinematicWeight(j.phase,j.elapsed);
  if(j.weight<=0||j.phase==='arriving')return;
  if(j.phase==='landing'){
    const view=currentView();
    j.pose=landingPose(j.elapsed,{hero:position,yaw,pitch,distance:radius,height:view.height||1.9,fov:view.fov},j.pose||undefined);
    return;
  }
  const phase=j.phase==='traveling'?'entering':j.phase;
  const t=reducedMotion?{casting:PORTAL_TIMING.cast,ready:0,entering:PORTAL_ENTRY.walk}[phase]:phase==='entering'?j.entered:j.elapsed;
  portalShot(phase,t,{entry:PORTAL_ENTRY,from:j.from},j.shot);
  j.pose=shotPose(j.shot,j.rig,j.pose||undefined);
  j.shake=Math.max(0,(j.shake||0)*Math.exp(-4*dt));
}
async function arriveThroughPortal(arrival) {
  // City actors are separate from the map. Keep the reusable horse and small
  // activity props, and release the chapter's imported scenery and people.
  if(!inCity()) {
    story.dispose();
    for(const [id,entry] of collision.entries)if(!String(id).startsWith('city-'))cityExtraColliders.set(id,entry);
  }
  collision.clear();
  world.colliders.forEach((shape,index)=>collision.insert(`city-${index}`,shape));
  if(inCity()) {
    for(const [id,shape] of cityExtraColliders)collision.insert(id,shape);
    cityExtraColliders.clear();
    for(let i=activities.stations.length-1;i>=0;i--)if(activities.stations[i].id.startsWith('story-'))activities.stations.splice(i,1);
    story=createStory({world,activities,collision});scene.add(story.root);story.setState({restored:progress.restored});
    chapterTwo.places.chart=story.places.tobin;chapterTwo.places.seal=story.places.maren;
    story.stream({prepare:prepareModel}).catch(error=>console.warn('The story models did not load.',error));
  }
  chapterTwo.syncMap();placePortal();
  spawn.set(arrival.x,arrival.y,arrival.z);position.copy(spawn);avatar.position.copy(position);stage.position.copy(spawn);
  activities.mount.mounted=false;locomotion.waterZones=inCity()?activities.waterZones:[];locomotion.climbables=inCity()?activities.climbables:[];
  locomotion.reset();lockTarget=null;aiming=cinematic=false;attackTimer=abilityTimer=hurtTimer=combatMemory=0;
  for(const enemy of enemies)enemy.group.visible=inCity()&&enemy.alive;
  shardMesh.visible=inCity();activities.root.visible=inCity();mapLayer=null;
  world.setTime(preferences.time);world.setQuality(quality);renderer.renderLists.dispose();
  followCamera.reset(position,yaw,currentView().pitch,currentView().radius);
}

const keys=new Set();let joyX=0,joyY=0,joyId=null,sprinting=false,dragId=null,dragX=0,dragY=0,dragDistance=0;
let yaw=0,pitch=.48,radius=14;
const cameraTarget=new THREE.Vector3(),cameraDesired=new THREE.Vector3();
const dialog=$('menu-dialog');
/**
 * CAMERA VIEW
 *
 * `settling` is how much of the move into a new perspective is still
 * to run. While it lasts the camera eases toward the preset; the
 * moment the player drags or zooms it drops to zero, because a hand
 * on the camera outranks a posture it was on its way to.
 */
let viewIndex=Math.max(0,VIEWS.findIndex(view=>view.id===preferences.view)),settling=0;
const currentView=()=>VIEWS[viewIndex];
function showView(){
  const view=currentView();
  $('view-label').textContent=view.name;
  $('view-button').setAttribute('aria-label',`Camera view: ${view.name}. Press to change.`);
}
function cycleView(step=1){
  if(screen!=='game'||dialog.open)return;
  viewIndex=(viewIndex+step+VIEWS.length)%VIEWS.length;
  preferences.view=currentView().id;
  // Long enough to read as a move rather than a cut, short enough
  // that a player pressing twice is not fighting the first press.
  settling=.9;
  showView();save();toast(`Camera · ${currentView().name}`);sound();
}
showView();
function syncCameraControls(){
  $('aim-button').setAttribute('aria-pressed',String(aiming));$('lock-button').setAttribute('aria-pressed',String(!!lockTarget));$('cinematic-button').setAttribute('aria-pressed',String(cinematic));
  $('aim-reticle').hidden=!aiming;$('camera-mode').textContent=activities.mount.mounted?'MOUNTED':cinematic?'CINEMATIC':aiming?'AIM':lockTarget?'TARGET LOCKED':'';
}
// The flashlight comes out at dusk and goes away at dawn by itself; this is
// the player's say over whether it comes out at all.
function syncFlashlight(){$('flashlight-button').setAttribute('aria-pressed',String(preferences.flashlight));}
function toggleFlashlight(){
  if(screen!=='game'||dialog.open)return;
  preferences.flashlight=flashlight.toggle();syncFlashlight();save();sound();
  toast(flashlight.dark?`Flashlight ${preferences.flashlight?'on':'off'}`:preferences.flashlight?'Flashlight ready · it comes out at dusk':'Flashlight packed away for tonight');
}
syncFlashlight();
function toggleAim(){if(screen!=='game'||dialog.open||chat)return;aiming=!aiming;cinematic=false;if(aiming)lockTarget=null;syncCameraControls();}
function toggleCinematic(){if(screen!=='game'||dialog.open||chat)return;cinematic=!cinematic;aiming=false;lockTarget=null;syncCameraControls();}
function toggleLock(){
  if(screen!=='game'||dialog.open||chat)return;
  if(lockTarget){yaw=followCamera.yaw;lockTarget=null;}
  else{
    lockTarget=[...enemies,...chapterTwo.combatants].filter(e=>e.alive&&position.distanceTo(e.group.position)<35&&collision.cameraFraction(new THREE.Vector3(position.x,position.y+1.8,position.z),new THREE.Vector3(e.group.position.x,e.group.position.y+1.8,e.group.position.z),.1)>.98).sort((a,b)=>position.distanceToSquared(a.group.position)-position.distanceToSquared(b.group.position))[0]||null;
    if(!lockTarget)toast('No visible target within range.');
  }
  aiming=cinematic=false;syncCameraControls();
}
function resetInput(){keys.clear();joyX=joyY=0;joyId=null;sprinting=false;dragId=null;emoting=null;aiming=false;closeEmotes();syncCameraControls();velocity.set(0,0,0);$('joystick-knob').style.transform='';}
addEventListener('keydown',e=>{
  // While the controls are being arranged the hero stays put: no key
  // reaches the game, and Escape finishes the same as Done.
  if(editingLayout){if(e.code==='Escape')editLayout(false);return;}
  if(dialog.open){if(e.code==='Escape'){e.preventDefault();closeDialog();}return;}
  if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
  if(screen!=='game')return;
  if(portalJourney&&!chat){e.preventDefault();return;}
  // A conversation takes the keys it pages with; everything else waits.
  if(chat){if(['KeyF','Space','Enter','NumpadEnter'].includes(e.code)){e.preventDefault();if(!e.repeat)advance();}else if(e.code==='Escape'){e.preventDefault();skipConversation();}return;}
  // An open emote picker is the first thing Escape closes.
  if(e.code==='Escape'&&!$('emote-panel').hidden){e.preventDefault();closeEmotes();return;}
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  keys.add(e.code);if(e.repeat)return;
  // The Escape that opens the pause menu is spent: left alone, the browser
  // would take it as a request to close the modal it just opened.
  if(e.code==='Escape')e.preventDefault();
  if(e.code==='Space')jump();if(e.code==='KeyQ')attack();if(e.code==='KeyE')attack(true);if(e.code==='KeyF')interact();if(e.code==='KeyV')cycleView();if(e.code==='Escape'||e.code==='KeyP')openMenu('pause');if(e.code==='KeyJ')openMenu('journal');
  if(e.code==='KeyL')toggleLock();if(e.code==='KeyR')toggleAim();if(e.code==='KeyC')toggleCinematic();if(e.code==='KeyT')toggleFlashlight();
  if(EMOTE_KEYS[e.code])perform(EMOTE_KEYS[e.code]);if(e.code==='KeyG')toggleEmotes();
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>{resetInput();if(screen==='game'&&!dialog.open)openMenu('pause');save();});
addEventListener('pagehide',()=>{save();audio.setPaused(true);});
document.addEventListener('visibilitychange',()=>{resetInput();if(document.hidden){audio.setPaused(true);save();renderer.setAnimationLoop(null);if(screen==='game'&&!dialog.open)openMenu('pause');}else{lastFrame=performance.now();if(!contextLost)renderer.setAnimationLoop(animate);}});
function jump(){if(screen==='game'&&!dialog.open&&!chat){locomotion.requestJump();cinematic=false;}}
// Emotes are the one animation the player drives directly, so they
// are held for exactly as long as the clip runs and dropped the
// moment the character has somewhere else to be. `hero.emotes` only
// lists gestures this character actually shipped with, so a key
// pressed by someone playing a starter hero does nothing at all.
// In key order: 1 to 9, then 0.
const EMOTES=[['Dance','Dance'],['Nod','Nod'],['Shake','Shake head'],['Sad','Sad'],['Wave','Wave'],['Cheer','Cheer'],['Point','Point'],['Stomp','Stomp'],['Salute','Salute'],['Sing','Sing']];
const EMOTE_KEYS=Object.fromEntries(EMOTES.map(([state],i)=>[`Digit${(i+1)%10}`,state]));
// Emotes and the gestures the world asks for — a rune pressed, a crate
// pushed — play the same way. `limit` cuts a looping one short.
function perform(state,limit=Infinity){
  if(screen!=='game'||dialog.open||chat||!hero||activities.mount.mounted||locomotion.climbing||locomotion.swimming)return false;
  const duration=Math.min(limit,hero.cue(state));if(!duration)return false;
  emoting=state;emoteUntil=time+duration;closeEmotes();return true;
}
// A gesture the moment calls for, made as soon as the hero is free to:
// a cheer waits for the killing blow to finish, and for the player to
// stop running. Offered for a few seconds, then let go.
let pendingEmote=null;
function react(state,within=4){if(hero?.emotes?.[state])pendingEmote={state,until:time+within};}
// The emote picker, for a hand with no number keys to press.
function syncEmotes(){
  const available=EMOTES.map(([state,label],i)=>({state,label,key:(i+1)%10})).filter(({state})=>hero?.emotes?.[state]);
  $('emote-button').hidden=!available.length;
  $('emote-panel').innerHTML=available.map(({state,label,key})=>`<button role="menuitem" data-emote="${state}"><kbd>${key}</kbd>${label}</button>`).join('');
  if(!available.length)closeEmotes();
}
function toggleEmotes(open=$('emote-panel').hidden){
  if(open&&(screen!=='game'||dialog.open||chat||$('emote-button').hidden))return;
  $('emote-panel').hidden=!open;$('emote-button').setAttribute('aria-expanded',String(open));
}
function closeEmotes(){toggleEmotes(false);}
renderer.domElement.addEventListener('pointerdown',e=>{if(dialog.open||dragId!==null)return;dragId=e.pointerId;dragX=e.clientX;dragY=e.clientY;dragDistance=0;renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(e.pointerId!==dragId)return;const dx=e.clientX-dragX,dy=e.clientY-dragY;dragDistance+=Math.abs(dx)+Math.abs(dy);dragX=e.clientX;dragY=e.clientY;if(screen==='lobby')previewYaw+=dx*.009;else{yaw-=dx*.005;pitch=clamp(pitch+dy*.004,-1.2,1.08);settling=0;}});
renderer.domElement.addEventListener('pointerup',e=>{if(e.pointerId!==dragId)return;if(dragDistance<7&&e.pointerType==='mouse'&&e.button===0)attack();dragId=null;});
renderer.domElement.addEventListener('pointercancel',()=>dragId=null);renderer.domElement.addEventListener('lostpointercapture',()=>dragId=null);
renderer.domElement.addEventListener('wheel',e=>{if(screen==='game'){radius=clamp(radius+e.deltaY*.014,4,25);settling=0;e.preventDefault();}},{passive:false});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
// Playing is a two-fingered thing: a thumb holding the stick and another
// tapping the buttons. Safari reads that second finger arriving and leaving
// as a pinch and zooms the page — and iOS does not honour `touch-action` for
// the viewport's own zoom, so no amount of CSS on the controls prevents it.
// A zoomed page is unplayable here: the HUD is fixed to a screen that cannot
// scroll, so half the controls end up out of reach mid-fight. The menus and
// the lobby keep their zoom, where the print is small and worth magnifying.
const playing=()=>screen==='game'&&!dialog.open;
for(const event of ['gesturestart','gesturechange','gestureend'])
  addEventListener(event,e=>{if(playing())e.preventDefault();},{passive:false});
// Safari's gesture events are its own; this is the same refusal for anything
// that follows the standard, and it leaves one-fingered scrolling alone.
addEventListener('touchmove',e=>{if(e.touches.length>1&&playing()&&e.cancelable)e.preventDefault();},{passive:false});
addEventListener('dblclick',e=>{if(playing())e.preventDefault();},{passive:false});
const joystick=$('joystick');let joyCenterX=0,joyCenterY=0;
function moveJoy(e){const max=joystick.clientWidth*.34,dx=e.clientX-joyCenterX,dy=e.clientY-joyCenterY,length=Math.hypot(dx,dy),scale=length>max?max/length:1;joyX=dx*scale/max;joyY=dy*scale/max;if(length<5)joyX=joyY=0;$('joystick-knob').style.transform=`translate(${dx*scale}px,${dy*scale}px)`;}
joystick.addEventListener('pointerdown',e=>{if(joyId!==null||dialog.open)return;joyId=e.pointerId;const b=joystick.getBoundingClientRect();joyCenterX=b.left+b.width/2;joyCenterY=b.top+b.height/2;joystick.setPointerCapture(e.pointerId);moveJoy(e);e.preventDefault();});
joystick.addEventListener('pointermove',e=>{if(e.pointerId===joyId)moveJoy(e);});
function endJoy(e){if(e.pointerId===joyId){joyId=null;joyX=joyY=0;$('joystick-knob').style.transform='';}}
for(const event of ['pointerup','pointercancel','lostpointercapture'])joystick.addEventListener(event,endJoy);
const sprint=$('sprint-button');sprint.addEventListener('pointerdown',e=>{sprinting=true;sprint.setPointerCapture(e.pointerId);e.preventDefault();});for(const event of ['pointerup','pointercancel','lostpointercapture'])sprint.addEventListener(event,()=>sprinting=false);
// A press that begins while another finger is already down never
// becomes a click: the browser only promotes a single-pointer
// gesture to a tap. A thumb on the joystick is exactly that, so
// every action button was dead for as long as the player was
// moving — the one moment they are all worth having. The press
// itself is what the buttons act on now, and `click` stays for
// mouse and keyboard, guarded so a tap that does produce one does
// not fire the action twice.
function actionButton(id,run){
  const button=$(id);let touched=0;
  button.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse')return;
    // The press has been spent here, so the browser is left no default
    // action to grow a gesture out of when the same finger comes back a
    // moment later. The zoom this guards against is refused outright
    // below; this only keeps a tap from feeding it in the first place.
    if(e.cancelable)e.preventDefault();
    touched=performance.now();run();
  });
  // A click may still follow a single-finger tap, and that one has
  // already been acted on. `detail` is 0 only for a keyboard
  // activation, which has no press of its own behind it. The press is
  // remembered by when it happened rather than by a flag: preventing
  // the default above suppresses the click on some browsers and not
  // others, and a flag left standing would swallow the next real one.
  button.addEventListener('click',e=>{if(e.detail&&performance.now()-touched<700)return;run();});
}
actionButton('view-button',()=>cycleView());actionButton('attack-button',()=>attack());actionButton('ability-button',()=>attack(true));actionButton('jump-button',jump);actionButton('interact-button',interact);
actionButton('lock-button',toggleLock);actionButton('aim-button',toggleAim);actionButton('cinematic-button',toggleCinematic);actionButton('flashlight-button',toggleFlashlight);
actionButton('emote-button',()=>toggleEmotes());
// The picker's buttons come and go with the hero, so they are answered
// here, the same way `actionButton` answers the fixed ones.
{
  const panel=$('emote-panel');let touched=0;
  panel.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-emote]');if(!b||e.pointerType==='mouse')return;if(e.cancelable)e.preventDefault();touched=performance.now();perform(b.dataset.emote);});
  panel.addEventListener('click',e=>{const b=e.target.closest('[data-emote]');if(!b||(e.detail&&performance.now()-touched<700))return;perform(b.dataset.emote);});
  // A press anywhere else puts it away.
  addEventListener('pointerdown',e=>{if(!panel.hidden&&!e.target.closest('#emote-panel,#emote-button'))closeEmotes();},true);
}

/**
 * CONTROL LAYOUT
 *
 * Thumbs are not all the same length and phones are not all the same
 * size, so where a control sits is the player's call. A moved control
 * leaves the stylesheet's flow and is pinned by its centre instead —
 * once one moves, every control is pinned at the spot it already
 * occupied, so the ability bar does not re-centre itself around the
 * gap and shuffle the buttons nobody touched.
 */
const controlEl = control => $(control === 'joystick' ? 'joystick' : `${control}-button`);
/**
 * A moved control is positioned against the screen, which is why no
 * ancestor of one may carry a `transform`: a transform would become
 * the containing block for anything fixed inside it and the fractions
 * below would quietly come to mean a share of that box instead. The
 * ability bar is centred without one for exactly this reason.
 */
function placeControl(control, spot) {
  const element = controlEl(control);
  if (!element) return;
  // Centred with the standalone `translate` property rather than a
  // `transform`: buttons animate their transform on press, so a
  // centring transform would set every move sliding and would measure
  // a control still easing into place as somewhere it is not. It also
  // needs no size from JavaScript, which matters because the layout is
  // applied while the HUD is still hidden and measures zero.
  Object.assign(element.style, spot
    ? { position: 'fixed', left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, right: 'auto', bottom: 'auto', translate: '-50% -50%', margin: '0' }
    : { position: '', left: '', top: '', right: '', bottom: '', translate: '', margin: '' });
}
const applyLayout = () => { for (const control of CONTROLS) placeControl(control, preferences.layout[control]); };
// A control is held far enough inside the edge to stay tappable, and
// clamping runs again on resize so a rotation cannot strand one of
// them off the side of a narrower screen.
function clampSpot(element, x, y) {
  const margin = 6;
  const halfX = Math.min(element.offsetWidth / 2 + margin, innerWidth / 2), halfY = Math.min(element.offsetHeight / 2 + margin, innerHeight / 2);
  return { x: clamp(x, halfX / innerWidth, 1 - halfX / innerWidth), y: clamp(y, halfY / innerHeight, 1 - halfY / innerHeight) };
}
function pinCurrentLayout() {
  for (const control of CONTROLS) {
    const element = controlEl(control);
    // A control the stylesheet is hiding on this device has no place
    // of its own to remember.
    if (preferences.layout[control] || !element || !element.offsetParent) continue;
    const box = element.getBoundingClientRect();
    preferences.layout[control] = clampSpot(element, (box.left + box.width / 2) / innerWidth, (box.top + box.height / 2) / innerHeight);
  }
  applyLayout();
}
let editingLayout = false, dragging = null, borrowedHud = false;
function editLayout(on) {
  editingLayout = on; dragging = null;
  // The controls can be arranged from the lobby as well as mid-game —
  // on a tablet the lobby's own settings button is the obvious way in
  // — so the HUD is borrowed for as long as it takes and put back
  // afterwards. Nothing in it can be pressed meanwhile; see below.
  if (on && $('game-hud').hidden) { borrowedHud = true; $('game-hud').hidden = false; }
  document.body.classList.toggle('arranging', on);
  $('layout-editor').hidden = !on;
  if (on) resetInput();
  else {
    if (borrowedHud) { $('game-hud').hidden = true; borrowedHud = false; }
    save(); toast('Controls saved where you left them.');
  }
}
// Capture phase, so a control being moved never also fires: the
// press is spent on the drag before the button or the stick sees it.
$('game-hud').addEventListener('pointerdown', e => {
  if (!editingLayout) return;
  const element = e.target.closest('[data-control]');
  if (!element) return;
  e.preventDefault(); e.stopPropagation();
  // Pinning happens on the first drag rather than on entering the
  // editor, so a player who opens it and changes their mind — or
  // presses Reset — is left with no stored layout at all.
  pinCurrentLayout();
  // Where the finger landed within the control, measured against the
  // spot just pinned rather than the element: a control keeps its
  // grip point instead of jumping its centre under the finger.
  const spot = preferences.layout[element.dataset.control];
  dragging = { element, pointerId: e.pointerId, control: element.dataset.control, offsetX: e.clientX - spot.x * innerWidth, offsetY: e.clientY - spot.y * innerHeight };
  element.setPointerCapture(e.pointerId);
  element.classList.add('dragging');
  $('layout-message').textContent = `Moving the ${element.dataset.controlName.toLowerCase()}.`;
}, true);
// A mouse drag still ends in a click, and a click on a control is an
// attack, a jump or a pulse. While the editor is open the whole HUD
// is furniture — its controls get moved rather than used, and the
// pause and journal buttons behind the dimming stay out of reach —
// so only the editor's own bar answers a press.
$('game-hud').addEventListener('click', e => {
  if (!editingLayout) return;
  e.preventDefault(); e.stopPropagation();
}, true);
addEventListener('pointermove', e => {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  const spot = clampSpot(dragging.element, (e.clientX - dragging.offsetX) / innerWidth, (e.clientY - dragging.offsetY) / innerHeight);
  preferences.layout[dragging.control] = spot;
  placeControl(dragging.control, spot);
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) addEventListener(event, e => {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  dragging.element.classList.remove('dragging');
  dragging = null;
  $('layout-message').textContent = 'Drag any control where you want it.';
});
$('layout-done').addEventListener('click', () => editLayout(false));
$('layout-reset').addEventListener('click', () => { preferences.layout = {}; applyLayout(); $('layout-message').textContent = 'Back where they started. Drag any control to move it.'; });
addEventListener('resize', () => {
  for (const [control, spot] of Object.entries(preferences.layout)) {
    const element = controlEl(control);
    if (element) preferences.layout[control] = clampSpot(element, spot.x, spot.y);
  }
  applyLayout();
});
applyLayout();

function enterGame(){if(!hero||switching)return;if(editingLayout)editLayout(false);enableAudio();screen='game';audio.setPaused(false);followCamera.reset(position,yaw,currentView().pitch,currentView().radius);sessionStarted=true;document.body.dataset.screen=screen;$('topbar').hidden=true;$('lobby').hidden=true;$('game-hud').hidden=false;stage.visible=false;portraitLight.intensity=0;resetInput();avatar.position.copy(position);cameraTarget.copy(position).y+=2;pitch=currentView().pitch;radius=currentView().radius;camera.fov=currentView().fov;camera.updateProjectionMatrix();settling=0;updateCamera(1);updateHUD();const step=currentStep();toast(step.id==='keeper'?'Someone is waiting at the Moonwell · Follow the gold marker':step.id==='complete'?'The Moonwell shines over the Reach':`${step.title} · ${step.description}`);}
function enterLobby(){if(portalJourney)return;if(editingLayout)editLayout(false);closeDialog();screen='lobby';audio.setPaused(true);lockTarget=null;cinematic=false;document.body.dataset.screen=screen;$('topbar').hidden=false;$('lobby').hidden=false;$('game-hud').hidden=true;stage.visible=true;portraitLight.intensity=1.6;avatar.position.copy(spawn).y+=.22;resetInput();save();updateHeroUI();$('play-button').firstElementChild.textContent=sessionStarted?'Continue journey':'Enter the city';}
$('play-button').addEventListener('click',enterGame);$('lobby-button').addEventListener('click',enterLobby);$('nav-heroes').addEventListener('click',()=>{closeDialog();});
function closeDialog(){dialog.close();resetInput();audio.setPaused(screen!=='game');lastFrame=performance.now();save();}
$('close-dialog').addEventListener('click',closeDialog);dialog.addEventListener('cancel',()=>{resetInput();save();});dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeDialog();}});
function openMenu(type){
  if(portalJourney)return;
  resetInput();const content=$('dialog-content');$('dialog-eyebrow').textContent=type==='settings'?'MAKE IT YOURS':type==='journal'?`${currentChapter().eyebrow} · ${currentChapter().title.toUpperCase()}`:'TAKE A BREATH';$('dialog-title').textContent=type==='settings'?'World & settings':type==='journal'?'Your journal':'A moment of quiet';
  if(type==='settings'){
    content.innerHTML=`<label class="setting-row"><span>Graphics<small>Auto adapts resolution and shadows to keep the world responsive.</small></span><select id="quality-select"><option value="auto">Auto</option><option value="low">Performance</option><option value="balanced">Balanced</option><option value="high">High</option></select></label><label class="setting-row"><span>Time of day <output id="time-value">${formatTime(preferences.time)}</output><small>Sunrise at 06:00, sunset at 18:00. A full day takes 20 minutes of play; menus pause time.</small></span><input id="time-setting" type="range" min="0" max="24" step=".25" aria-label="Time of day"></label><label class="setting-row"><span>Enable audio<small id="audio-status"></small></span><input id="sound-setting" type="checkbox"></label>${["master","effects","ambience","music"].map(channel=>`<label class="setting-row"><span>${channel[0].toUpperCase()+channel.slice(1)} volume</span><input id="volume-${channel}" type="range" min="0" max="1" step=".05" value="${preferences.volumes[channel]}" aria-label="${channel[0].toUpperCase()+channel.slice(1)} volume"></label>`).join('')}<label class="setting-row"><span>Show frame rate</span><input id="fps-setting" type="checkbox"></label><label class="setting-row"><span>Lantern Plaza<small>A lamplit market street and its cathedral, built block by block, across the water from the east quay. A 24 MB download, fetched only while this is on. The world reloads to add or remove it.</small></span><input id="plaza-setting" type="checkbox"></label><label class="setting-row"><span>Nightwood Road<small>A moonlit forest road across the water from the north quay. A 15 MB download, fetched only while this is on. The world reloads to add or remove it.</small></span><input id="nightwood-setting" type="checkbox"></label><label class="setting-row"><span>Red Mesa<small>A wind-carved butte on a plain of red sand, across the water from the south quay. A 13 MB download, fetched only while this is on. The world reloads to add or remove it.</small></span><input id="mesa-setting" type="checkbox"></label><div class="setting-row"><span>Control layout<small>Put the joystick and the buttons where your thumbs actually land. Drag them anywhere, then press Done.</small></span><button id="layout-edit" class="layout-edit">Rearrange</button></div><p class="credits-note"><a href="./assets/audio/CREDITS.md" target="_blank" rel="noopener">Sound recording and music credits</a>. <a href="./assets/story/CREDITS.md" target="_blank" rel="noopener">Story characters and props</a>: sixteen Sketchfab models, each credited to its author under CC BY 4.0. City environment: City Set — Proto Series. Skibidi Yard: <a href="https://sketchfab.com/3d-models/skibidi-toilet-79-map-2a29c94edd4744f3ab4666da880185c3" target="_blank" rel="noopener">“Skibidi toilet 79 map”</a> by <a href="https://sketchfab.com/Mystv" target="_blank" rel="noopener">MysteriousTV</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, cut down to a pier. Nightwood Road: <a href="https://sketchfab.com/3d-models/a-forest-3-with-a-road-at-night-for-game-61f8c7817fe6457fb26e4814cfc48a3f" target="_blank" rel="noopener">“a forest (3) with a road at night for game”</a> by <a href="https://sketchfab.com/dasy444" target="_blank" rel="noopener">dasy444</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Red Mesa: <a href="https://sketchfab.com/3d-models/worldmachine-terrain-550d7edf4bcb4e79acd4a1bd13c4b5ba" target="_blank" rel="noopener">“Worldmachine Terrain”</a> by <a href="https://sketchfab.com/han" target="_blank" rel="noopener">Hannes Delbeke</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Flashlight: <a href="https://sketchfab.com/3d-models/flashlight-5fa9a65e7b0141ee877ed18f4f42d953" target="_blank" rel="noopener">“Flashlight”</a> by <a href="https://sketchfab.com/mar.cos." target="_blank" rel="noopener">MAR.COS.</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, with smaller textures. Starter heroes made for Astra. Rei and Arthur are your existing imported models and load only when selected.</p>`;
    $('quality-select').value=preferences.quality;$('quality-select').onchange=e=>{preferences.quality=e.target.value;resolutionScale=1;applyQuality(preferences.quality==='auto'?(touch?'balanced':'high'):preferences.quality);lastAdapt=time;save();};
    $('time-setting').value=preferences.time;$('time-setting').oninput=e=>{setTime(Number(e.target.value));dirtySave=true;};$('sound-setting').checked=preferences.sound;$('audio-status').textContent=audioStatus();$('sound-setting').onchange=e=>{preferences.sound=e.target.checked;audio.setEnabled(preferences.sound);if(preferences.sound)enableAudio();save();};$('fps-setting').checked=preferences.showFPS;$('fps-setting').onchange=e=>{preferences.showFPS=e.target.checked;$('performance-readout').hidden=!preferences.showFPS;save();};
    // The world is built once, with or without the plaza, the Nightwood and the mesa: it takes a fresh one.
    for(const district of ['plaza','nightwood','mesa']){$(district+'-setting').checked=preferences[district];$(district+'-setting').onchange=e=>{preferences[district]=e.target.checked;save();location.reload();};}
    for(const channel of ['master','effects','ambience','music'])$('volume-'+channel).oninput=e=>{preferences.volumes[channel]=Number(e.target.value);audio.setVolumes(preferences.volumes);save();};
    $('layout-edit').onclick=()=>{closeDialog();editLayout(true);};
  }else if(type==='journal'){
    const second=chapterTwoUnlocked(),steps=second?CHAPTER_TWO_STEPS:STEPS,index=second?steps.indexOf(currentStep()):storyStep(progress);
    const entries=(list,at)=>list.slice(0,at+1).map((step,i)=>{
      const done=i<at,detail=done?step.recap:step.description;
      return '<div class="journal-entry"><span>'+ (done?'✓':'◇') +'</span><div><h3>'+step.title+'</h3><p>'+detail+'</p>'+(!done&&step.goal?'<div class="journal-reward">'+Math.min(step.goal,step.count(progress))+' / '+step.goal+'</div>':!done&&step.where?'<div class="journal-reward">◇ '+step.where+'</div>':'')+'</div></div>';
    }).join('');
    content.innerHTML='<p class="dialog-copy">'+(second?CHAPTER_TWO.intro:INTRO)+'</p>'+
      (second?'<div class="chapter-route">CITY → PINE ISLET → SKIBIDI YARD → MOONWELL</div>':'')+
      entries(steps,index)+(second&&chapterTwo.status?'<p class="dialog-copy">'+chapterTwo.status+'</p>':'')+
      (second?'<details class="previous-chapter"><summary>✓ Chapter One · The Last Keeper</summary>'+entries(STEPS.slice(0,-1),STEPS.length)+'</details>':'<p class="dialog-copy">More of the story waits ahead.</p>')+
      '<p class="dialog-copy">Rest near the golden camp marker to recover health. Follow the gold diamond on the map to your next objective. Read each lock’s inscription for its sequence. Completed missions are saved; failed challenges can be retried.</p>';
  }else{
    content.innerHTML='<p class="dialog-copy">The city will wait. Your progress is saved on this device.</p><div class="menu-buttons"><button id="resume-button" class="primary-button">Return to adventure</button><button id="menu-lobby">Choose another adventurer</button><button id="menu-settings">World & settings</button></div><div class="control-list"><kbd>WASD / ARROWS</kbd><span>Move · Shift to sprint</span><kbd>SPACE</kbd><span>Jump</span><kbd>Q / CLICK</kbd><span>Attack the nearest wisp</span><kbd>E</kbd><span>Signature ability · 7 second recharge</span><kbd>F</kbd><span>Interact · talk, read, climb, push, ride / dismount</span><kbd>L / R / C</kbd><span>Target lock / aim / cinematic camera</span><kbd>V</kbd><span>Camera view · follow, shoulder, wide, overhead</span><kbd>T</kbd><span>Flashlight · comes out after dusk, or stays packed</span><kbd>1–9 · 0 · G</kbd><span>Emote · dance, wave, cheer and more, or pick one from the ☺ button · imported adventurers only</span><kbd>DRAG / SCROLL</kbd><span>Look around / zoom</span></div>';
    $('resume-button').onclick=closeDialog;$('menu-lobby').onclick=enterLobby;$('menu-settings').onclick=()=>openMenu('settings');
  }
  audio.setPaused(true);if(!dialog.open)dialog.showModal();
}
$('settings-button').onclick=()=>openMenu('settings');$('nav-journal').onclick=$('journal-button').onclick=()=>openMenu('journal');$('pause-button').onclick=()=>openMenu('pause');

function respawnPlayer(){
  chapterTwo.resetChallenge();
  health=100;activities.mount.mounted=false;position.copy(spawn);locomotion.reset();lockTarget=null;aiming=cinematic=false;
  followCamera.reset(position,yaw,pitch,radius);combatMemory=0;audio.play('hit',{volume:.5});
  enemies.forEach(e=>{if(e.alive)e.group.position.set(e.x,groundHeight(e.x,e.z)+(e.rig?0:1.4),e.z);});
  toast('The keeper?s light shelters you. Your journey continues.');
}
// The stamina bar shows only while it is being spent or refilled.
let shownStamina=-1,shownExhausted=false;
function updateStamina(){
  const stamina=Math.round(locomotion.stamina*100),exhausted=locomotion.exhausted;
  if(stamina===shownStamina&&exhausted===shownExhausted)return;
  const meter=$('stamina-meter');shownStamina=stamina;shownExhausted=exhausted;
  $('stamina-fill').style.width=`${stamina}%`;meter.setAttribute('aria-valuenow',stamina);
  meter.classList.toggle('active',stamina<100);meter.classList.toggle('exhausted',exhausted);
}
function updatePlayer(dt){
  let x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+joyX;
  let z=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+joyY;
  const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
  const run=sprinting||keys.has('ShiftLeft')||keys.has('ShiftRight'),mounted=activities.mount.mounted;
  const movementYaw=lockTarget?followCamera.yaw:yaw;
  let wx=Math.cos(movementYaw)*x+Math.sin(movementYaw)*z,wz=-Math.sin(movementYaw)*x+Math.cos(movementYaw)*z,magnitude=Math.min(1,length);
  // Mounted, the controls ask for a way to go and the horse swings round to it.
  if(mounted)({x:wx,z:wz,magnitude}=reins.update(dt,{x:wx,z:wz,speed:locomotion.speed}));
  locomotion.radius=mounted?.85:.52;
  // Badly hurt, the hero nurses the wound: hunched when standing, and
  // limping at a walk. A limp covers less ground than a stride, so the
  // walk slows to match it; a sprint can still get away.
  const injured=health<=30&&!mounted;
  locomotion.update(dt,{x:wx,z:wz,magnitude,walk:!run,sprint:run,mounted,heroSpeed:heroMeta.speed,speedScale:mounted?1.65:(aiming?.65:1)*(injured&&!run?.75:1),attacking:attackTimer>heroMeta.cooldown*.45,hurt:hurtTimer>.9,climbDirection:-z});
  const bounds=world.bounds;position.x=clamp(position.x,bounds.minX+1,bounds.maxX-1);position.z=clamp(position.z,bounds.minZ+1,bounds.maxZ-1);
  updateStamina();
  if(inCity())propPhysics.update(dt);
  for(const event of locomotion.events){
    if(event.type==='land'&&event.speed>13){health=Math.max(0,health-(event.speed-13)*4);hurtTimer=.8;audio.play('hit',{volume:.6});}
  }
  if(health<=0){respawnPlayer();return;}
  const floor=locomotion.groundHeight;
  avatar.position.copy(position);
  const facing=lockTarget?.alive?Math.atan2(lockTarget.group.position.x-position.x,lockTarget.group.position.z-position.z):aiming?yaw+Math.PI:Math.atan2(velocity.x,velocity.z);
  if(mounted)avatar.rotation.y=reins.heading;
  else if((locomotion.speed>.2||lockTarget||aiming)&&attackTimer<=0)avatar.rotation.y+=Math.atan2(Math.sin(facing-avatar.rotation.y),Math.cos(facing-avatar.rotation.y))*(1-Math.exp(-14*dt));
  if(mounted){activities.mount.position.copy(position);activities.mount.group.rotation.y=avatar.rotation.y;}
  if(locomotion.climbing)avatar.rotation.y=Math.PI;
  if(emoting&&(time>emoteUntil||length>.08||attackTimer>0||hurtTimer>.9||!locomotion.grounded))emoting=null;
  if(pendingEmote&&(time>pendingEmote.until||(!emoting&&length<=.08&&attackTimer<=0&&locomotion.grounded&&locomotion.speed<.5&&perform(pendingEmote.state))))pendingEmote=null;
  // No idle fidgets with a fight on: a hero who has just been hit does
  // not stop to scratch.
  hero.animate(dt,{speed:mounted?0:locomotion.speed,moving:!mounted&&length>.08,sprinting:locomotion.sprinting,jumping:!locomotion.grounded&&!locomotion.climbing,attacking:attackTimer>heroMeta.cooldown*.45,holding:flashlight.out,injured,fidget:!lockTarget&&!aiming&&combatMemory<=0,state:emoting||(mounted?'Ride':locomotion.state),time});
  if(Math.hypot(position.x-camp.x,position.z-camp.z)<12)health=Math.min(100,health+dt*12);
  const interaction=nearbyInteraction();$('interaction-hint').hidden=!interaction;if(interaction)$('interaction-text').textContent=interaction.label;
  attackTimer=Math.max(0,attackTimer-dt);abilityTimer=Math.max(0,abilityTimer-dt);hurtTimer=Math.max(0,hurtTimer-dt);
  combatMemory=Math.max(0,combatMemory-dt);victoryTime=Math.max(0,victoryTime-dt);
  $('ability-cooldown').style.height=`${abilityTimer/7*100}%`;
  let nearestThreat=Infinity;
  for(const e of enemies){
    if(!inCity()){e.group.visible=false;continue;}
    if(!e.alive){
      if(e.dying>0){e.dying=Math.max(0,e.dying-dt);e.rig?.animate(dt,{state:'Dead',time});e.ragdoll.update(dt);if(e.dying===0)e.group.visible=false;}
      e.respawn=Math.max(0,e.respawn-dt);
      if(e.respawn===0&&e.dying===0&&Math.hypot(position.x-e.x,position.z-e.z)>RESPAWN_CLEARANCE)revive(e);
      continue;
    }
    e.hit=Math.max(0,e.hit-dt);e.swing=Math.max(0,e.swing-dt);
    const dx=position.x-e.group.position.x,dz=position.z-e.group.position.z,d=Math.hypot(dx,dz);
    // Far off, a wisp is neither drawn nor animated until the player comes back.
    e.group.visible=d<world.streaming.reach('props');if(!e.group.visible)continue;
    const visible=d<30&&collision.cameraFraction(new THREE.Vector3(e.group.position.x,e.group.position.y+1.7,e.group.position.z),new THREE.Vector3(position.x,position.y+1.7,position.z),.1)>.98;
    if(visible)nearestThreat=Math.min(nearestThreat,d);
    const chasing=visible&&d<18&&d>1.9;
    if(chasing){e.group.position.x+=dx/d*2.9*dt;e.group.position.z+=dz/d*2.9*dt;collide(e.group.position,.8);}
    e.group.rotation.y=Math.atan2(dx,dz);
    if(e.rig){e.group.position.y=groundHeight(e.group.position.x,e.group.position.z);e.group.scale.setScalar(e.hit>0?.92:1);e.rig.animate(dt,{speed:chasing?2.9:0,moving:chasing,attacking:e.swing>0,state:e.hit>0?'Hit':undefined,time});}
    else{e.group.position.y=groundHeight(e.group.position.x,e.group.position.z)+1.5+Math.sin(time*2+e.index)*.25;e.core.rotation.z=Math.sin(time+e.index)*.14;e.core.scale.setScalar(e.hit>0?.8:1);}
    if(visible&&d<2.5&&hurtTimer<=0&&Math.abs(position.y-groundHeight(e.group.position.x,e.group.position.z))<1.5){health=Math.max(0,health-12);hurtTimer=1.2;e.swing=.6;combatMemory=5;audio.play('hit',{position,volume:.7});if(health<=0)respawnPlayer();}
  }
  if(lockTarget&&(!lockTarget.alive||position.distanceTo(lockTarget.group.position)>40))lockTarget=null;
  const threat=nearestThreat<10||combatMemory>0||chapterTwo.combatants.some(e=>e.alive)?'combat':victoryTime>0?'victory':nearestThreat<26?'suspicion':'exploration';
  audio.setPaused(false);
  audio.update(dt,position,region(),{...locomotion.getStats(),events:locomotion.events,surface:locomotion.inWater?'water':region(),state:locomotion.state,mounted}, {sources:activities.sources,threat});
  syncCameraControls();
}
// The hero stands and listens, the line types itself out, and the camera
// comes round over their shoulder to whoever is speaking.
function updateConversation(dt){
  if(chat.shown<chat.text.length){chat.shown=Math.min(chat.text.length,chat.shown+dt*60);$('conversation-text').textContent=chat.text.slice(0,Math.floor(chat.shown));}
  yaw+=Math.atan2(Math.sin(chat.yaw-yaw),Math.cos(chat.yaw-yaw))*(1-Math.exp(-3*dt));
  pitch=damp(pitch,.2,3,dt);radius=damp(radius,Math.min(radius,10),3,dt);
  hero.animate(dt,{speed:0,holding:flashlight.out,state:chat.pose,injured:health<=30,fidget:false,time});
}
function updateShards(){
  shardMesh.visible=inCity();if(!inCity())return;
  for(let i=0;i<shardPositions.length;i++){
    if(!shardPositions[i]){dummy.scale.setScalar(0);dummy.updateMatrix();shardMesh.setMatrixAt(i,dummy.matrix);continue;}
    const [x,z]=shardPositions[i];
    if(screen==='game'&&!dialog.open&&!progress.collected.has(i)&&Math.hypot(position.x-x,position.z-z)<2&&position.y-groundHeight(x,z)<3){progress.collected.add(i);gainXP(15);sound();if(progress.collected.size===5)toast('The light gathers · Seek the restless wisps');}
    dummy.position.set(x,groundHeight(x,z)+1.6+Math.sin(time*2+i)*.22,z);dummy.rotation.set(0,time*.7+i,.12);dummy.scale.setScalar(progress.collected.has(i)?0:1);dummy.updateMatrix();shardMesh.setMatrixAt(i,dummy.matrix);
  }
  shardMesh.instanceMatrix.needsUpdate=true;
}
function updateCamera(dt){
  if(screen==='lobby'){
    const portrait=innerWidth<601&&innerHeight>500,tablet=innerWidth<=820&&!portrait&&innerHeight>500;
    camera.fov=portrait?39:37;camera.updateProjectionMatrix();
    // Aim left of the model on narrow screens, leaving its silhouette beside the text.
    cameraDesired.set(portrait?-2.3:tablet?-1.3:0,portrait?3.7:3.9,portrait?29.5:29.8);
    cameraTarget.set(portrait?-2.3:tablet?-1.3:0,portrait?1.8:1.6,18);
    cameraDesired.x+=spawn.x;cameraDesired.y+=spawn.y;cameraDesired.z+=spawn.z-18;
    cameraTarget.x+=spawn.x;cameraTarget.y+=spawn.y;cameraTarget.z+=spawn.z-18;
    camera.position.copy(cameraDesired);camera.lookAt(cameraTarget);
  }else{
    const shot=portalJourney?.pose,weight=shot?portalJourney.weight:0;
    // Under a blend the follow camera keeps its own smoothed pose; give it
    // back before it takes its next step.
    if(heldCamera.active){camera.position.copy(heldCamera.position);camera.quaternion.copy(heldCamera.quaternion);camera.fov=heldCamera.fov;heldCamera.active=false;}
    if(weight<1){
      const view=currentView();
      if(settling>0){
        settling=Math.max(0,settling-dt);
        pitch=damp(pitch,view.pitch,7,dt);
        radius=damp(radius,view.radius,7,dt);
      }
      const mode=activities.mount.mounted?'mount':cinematic?'cinematic':aiming?'aim':'follow';
      followCamera.update(dt,position,yaw,pitch,radius,{mode,lockTarget:mode==='follow'?lockTarget:null,height:view.height||1.9,shoulder:view.shoulder||0,fov:view.fov,speed:locomotion.speed,cinematicTime:reducedMotion?0:time});
      if(lockTarget&&!followCamera.locked)lockTarget=null;
    }
    if(lockTarget&&weight===0){
      const marker=targetPoint.copy(lockTarget.group.position);marker.y+=4;marker.project(camera);
      $('target-marker').hidden=marker.z>1||marker.z< -1; $('target-marker').style.left=`${(marker.x*.5+.5)*100}%`;$('target-marker').style.top=`${(-marker.y*.5+.5)*100}%`;
    }else $('target-marker').hidden=true;
    if(weight>0)filmPortal(shot,weight,dt);
  }
}
// The portal crossing's camera. Buildings and hills draw it in toward its
// subject rather than letting it look through them, and it only eases back out.
const heldCamera={active:false,position:new THREE.Vector3(),quaternion:new THREE.Quaternion(),fov:55};
const filmed={position:new THREE.Vector3(),target:new THREE.Vector3(),quaternion:new THREE.Quaternion(),matrix:new THREE.Matrix4(),desired:new THREE.Vector3(),reach:1,boom:0};
function filmPortal(shot,weight,dt){
  const f=filmed,shake=reducedMotion?0:(portalJourney?.shake||0)*.16;
  f.target.copy(shot.target);
  if(shake>0){f.target.x+=Math.sin(time*47)*shake;f.target.y+=Math.sin(time*39+1)*shake*.7;f.target.z+=Math.sin(time*43+2)*shake;}
  // A blocked shot first rises over what is in the way, so the camera stays
  // outside the ring the stones fly in, and only then draws in toward its subject.
  let boom=0,fraction=0;
  for(const rise of [0,3,6,10]){
    const clear=followCamera.safeFraction(shot.target,f.desired.copy(shot.position).setY(shot.position.y+rise));
    if(clear>fraction+.02){boom=rise;fraction=clear;}
    if(clear>=.97)break;
  }
  f.boom=reducedMotion?boom:damp(f.boom,boom,2.5,dt);
  f.desired.copy(shot.position).setY(shot.position.y+f.boom);
  fraction=followCamera.safeFraction(shot.target,f.desired);
  f.reach=fraction<f.reach?fraction:damp(f.reach,fraction,2.5,dt);
  f.position.lerpVectors(shot.target,f.desired,f.reach);
  f.position.y=Math.max(f.position.y,followCamera.floorHeight(f.position.x,f.position.z));
  f.matrix.lookAt(f.position,f.target,camera.up);f.quaternion.setFromRotationMatrix(f.matrix);
  if(weight<1){
    heldCamera.position.copy(camera.position);heldCamera.quaternion.copy(camera.quaternion);heldCamera.fov=camera.fov;heldCamera.active=true;
    camera.position.lerp(f.position,weight);camera.quaternion.slerp(f.quaternion,weight);camera.fov+=(shot.fov-camera.fov)*weight;
  }else{camera.position.copy(f.position);camera.quaternion.copy(f.quaternion);camera.fov=shot.fov;}
  camera.updateProjectionMatrix();
}
const map=$('minimap').getContext('2d');
// The map follows the player at a fixed scale: the Reach is now too wide to
// show whole at a size that still reads. Its walls never move, so they are
// drawn once, and each update copies only the part around the player.
const MAP_SCALE=.5;
let mapLayer=null;
function drawMapLayer(){
  const bounds=world.bounds,layer=document.createElement('canvas');
  layer.width=Math.ceil((bounds.maxX-bounds.minX)*MAP_SCALE);layer.height=Math.ceil((bounds.maxZ-bounds.minZ)*MAP_SCALE);
  const context=layer.getContext('2d'),lx=x=>(x-bounds.minX)*MAP_SCALE,lz=z=>(z-bounds.minZ)*MAP_SCALE;
  context.fillStyle='#b5b8ad66';
  for(const c of world.colliders){
    if(c.ceilingOnly || c.cameraOnly)continue;
    if(c.r!==undefined){context.beginPath();context.arc(lx(c.x),lz(c.z),c.r*MAP_SCALE,0,Math.PI*2);context.fill();}
    else context.fillRect(lx(c.x-c.w/2),lz(c.z-c.d/2),c.w*MAP_SCALE,c.d*MAP_SCALE);
  }
  return layer;
}
function drawMap(){
  map.clearRect(0,0,180,180);map.fillStyle='#343c40';map.fillRect(0,0,180,180);
  const bounds=world.bounds,scale=MAP_SCALE;
  const px=x=>90+(x-position.x)*scale,pz=z=>90+(z-position.z)*scale;
  mapLayer??=drawMapLayer();
  map.drawImage(mapLayer,Math.round(px(bounds.minX)),Math.round(pz(bounds.minZ)));
  for(const l of world.landmarks){map.fillStyle=l.color;map.fillRect(px(l.x)-3,pz(l.z)-3,6,6);}
  const goal=questObjective();
  if(goal){
    let gx=px(goal.x)-90,gz=pz(goal.z)-90;const reach=Math.hypot(gx,gz);if(reach>80){gx*=80/reach;gz*=80/reach;}
    map.save();map.translate(90+gx,90+gz);map.rotate(Math.PI/4);map.fillStyle='#ffd98a';map.strokeStyle='#3b2b0d';map.lineWidth=1.5;map.fillRect(-4.5,-4.5,9,9);map.strokeRect(-4.5,-4.5,9,9);map.restore();
  }
  map.fillStyle='#deca88';for(let i=0;i<shardPositions.length;i++){if(progress.collected.has(i)||!shardPositions[i])continue;map.beginPath();map.arc(px(shardPositions[i][0]),pz(shardPositions[i][1]),1.9,0,Math.PI*2);map.fill();}
  map.fillStyle='#c9a1e2';for(const e of enemies){if(!e.alive)continue;map.beginPath();map.arc(px(e.group.position.x),pz(e.group.position.z),2.5,0,Math.PI*2);map.fill();}
  map.fillStyle='#ff987d';for(const e of chapterTwo.combatants){if(!e.alive)continue;map.beginPath();map.arc(px(e.group.position.x),pz(e.group.position.z),e.boss?4:2.5,0,Math.PI*2);map.fill();}
  map.strokeStyle='#9fe8ed';map.lineWidth=1.5;for(const p of chapterTwo.mapTargets){map.beginPath();map.arc(px(p.x),pz(p.z),3.5,0,Math.PI*2);map.stroke();}
  map.save();map.translate(px(position.x),pz(position.z));map.rotate(-avatar.rotation.y);map.fillStyle='#fff6d6';map.beginPath();map.moveTo(0,6);map.lineTo(-4,-4);map.lineTo(4,-4);map.closePath();map.fill();map.restore();
}

let lastFrame=performance.now(),nextFrame=0,uiTime=0,renderInfo={calls:0,triangles:0,programs:0};
function animate(now){
  if(contextLost||document.hidden)return;
  // Avoid driving a phone's 120/144 Hz panel at full GPU load. Menus need fewer frames.
  const interval=1000/(dialog.open?15:60);
  if(now<nextFrame)return;
  nextFrame=now-((now-nextFrame)%interval)+interval;
  const raw=Math.max(0,(now-lastFrame)/1000);lastFrame=now;const dt=Math.min(raw,.08);time+=dt;
  if(!dialog.open){
    if(screen==='game'){setTime(preferences.time+dt*24/DAY_LENGTH_SECONDS);dirtySave=true;}
    if(screen==='game'&&hero){if(chat)updateConversation(dt);else if(!portalJourney){const steps=Math.max(1,Math.ceil(dt/.025));for(let i=0;i<steps;i++)updatePlayer(dt/steps);}}
    else if(hero){avatar.position.copy(spawn).y+=.22;avatar.rotation.y=previewYaw;hero.animate(dt,{speed:0,holding:flashlight.out,state:time<greetUntil?'Wave':undefined,time:reducedMotion?0:time});}
    if(screen==='game')updatePortalJourney(dt);
    portal.root.visible=screen==='game';portal.watch(portalJourney?.weight>0?camera.position:null);
    // Each stone that breaks the ground lands a thud and a jolt of the camera.
    for(const event of portal.update(dt,reducedMotion?0:time))if(event.type==='stone'){audio.play('landing',{volume:.55,rate:.66});if(portalJourney)portalJourney.shake=Math.min(1,(portalJourney.shake||0)+.35);}
    activities.root.visible=screen==='game'&&inCity();if(inCity())activities.update(dt,reducedMotion?0:time,locomotion.speed,locomotion.sprinting);
    if(screen==='game'&&activities.mount.mounted&&hero)alignRider(avatar,hero.ridingAnchor,activities.mount.saddle);
    world.update(dt,reducedMotion?0:time,screen==='game'?position:avatar.position);updateShards();
    if(inCity())story.update(dt,reducedMotion?0:time,screen==='game'?position:avatar.position,STEPS[storyStep(progress)].id);
    chapterTwo.update(dt,reducedMotion?0:time,position,{active:screen==='game'&&!chat&&!portalJourney});
    chapterTwo.root.visible=chapterTwoUnlocked()&&screen==='game';
    pulseAge+=dt;boltAge+=dt;pulse.scale.setScalar(1+pulseAge*pulseSize*2);pulse.material.opacity=Math.max(0,1-pulseAge*2);pulse.visible=pulseAge<.5;bolt.material.opacity=Math.max(0,1-boltAge*5);bolt.visible=boltAge<.2;
    updateCamera(dt);
    flashlight.update(dt,{facing:avatar.rotation.y,camera});
  }
  audio.setPaused(dialog.open||screen!=='game'||contextLost||document.hidden);
  const avatarFloor=screen==='game'?locomotion.groundHeight:groundHeight(avatar.position.x,avatar.position.z);
  blob.position.set(avatar.position.x,avatarFloor+(screen==='lobby'?.225:.045),avatar.position.z);blob.material.opacity=screen==='game'?Math.max(.2,1-(position.y-avatarFloor)*.15):.8;
  atmosphere.update(dt,reducedMotion?0:time,camera.position,region());
  renderer.render(scene,camera);renderInfo={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,programs:renderer.info.programs?.length??0};
  uiTime+=dt;if(uiTime>.15){uiTime=0;if(screen==='game'){updateHUD();drawMap();const landmark=world.landmarks.find(l=>Math.hypot(position.x-l.x,position.z-l.z)<20);$('region-name').textContent=landmark?landmark.name:{forest:'Pine Islet',plaza:'Lantern Plaza',yard:'Skibidi Yard',nightwood:'Nightwood Road',mesa:'Red Mesa'}[region()]||'City Quarter';$('world-clock').textContent=`${{forest:'ISLET',plaza:'PLAZA',yard:'YARD',nightwood:'WOODS',mesa:'MESA'}[region()]||'CITY'} · ${formatTime(preferences.time)}`;}}
  if(raw>0&&raw<.25&&!dialog.open&&!switching){frameMS=frameMS*.96+raw*1000*.04;frameSamples++;sampleTime+=raw;}
  if(sampleTime>1){$('performance-readout').textContent=`${Math.round(1000/frameMS)} FPS · ${quality} · ${Math.round(renderer.getPixelRatio()*100)}%`;sampleTime=0;}
  if(preferences.quality==='auto'&&frameSamples>150&&time-lastAdapt>8&&frameMS>25){if(quality==='high')applyQuality('balanced',true);else if(quality==='balanced')applyQuality('low',true);else if(resolutionScale>.7){resolutionScale=Math.max(.7,resolutionScale-.1);applyQuality('low',true);}frameSamples=0;}
  if(dirtySave&&time-lastSave>3){save();lastSave=time;}
}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);updateCamera(1);}
addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;audio.setPaused(true);renderer.setAnimationLoop(null);resetInput();save();toast('Graphics paused. Waiting for your device to recover…');});
renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;lastFrame=performance.now();applyQuality(quality);if(!document.hidden)renderer.setAnimationLoop(animate);toast('The world is ready again.');});

// Read-only diagnostics for browser verification and device profiling.
function ridingStats(){
  if(!hero||!activities.mount.mounted)return null;
  const contact=hero.ridingAnchor.getWorldPosition(new THREE.Vector3());
  const saddle=activities.mount.saddle.getWorldPosition(new THREE.Vector3());
  return {seatGap:contact.distanceTo(saddle),rootHeight:avatar.position.y-position.y,heading:reins.heading};
}
Object.defineProperty(window,'__ASTRA_DEBUG__',{get:()=>({screen,hero:heroMeta.id,ready:!!hero,switching,paused:dialog.open,quality,pixelRatio:renderer.getPixelRatio(),fps:Math.round(1000/frameMS),position:{x:position.x,y:position.y,z:position.z},progress:{xp:progress.xp,kills:progress.kills,shards:progress.collected.size,quest:storyStep(progress)},chapterTwo:{unlocked:chapterTwoUnlocked(),...chapterTwo.diagnostics},story:{step:STEPS[storyStep(progress)].id,flags:{...progress.story},finale,chat:chat?{person:chat.person,line:chat.index,lines:chat.lines.length}:null,...story.diagnostics},health,enemies:enemies.filter(e=>e.alive).length,enemyModel:enemies.filter(e=>e.rig).length,heroRuntime:hero?.diagnostics||null,riding:ridingStats(),portal:{...portal.diagnostics(),journey:portalJourney?{phase:portalJourney.phase,destination:portalJourney.route.destination,ready:portalJourney.ready}:null,places:portal.places},terrain:{...world.diagnostics,height:groundHeight(position.x,position.z)},atmosphere:atmosphere.diagnostics,flashlight:flashlight.diagnostics,locomotion:locomotion.getStats(),audio:audio.getStats(),activities:activities.getStats(),physics:{bodies:propPhysics.bodies.length,moving:propPhysics.bodies.filter(body=>!body.sleeping).length},camera:{...followCamera.getStats(),view:currentView().id,name:currentView().name,pitch,radius,fov:camera.fov,settling},render:renderInfo,input:{joyX,joyY,sprinting,keys:[...keys]}})});
try{
  const resumeMap=saved.map==='yard'&&progress.chapterTwo.roots?'yard':saved.map==='forest'&&progress.chapterTwo.accepted?'forest':progress.chapterTwo.accepted&&!progress.chapterTwo.complete?(progress.chapterTwo.roots?'yard':'forest'):'city';
  if(chapterTwoUnlocked()&&resumeMap!=='city'){const arrival=await world.travelTo(resumeMap,{prepare:prepareModel});await arriveThroughPortal(arrival);}
  await selectHero(HEROES.some(h=>h.id===saved.hero)?saved.hero:'warden');
  if(!hero)await selectHero('warden');
  updateHUD();updateCamera(1);updateShards();$('performance-readout').hidden=!preferences.showFPS;
  // In the hero's hand by now nearly always, so its shader is ready before dusk
  // rather than built on the frame it first comes out.
  await Promise.race([flashlightModel,new Promise(resolve=>setTimeout(resolve,4000))]);
  if(renderer.compileAsync)await Promise.race([renderer.compileAsync(scene,camera),new Promise(resolve=>setTimeout(resolve,8000))]);
  window.astraReady=true;$('loading').classList.add('finished');setTimeout(()=>$('loading').hidden=true,600);
  lastFrame=performance.now();renderer.setAnimationLoop(animate);
  // The plaza's model, when the plaza is on, streams in behind the game rather
  // than holding up its start. Its shaders and textures are made ready before
  // it is shown, so its arrival costs no dropped frames.
  const prepare=prepareModel;
  portal.load({prepare}).catch(error=>console.warn('The portal uses its carved stand-in.',error));
  world.stream({prepare}).catch(error=>console.warn('The plaza model did not load; its footprint stands in for it.',error));
  // The story's people and props follow the same way, each ready before it is shown.
  if(inCity())story.stream({prepare}).catch(error=>console.warn('The story models did not load.',error));
}catch(error){console.error(error);$('load-message').textContent='This device could not start the 3D world. Try again with a WebGL-enabled browser.';$('retry-button').hidden=false;}
