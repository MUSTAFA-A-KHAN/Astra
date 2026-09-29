import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readChapterThree, chapterThreeUnlocked, chapterThreeStep, chapterThreeConversation, CHAPTER_THREE_PEOPLE, MEMORY_FLAGS, RECORD_FLAGS, turnLens, lensesAligned } from '../chapter-three-script.js';
import { createChapterThree } from '../chapter-three-world.js';
import { createUnwritten } from '../chapter-three-combat.js';
import { loadObservatoryDistrict, OBSERVATORY_ARRIVAL, OBSERVATORY_SITES } from '../observatory-world.js';
import { createNavigation } from '../navigation.js';
import { SpatialHash } from '../physics.js';
import { portalRoute } from '../portal-script.js';

const previous = { restored: true, story: { ledger: true, farewell: true }, chapterTwo: Object.fromEntries(['accepted','roots','bells','valves','vigil','warden','complete'].map(flag => [flag, true])) };
const throughLenses = { accepted: true, ...Object.fromEntries(MEMORY_FLAGS.map(flag => [flag, true])), lenses: true };
function fixture(flags = {}, map = 'forest') {
  const state = Object.assign(readChapterThree({}), flags), changes = [], messages = [];
  const world = { activeMap: map, getHeight: () => 0, findWalkable: (x,z) => ({x,y:0,z}), isWalkable: () => true };
  const sites = Object.fromEntries(['seal','rootTablet','root','rain','moon','valvePanel','beacon','dusk','tide','dawn'].map((id,i) => [id, {x:i*12,y:0,z:0}]));
  const position = new THREE.Vector3(), collision = new SpatialHash();
  const chapter = createChapterThree({world,collision,state,sites,isUnlocked:()=>true,onChange:c=>changes.push(c),onMessage:m=>messages.push(m),onDamage:()=>{}});
  const use = id => { position.copy(chapter.places[id]); const action = chapter.nearby(position); assert.equal(action?.id,id); return chapter.interact(action); };
  const hear = id => { use(id); const entry=chapterThreeConversation(id,state); chapter.hear(id,entry.sets); };
  return {state,changes,messages,world,chapter,position,use,hear};
}

test('chapter three requires the full previous ending and reads independent strict flags', () => {
  assert.equal(chapterThreeUnlocked(previous),true);
  for (const flag of Object.keys(previous.chapterTwo)) assert.equal(chapterThreeUnlocked({...previous,chapterTwo:{...previous.chapterTwo,[flag]:false}}),false);
  assert.equal(chapterThreeUnlocked({}),false);
  const saved={chapterThree:{accepted:true,relay:1,complete:'true',extra:true}};
  const state=readChapterThree(saved); assert.equal(state.accepted,true); assert.equal(state.relay,false); assert.equal(state.complete,false); assert.equal(state.extra,undefined);
  state.accepted=false;assert.equal(saved.chapterThree.accepted,true);
  assert.equal(chapterThreeStep({complete:true}).id,'summons');
});

test('linked lenses can be solved from every orientation and three turns undo a move', () => {
  for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let c=0;c<3;c++) {
    const start=[a,b,c]; let found=false;
    for(let x=0;x<3;x++)for(let y=0;y<3;y++)for(let z=0;z<3;z++) {
      let faces=start;
      for(const [i,n] of [x,y,z].entries())for(let k=0;k<n;k++)faces=turnLens(faces,i);
      found ||= lensesAligned(faces);
    }
    assert.ok(found);
    for(let i=0;i<3;i++)assert.deepEqual(turnLens(turnLens(turnLens(start,i),i),i),start);
  }
});

test('memories checkpoint one at a time; stale and clue callbacks never award XP', () => {
  const f=fixture({accepted:true});
  f.hear('memoryRain');assert.equal(f.state.memoryRain,true);
  f.chapter.hear('memoryRain','memoryRain');assert.equal(f.changes.length,1);
  f.hear('memoryRoot');f.hear('memoryMoon');assert.equal(chapterThreeStep(f.state).id,'lenses');
  f.hear('lensTablet');assert.equal(f.changes.length,3);assert.equal(f.state.undefined,undefined);
  f.use('lensMoon');f.use('lensRoot');
  assert.deepEqual(f.chapter.diagnostics.faces,[2,1,1]);
  // Return to zero then solve: root twice, rain once, moon zero.
  f.chapter.syncMap();f.use('lensRoot');f.use('lensRoot');f.use('lensRain');
  assert.equal(f.state.lenses,true);assert.equal(chapterThreeStep(f.state).id,'relay');
});

