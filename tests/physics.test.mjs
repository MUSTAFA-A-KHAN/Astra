import test from 'node:test';
import assert from 'node:assert/strict';
import { LocomotionController, SpatialHash, PropPhysics, RagdollController, stickSprint, STICK_SPRINT } from '../physics.js';

const flat = {
  getHeight: () => 0,
  getNormal(x,z,out) {out.x=0;out.y=1;out.z=0;return out;},
};
const point = (x=0,y=0,z=0) => ({x,y,z});
function actor(terrain=flat,options={},collision=new SpatialHash()) {
  const position=point(),velocity=point();
  return new LocomotionController(position,velocity,terrain,collision,options);
}
function advance(controller,seconds,input={}) {
  const events=[];
  for(let i=0;i<Math.ceil(seconds*120);i++) {controller.update(1/120,input);events.push(...controller.events);}
  return events;
}

test('walking accelerates, respects analog magnitude, and coasts to rest',()=>{
  const controller=actor();
  advance(controller,.1,{x:1,z:0,walk:true});
  assert.ok(controller.speed>1 && controller.speed<3);
  advance(controller,.5,{x:1,z:0,walk:true});
  assert.ok(Math.abs(controller.speed-3)<.01);
  const released=controller.position.x;
  advance(controller,.6);
  assert.ok(controller.position.x>released);
  assert.ok(controller.speed<.01);
  advance(controller,1,{x:.5,z:0,walk:true});
  assert.ok(Math.abs(controller.speed-1.5)<.01);
  advance(controller,1,{x:1,z:1,sprint:true,speedScale:1.65});
  assert.ok(Math.abs(controller.speed-8.5*1.65)<.01,'diagonal mounted movement has normalized speed');
});

test('sprinting spends stamina, an empty bar walks, and a rest restores it',()=>{
  const controller=actor(),sprint={x:1,z:0,sprint:true};
  advance(controller,3,sprint);
  assert.equal(controller.state,'Sprint');assert.ok(Math.abs(controller.speed-8.5)<.01);
  assert.ok(controller.stamina>.75 && controller.stamina<.85,'three of fifteen seconds are spent');
  advance(controller,12.5,sprint);
  assert.equal(controller.exhausted,true);assert.equal(controller.sprinting,false);
  // Out of breath, the hero walks: a walk's stride at a walk's pace, not a run slowed down.
  assert.equal(controller.state,'Walk');assert.ok(Math.abs(controller.speed-3)<.01,'the shift key no longer sprints');
  advance(controller,1.5);
  assert.equal(controller.exhausted,true,'a short breather is not enough');
  advance(controller,3);
  assert.equal(controller.stamina,1);assert.equal(controller.exhausted,false);
  advance(controller,.5,sprint);
  assert.equal(controller.state,'Sprint');

  const rider=actor();
  advance(rider,10,{...sprint,mounted:true});
  assert.equal(rider.stamina,1,'the horse carries the effort');assert.equal(rider.state,'Sprint');
});

test('jump buffers trigger once, landing reports impact once, and ceilings stop upward motion',()=>{
  const controller=actor();
  controller.requestJump();
  const events=advance(controller,1.2);
  assert.equal(events.filter(event=>event.type==='jump').length,1);
  const landings=events.filter(event=>event.type==='land');
  assert.equal(landings.length,1);assert.ok(landings[0].speed>7);
  assert.equal(controller.position.y,0);assert.equal(controller.grounded,true);

  const collision=new SpatialHash();
  collision.insert('ceiling',{x:0,z:0,w:10,d:10,bottom:4,top:5});
  const under=actor(flat,{},collision);under.requestJump();
  let highest=0;
  for(let i=0;i<120;i++) {under.update(1/120);highest=Math.max(highest,under.position.y);}
  assert.ok(highest<=.751,'head never crosses the ceiling');
  assert.ok(highest>.5);assert.equal(under.grounded,true);

  const buffered=actor();buffered.position.y=.12;buffered.grounded=false;buffered.coyote=0;buffered.verticalVelocity=-3;
  buffered.requestJump();
  const bufferedEvents=advance(buffered,.1);
  assert.equal(bufferedEvents.filter(event=>event.type==='jump').length,1);
  assert.ok(buffered.position.y>.2,'a jump queued just before landing starts on contact');
});

