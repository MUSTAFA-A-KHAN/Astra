import * as THREE from 'three';
import { createCityWorld } from './city-world.js';
import { createAtmosphere } from './atmosphere.js';
import { SpatialHash, LocomotionController, PropPhysics, RagdollController } from './physics.js';
import { FollowCamera } from './camera.js';
import { GameAudio } from './audio.js';
import { createGameplayWorld } from './gameplay-world.js';
import { HEROES, createHero, createEnemySquad } from './characters.js';

const $ = id => document.getElementById(id);
const touch = matchMedia('(pointer:coarse)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const SAVE_KEY = 'astra-journey-v1';
function readSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } }
const saved = readSave();
const finite = (v, fallback, min = 0, max = 1e7) => Number.isFinite(v) ? clamp(v, min, max) : fallback;
const progress = { xp: finite(saved.xp, 0), kills: finite(saved.kills, 0), restored: saved.restored === true, collected: new Set(Array.isArray(saved.collected) ? saved.collected.filter(v => Number.isInteger(v) && v >= 0 && v < 24) : []) };
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
  { id: 'close', name: 'Close', pitch: .2, radius: 5, fov: 70, shoulder: .8, height: 2.25 },
  { id: 'shoulder', name: 'Shoulder', pitch: .3, radius: 8.5, fov: 62 },
  { id: 'wide', name: 'Wide', pitch: .4, radius: 23, fov: 52 },
  { id: 'overhead', name: 'Overhead', pitch: .88, radius: 21, fov: 55 },
];
const readLayout = stored => Object.fromEntries(CONTROLS
  .map(control => [control, stored?.[control]])
  .filter(([, spot]) => Number.isFinite(spot?.x) && Number.isFinite(spot?.y))
  .map(([control, spot]) => [control, { x: clamp(spot.x, 0, 1), y: clamp(spot.y, 0, 1) }]));
const preferences = { quality: ['auto','low','balanced','high'].includes(saved.quality) ? saved.quality : 'auto', sound: saved.sound !== false, showFPS: saved.showFPS === true, time: finite(saved.time, 15.5, 0, 24), layout: readLayout(saved.layout), view: VIEWS.some(view => view.id === saved.view) ? saved.view : VIEWS[0].id };
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
let toastTimeout, audioContext, time = 0, health = 100, attackTimer = 0, abilityTimer = 0, hurtTimer = 0, emoting = null, emoteUntil = 0;
let lockTarget = null, aiming = false, cinematic = false, combatMemory = 0, victoryTime = 0;
let lastSave = 0, dirtySave = false, previewYaw = .23;
const level = () => Math.floor(progress.xp / 150) + 1;
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...preferences, xp: progress.xp, kills: progress.kills, restored: progress.restored, collected: [...progress.collected], hero: heroMeta.id })); dirtySave = false; }
  catch { /* Private browsing and full storage must never stop play. */ }
}
function toast(message) { $('toast-text').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 3800); }
function sound() {
  audio.play('interaction', { volume: .35 });
}
function enableAudio() { if (!preferences.sound) return; try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audio.setContext(audioContext); audioContext.resume().catch(() => {}); } catch {} }

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
let world;
try {
  $('load-message').textContent = 'Preparing the city streets…';
  world = await createCityWorld(scene, { lowPower: touch });
} catch (error) {
  $('load-message').textContent = 'The city could not load. Check your connection and try again.';
  $('retry-button').hidden = false;
  throw error;
}
const groundHeight = (x, z) => world.getHeight(x, z);
const spawn = new THREE.Vector3(world.spawn.x, groundHeight(world.spawn.x, world.spawn.z), world.spawn.z);
const shrine = world.landmarks.find(landmark => landmark.id === 'shrine') || world.landmarks[0];
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
const activities = createGameplayWorld(scene, world, collision);
const locomotion = new LocomotionController(position, velocity, activities.terrain, collision, { waterZones: activities.waterZones, climbables: activities.climbables });
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
  world.setQuality(value); atmosphere.setQuality(value); renderer.shadowMap.needsUpdate = true;
  $('quality-status').textContent = `${preferences.quality === 'auto' ? 'Adaptive' : 'Graphics'} · ${value === 'low' ? 'Performance' : value === 'high' ? 'High' : 'Balanced'}`;
  if (adaptive) lastAdapt = time;
}
applyQuality(preferences.quality === 'auto' ? quality : preferences.quality);
function setTime(hour) {
  preferences.time = ((hour % 24) + 24) % 24;
  atmosphere.setTime(preferences.time);
  world.setTime(preferences.time);
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
    if(hero){avatar.remove(hero.group);hero.dispose();}
    hero=next;heroMeta=meta;avatar.add(hero.group);previewYaw=.23;updateHeroUI();save();
  } catch (error) { console.warn('Character unavailable:',error); toast('That adventurer could not load. Your current hero is ready.'); }
  finally {switching=false;$('character-loading').hidden=true;$('play-button').disabled=!hero;}
}
$('character-roster').addEventListener('click',e=>{const b=e.target.closest('[data-hero]');if(b)selectHero(b.dataset.hero);});

