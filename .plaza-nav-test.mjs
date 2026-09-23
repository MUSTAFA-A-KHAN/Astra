import fs from 'node:fs';
import {createPlazaTerrain,PLAZA_TRANSFORM} from './plaza-world.js';
import {createNavigation} from './navigation.js';
import {SpatialHash,LocomotionController} from './physics.js';
const data=JSON.parse(fs.readFileSync('plaza-night-time/plaza-navigation.json'));
console.time('terrain');const terrain=createPlazaTerrain(data);console.timeEnd('terrain');
console.time('nav');const nav=createNavigation([terrain],{minX:201.5,maxX:518.5,minZ:-108,maxZ:99},{arrival:{x:205,z:18,radius:.6}});console.timeEnd('nav');
console.time('hash');const collision=new SpatialHash(8);nav.colliders.forEach((c,i)=>collision.insert(i,c));console.timeEnd('hash');
console.log(nav.diagnostics,nav.spawn,process.memoryUsage().heapUsed/1e6);
const world=(x,y,z)=>({x:360-z*1.8,y:-34.65+y*1.8,z:-5.4+x*1.8});
for(const [x,z]of [[-20,54],[0,54],[13,54],[13,20],[20,20]]){const p=world(x,20,z);console.log(x,z,nav.getHeight(p.x,p.z),nav.getSupportHeight(p.x,p.z,p.y,.95))}
