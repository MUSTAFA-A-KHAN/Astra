import * as THREE from 'three';
import { createWorld } from './world.js';
import { HEROES, createHero } from './characters.js';
import { createStreamedTerrain } from './terrain.js';
import { AssetManager } from './asset-manager.js';
import { AnimationManager } from './animation-manager.js';
import { CharacterManager } from './character-manager.js';
import { GraphicsQualityManager } from './graphics-quality-manager.js';
import { LODManager } from './lod-manager.js';
import { LoadingManager } from './loading-manager.js';
import { CacheManager } from './cache-manager.js';

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
const preferences = { quality: ['auto','low','balanced','high'].includes(saved.quality) ? saved.quality : 'auto', sound: saved.sound !== false, showFPS: saved.showFPS === true, time: finite(saved.time, 15.5, 0, 24) };
let hero = null, heroMeta = HEROES[0], screen = 'lobby', switching = false, sessionStarted = false, contextLost = false, streamedTerrain = null;
const cacheManager = new CacheManager();
const loadingManager = new LoadingManager({ element: document.getElementById('character-loading'), textElement: document.getElementById('character-loading-text') });
const assetManager = new AssetManager({ onProgress: ({ url, progress }) => loadingManager.update(url, progress, `Loading asset · ${Math.round(progress * 100)}%`) });
const animationManager = new AnimationManager(assetManager);
let toastTimeout, audioContext, time = 0, health = 100, attackTimer = 0, abilityTimer = 0, hurtTimer = 0, jumpVelocity = 0;
let lastSave = 0, dirtySave = false, previewYaw = .23;
const level = () => Math.floor(progress.xp / 150) + 1;
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...preferences, xp: progress.xp, kills: progress.kills, restored: progress.restored, collected: [...progress.collected], hero: heroMeta.id })); dirtySave = false; }
  catch { /* Private browsing and full storage must never stop play. */ }
}
function toast(message) { $('toast-text').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 3800); }
function sound(frequency = 540, length = .12, type = 'sine') {
  if (!preferences.sound || !audioContext || audioContext.state !== 'running') return;
  const osc = audioContext.createOscillator(), gain = audioContext.createGain();
  osc.type = type; osc.frequency.setValueAtTime(frequency, audioContext.currentTime); osc.frequency.exponentialRampToValueAtTime(frequency * .55, audioContext.currentTime + length);
  gain.gain.setValueAtTime(.045, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + length);
  osc.connect(gain); gain.connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + length); osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}
function enableAudio() { if (!preferences.sound) return; try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume().catch(() => {}); } catch {} }

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
const world = createWorld(scene, { lowPower: touch });
const characterManager = new CharacterManager({ assetManager, animationManager, heroes: HEROES, createBuiltin: createHero });

try {
  streamedTerrain = await createStreamedTerrain(scene, camera, renderer, { token: window.ASTRA_CESIUM_ION_TOKEN || '' });
} catch (error) {
  console.warn('Streamed terrain unavailable; using Astra fallback terrain.', error);
  streamedTerrain = null;
}
graphicsQualityManager.streamedTerrain = streamedTerrain;
const avatar = new THREE.Group(); scene.add(avatar); avatar.position.set(0, 0, 18);
const position = new THREE.Vector3(0, 0, 18), velocity = new THREE.Vector3();
const stage = new THREE.Group(); stage.position.set(0, 0, 18); scene.add(stage);
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 3.05, .3, 48), new THREE.MeshStandardMaterial({ color: '#627365', roughness: .88 })); pedestal.position.y = .06; pedestal.receiveShadow = true; stage.add(pedestal);
const stageRing = new THREE.Mesh(new THREE.TorusGeometry(2.53, .025, 5, 64), new THREE.MeshBasicMaterial({ color: '#e2d29d' })); stageRing.rotation.x = Math.PI / 2; stageRing.position.y = .22; stage.add(stageRing);
const blobCanvas = document.createElement('canvas'); blobCanvas.width = blobCanvas.height = 64;
const blobCtx = blobCanvas.getContext('2d'); const gradient = blobCtx.createRadialGradient(32,32,0,32,32,32); gradient.addColorStop(0,'#061d17aa'); gradient.addColorStop(1,'#061d1700'); blobCtx.fillStyle = gradient; blobCtx.fillRect(0,0,64,64);
const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.4,3.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blobCanvas), transparent: true, depthWrite: false })); blob.rotation.x = -Math.PI / 2; scene.add(blob);