// Collectibles share one mesh, material, and GPU buffer.
const shardPositions = (world.shardPositions || [[0,9],[1,0],[-1,-10],[2,-20],[0,-32],[-12,9],[-23,16],[-35,23],[-42,34],[-49,17],[14,-7],[25,-13],[36,-17],[47,-26],[55,-12],[-15,-42],[16,-43],[-28,-60],[30,-63],[60,30],[-65,-10],[66,-48],[-25,60],[25,48]]).map(([x,z])=>{const point=world.findWalkable(x,z);return [point.x,point.z];});
const shardMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.48),new THREE.MeshStandardMaterial({color:'#c1f6df',emissive:'#43a995',emissiveIntensity:.8,metalness:.2,roughness:.25}),shardPositions.length); shardMesh.frustumCulled=false; scene.add(shardMesh);
const dummy=new THREE.Object3D();
const enemyGeo=new THREE.IcosahedronGeometry(.85,1),enemyMat=new THREE.MeshStandardMaterial({color:'#9380b0',emissive:'#3c235c',emissiveIntensity:.65,roughness:.5});
const eyeGeo=new THREE.SphereGeometry(.12,6,4),eyeMat=new THREE.MeshBasicMaterial({color:'#ffdbaf'});
const enemies=(world.enemyPositions || [[-9,-17],[12,-30],[-17,-38],[28,-24],[-33,-12],[45,-42]]).map(([x,z],i)=>{
  const point=world.findWalkable(x,z);x=point.x;z=point.z;
  const group=new THREE.Group(),wisp=new THREE.Group(),core=new THREE.Mesh(enemyGeo,enemyMat); wisp.add(core);
  for(const side of [-1,1]){const eye=new THREE.Mesh(eyeGeo,eyeMat);eye.position.set(side*.27,.18,.72);wisp.add(eye);}
  group.add(wisp);group.position.set(x,groundHeight(x,z)+1.4,z);scene.add(group);return{group,wisp,core,x,z,hp:80,index:i,hit:0,alive:true,rig:null,swing:0,dying:0,respawn:0};
});
// Walking automatons replace the placeholder wisps once the shared model lands.
// A failed download leaves the wisps in play rather than emptying the field.
createEnemySquad(enemies.length).then(squad=>{
  squad.members.forEach((rig,i)=>{const e=enemies[i];e.rig=rig;e.wisp.visible=false;e.group.add(rig.group);e.group.position.y=groundHeight(e.group.position.x,e.group.position.z);});
}).catch(error=>console.warn('Enemy model unavailable:',error));
// The Reach refills itself: a felled automaton walks back out of its
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
function gainXP(amount) {const previous=level();progress.xp+=amount;dirtySave=true;if(level()>previous){health=100;toast(`Level ${level()} · Your light grows stronger`);sound();}updateHUD();}
function questStage(){return progress.restored?3:progress.collected.size<5?0:progress.kills<3?1:2;}
const questTitles=['A glimmer in the green','Quiet the restless','Awaken the Moonwell','A light returned'];
const questDescriptions=['Collect 5 glowing shards along the city streets.','Defeat 3 wandering wisps. Approach, then attack.','Follow the blue map marker. Restore the blue shrine.','The Reach is at peace. Keep exploring the city.'];
function updateHUD(){
  $('health-fill').style.width=`${health}%`;$('health-meter').setAttribute('aria-valuenow',Math.ceil(health));$('health-label').textContent=`${Math.ceil(health)} / 100`;
  $('xp-fill').style.width=`${progress.xp%150/150*100}%`;$('xp-meter').setAttribute('aria-valuenow',Math.round(progress.xp%150/150*100));$('level-label').textContent=`LV. ${level()}`;$('shards-label').textContent=`${progress.collected.size} shards`;
  const q=questStage(),value=q===0?progress.collected.size:q===1?progress.kills:1,max=q===0?5:q===1?3:1;
  $('quest-title').textContent=questTitles[q];$('quest-description').textContent=questDescriptions[q];$('quest-count').textContent=q===2?'◇ SHRINE':q===3?'COMPLETE':`${value} / ${max}`;$('quest-fill').style.width=`${value/max*100}%`;
}
function attack(special=false){
  if(screen!=='game'||dialog.open||document.hidden||!hero||contextLost)return;
  if(special?abilityTimer>0:attackTimer>0)return;
  if(special)abilityTimer=7;attackTimer=heroMeta.cooldown;
  cinematic=false; combatMemory=5; audio.play('sword', { position, volume: special ? .9 : .65 });
  const range=special?heroMeta.range+5:heroMeta.range,damage=(special?heroMeta.damage*2:heroMeta.damage)+(level()-1)*3;
  let nearest=null,best=range;
  for(const e of enemies){if(!e.alive)continue;const d=Math.hypot(e.group.position.x-position.x,e.group.position.z-position.z);if(d<best){nearest=e;best=d;}}
  if(lockTarget?.alive && position.distanceTo(lockTarget.group.position)<range)nearest=lockTarget;
  if(aiming&&!special&&nearest){const dx=nearest.group.position.x-position.x,dz=nearest.group.position.z-position.z;if((-Math.sin(yaw)*dx-Math.cos(yaw)*dz)/Math.max(.01,Math.hypot(dx,dz))<.82)nearest=null;}
  if(nearest && (Math.abs(nearest.group.position.y-position.y)>4 || collision.cameraFraction(new THREE.Vector3(position.x,position.y+1.8,position.z),new THREE.Vector3(nearest.group.position.x,nearest.group.position.y+1.8,nearest.group.position.z),.1)<.98))nearest=null;
  if(nearest){avatar.rotation.y=Math.atan2(nearest.group.position.x-position.x,nearest.group.position.z-position.z);}
  const targets=special?enemies.filter(e=>e.alive&&Math.abs(e.group.position.y-position.y)<4&&Math.hypot(e.group.position.x-position.x,e.group.position.z-position.z)<range&&collision.cameraFraction(new THREE.Vector3(position.x,position.y+1.8,position.z),new THREE.Vector3(e.group.position.x,e.group.position.y+1.8,e.group.position.z),.1)>.98):nearest?[nearest]:[];
  for(const e of targets){
    e.hp-=damage;e.hit=.3;audio.play('hit',{position:e.group.position,volume:.6});
    if(e.hp<=0){
      e.alive=false;e.respawn=RESPAWN_DELAY;e.dying=2.6;
      const dx=e.group.position.x-position.x,dz=e.group.position.z-position.z,d=Math.max(.1,Math.hypot(dx,dz));
      e.ragdoll.start({x:dx/d*4,y:2,z:dz/d*4});
      if(lockTarget===e)lockTarget=null;
      progress.kills++;gainXP(35);toast(`Wisp released · +35 experience${progress.kills===3?' · Return to the Moonwell':''}`);
      if(!enemies.some(other=>other.alive&&position.distanceTo(other.group.position)<20)){victoryTime=7;combatMemory=0;}
    }
  }
  if(special){showPulse(position.x,position.z,range,heroMeta.color);if(heroMeta.id==='warden'){health=Math.min(100,health+20);updateHUD();}}
  else if(nearest){targetPoint.copy(nearest.group.position);direction.copy(targetPoint).sub(position).add(new THREE.Vector3(0,-1.6,0));bolt.position.copy(position).add(new THREE.Vector3(0,1.6,0)).addScaledVector(direction,.5);bolt.scale.set(1,direction.length(),1);bolt.quaternion.setFromUnitVectors(up,direction.normalize());bolt.material.color.set(heroMeta.color);boltAge=0;}
  else showPulse(position.x,position.z,2.5,heroMeta.color);
  updateHUD();
}
function nearbyInteraction(){
  if(activities.mount.mounted)return {type:'mount',label:'Dismount'};
  if(locomotion.climbing)return {type:'climb',label:'Let go of ladder'};
  if(position.distanceTo(activities.mount.position)<4)return {type:'mount',label:'Ride trail horse'};
  const ladder=activities.climbables.find(c=>Math.hypot(position.x-c.x,position.z-c.z)<(c.r||1.8)&&position.y<c.top+.5);
  if(ladder)return {type:'climb',label:'Climb lookout · forward / back',ladder};
  if(activities.crates.some(c=>position.distanceTo(c.position)<2.8))return {type:'push',label:'Push supply crate'};
  if(questStage()===2&&Math.hypot(position.x-shrine.x,position.z-shrine.z)<10)return {type:'shrine',label:'Restore the shrine'};
  return null;
}
function interact(){
  if(screen!=='game'||dialog.open)return;
  const action=nearbyInteraction();if(!action)return;
  if(action.type==='mount'){
    const mount=activities.mount;
    if(mount.mounted){
      const point=world.findWalkable(position.x+2,position.z,1);const candidate=new THREE.Vector3(point.x,point.y,point.z);collide(candidate);position.copy(candidate);mount.mounted=false;locomotion.reset();
    }else if(locomotion.grounded){mount.mounted=true;position.copy(mount.position);lockTarget=null;aiming=cinematic=false;locomotion.reset();}
    syncCameraControls();audio.play('interaction');return;
  }
  if(action.type==='climb'){if(locomotion.climbing)locomotion.stopClimb();else{locomotion.startClimb(action.ladder);cinematic=false;}return;}
  if(action.type==='push'){const dir={x:Math.sin(avatar.rotation.y),z:Math.cos(avatar.rotation.y)};propPhysics.push(position,dir,8,3);audio.play('landing',{position,volume:.3});return;}
  progress.restored=true;gainXP(150);save();showPulse(shrine.x,shrine.z,22,'#b8f3e0');victoryTime=8;toast('The Moonwell awakens · Chapter complete · +150 experience');audio.play('victory');
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
function toggleAim(){if(screen!=='game'||dialog.open)return;aiming=!aiming;cinematic=false;if(aiming)lockTarget=null;syncCameraControls();}
function toggleCinematic(){if(screen!=='game'||dialog.open)return;cinematic=!cinematic;aiming=false;lockTarget=null;syncCameraControls();}
function toggleLock(){
  if(screen!=='game'||dialog.open)return;
  if(lockTarget){yaw=followCamera.yaw;lockTarget=null;}
  else{
    lockTarget=enemies.filter(e=>e.alive&&position.distanceTo(e.group.position)<35&&collision.cameraFraction(new THREE.Vector3(position.x,position.y+1.8,position.z),new THREE.Vector3(e.group.position.x,e.group.position.y+1.8,e.group.position.z),.1)>.98).sort((a,b)=>position.distanceToSquared(a.group.position)-position.distanceToSquared(b.group.position))[0]||null;
    if(!lockTarget)toast('No visible target within range.');
  }
  aiming=cinematic=false;syncCameraControls();
}
function resetInput(){keys.clear();joyX=joyY=0;joyId=null;sprinting=false;dragId=null;emoting=null;aiming=false;syncCameraControls();velocity.set(0,0,0);$('joystick-knob').style.transform='';}
addEventListener('keydown',e=>{
  // While the controls are being arranged the hero stays put: no key
  // reaches the game, and Escape finishes the same as Done.
  if(editingLayout){if(e.code==='Escape')editLayout(false);return;}
  if(dialog.open){if(e.code==='Escape'){e.preventDefault();closeDialog();}return;}
  if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
  if(screen!=='game')return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  keys.add(e.code);if(e.repeat)return;
  if(e.code==='Space')jump();if(e.code==='KeyQ')attack();if(e.code==='KeyE')attack(true);if(e.code==='KeyF')interact();if(e.code==='KeyV')cycleView();if(e.code==='Escape'||e.code==='KeyP')openMenu('pause');if(e.code==='KeyJ')openMenu('journal');
  if(e.code==='KeyL')toggleLock();if(e.code==='KeyR')toggleAim();if(e.code==='KeyC')toggleCinematic();
  if(EMOTE_KEYS[e.code])emote(EMOTE_KEYS[e.code]);
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>{resetInput();if(screen==='game'&&!dialog.open)openMenu('pause');save();});
addEventListener('pagehide',()=>{save();audio.setPaused(true);});
document.addEventListener('visibilitychange',()=>{resetInput();if(document.hidden){audio.setPaused(true);save();renderer.setAnimationLoop(null);if(screen==='game'&&!dialog.open)openMenu('pause');}else{lastFrame=performance.now();if(!contextLost)renderer.setAnimationLoop(animate);}});
function jump(){if(screen==='game'&&!dialog.open){locomotion.requestJump();cinematic=false;}}
// Emotes are the one animation the player drives directly, so they
// are held for exactly as long as the clip runs and dropped the
// moment the character has somewhere else to be. `hero.emotes` only
// lists gestures this character actually shipped with, so a key
// pressed by someone playing a starter hero does nothing at all.
const EMOTE_KEYS={Digit1:'Dance',Digit2:'Nod',Digit3:'Shake',Digit4:'Sad'};
function emote(state){
  if(screen!=='game'||dialog.open)return;
  const duration=hero?.emotes?.[state];if(!duration)return;
  emoting=state;emoteUntil=time+duration;
}
renderer.domElement.addEventListener('pointerdown',e=>{if(dialog.open||dragId!==null)return;dragId=e.pointerId;dragX=e.clientX;dragY=e.clientY;dragDistance=0;renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(e.pointerId!==dragId)return;const dx=e.clientX-dragX,dy=e.clientY-dragY;dragDistance+=Math.abs(dx)+Math.abs(dy);dragX=e.clientX;dragY=e.clientY;if(screen==='lobby')previewYaw+=dx*.009;else{yaw-=dx*.005;pitch=clamp(pitch+dy*.004,-1.2,1.08);settling=0;}});
renderer.domElement.addEventListener('pointerup',e=>{if(e.pointerId!==dragId)return;if(dragDistance<7&&e.pointerType==='mouse'&&e.button===0)attack();dragId=null;});
renderer.domElement.addEventListener('pointercancel',()=>dragId=null);renderer.domElement.addEventListener('lostpointercapture',()=>dragId=null);
renderer.domElement.addEventListener('wheel',e=>{if(screen==='game'){radius=clamp(radius+e.deltaY*.014,4,25);settling=0;e.preventDefault();}},{passive:false});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
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
  const button=$(id);let pressed=false;
  button.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;pressed=true;run();});
  // A click still follows a single-finger tap, and that one has
  // already been acted on. `detail` is 0 only for a keyboard
  // activation, which has no press of its own behind it.
  button.addEventListener('click',e=>{if(pressed&&e.detail){pressed=false;return;}run();});
}
actionButton('view-button',()=>cycleView());actionButton('attack-button',()=>attack());actionButton('ability-button',()=>attack(true));actionButton('jump-button',jump);actionButton('interact-button',interact);
actionButton('lock-button',toggleLock);actionButton('aim-button',toggleAim);actionButton('cinematic-button',toggleCinematic);

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

