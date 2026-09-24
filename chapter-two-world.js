import * as THREE from 'three';
import { RUNE_ORDER, BELL_ORDER, CHALLENGE_RULES, chapterTwoStep } from './chapter-two-script.js';

// Chapter checkpoints are persistent. A failed attempt only resets its local challenge.
export function createChapterTwo({ world, collision, state, storyPlaces, isUnlocked, onChange, onMessage, onDamage }) {
  const root = new THREE.Group(); root.name = 'The Drowned Meridian'; root.visible = false;
  const places = { chart: storyPlaces.tobin, seal: storyPlaces.maren };
  const props = {}, fighters = [];
  let player = new THREE.Vector3(), runeIndex = 0, bellIndex = 0, valves = new Set(), valveTime = 0;
  let wave = 0, arena = null, waveDelay = 0, bossTime = 0, enabled = false;
  const base = new THREE.MeshStandardMaterial({ color: '#344950', roughness: .85 });
  const glow = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, roughness: .4 });
  const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const clear = (a, b) => collision.cameraFraction(new THREE.Vector3(a.x, a.y + 1.8, a.z), new THREE.Vector3(b.x, b.y + 1.8, b.z), .1) > .98;
  function place(id, x, z, map, color, kind = 'stone') {
    const available = p => world.biomeAt(p.x,p.z) === map && world.isWalkable(p.x,p.z,.85) && Object.values(places).every(other=>flatDistance(p,other)>4.5);
    let spot = world.findWalkable(x, z, .85);
    if(!available(spot)) {
      spot=null;
      for(let radius=1.5;radius<=75&&!spot;radius+=1.5)for(let i=0,count=Math.ceil(radius*5);i<count;i++){
        const candidate={x:x+Math.cos(i/count*Math.PI*2)*radius,z:z+Math.sin(i/count*Math.PI*2)*radius};
        if(available(candidate)){spot={...candidate,y:world.getHeight(candidate.x,candidate.z)};break;}
      }
    }
    if (!spot) throw new Error(`No reachable Chapter Two site for ${id} in ${map}`);
    places[id] = { ...spot };
    const group = new THREE.Group(); group.name = id; group.position.set(spot.x, spot.y, spot.z);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.7, 1, .5, 6), base); foot.position.y = .25; group.add(foot);
    const material = glow(color);
    const shape = kind === 'bell' ? new THREE.CylinderGeometry(.3, .9, 1.3, 12, 1, true) : kind === 'valve' ? new THREE.TorusGeometry(.7, .13, 6, 16) : new THREE.OctahedronGeometry(.6);
    const icon = new THREE.Mesh(shape, material); icon.position.y = 1.7; group.add(icon);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, .045, 4, 32), material); ring.rotation.x = -Math.PI / 2; ring.position.y = .06; group.add(ring);
    root.add(group); world.streaming?.add(group, { kind: 'props' });
    props[id] = { group, icon, material }; return spot;
  }
  // Along the island clearing, then round the container lanes of Map 79's
  // yard: the bell verse just off the south bridge, a bell in each far corner,
  // the valves by the landing, the beacon in the open west lane and the
  // Hollow Warden at the north end.
  place('rootTablet', -96, 8, 'forest', '#b3cda0');
  place('root', -106, 5, 'forest', '#9aca75');
  place('rain', -121, 13, 'forest', '#72c8ef');
  place('moon', -115, -3, 'forest', '#d5b6fa');
  place('bellTablet', 186, 136, 'yard', '#ffd9a4');
  place('dusk', 132, 200, 'yard', '#ed9477', 'bell');
  place('tide', 211, 165, 'yard', '#7ddddd', 'bell');
  place('dawn', 170, 212, 'yard', '#efcd76', 'bell');
  place('valvePanel', 157, 143, 'yard', '#ecc674');
  place('valve1', 170, 140, 'yard', '#f1a265', 'valve');
  place('valve2', 138, 165, 'yard', '#f1a265', 'valve');
  place('valve3', 176, 178, 'yard', '#f1a265', 'valve');
  place('beacon', 140, 182, 'yard', '#b6fff2');
  place('warden', 205, 206, 'yard', '#c5a5fc');
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.45), glow('#ffe3a1')); root.add(marker);
  const warning = new THREE.Mesh(new THREE.RingGeometry(.1, 10, 64), new THREE.MeshBasicMaterial({ color: '#ff7255', transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false }));
  warning.rotation.x = -Math.PI / 2; warning.visible = false; root.add(warning);
  const fighterGeometry = new THREE.IcosahedronGeometry(1, 1);
  function checkpoint(flag, reward) { if (state[flag]) return; state[flag] = true; onChange({ flag, reward }); }
  const step = () => chapterTwoStep(state).id;
  function objective() {
    return ({ summons: places.chart, roots: places.rootTablet, bells: places.bellTablet,
      valves: valveTime > 0 ? places[['valve1','valve2','valve3'].find(id => !valves.has(id))] : places.valvePanel,
      vigil: places.beacon, warden: places.warden, homecoming: places.seal })[step()] || null;
  }
  function candidates() {
    switch (step()) {
      case 'summons': return [['chart', 'Ask Tobin about the black tide']];
      case 'roots': return [['rootTablet','Read the root inscription'], ...RUNE_ORDER.map(id => [id, `Touch the ${id} rune`])];
      case 'bells': return [['bellTablet','Read the bell inscription'], ...BELL_ORDER.map(id => [id, `Ring the ${id} bell`])];
      case 'valves': return [['valvePanel','Read the pressure log'], ...['valve1','valve2','valve3'].filter(id => !valves.has(id)).map((id) => [id, `Close pressure valve ${id.slice(-1)}`])];
      case 'vigil': return arena ? [] : [['beacon','Light the beacon · survive three waves']];
      case 'warden': return arena ? [] : [['warden','Challenge the Hollow Warden']];
      case 'homecoming': return [['seal','Return the Tidewarden’s voice']];
      default: return [];
    }
  }
  function nearby(position) {
    player.copy(position);
    if (!isUnlocked()) return null;
    return candidates().map(([id,label]) => ({ type: 'chapterTwo', id, label, ...places[id] }))
      .filter(p => flatDistance(position,p) < 4.8 && Math.abs(position.y-p.y) < 3 && (['chart','seal'].includes(p.id)||clear(position,p)))
      .sort((a,b) => flatDistance(position,a)-flatDistance(position,b))[0] || null;
  }
  function resetChallenge() {
    for (const f of fighters) { f.alive=false;root.remove(f.group); f.material.dispose(); }
    fighters.length = 0; arena = null; wave = 0; waveDelay = 0; bossTime = 0; valveTime = 0; valves.clear(); warning.visible = false;
  }
  function spawnFighter(centre, index, boss = false) {
    const angle = index * 2.4;
    let at = boss ? centre : world.findWalkable(centre.x + Math.cos(angle)*7, centre.z + Math.sin(angle)*7, .85);
    const safe = p => flatDistance(p,centre)<18 && world.biomeAt(p.x,p.z)===world.biomeAt(centre.x,centre.z) && clear(centre,p);
    if(!safe(at)){
      at=centre;
      for(let i=0;i<24;i++){
        const candidate=world.findWalkable(centre.x+Math.cos(angle+i/24*Math.PI*2)*5,centre.z+Math.sin(angle+i/24*Math.PI*2)*5,.85);
        if(safe(candidate)){at=candidate;break;}
      }
    }
    const group = new THREE.Group(), material = glow(boss ? '#ba87f6' : '#ef866f');
    const core = new THREE.Mesh(fighterGeometry, material); core.scale.setScalar(boss ? 2.2 : 1); core.position.y = boss ? 2.6 : 1.6; group.add(core);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(boss ? 2.8 : 1.3, .07, 4, 24), material); hoop.position.y = core.position.y; hoop.rotation.x = Math.PI / 2; group.add(hoop);
    group.position.set(at.x,at.y,at.z); root.add(group);
    fighters.push({ group, core, material, hp: boss ? CHALLENGE_RULES.bossHP : CHALLENGE_RULES.baseEnemyHP, alive: true, boss, cooldown: 1, pulseDone: false });
  }
  function nextWave() {
    wave++; waveDelay = 0;
    for(let i=0;i<CHALLENGE_RULES.waveCounts[wave-1];i++)spawnFighter(places.beacon,i);
    onMessage(`Beacon vigil · wave ${wave} / 3. Stay within the square.`);
  }
  function interact(action) {
    if (!isUnlocked() || !candidates().some(([id])=>id===action.id) || flatDistance(player,places[action.id])>=4.8 || Math.abs(player.y-places[action.id].y)>=3 || (!['chart','seal'].includes(action.id)&&!clear(player,places[action.id]))) return null;
    const id = action.id;
    if (['chart','rootTablet','bellTablet','valvePanel','seal'].includes(id)) return { person: id };
    if (step() === 'roots' || step() === 'bells') {
      const roots = step()==='roots', order = roots ? RUNE_ORDER : BELL_ORDER, index = roots ? runeIndex : bellIndex;
      const correct = id===order[index], next = correct ? index+1 : 0;
      if(roots)runeIndex=next;else bellIndex=next;
      onMessage(correct ? `${roots?'Root lock':'Bell lock'} · ${next} / 3` : 'The lock falls silent. The sequence resets; read the inscription again.');
      if(next===3)checkpoint(roots?'roots':'bells',100);
    } else if (step()==='valves') {
      if(!valveTime)valveTime=CHALLENGE_RULES.valveSeconds;
      valves.add(id); onMessage(`Pressure valves · ${valves.size} / 3 · ${Math.ceil(valveTime)} seconds`);
      if(valves.size===3){valveTime=0;checkpoint('valves',120);}
    } else if(id==='beacon') { resetChallenge(); arena='vigil'; nextWave(); }
    else if(id==='warden') { resetChallenge(); arena='warden'; spawnFighter(places.warden,0,true); onMessage('The Hollow Warden · leave the red circle, then strike while its shield is down.'); }
    return null;
  }
  function attack({ position, range, damage, special, target, lineOfSight = clear }) {
    if(!isUnlocked() || !arena)return {hits:0,kills:0,bossShielded:false};
    const targets=fighters.filter(f=>f.alive&&(special||target===undefined||target===f)&&flatDistance(position,f.group.position)<range&&Math.abs(position.y-f.group.position.y)<4&&lineOfSight(position,f.group.position)).sort((a,b)=>flatDistance(position,a.group.position)-flatDistance(position,b.group.position));
    const result={hits:0,kills:0,bossShielded:false};
    for(const f of special?targets:targets.slice(0,1)) {
      if(f.boss && bossTime%7<3.4){result.bossShielded=true;continue;}
      f.hp-=damage; result.hits++;
      if(f.hp<=0){f.alive=false;f.group.visible=false;result.kills++;}
    }
    if(result.bossShielded)onMessage('Its shield holds. Dodge the red pulse; strike during the silver glow.');
    if(arena==='warden' && fighters.length && fighters.every(f=>!f.alive)){resetChallenge();checkpoint('warden',250);onMessage('The stolen voice is free. Bring it home to the Moonwell.');}
    return result;
  }
  function update(dt,time,position,{active}) {
    player.copy(position); enabled=isUnlocked(); root.visible=enabled;
    if(!enabled)return;
    const goal=objective(); marker.visible=!!goal;
    if(goal)marker.position.set(goal.x,goal.y+4.7+Math.sin(time*2)*.2,goal.z);
    marker.rotation.y=time;
    for(const [id,p] of Object.entries(props)) {
      const done=(RUNE_ORDER.includes(id)&&state.roots)||(BELL_ORDER.includes(id)&&state.bells)||(id.startsWith('valve')&&state.valves)||(id==='beacon'&&state.vigil)||(id==='warden'&&state.warden);
      p.material.emissiveIntensity=done?.25:1.2+Math.sin(time*2)*.3;
    }
    if(!active)return;
    if(valveTime>0){valveTime=Math.max(0,valveTime-dt);if(!valveTime){valves.clear();onMessage('Pressure returned. All three valves reopened. Try again from any valve.');}}
    if(!arena)return;
    const centre=places[arena==='vigil'?'beacon':'warden'];
    if(flatDistance(position,centre)>42){resetChallenge();onMessage('The challenge resets when you leave its grounds. Your completed locks are safe.');return;}
    if(arena==='vigil') {
      if(fighters.every(f=>!f.alive)){
        if(wave===3){resetChallenge();checkpoint('vigil',180);onMessage('The beacon holds. The Hollow Warden waits beyond the yard’s stacks.');return;}
        waveDelay+=dt;if(waveDelay>=2)nextWave();
      }
      for(const f of fighters)if(f.alive){
        const at=f.group.position, d=flatDistance(position,at);f.cooldown-=dt;
        if(d>2 && clear(at,position)){
          const nx=at.x+(position.x-at.x)/d*3.6*dt,nz=at.z+(position.z-at.z)/d*3.6*dt;
          if(world.isWalkable(nx,nz,.7)){at.x=nx;at.z=nz;collision.resolve(at,.7,3);at.y=world.getHeight(at.x,at.z);}
        }
        f.core.rotation.y=time; f.core.position.y=1.6+Math.sin(time*3)*.2;
        if(d<3 && Math.abs(position.y-at.y)<1.8 && clear(at,position) && f.cooldown<=0){f.cooldown=1.4;onDamage(16);if(!arena)return;}
      }
    } else {
      const boss=fighters.find(f=>f.alive);if(!boss)return;
      const previous=bossTime%7;bossTime+=dt;const phase=bossTime%7;
      if(phase<previous)boss.pulseDone=false;
      warning.visible=phase<3.4;warning.position.set(centre.x,centre.y+.16,centre.z);
      warning.material.opacity=.12+Math.min(1,phase/3.4)*.4;
      boss.material.color.set(phase<3.4?'#ba87f6':'#c7fff1');boss.material.emissive.set(phase<3.4?'#9f51e3':'#a5ffdc');
      boss.core.rotation.y=time*.7;
      if(phase>=3.4&&!boss.pulseDone){boss.pulseDone=true;if(flatDistance(position,centre)<10&&position.y-world.getHeight(position.x,position.z)<1&&clear(centre,position))onDamage(32);}
    }
  }
  function status() {
    if(step()==='roots')return `Runes ${runeIndex} / 3 · inscription at the island landing`;
    if(step()==='bells')return `Bells ${bellIndex} / 3 · inscription by the south jetty`;
    if(step()==='valves')return valveTime>0?`Valves ${valves.size} / 3 · ${Math.ceil(valveTime)}s left`:'Three valves · 45 seconds · timer starts at the first valve';
    if(arena==='vigil')return `Wave ${wave} / 3 · ${fighters.filter(f=>f.alive).length} sentinels remain`;
    if(arena==='warden')return `Hollow Warden ${Math.max(0,Math.ceil(fighters[0]?.hp||0))} / ${CHALLENGE_RULES.bossHP} · ${bossTime%7<3.4?'DODGE THE RED PULSE':'SHIELD DOWN · ATTACK'}`;
    return '';
  }
  return { root,places,nearby,interact,update,attack,objective,resetChallenge,get status(){return status();},
    get mapTargets(){return isUnlocked()?candidates().map(([id,label])=>({id,label,...places[id]})):[];},
    get combatants(){return fighters;},
    get diagnostics(){return {step:step(),flags:{...state},places,arena,wave,runeIndex,bellIndex,valves:[...valves],valveTime,bossTime,status:status(),enemies:fighters.map(f=>({hp:f.hp,alive:f.alive,boss:f.boss,x:f.group.position.x,y:f.group.position.y,z:f.group.position.z}))};} };
}