test('thin walls block large-frame motion and preserve tangential sliding',()=>{
  const collision=new SpatialHash(2);
  collision.insert('thin-wall',{x:2,z:0,w:.04,d:30,bottom:-1,top:10});
  const controller=actor(flat,{},collision);
  controller.velocity.x=90;controller.velocity.z=5;
  controller.update(.12,{x:1,z:.3,sprint:true});
  assert.ok(controller.position.x<=1.461,`wall crossed: ${controller.position.x}`);
  assert.ok(controller.position.z>.1,'collision preserves sideways movement');
  assert.ok(controller.velocity.x<.01);
  const before=controller.position.x;controller.update(Infinity,{x:1});
  assert.equal(controller.position.x,before);
});

test('steep slopes stop uphill walking and gravity produces a downhill slide',()=>{
  const terrain={getHeight:(x)=>x*2,getNormal(x,z,out){out.x=-2/Math.sqrt(5);out.y=1/Math.sqrt(5);out.z=0;}};
  const uphill=actor(terrain);
  advance(uphill,.8,{x:1,z:0,sprint:true});
  assert.ok(uphill.position.x<.05);
  assert.ok(uphill.slope>.82);
  const downhill=actor(terrain);
  advance(downhill,.5);
  assert.ok(downhill.position.x<-.3,'steep terrain accelerates downhill without input');
});

test('stepping off a ledge falls with momentum and reports a hard landing',()=>{
  const terrain={...flat,getHeight:(x)=>x<1?8:0};
  const controller=actor(terrain);
  controller.velocity.x=8;
  let airborne=false,maxImpact=0;
  for(let i=0;i<300;i++) {
    controller.update(1/120,{x:1,z:0,sprint:true});
    airborne ||= !controller.grounded;
    for(const event of controller.events)if(event.type==='land')maxImpact=Math.max(maxImpact,event.speed);
  }
  assert.equal(airborne,true);assert.ok(maxImpact>15);assert.equal(controller.position.y,0);
  assert.ok(controller.position.x>5,'forward momentum carries the character through the fall');
});

test('shallow water slows walking while deep water damps a fall and supports swimming',()=>{
  const shallow=actor(flat,{waterZones:[{x:0,z:0,w:100,d:100,surface:.8}]});
  const wetEvents=advance(shallow,1,{x:1,z:0,walk:true});
  assert.equal(shallow.state,'Wade');assert.equal(shallow.grounded,true);
  assert.equal(shallow.swimming,false);assert.ok(shallow.speed<2);
  assert.equal(wetEvents.filter(event=>event.type==='water-enter').length,1);
  const deep=actor(flat,{waterZones:[{x:0,z:0,w:20,d:20,surface:0,floor:-6}]});
  deep.position.y=4;deep.grounded=false;deep.verticalVelocity=-10;
  advance(deep,4);
  assert.equal(deep.swimming,true);assert.equal(deep.state,'Swim');
  assert.ok(Math.abs(deep.position.y+deep.height*.56)<.05,'buoyancy converges on a stable surface pose');
  assert.ok(deep.position.y>-3,'falling swimmer does not sink to the floor');
  const leaving=advance(shallow,1,{x:1,z:0,sprint:true});
  assert.equal(leaving.filter(event=>event.type==='water-enter').length,0,'continuous wading does not replay entry sounds');
});