function enterGame(){if(!hero||switching)return;if(editingLayout)editLayout(false);enableAudio();screen='game';audio.setPaused(false);followCamera.reset(position,yaw,currentView().pitch,currentView().radius);sessionStarted=true;document.body.dataset.screen=screen;$('topbar').hidden=true;$('lobby').hidden=true;$('game-hud').hidden=false;stage.visible=false;portraitLight.intensity=0;resetInput();avatar.position.copy(position);cameraTarget.copy(position).y+=2;pitch=currentView().pitch;radius=currentView().radius;camera.fov=currentView().fov;camera.updateProjectionMatrix();settling=0;updateCamera(1);updateHUD();toast('Follow the glowing shards. Your journey begins.');}
function enterLobby(){if(editingLayout)editLayout(false);closeDialog();screen='lobby';audio.setPaused(true);lockTarget=null;cinematic=false;document.body.dataset.screen=screen;$('topbar').hidden=false;$('lobby').hidden=false;$('game-hud').hidden=true;stage.visible=true;portraitLight.intensity=1.6;avatar.position.copy(spawn).y+=.22;resetInput();save();updateHeroUI();$('play-button').firstElementChild.textContent=sessionStarted?'Continue journey':'Enter the city';}
$('play-button').addEventListener('click',enterGame);$('lobby-button').addEventListener('click',enterLobby);$('nav-heroes').addEventListener('click',()=>{closeDialog();});
function closeDialog(){dialog.close();resetInput();audio.setPaused(screen!=='game');lastFrame=performance.now();save();}
$('close-dialog').addEventListener('click',closeDialog);dialog.addEventListener('cancel',()=>{resetInput();save();});dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeDialog();}});
function openMenu(type){
  resetInput();const content=$('dialog-content');$('dialog-eyebrow').textContent=type==='settings'?'MAKE IT YOURS':type==='journal'?'THE FIRST LIGHT':'TAKE A BREATH';$('dialog-title').textContent=type==='settings'?'World & settings':type==='journal'?'Your journal':'A moment of quiet';
  if(type==='settings'){
    content.innerHTML=`<label class="setting-row"><span>Graphics<small>Auto adapts resolution and shadows to keep the world responsive.</small></span><select id="quality-select"><option value="auto">Auto</option><option value="low">Performance</option><option value="balanced">Balanced</option><option value="high">High</option></select></label><label class="setting-row"><span>Time of day <output id="time-value">${formatTime(preferences.time)}</output><small>Sunrise at 06:00, sunset at 18:00. A full day takes 20 minutes of play; menus pause time.</small></span><input id="time-setting" type="range" min="0" max="24" step=".25" aria-label="Time of day"></label><label class="setting-row"><span>Enable audio</span><input id="sound-setting" type="checkbox"></label>${["master","effects","ambience","music"].map(channel=>`<label class="setting-row"><span>${channel[0].toUpperCase()+channel.slice(1)} volume</span><input id="volume-${channel}" type="range" min="0" max="1" step=".05" value="${preferences.volumes[channel]}" aria-label="${channel[0].toUpperCase()+channel.slice(1)} volume"></label>`).join('')}<label class="setting-row"><span>Show frame rate</span><input id="fps-setting" type="checkbox"></label><div class="setting-row"><span>Control layout<small>Put the joystick and the buttons where your thumbs actually land. Drag them anywhere, then press Done.</small></span><button id="layout-edit" class="layout-edit">Rearrange</button></div><p class="credits-note"><a href="./assets/audio/CREDITS.md" target="_blank" rel="noopener">Sound recording and music credits</a>. City environment: City Set — Proto Series. Starter heroes made for Astra. Rei and Arthur are your existing imported models and load only when selected.</p>`;
    $('quality-select').value=preferences.quality;$('quality-select').onchange=e=>{preferences.quality=e.target.value;resolutionScale=1;applyQuality(preferences.quality==='auto'?(touch?'balanced':'high'):preferences.quality);lastAdapt=time;save();};
    $('time-setting').value=preferences.time;$('time-setting').oninput=e=>{setTime(Number(e.target.value));dirtySave=true;};$('sound-setting').checked=preferences.sound;$('sound-setting').onchange=e=>{preferences.sound=e.target.checked;audio.setEnabled(preferences.sound);if(preferences.sound)enableAudio();save();};$('fps-setting').checked=preferences.showFPS;$('fps-setting').onchange=e=>{preferences.showFPS=e.target.checked;$('performance-readout').hidden=!preferences.showFPS;save();};
    for(const channel of ['master','effects','ambience','music'])$('volume-'+channel).oninput=e=>{preferences.volumes[channel]=Number(e.target.value);audio.setVolumes(preferences.volumes);save();};
    $('layout-edit').onclick=()=>{closeDialog();editLayout(true);};
  }else if(type==='journal'){
    const q=questStage();content.innerHTML=`<p class="dialog-copy">An old light sleeps beneath the city. Gather its scattered pieces, quiet the restless wisps, and bring the Moonwell back to life.</p>`+questTitles.slice(0,3).map((title,i)=>`<div class="journal-entry ${i>q?'locked':''}"><span>${i<q?'✓':i===q?'◇':'·'}</span><div><h3>${title}</h3><p>${questDescriptions[i]}</p><div class="journal-reward">${i===0?`${Math.min(5,progress.collected.size)} / 5 shards · 15 XP per shard`:i===1?`${Math.min(3,progress.kills)} / 3 wisps · 35 XP per wisp`:`${progress.restored?'RESTORED':'BLUE MARKER'} · 150 XP`}</div></div></div>`).join('')+`<p class="dialog-copy">Rest near the golden camp marker to recover health. The map shows shards in gold, wisps in violet, and you in ivory.</p>`;
  }else{
    content.innerHTML='<p class="dialog-copy">The city will wait. Your progress is saved on this device.</p><div class="menu-buttons"><button id="resume-button" class="primary-button">Return to adventure</button><button id="menu-lobby">Choose another adventurer</button><button id="menu-settings">World & settings</button></div><div class="control-list"><kbd>WASD / ARROWS</kbd><span>Move · Shift to sprint</span><kbd>SPACE</kbd><span>Jump</span><kbd>Q / CLICK</kbd><span>Attack the nearest wisp</span><kbd>E</kbd><span>Signature ability · 7 second recharge</span><kbd>F</kbd><span>Interact ? climb, push, ride / dismount, restore shrine</span><kbd>L / R / C</kbd><span>Target lock / aim / cinematic camera</span><kbd>V</kbd><span>Camera view · follow, shoulder, wide, overhead</span><kbd>1 · 2 · 3 · 4</kbd><span>Emote · dance, nod, shake, sad · imported adventurers only</span><kbd>DRAG / SCROLL</kbd><span>Look around / zoom</span></div>';
    $('resume-button').onclick=closeDialog;$('menu-lobby').onclick=enterLobby;$('menu-settings').onclick=()=>openMenu('settings');
  }
  audio.setPaused(true);if(!dialog.open)dialog.showModal();
}
$('settings-button').onclick=()=>openMenu('settings');$('nav-journal').onclick=$('journal-button').onclick=()=>openMenu('journal');$('pause-button').onclick=()=>openMenu('pause');

