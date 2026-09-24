import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPlazaTerrain, PLAZA_STEP, PLAZA_TRANSFORM as t } from '../plaza-world.js';
import { createNavigation } from '../navigation.js';
import { LocomotionController, SpatialHash } from '../physics.js';

const data = JSON.parse(await readFile(new URL('../plaza-night-time/plaza-navigation.json', import.meta.url)));
const world = ([x, y, z]) => ({ x: t.x - z * t.scale, y: t.y + y * t.scale, z: t.z + x * t.scale });

// This real staircase has hollow space below its higher treads. Street-height
// sampling used to place a water barrier across the flight at local x=25.63.
test('hollow plaza stairs remain climbable while empty water stays blocked', () => {
  const terrain = createPlazaTerrain(data);
  const navigation = createNavigation([terrain], { minX:450, maxX:462, minZ:32, maxZ:55 },
    { arrival:world([24,20,-53.5]) });
  const collision = new SpatialHash(8);
  navigation.colliders.forEach((shape, i) => collision.insert(i, shape));
  const position = world([24,20,-53.5]);
  const controller = new LocomotionController(position, {x:0,y:0,z:0}, {
    ...navigation,
    stepHeightAt: () => PLAZA_STEP,
    getNormal(x,z,out) { out.x=out.z=0;out.y=1;return out; },
  }, collision);
  const destination = world([31,26,-53.5]);
  for(let i=0;i<1200 && position.z<destination.z;i++) controller.update(1/60,{x:0,z:1,walk:true});
  assert.ok(position.z>=destination.z, `Blocked on staircase at ${JSON.stringify(position)}`);
  assert.ok(Math.abs(position.y-destination.y)<.01, 'reached the upper floor');
  assert.equal(controller.grounded,true);
  for(let i=0;i<180;i++) controller.update(1/60,{x:0,z:1,walk:true});
  assert.ok(position.z<world([32,26,-53.5]).z-controller.radius,
    'the real wall at the end of the upper floor still blocks movement');
  const upperOnly=world([27,23,-53.5]);
  assert.equal(navigation.isWalkable(upperOnly.x,upperOnly.z,.1),false,
    'upper-only cells are not street-level placement candidates');
  terrain.layout.geometry.dispose();

  // Genuinely empty cells beside valid floors retain their water boundary.
  const island=createPlazaTerrain({version:1,floors:[[20,0,0,4,4]],walls:[],ceilings:[]});
  const shore=world([2,20,2]);
  const islandNav=createNavigation([island],{minX:349,maxX:363,minZ:-9,maxZ:6},{arrival:shore});
  assert.ok(islandNav.colliders.some(c=>c.noCamera), 'empty water retains its collision barrier');
  island.layout.geometry.dispose();
});