// Static obstacle buckets limit collision checks to objects near the player.
const buckets = new Map(), cellSize = 16;
for (const c of world.colliders) {
  const extent = c.r ?? Math.max(c.w, c.d) / 2;
  for (let x = Math.floor((c.x-extent-1)/cellSize); x <= Math.floor((c.x+extent+1)/cellSize); x++) for (let z = Math.floor((c.z-extent-1)/cellSize); z <= Math.floor((c.z+extent+1)/cellSize); z++) { const key = `${x},${z}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(c); }
}
function collide(p, radius = .65) {
  const nearby = buckets.get(`${Math.floor(p.x/cellSize)},${Math.floor(p.z/cellSize)}`) || [];
  for (const c of nearby) {
    if (c.r !== undefined) { const dx=p.x-c.x,dz=p.z-c.z, min=c.r+radius, d=Math.hypot(dx,dz); if (d<min) { p.x=c.x+(d>0?dx/d:1)*min; p.z=c.z+(d>0?dz/d:0)*min; } }
    else { const nx=clamp(p.x,c.x-c.w/2,c.x+c.w/2),nz=clamp(p.z,c.z-c.d/2,c.z+c.d/2),dx=p.x-nx,dz=p.z-nz,d=Math.hypot(dx,dz); if(d<radius) { if(d>.001){p.x=nx+dx/d*radius;p.z=nz+dz/d*radius;}else{p.z=c.z+c.d/2+radius;} } }
  }
  p.x=clamp(p.x,-125,125); p.z=clamp(p.z,-125,125);
}

const QUALITY = { low:{ratio:1,shadows:false}, balanced:{ratio:1.35,shadows:true}, high:{ratio:1.8,shadows:true} };
const graphicsQualityManager = new GraphicsQualityManager({ renderer, sun, world, streamedTerrain: null, touchDevice: touch });
const lodManager = new LODManager({ camera, high: 20, medium: 48, far: 90 });
let quality = touch ? 'balanced' : 'high', resolutionScale = 1, frameMS = 16.7, frameSamples = 0, sampleTime = 0, lastAdapt = 0;
function applyQuality(value, adaptive = false) {
  quality = value;
  graphicsQualityManager.resolutionScale = resolutionScale;
  graphicsQualityManager.apply(value, adaptive);
  $('quality-status').textContent = `${preferences.quality === 'auto' ? 'Adaptive' : 'Graphics'} · ${value === 'low' ? 'Performance' : value === 'high' ? 'High' : 'Balanced'}`;
  if (adaptive) lastAdapt = time;
}
applyQuality(preferences.quality === 'auto' ? quality : preferences.quality);
function setTime(hour) {
  preferences.time = hour; const day=clamp(Math.sin((hour-6)/12*Math.PI)*1.4,0,1);
  const dusk = hour > 15 && hour < 20;
  scene.background.set(day > .2 ? (dusk ? '#a9b6a3' : '#9ebfc0') : '#26394e'); scene.fog.color.copy(scene.background);
  hemi.intensity = .85+day*1.7; sun.intensity=.25+day*3; sun.color.set(dusk ? '#ffcf93' : '#ffe5bd');
  portraitLight.intensity = screen === 'lobby' ? 1.6 : .4;
  world.setTime(hour); streamedTerrain?.setTime?.(hour);
}
setTime(preferences.time);

const sigils = [ '<path d="m16 3 11 4v14L16 31 5 21V7Z M16 8v16m-5-10h10"/>', '<path d="M11 3c20 8 20 20 0 28L11 3Zm0 14h18m-4-4 4 4-4 4"/>', '<path d="m16 2 7 9-7 9-7-9Zm0 18v11M6 5 3 2m23 3 3-3M5 19l-3 3m25-3 3 3"/>', '<path d="m16 2 12 14-12 14L4 16Zm0 7 6 7-6 7-6-7Z"/>', '<path d="M3 19h26M7 19 11 7h10l4 12M9 24h14M11 29h10"/>' ];
$('character-roster').innerHTML = HEROES.map((h,i)=>`<button class="character-card" data-hero="${h.id}" aria-label="Select ${h.name}, ${h.title}${h.imported ? `, optional ${h.size} download` : ''}" aria-pressed="false" style="--hero-color:${h.color}"><span class="character-sigil"><svg viewBox="0 0 32 34" aria-hidden="true">${sigils[i]}</svg></span><span><strong>${h.name}</strong><small>${h.imported ? h.size+' · GUEST' : h.role.toUpperCase()}</small></span></button>`).join('');
function updateHeroUI() {
  $('hero-name').replaceChildren(document.createTextNode(heroMeta.name), Object.assign(document.createElement('span'),{textContent:heroMeta.title}));
  $('hero-role').textContent=heroMeta.weapon.toUpperCase(); $('hero-description').textContent=heroMeta.description;
  $('hero-ability').textContent=heroMeta.ability; $('hud-name').textContent=heroMeta.name; $('player-emblem').textContent=heroMeta.name[0];
  $('preview-label').textContent=`${heroMeta.name.toUpperCase()} · LEVEL ${String(level()).padStart(2,'0')}`;
  $('hero-stats').innerHTML=Object.entries(heroMeta.stats).map(([name,value])=>`<div class="hero-stat"><div><small>${name.toUpperCase()}</small><strong>${value}</strong></div><div class="stat-track"><i style="width:${value}%"></i></div></div>`).join('');
  $('ability-label').textContent=heroMeta.id==='ranger'?'Gale':heroMeta.id==='warden'?'Sunsteel':'Pulse';
  document.querySelectorAll('[data-hero]').forEach(b=>{ const selected=b.dataset.hero===heroMeta.id; b.classList.toggle('selected',selected); b.setAttribute('aria-pressed',String(selected)); });
  $('roster-count').textContent=`${String(HEROES.indexOf(heroMeta)+1).padStart(2,'0')} / 05`;
}
async function selectHero(id) {
  if (switching || (hero && heroMeta.id === id)) return;
  switching = true;
  $('play-button').disabled = true;
  const meta = HEROES.find(h => h.id === id) || HEROES[0];

  loadingManager.begin(meta.id, meta.imported
    ? `Loading ${meta.name} · ${meta.size}…`
    : 'Preparing adventurer…');
  $('character-loading').hidden = false;

  try {
    const next = await characterManager.load(meta.id);
    if (hero && hero.group !== next.group) {
      avatar.remove(hero.group);
    }
    hero = next;
    heroMeta = meta;
    if (hero.group.parent !== avatar) avatar.add(hero.group);
    lodManager.register(hero.group, { high: 22, medium: 55, far: 95 });
    previewYaw = .23;
    updateHeroUI();
    save();
  } catch (error) {
    console.warn('Character unavailable:', error);
    toast('That adventurer could not load. Your current hero is ready.');
  } finally {
    switching = false;
    loadingManager.end(meta.id);
    $('character-loading').hidden = true;
    $('play-button').disabled = !hero;
  }
}

('character-roster').addEventListener('click',e=>{const b=e.target.closest('[data-hero]');if(b)selectHero(b.dataset.hero);});

// Collectibles share one mesh, material, and GPU buffer.
const shardPositions = [[0,9],[1,0],[-1,-10],[2,-20],[0,-32],[-12,9],[-23,16],[-35,23],[-42,34],[-49,17],[14,-7],[25,-13],[36,-17],[47,-26],[55,-12],[-15,-42],[16,-43],[-28,-60],[30,-63],[60,30],[-65,-10],[66,-48],[-25,60],[25,48]];
const shardMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.48),new THREE.MeshStandardMaterial({color:'#c1f6df',emissive:'#43a995',emissiveIntensity:.8,metalness:.2,roughness:.25}),shardPositions.length); shardMesh.frustumCulled=false; scene.add(shardMesh);
const dummy=new THREE.Object3D();
const enemyGeo=new THREE.IcosahedronGeometry(.85,1),enemyMat=new THREE.MeshStandardMaterial({color:'#9380b0',emissive:'#3c235c',emissiveIntensity:.65,roughness:.5});
const eyeGeo=new THREE.SphereGeometry(.12,6,4),eyeMat=new THREE.MeshBasicMaterial({color:'#ffdbaf'});
const enemies=[[-9,-17],[12,-30],[-17,-38],[28,-24],[-33,-12],[45,-42]].map(([x,z],i)=>{
  const group=new THREE.Group(),core=new THREE.Mesh(enemyGeo,enemyMat); group.add(core);
  for(const side of [-1,1]){const eye=new THREE.Mesh(eyeGeo,eyeMat);eye.position.set(side*.27,.18,.72);group.add(eye);}
  group.position.set(x,1.4,z);scene.add(group);return{group,core,x,z,hp:80,index:i,hit:0,alive:true};
});
const effectGroup=new THREE.Group();scene.add(effectGroup);
const pulse=new THREE.Mesh(new THREE.TorusGeometry(1,.045,5,40),new THREE.MeshBasicMaterial({color:'#c3f0d5',transparent:true,opacity:0,depthWrite:false}));pulse.rotation.x=-Math.PI/2;effectGroup.add(pulse);
let pulseAge=2,pulseSize=5;
const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,1,6),new THREE.MeshBasicMaterial({color:'#e3eec0',transparent:true,opacity:0,depthWrite:false}));effectGroup.add(bolt);let boltAge=1;
const direction=new THREE.Vector3(),targetPoint=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
function showPulse(x,z,size,color) { pulse.position.set(x,.3,z);pulse.material.color.set(color);pulseAge=0;pulseSize=size; }
function gainXP(amount) {const previous=level();progress.xp+=amount;dirtySave=true;if(level()>previous){health=100;toast(`Level ${level()} · Your light grows stronger`);sound(880,.3);}updateHUD();}
function questStage(){return progress.restored?3:progress.collected.size<5?0:progress.kills<3?1:2;}
const questTitles=['A glimmer in the green','Quiet the restless','Awaken the Moonwell','A light returned'];
const questDescriptions=['Collect 5 glowing shards along the old paths.','Defeat 3 wandering wisps. Approach, then attack.','Follow the path north. Restore the blue shrine.','The Reach is at peace. Keep exploring the wilds.'];
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
  const range=special?heroMeta.range+5:heroMeta.range,damage=(special?heroMeta.damage*2:heroMeta.damage)+(level()-1)*3;
  let nearest=null,best=range;
  for(const e of enemies){if(!e.alive)continue;const d=Math.hypot(e.group.position.x-position.x,e.group.position.z-position.z);if(d<best){nearest=e;best=d;}}
  if(nearest){avatar.rotation.y=Math.atan2(nearest.group.position.x-position.x,nearest.group.position.z-position.z);}
  const targets=special?enemies.filter(e=>e.alive&&Math.hypot(e.group.position.x-position.x,e.group.position.z-position.z)<range):nearest?[nearest]:[];
  for(const e of targets){e.hp-=damage;e.hit=.3;if(e.hp<=0){e.alive=false;e.group.visible=false;progress.kills++;gainXP(35);toast(`Wisp released · +35 experience${progress.kills===3?' · Return to the Moonwell':''}`);}}
  if(special){showPulse(position.x,position.z,range,heroMeta.color);if(heroMeta.id==='warden'){health=Math.min(100,health+20);updateHUD();}}
  else if(nearest){targetPoint.copy(nearest.group.position);direction.copy(targetPoint).sub(position).add(new THREE.Vector3(0,-1.6,0));bolt.position.copy(position).add(new THREE.Vector3(0,1.6,0)).addScaledVector(direction,.5);bolt.scale.set(1,direction.length(),1);bolt.quaternion.setFromUnitVectors(up,direction.normalize());bolt.material.color.set(heroMeta.color);boltAge=0;}
  else showPulse(position.x,position.z,2.5,heroMeta.color);
  sound(special?360:680,special?.3:.1,'triangle');updateHUD();
}
function interact(){if(screen!=='game'||dialog.open)return;if(questStage()===2&&Math.hypot(position.x,position.z+50)<10){progress.restored=true;gainXP(150);save();showPulse(0,-50,22,'#b8f3e0');toast('The Moonwell awakens · Chapter complete · +150 experience');sound(900,.6);}}

const keys=new Set();let joyX=0,joyY=0,joyId=null,sprinting=false,dragId=null,dragX=0,dragY=0,dragDistance=0;
let yaw=0,pitch=.48,radius=14;
const cameraTarget=new THREE.Vector3(),cameraDesired=new THREE.Vector3();
const dialog=$('menu-dialog');
function resetInput(){keys.clear();joyX=joyY=0;joyId=null;sprinting=false;dragId=null;velocity.set(0,0,0);$('joystick-knob').style.transform='';}
addEventListener('keydown',e=>{
  if(dialog.open){if(e.code==='Escape'){e.preventDefault();closeDialog();}return;}
  if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
  if(screen!=='game')return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  keys.add(e.code);if(e.repeat)return;
  if(e.code==='Space')jump();if(e.code==='KeyQ')attack();if(e.code==='KeyE')attack(true);if(e.code==='KeyF')interact();if(e.code==='Escape'||e.code==='KeyP')openMenu('pause');if(e.code==='KeyJ')openMenu('journal');
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>{resetInput();if(screen==='game'&&!dialog.open)openMenu('pause');save();});
addEventListener('pagehide',save);
document.addEventListener('visibilitychange',()=>{resetInput();if(document.hidden){save();renderer.setAnimationLoop(null);if(screen==='game'&&!dialog.open)openMenu('pause');}else{lastFrame=performance.now();if(!contextLost)renderer.setAnimationLoop(animate);}});
function jump(){if(screen==='game'&&!dialog.open&&position.y<=.001)jumpVelocity=8;}
renderer.domElement.addEventListener('pointerdown',e=>{if(dialog.open||dragId!==null)return;dragId=e.pointerId;dragX=e.clientX;dragY=e.clientY;dragDistance=0;renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove',e=>{if(e.pointerId!==dragId)return;const dx=e.clientX-dragX,dy=e.clientY-dragY;dragDistance+=Math.abs(dx)+Math.abs(dy);dragX=e.clientX;dragY=e.clientY;if(screen==='lobby')previewYaw+=dx*.009;else{yaw-=dx*.005;pitch=clamp(pitch+dy*.004,.18,1.08);}});
renderer.domElement.addEventListener('pointerup',e=>{if(e.pointerId!==dragId)return;if(dragDistance<7&&e.pointerType==='mouse'&&e.button===0)attack();dragId=null;});
renderer.domElement.addEventListener('pointercancel',()=>dragId=null);renderer.domElement.addEventListener('lostpointercapture',()=>dragId=null);
renderer.domElement.addEventListener('wheel',e=>{if(screen==='game'){radius=clamp(radius+e.deltaY*.014,7,25);e.preventDefault();}},{passive:false});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
const joystick=$('joystick');let joyCenterX=0,joyCenterY=0;
function moveJoy(e){const max=joystick.clientWidth*.34,dx=e.clientX-joyCenterX,dy=e.clientY-joyCenterY,length=Math.hypot(dx,dy),scale=length>max?max/length:1;joyX=dx*scale/max;joyY=dy*scale/max;if(length<5)joyX=joyY=0;$('joystick-knob').style.transform=`translate(${dx*scale}px,${dy*scale}px)`;}
joystick.addEventListener('pointerdown',e=>{if(joyId!==null||dialog.open)return;joyId=e.pointerId;const b=joystick.getBoundingClientRect();joyCenterX=b.left+b.width/2;joyCenterY=b.top+b.height/2;joystick.setPointerCapture(e.pointerId);moveJoy(e);e.preventDefault();});
joystick.addEventListener('pointermove',e=>{if(e.pointerId===joyId)moveJoy(e);});
function endJoy(e){if(e.pointerId===joyId){joyId=null;joyX=joyY=0;$('joystick-knob').style.transform='';}}
for(const event of ['pointerup','pointercancel','lostpointercapture'])joystick.addEventListener(event,endJoy);
const sprint=$('sprint-button');sprint.addEventListener('pointerdown',e=>{sprinting=true;sprint.setPointerCapture(e.pointerId);e.preventDefault();});for(const event of ['pointerup','pointercancel','lostpointercapture'])sprint.addEventListener(event,()=>sprinting=false);
$('attack-button').addEventListener('click',()=>attack());$('ability-button').addEventListener('click',()=>attack(true));$('jump-button').addEventListener('click',jump);$('interact-button').addEventListener('click',interact);

function enterGame(){if(!hero||switching)return;enableAudio();screen='game';sessionStarted=true;document.body.dataset.screen=screen;$('topbar').hidden=true;$('lobby').hidden=true;$('game-hud').hidden=false;stage.visible=false;portraitLight.intensity=.4;resetInput();avatar.position.copy(position);cameraTarget.copy(position).y+=2;updateCamera(1);updateHUD();toast('Follow the glowing shards. Your journey begins.');}
function enterLobby(){closeDialog();screen='lobby';document.body.dataset.screen=screen;$('topbar').hidden=false;$('lobby').hidden=false;$('game-hud').hidden=true;stage.visible=true;portraitLight.intensity=1.6;avatar.position.set(0,.22,18);resetInput();save();updateHeroUI();$('play-button').firstElementChild.textContent=sessionStarted?'Continue journey':'Enter the wilds';}
$('play-button').addEventListener('click',enterGame);$('lobby-button').addEventListener('click',enterLobby);$('nav-heroes').addEventListener('click',()=>{closeDialog();});
function closeDialog(){dialog.close();resetInput();lastFrame=performance.now();save();}
$('close-dialog').addEventListener('click',closeDialog);dialog.addEventListener('cancel',()=>{resetInput();save();});dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeDialog();}});
function openMenu(type){
  resetInput();const content=$('dialog-content');$('dialog-eyebrow').textContent=type==='settings'?'MAKE IT YOURS':type==='journal'?'THE FIRST LIGHT':'TAKE A BREATH';$('dialog-title').textContent=type==='settings'?'World & settings':type==='journal'?'Your journal':'A moment of quiet';
  if(type==='settings'){
    content.innerHTML=`<label class="setting-row"><span>Graphics<small>Auto adapts resolution and shadows to keep the world responsive.</small></span><select id="quality-select"><option value="auto">Auto</option><option value="low">Performance</option><option value="balanced">Balanced</option><option value="high">High</option></select></label><label class="setting-row"><span>Time of day<small>Change the light across the Reach.</small></span><input id="time-setting" type="range" min="0" max="24" step=".25" aria-label="Time of day"></label><label class="setting-row"><span>Sound effects</span><input id="sound-setting" type="checkbox"></label><label class="setting-row"><span>Show frame rate</span><input id="fps-setting" type="checkbox"></label><p class="credits-note">Original world and starter heroes, made for Astra. Rei and Arthur are your existing imported models and load only when selected.</p>`;
    $('quality-select').value=preferences.quality;$('quality-select').onchange=e=>{preferences.quality=e.target.value;resolutionScale=1;applyQuality(preferences.quality==='auto'?(touch?'balanced':'high'):preferences.quality);lastAdapt=time;save();};
    $('time-setting').value=preferences.time;$('time-setting').oninput=e=>{setTime(Number(e.target.value));dirtySave=true;};$('sound-setting').checked=preferences.sound;$('sound-setting').onchange=e=>{preferences.sound=e.target.checked;if(preferences.sound)enableAudio();save();};$('fps-setting').checked=preferences.showFPS;$('fps-setting').onchange=e=>{preferences.showFPS=e.target.checked;$('performance-readout').hidden=!preferences.showFPS;save();};
  }else if(type==='journal'){
    const q=questStage();content.innerHTML=`<p class="dialog-copy">An old light sleeps beneath the forest. Gather its scattered pieces, quiet the restless wisps, and bring the Moonwell back to life.</p>`+questTitles.slice(0,3).map((title,i)=>`<div class="journal-entry ${i>q?'locked':''}"><span>${i<q?'✓':i===q?'◇':'·'}</span><div><h3>${title}</h3><p>${questDescriptions[i]}</p><div class="journal-reward">${i===0?`${Math.min(5,progress.collected.size)} / 5 shards · 15 XP per shard`:i===1?`${Math.min(3,progress.kills)} / 3 wisps · 35 XP per wisp`:`${progress.restored?'RESTORED':'NORTH · BLUE MARKER'} · 150 XP`}</div></div></div>`).join('')+`<p class="dialog-copy">Rest near the golden camp marker to recover health. The map shows shards in gold, wisps in violet, and you in ivory.</p>`;
  }else{
    content.innerHTML='<p class="dialog-copy">The forest will wait. Your progress is saved on this device.</p><div class="menu-buttons"><button id="resume-button" class="primary-button">Return to adventure</button><button id="menu-lobby">Choose another adventurer</button><button id="menu-settings">World & settings</button></div><div class="control-list"><kbd>WASD / ARROWS</kbd><span>Move · Shift to sprint</span><kbd>SPACE</kbd><span>Jump</span><kbd>Q / CLICK</kbd><span>Attack the nearest wisp</span><kbd>E</kbd><span>Signature ability · 7 second recharge</span><kbd>F</kbd><span>Restore the shrine</span><kbd>DRAG / SCROLL</kbd><span>Look around / zoom</span></div>';
    $('resume-button').onclick=closeDialog;$('menu-lobby').onclick=enterLobby;$('menu-settings').onclick=()=>openMenu('settings');
  }
  if(!dialog.open)dialog.showModal();
}
$('settings-button').onclick=()=>openMenu('settings');$('nav-journal').onclick=$('journal-button').onclick=()=>openMenu('journal');$('pause-button').onclick=()=>openMenu('pause');

function updatePlayer(dt){
  let x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+joyX;
  let z=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+joyY;
  const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
  const run=sprinting||keys.has('ShiftLeft')||keys.has('ShiftRight'),speed=heroMeta.speed*(run?1.65:1);
  const vx=(Math.cos(yaw)*x+Math.sin(yaw)*z)*speed,vz=(-Math.sin(yaw)*x+Math.cos(yaw)*z)*speed;
  velocity.x=damp(velocity.x,vx,12,dt);velocity.z=damp(velocity.z,vz,12,dt);
  position.x+=velocity.x*dt;position.z+=velocity.z*dt;collide(position);
  jumpVelocity-=23*dt;position.y=Math.max(0,position.y+jumpVelocity*dt);if(position.y===0)jumpVelocity=0;
  avatar.position.copy(position);
  if(Math.hypot(velocity.x,velocity.z)>.2&&attackTimer<=0){const target=Math.atan2(velocity.x,velocity.z);avatar.rotation.y+=Math.atan2(Math.sin(target-avatar.rotation.y),Math.cos(target-avatar.rotation.y))*(1-Math.exp(-14*dt));}
  hero.animate(dt,{speed:Math.hypot(velocity.x,velocity.z),moving:length>.08,sprinting:run,attacking:attackTimer>heroMeta.cooldown*.45,time});
  if(Math.hypot(position.x+45,position.z-25)<12)health=Math.min(100,health+dt*12);
  const nearShrine=Math.hypot(position.x,position.z+50)<10;$('interaction-hint').hidden=!(nearShrine&&questStage()===2);
  attackTimer=Math.max(0,attackTimer-dt);abilityTimer=Math.max(0,abilityTimer-dt);hurtTimer=Math.max(0,hurtTimer-dt);
  $('ability-cooldown').style.height=`${abilityTimer/7*100}%`;
  for(const e of enemies){
    if(!e.alive)continue;e.hit=Math.max(0,e.hit-dt);const dx=position.x-e.group.position.x,dz=position.z-e.group.position.z,d=Math.hypot(dx,dz);
    if(d<18&&d>1.9){e.group.position.x+=dx/d*2.9*dt;e.group.position.z+=dz/d*2.9*dt;collide(e.group.position,.8);}
    e.group.position.y=1.5+Math.sin(time*2+e.index)*.25;e.group.rotation.y=Math.atan2(dx,dz);e.core.rotation.z=Math.sin(time+e.index)*.14;e.core.scale.setScalar(e.hit>0?.8:1);
    if(d<2.5&&hurtTimer<=0&&position.y<1.5){health=Math.max(0,health-12);hurtTimer=1.2;sound(110,.14,'triangle');if(health<=0){health=100;position.set(0,0,18);velocity.set(0,0,0);enemies.forEach(enemy=>{if(enemy.alive)enemy.group.position.set(enemy.x,1.4,enemy.z);});toast('The glade shelters you. Your journey continues.');}}
  }
}
function updateShards(){
  for(let i=0;i<shardPositions.length;i++){
    const [x,z]=shardPositions[i];
    if(screen==='game'&&!dialog.open&&!progress.collected.has(i)&&Math.hypot(position.x-x,position.z-z)<2&&position.y<3){progress.collected.add(i);gainXP(15);sound(1100,.16);if(progress.collected.size===5)toast('The light gathers · Seek the restless wisps');}
    dummy.position.set(x,1.6+Math.sin(time*2+i)*.22,z);dummy.rotation.set(0,time*.7+i,.12);dummy.scale.setScalar(progress.collected.has(i)?0:1);dummy.updateMatrix();shardMesh.setMatrixAt(i,dummy.matrix);
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
    camera.position.copy(cameraDesired);camera.lookAt(cameraTarget);
  }else{
    if(camera.fov!==55){camera.fov=55;camera.updateProjectionMatrix();}
    targetPoint.copy(position);targetPoint.y+=1.9;cameraTarget.lerp(targetPoint,1-Math.exp(-9*dt));
    cameraDesired.set(cameraTarget.x+Math.sin(yaw)*Math.cos(pitch)*radius,cameraTarget.y+Math.sin(pitch)*radius,cameraTarget.z+Math.cos(yaw)*Math.cos(pitch)*radius);
    camera.position.lerp(cameraDesired,1-Math.exp(-10*dt));camera.lookAt(cameraTarget);
  }
}
const map=$('minimap').getContext('2d');
function drawMap(){
  map.clearRect(0,0,180,180);map.fillStyle='#223c2e';map.fillRect(0,0,180,180);
  const scale=.78,px=x=>90+x*scale,pz=z=>90+z*scale;map.strokeStyle='#b5b88638';map.lineWidth=4;
  map.beginPath();map.moveTo(px(0),pz(22));map.lineTo(px(0),pz(-55));map.moveTo(px(0),pz(5));map.lineTo(px(-45),pz(25));map.moveTo(px(0),pz(-5));map.lineTo(px(50),pz(-20));map.stroke();
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
    if(screen==='game'&&hero){const steps=Math.max(1,Math.ceil(dt/.025));for(let i=0;i<steps;i++)updatePlayer(dt/steps);}
    else if(hero){avatar.position.set(0,.22,18);avatar.rotation.y=previewYaw;hero.animate(dt,{speed:0,time:reducedMotion?0:time});}
    world.update(dt,reducedMotion?0:time,screen==='game'?position:avatar.position); updateShards();
    pulseAge+=dt;boltAge+=dt;pulse.scale.setScalar(1+pulseAge*pulseSize*2);pulse.material.opacity=Math.max(0,1-pulseAge*2);pulse.visible=pulseAge<.5;bolt.material.opacity=Math.max(0,1-boltAge*5);bolt.visible=boltAge<.2;
    updateCamera(dt);
  }
  streamedTerrain?.update?.();
  lodManager.update();
  blob.position.set(avatar.position.x,screen==='lobby'?.225:.045,avatar.position.z);blob.material.opacity=screen==='game'?Math.max(.2,1-position.y*.15):.8;
  sun.position.set(avatar.position.x-45,65,avatar.position.z+38);sun.target.position.set(avatar.position.x,0,avatar.position.z);sun.target.updateMatrixWorld();
  renderer.render(scene,camera);renderInfo={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
  uiTime+=dt;if(uiTime>.15){uiTime=0;if(screen==='game'){updateHUD();drawMap();const landmark=world.landmarks.find(l=>Math.hypot(position.x-l.x,position.z-l.z)<20);$('region-name').textContent=landmark?landmark.name:"Wanderer's Glade";}}
  if(raw>0&&raw<.25&&!dialog.open&&!switching){frameMS=frameMS*.96+raw*1000*.04;frameSamples++;sampleTime+=raw;}
  if(sampleTime>1){$('performance-readout').textContent=`${Math.round(1000/frameMS)} FPS · ${quality} · ${Math.round(renderer.getPixelRatio()*100)}%`;sampleTime=0;}
  if(preferences.quality==='auto'&&frameSamples>150&&time-lastAdapt>8&&frameMS>25){if(quality==='high')applyQuality('balanced',true);else if(quality==='balanced')applyQuality('low',true);else if(resolutionScale>.7){resolutionScale=Math.max(.7,resolutionScale-.1);applyQuality('low',true);}frameSamples=0;}
  if(dirtySave&&time-lastSave>3){save();lastSave=time;}
}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);updateCamera(1);}
addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;renderer.setAnimationLoop(null);resetInput();save();toast('Graphics paused. Waiting for your device to recover…');});
renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;lastFrame=performance.now();applyQuality(quality);if(!document.hidden)renderer.setAnimationLoop(animate);toast('The world is ready again.');});

// Read-only diagnostics for browser verification and device profiling.
Object.defineProperty(window,'__ASTRA_DEBUG__',{get:()=>({screen,hero:heroMeta.id,ready:!!hero,switching,paused:dialog.open,quality,pixelRatio:renderer.getPixelRatio(),fps:Math.round(1000/frameMS),position:{x:position.x,y:position.y,z:position.z},progress:{xp:progress.xp,kills:progress.kills,shards:progress.collected.size,quest:questStage()},health,enemies:enemies.filter(e=>e.alive).length,render:renderInfo,input:{joyX,joyY,sprinting,keys:[...keys]}})});
try{
  await selectHero(HEROES.some(h=>h.id===saved.hero)?saved.hero:'warden');
  if(!hero)await selectHero('warden');
  updateHUD();updateCamera(1);updateShards();$('performance-readout').hidden=!preferences.showFPS;
  if(renderer.compileAsync)await Promise.race([renderer.compileAsync(scene,camera),new Promise(resolve=>setTimeout(resolve,8000))]);
  window.astraReady=true;$('loading').classList.add('finished');setTimeout(()=>$('loading').hidden=true,600);
  lastFrame=performance.now();renderer.setAnimationLoop(animate);
}catch(error){console.error(error);$('load-message').textContent='This device could not start the 3D world. Try again with a WebGL-enabled browser.';$('retry-button').hidden=false;}