function respawnPlayer(){
  health=100;activities.mount.mounted=false;position.copy(spawn);locomotion.reset();lockTarget=null;aiming=cinematic=false;
  followCamera.reset(position,yaw,pitch,radius);combatMemory=0;audio.play('hit',{volume:.5});
  enemies.forEach(e=>{if(e.alive)e.group.position.set(e.x,groundHeight(e.x,e.z)+(e.rig?0:1.4),e.z);});
  toast('The city shelters you. Your journey continues.');
}
function updatePlayer(dt){
  let x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+joyX;
  let z=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+joyY;
  const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
  const run=sprinting||keys.has('ShiftLeft')||keys.has('ShiftRight'),mounted=activities.mount.mounted;
  const movementYaw=lockTarget?followCamera.yaw:yaw;
  const wx=Math.cos(movementYaw)*x+Math.sin(movementYaw)*z,wz=-Math.sin(movementYaw)*x+Math.cos(movementYaw)*z;
  locomotion.radius=mounted?.85:.52;
  locomotion.update(dt,{x:wx,z:wz,magnitude:Math.min(1,length),walk:!run,sprint:run,heroSpeed:heroMeta.speed,speedScale:mounted?1.65:aiming?.65:1,attacking:attackTimer>heroMeta.cooldown*.45,hurt:hurtTimer>.9,climbDirection:-z});
  const bounds=world.bounds;position.x=clamp(position.x,bounds.minX+1,bounds.maxX-1);position.z=clamp(position.z,bounds.minZ+1,bounds.maxZ-1);
  propPhysics.update(dt);
  for(const event of locomotion.events){
    if(event.type==='land'&&event.speed>13){health=Math.max(0,health-(event.speed-13)*4);hurtTimer=.8;audio.play('hit',{volume:.6});}
  }
  if(health<=0){respawnPlayer();return;}
  const floor=locomotion.groundHeight;
  avatar.position.copy(position);if(mounted)avatar.position.y+=2.35;
  const facing=lockTarget?.alive?Math.atan2(lockTarget.group.position.x-position.x,lockTarget.group.position.z-position.z):aiming?yaw+Math.PI:Math.atan2(velocity.x,velocity.z);
  if((locomotion.speed>.2||lockTarget||aiming)&&attackTimer<=0)avatar.rotation.y+=Math.atan2(Math.sin(facing-avatar.rotation.y),Math.cos(facing-avatar.rotation.y))*(1-Math.exp(-14*dt));
  if(mounted){activities.mount.position.copy(position);activities.mount.group.rotation.y=avatar.rotation.y;}
  if(locomotion.climbing)avatar.rotation.y=Math.PI;
  if(emoting&&(time>emoteUntil||length>.08||attackTimer>0||!locomotion.grounded))emoting=null;
  hero.animate(dt,{speed:mounted?0:locomotion.speed,moving:!mounted&&length>.08,sprinting:run,jumping:!locomotion.grounded&&!locomotion.climbing,attacking:attackTimer>heroMeta.cooldown*.45,state:emoting||(mounted?'Ride':locomotion.state),time});
  if(Math.hypot(position.x-camp.x,position.z-camp.z)<12)health=Math.min(100,health+dt*12);
  const interaction=nearbyInteraction();$('interaction-hint').hidden=!interaction;if(interaction)$('interaction-text').textContent=interaction.label;
  attackTimer=Math.max(0,attackTimer-dt);abilityTimer=Math.max(0,abilityTimer-dt);hurtTimer=Math.max(0,hurtTimer-dt);
  combatMemory=Math.max(0,combatMemory-dt);victoryTime=Math.max(0,victoryTime-dt);
  $('ability-cooldown').style.height=`${abilityTimer/7*100}%`;
  let nearestThreat=Infinity;
  for(const e of enemies){
    if(!e.alive){
      if(e.dying>0){e.dying=Math.max(0,e.dying-dt);e.rig?.animate(dt,{state:'Dead',time});e.ragdoll.update(dt);if(e.dying===0)e.group.visible=false;}
      e.respawn=Math.max(0,e.respawn-dt);
      if(e.respawn===0&&e.dying===0&&Math.hypot(position.x-e.x,position.z-e.z)>RESPAWN_CLEARANCE)revive(e);
      continue;
    }
    e.hit=Math.max(0,e.hit-dt);e.swing=Math.max(0,e.swing-dt);
    const dx=position.x-e.group.position.x,dz=position.z-e.group.position.z,d=Math.hypot(dx,dz);
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
  const threat=nearestThreat<10||combatMemory>0?'combat':victoryTime>0?'victory':nearestThreat<26?'suspicion':'exploration';
  audio.setPaused(false);
  audio.update(dt,position,'city',{...locomotion.getStats(),events:locomotion.events,surface:locomotion.inWater?'water':'stone',state:locomotion.state,mounted}, {sources:activities.sources,threat});
  syncCameraControls();
}
function updateShards(){
  for(let i=0;i<shardPositions.length;i++){
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
    const view=currentView();
    if(settling>0){
      settling=Math.max(0,settling-dt);
      pitch=damp(pitch,view.pitch,7,dt);
      radius=damp(radius,view.radius,7,dt);
    }
    const mode=activities.mount.mounted?'mount':cinematic?'cinematic':aiming?'aim':'follow';
    followCamera.update(dt,position,yaw,pitch,radius,{mode,lockTarget:mode==='follow'?lockTarget:null,height:view.height||1.9,shoulder:view.shoulder||0,fov:view.fov,speed:locomotion.speed,cinematicTime:reducedMotion?0:time});
    if(lockTarget&&!followCamera.locked)lockTarget=null;
    if(lockTarget){
      const marker=targetPoint.copy(lockTarget.group.position);marker.y+=4;marker.project(camera);
      $('target-marker').hidden=marker.z>1||marker.z< -1; $('target-marker').style.left=`${(marker.x*.5+.5)*100}%`;$('target-marker').style.top=`${(-marker.y*.5+.5)*100}%`;
    }else $('target-marker').hidden=true;

  }
}
const map=$('minimap').getContext('2d');
function drawMap(){
  map.clearRect(0,0,180,180);map.fillStyle='#343c40';map.fillRect(0,0,180,180);
  const bounds=world.bounds,scale=160/Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ);
  const px=x=>90+(x-(bounds.minX+bounds.maxX)/2)*scale,pz=z=>90+(z-(bounds.minZ+bounds.maxZ)/2)*scale;
  map.fillStyle='#b5b8ad66';
  for(const c of world.colliders){
    if(c.r!==undefined){map.beginPath();map.arc(px(c.x),pz(c.z),c.r*scale,0,Math.PI*2);map.fill();}
    else map.fillRect(px(c.x-c.w/2),pz(c.z-c.d/2),c.w*scale,c.d*scale);
  }
  for(const l of world.landmarks){map.fillStyle=l.color;map.fillRect(px(l.x)-3,pz(l.z)-3,6,6);}
  map.fillStyle='#deca88';for(let i=0;i<shardPositions.length;i++){if(progress.collected.has(i))continue;map.beginPath();map.arc(px(shardPositions[i][0]),pz(shardPositions[i][1]),1.9,0,Math.PI*2);map.fill();}
  map.fillStyle='#c9a1e2';for(const e of enemies){if(!e.alive)continue;map.beginPath();map.arc(px(e.group.position.x),pz(e.group.position.z),2.5,0,Math.PI*2);map.fill();}
  map.save();map.translate(px(position.x),pz(position.z));map.rotate(-avatar.rotation.y);map.fillStyle='#fff6d6';map.beginPath();map.moveTo(0,6);map.lineTo(-4,-4);map.lineTo(4,-4);map.closePath();map.fill();map.restore();
}