test('relay requires every lamp and the return, pauses, expires, retries and resets on travel', () => {
  const f=fixture(throughLenses,'yard');f.use('flame');
  f.chapter.update(100,0,f.position,{active:false});assert.equal(f.chapter.diagnostics.remaining,90);
  f.use('lampDusk');f.use('flame');assert.equal(f.state.relay,false);assert.equal(f.chapter.diagnostics.remaining,90);
  f.chapter.update(91,0,f.position);assert.equal(f.chapter.diagnostics.remaining,0);assert.deepEqual(f.chapter.diagnostics.lamps,[]);
  f.use('flame');f.use('lampDawn');f.chapter.syncMap();assert.equal(f.chapter.diagnostics.remaining,0);assert.equal(f.state.lenses,true);
  f.use('flame');for(const id of ['lampTide','lampDawn','lampDusk'])f.use(id);
  assert.equal(f.state.relay,false);assert.equal(f.chapter.objective().id,'flame');
  f.use('flame');assert.equal(f.state.relay,true);assert.deepEqual(f.changes,[{flag:'relay',reward:200}]);
});

test('new passage waits for relay and the observatory always offers a way home', () => {
  assert.equal(portalRoute(previous,'yard').destination,'city');
  const progress={...previous,chapterThree:{...throughLenses,relay:true}};
  assert.equal(portalRoute(progress,'yard').destination,'observatory');
  assert.equal(portalRoute(progress,'observatory').destination,'city');
  assert.equal(portalRoute({},'observatory').destination,null);
});

test('observatory sites and arrival share connected walkable ground', async () => {
  const district=await loadObservatoryDistrict();
  const nav=createNavigation([district.terrain],district.bounds,{arrival:OBSERVATORY_ARRIVAL});
  assert.ok(nav.isWalkable(nav.spawn.x,nav.spawn.z,.85));
  for(const [id,p] of Object.entries(OBSERVATORY_SITES)) {
    const at=nav.findWalkable(p.x,p.z+(id.startsWith('record')?3:0),.85);
    assert.ok(Math.hypot(at.x-p.x,at.z-p.z)<5,id);
    assert.ok(nav.isWalkable(at.x,at.z,.85),id);
    assert.ok(nav.route(nav.spawn,at).length>0,id);
  }
});

test('all chapter conversations have known speakers and the ending needs the boss and discoveries', () => {
  const state=readChapterThree({});
  for(const flag of [null,...Object.keys(state)]) {
    if(flag)state[flag]=true;
    for(const person of Object.keys(CHAPTER_THREE_PEOPLE))for(const [speaker,text] of chapterThreeConversation(person,state).lines) {
      assert.ok(speaker===null||CHAPTER_THREE_PEOPLE[speaker]);assert.ok(text.length>0&&text.length<260,text);
    }
  }
  state.complete=false;assert.equal(chapterThreeConversation('sharedSeal',state).sets,'complete');
  for(const flag of Object.keys(state).filter(flag=>flag!=='complete'))assert.notEqual(chapterThreeConversation('sharedSeal',{...state,[flag]:false}).sets,'complete',flag);
});

function bossFixture() {
  const root=new THREE.Group(),damage=[],victories=[];
  const world={getHeight:()=>0,findWalkable:(x,z)=>({x,y:0,z}),isWalkable:()=>true};
  const boss=createUnwritten({root,world,collision:new SpatialHash(),onDamage:n=>damage.push(n),onVictory:()=>victories.push(true),onMessage:()=>{}});
  boss.start({x:0,y:0,z:0});
  const hit=(target,damage=2000)=>boss.attack({position:target.group.position,range:6,damage,target});
  return {boss,damage,victories,hit};
}
test('Unwritten forces three phases, guard shields, pulse dodging and a single victory', () => {
  const f=bossFixture();let target=f.boss.fighters[0];
  assert.equal(f.hit(target).hits,0);
  f.boss.update(3.3,0,{x:13,y:0,z:0},false);assert.equal(f.boss.diagnostics.cycle,0);
  for(const phase of [1,2,3]) {
    f.boss.update(3.3,0,{x:13,y:0,z:0},true);assert.equal(f.boss.diagnostics.open,true);
    f.hit(target);
    if(phase<3) {
      assert.equal(f.boss.diagnostics.phase,phase+1);assert.equal(f.hit(target).hits,0);
      for(const guard of f.boss.fighters.filter(f=>f.alive&&!f.boss))f.hit(guard);
    }
  }
  assert.deepEqual(f.damage,[]);assert.deepEqual(f.victories,[true]);assert.equal(f.boss.active,false);
  assert.equal(f.hit(target).hits,0);
});
test('Unwritten pulses damage grounded heroes, spare jumping heroes and reset outside arena', () => {
  for(const [y,hits] of [[0,1],[1.1,0]]) {
    const f=bossFixture();f.boss.update(3.3,0,{x:0,y,z:0},true);assert.equal(f.damage.length,hits);
    f.boss.update(.1,0,{x:40,y:0,z:0},true);assert.equal(f.boss.active,false);assert.deepEqual(f.victories,[]);
  }
});