test('climbing reaches supported platforms without lifting actors walking beneath them',()=>{
  const ladder={id:'ladder',x:0,z:0,bottom:0,top:4,exit:{x:1,z:0}};
  const terrain={...flat,getSupportHeight(x,z,feetY,step){return x>.5 && x<3 && feetY+step>=4?4:0;}};
  const controller=actor(terrain,{climbables:[ladder]});
  assert.equal(controller.startClimb({...ladder,x:20}),false);
  assert.equal(controller.startClimb(ladder),true);
  const events=advance(controller,2);
  assert.equal(controller.climbing,null);assert.equal(controller.grounded,true);
  assert.equal(controller.position.y,4);assert.equal(controller.position.x,1);
  assert.equal(events.filter(event=>event.type==='climb-start').length,1);
  assert.equal(events.filter(event=>event.type==='climb-end').length,1);
  const below=actor(terrain);advance(below,.5,{x:1,z:0,walk:true});
  assert.equal(below.position.y,0,'support query uses feet height so platforms do not teleport actors');
  controller.position.x=0;controller.position.y=2;
  assert.equal(controller.startClimb(ladder),true);
  controller.requestJump();controller.update(1/60);
  assert.equal(controller.climbing,null);assert.ok(controller.verticalVelocity>0);
});

test('walkable collision tops support horizontal movement but still block their sides',()=>{
  const collision=new SpatialHash();
  collision.insert('platform',{x:0,z:0,w:3,d:3,bottom:0,top:4,walkable:true});
  const above=point(0,4,0);collision.resolve(above);assert.equal(above.x,0);assert.equal(above.z,0);
  const below=point(1.5,0,0);collision.resolve(below);assert.ok(below.x>=2);
});

test('pushed props honor mass, collide with walls, and stop with friction',()=>{
  const collision=new SpatialHash();collision.insert('wall',{x:3,z:0,w:.05,d:10,bottom:-1,top:5});
  const physics=new PropPhysics(flat,collision);
  const light=physics.addBody({id:'light',position:point(1,0,0),mass:6});
  const heavy=physics.addBody({id:'heavy',position:point(1,0,2),mass:30});
  assert.equal(physics.push(point(),point(1,0,0),8,3),2);
  assert.ok(light.velocity.x>heavy.velocity.x);
  for(let i=0;i<600;i++)physics.update(1/120);
  assert.ok(light.position.x<2.43);assert.equal(light.sleeping,true);
  assert.equal(heavy.sleeping,true);
  assert.equal(collision.entries.get('light').x,light.position.x);
  physics.dispose();assert.equal(collision.entries.has('light'),false);assert.equal(collision.entries.has('wall'),true);
});

test('root-body ragdoll falls, collides, settles, and restores its pose on reset',()=>{
  const collision=new SpatialHash();collision.insert('wall',{x:2,z:0,w:.05,d:10,bottom:-1,top:10});
  const position=point(0,3,0),rotation=point();
  const ragdoll=new RagdollController(position,flat,collision,{rotation});
  ragdoll.start({x:30,y:3,z:0});
  for(let i=0;i<600;i++)ragdoll.update(1/120);
  assert.equal(ragdoll.settled,true);assert.equal(position.y,0);
  assert.ok(position.x<1.33);assert.ok(rotation.x>1);
  ragdoll.reset();assert.equal(rotation.x,0);assert.equal(rotation.z,0);assert.equal(ragdoll.active,false);
});

test('the movement stick sprints past three quarters of its throw and holds it down to two thirds', () => {
  assert.deepEqual(STICK_SPRINT, { start: .75, stop: .65 });
  // Pushed out from rest: a run until the 75% line, a sprint from it.
  let sprinting = false;
  const push = tilt => (sprinting = stickSprint(sprinting, tilt));
  for (const tilt of [0, .3, .6, .7, .74]) assert.equal(push(tilt), false, `no sprint at ${tilt}`);
  assert.equal(push(.75), true);
  // A thumb resting near the line does not flicker: the sprint holds
  // until the stick eases back under 65%.
  for (const tilt of [.8, .72, .7, .66, .65]) assert.equal(push(tilt), true, `still sprinting at ${tilt}`);
  assert.equal(push(.64), false);
  // And once dropped, it needs the full 75% again.
  for (const tilt of [.66, .7, .74]) assert.equal(push(tilt), false, `not sprinting again at ${tilt}`);
  assert.equal(push(1), true);
  assert.equal(push(0), false, 'letting go stops it');
});