let lastFrame=performance.now(),nextFrame=0,uiTime=0,renderInfo={calls:0,triangles:0};
function animate(now){
  if(contextLost||document.hidden)return;
  // Avoid driving a phone's 120/144 Hz panel at full GPU load. Menus need fewer frames.
  const interval=1000/(dialog.open?15:60);
  if(now<nextFrame)return;
  nextFrame=now-((now-nextFrame)%interval)+interval;
  const raw=Math.max(0,(now-lastFrame)/1000);lastFrame=now;const dt=Math.min(raw,.08);time+=dt;
  if(!dialog.open){
    if(screen==='game'){setTime(preferences.time+dt*24/DAY_LENGTH_SECONDS);dirtySave=true;}
    if(screen==='game'&&hero){const steps=Math.max(1,Math.ceil(dt/.025));for(let i=0;i<steps;i++)updatePlayer(dt/steps);}
    else if(hero){avatar.position.copy(spawn).y+=.22;avatar.rotation.y=previewYaw;hero.animate(dt,{speed:0,time:reducedMotion?0:time});}
    activities.root.visible=screen==='game';activities.update(dt,reducedMotion?0:time,locomotion.speed);
    world.update(dt,reducedMotion?0:time,screen==='game'?position:avatar.position);updateShards();
    pulseAge+=dt;boltAge+=dt;pulse.scale.setScalar(1+pulseAge*pulseSize*2);pulse.material.opacity=Math.max(0,1-pulseAge*2);pulse.visible=pulseAge<.5;bolt.material.opacity=Math.max(0,1-boltAge*5);bolt.visible=boltAge<.2;
    updateCamera(dt);
  }
  audio.setPaused(dialog.open||screen!=='game'||contextLost||document.hidden);
  const avatarFloor=groundHeight(avatar.position.x,avatar.position.z);
  blob.position.set(avatar.position.x,avatarFloor+(screen==='lobby'?.225:.045),avatar.position.z);blob.material.opacity=screen==='game'?Math.max(.2,1-(position.y-avatarFloor)*.15):.8;
  atmosphere.update(dt,reducedMotion?0:time,camera.position);
  renderer.render(scene,camera);renderInfo={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
  uiTime+=dt;if(uiTime>.15){uiTime=0;if(screen==='game'){updateHUD();drawMap();const landmark=world.landmarks.find(l=>Math.hypot(position.x-l.x,position.z-l.z)<20);$('region-name').textContent=landmark?landmark.name:"City Quarter";$('world-clock').textContent=`CITY · ${formatTime(preferences.time)}`;}}
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
Object.defineProperty(window,'__ASTRA_DEBUG__',{get:()=>({screen,hero:heroMeta.id,ready:!!hero,switching,paused:dialog.open,quality,pixelRatio:renderer.getPixelRatio(),fps:Math.round(1000/frameMS),position:{x:position.x,y:position.y,z:position.z},progress:{xp:progress.xp,kills:progress.kills,shards:progress.collected.size,quest:questStage()},health,enemies:enemies.filter(e=>e.alive).length,enemyModel:enemies.filter(e=>e.rig).length,heroRuntime:hero?.diagnostics||null,terrain:{...world.diagnostics,height:groundHeight(position.x,position.z)},atmosphere:atmosphere.diagnostics,locomotion:locomotion.getStats(),audio:audio.getStats(),activities:activities.getStats(),physics:{bodies:propPhysics.bodies.length,moving:propPhysics.bodies.filter(body=>!body.sleeping).length},camera:{...followCamera.getStats(),view:currentView().id,name:currentView().name,pitch,radius,fov:camera.fov,settling},render:renderInfo,input:{joyX,joyY,sprinting,keys:[...keys]}})});
try{
  await selectHero(HEROES.some(h=>h.id===saved.hero)?saved.hero:'warden');
  if(!hero)await selectHero('warden');
  updateHUD();updateCamera(1);updateShards();$('performance-readout').hidden=!preferences.showFPS;
  if(renderer.compileAsync)await Promise.race([renderer.compileAsync(scene,camera),new Promise(resolve=>setTimeout(resolve,8000))]);
  window.astraReady=true;$('loading').classList.add('finished');setTimeout(()=>$('loading').hidden=true,600);
  lastFrame=performance.now();renderer.setAnimationLoop(animate);
}catch(error){console.error(error);$('load-message').textContent='This device could not start the 3D world. Try again with a WebGL-enabled browser.';$('retry-button').hidden=false;}
