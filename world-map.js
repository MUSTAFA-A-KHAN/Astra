import * as THREE from 'three';
import { createNavigation } from './navigation.js';
import { CITY_ARRIVAL, loadCityDistrict } from './city-world.js';
import { loadForestDistrict } from './forest-world.js';
import { loadYardDistrict } from './skibidi-world.js';
import { createStreetLights } from './street-lights.js';
import { createStreamer } from './streaming.js';

// The Verdant Reach is three supplied models standing in one harbour: the
// city on its quay, the Forest Loner diorama moored off its western seawall,
// and the Skibidi Yard's container pier off its south-east corner. Three more
// join them only when the player turns them on: the Lantern Plaza on its
// plinth off the eastern quay, the Nightwood's road off the northern quay,
// across the city from the yard, and the Red Mesa off the southern quay, west
// of the yard. This module places them, joins them with jetties, and hands the
// game a single piece of ground that spans them all.
export const HARBOUR_LEVEL = -6.65;
// The crossing west: a boardwalk on the pavement's line, high enough to step
// over the harbour wall, running out to the island's clearing.
const JETTY = { z: 11, width: 6, deck: 2.4, quay: -69.5, rise: -75 };
// The crossing east: level from the end of the spawn road, where the quay has
// no wall, to the rim of the plaza's plinth, which is laid at the same height.
// The deck stands a hand above both, so neither shows through it.
const EAST_JETTY = { z: 18, width: 5, quay: 184.5, deck: .55 };
// The crossing south: level from the open paving at the city's south-east
// corner, which has no wall either, to the yard's pier, laid at the same height.
const SOUTH_JETTY = { width: 5, quay: 105, deck: .55 };
// The crossing north: from the promenade along the north quay, which has no
// wall either, level out past its edge, then up at the west jetty's pitch to
// the end of the Nightwood's road, which stands higher than the quay.
const NORTH_JETTY = { width: 5, quay: -148, edge: -151.5, deck: .55, pitch: .35 };
// The crossing to the mesa: from the pavement above the south quay, up at the
// same pitch, high enough to step over the harbour wall and the sunken walk
// inside it, and on to the foot of the mesa's gully, which stands higher still.
const MESA_JETTY = { width: 5, quay: 88, pavement: .45, pitch: .35 };

// How much daylight reaches the streets at an hour: what the lamps, and the
// heroes' flashlights, come on by.
export const daylightAt = hour => THREE.MathUtils.clamp(Math.sin((hour-6)/12*Math.PI)*1.4,0,1);

export async function createWorld(scene, { lowPower = false, plaza: plazaOn = false, nightwood = false, mesa = false } = {}) {
  const [city, forest, yard, lantern, wood, butte] = await Promise.all([
    loadCityDistrict({ lowPower }), loadForestDistrict({ lowPower, waterline: HARBOUR_LEVEL }), loadYardDistrict({ lowPower }),
    // Until the player turns the plaza, the Nightwood or the mesa on, neither
    // its modules nor its model is fetched, and nothing below makes room for it.
    plazaOn ? loadLanternPlaza({ lowPower }) : null,
    nightwood ? import('./nightwood-world.js').then(({ loadNightwoodDistrict }) => loadNightwoodDistrict({ lowPower, waterline: HARBOUR_LEVEL })) : null,
    mesa ? import('./mesa-world.js').then(({ loadMesaDistrict }) => loadMesaDistrict({ lowPower, waterline: HARBOUR_LEVEL })) : null,
  ]);
  const plaza = lantern?.district, plazaLights = lantern?.lights;
  const present = [city, forest, plaza, yard, wood, butte].filter(Boolean);
  const root = new THREE.Group(); root.name = 'The Verdant Reach';
  root.add(...present.map(district => district.root));
  // The city model includes canal banks, but no water surface. The level sits
  // inside those banks, below the supplied roads, and out past the seawall it
  // becomes the harbour the island stands in.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color:'#355a64', roughness:.34, metalness:.25 }));
  water.name = 'Harbour water'; water.rotation.x = -Math.PI/2; water.position.y = HARBOUR_LEVEL; water.receiveShadow = true; root.add(water);

  const jetty = createForestJetty(forest), eastJetty = plaza && createPlazaJetty(plaza), southJetty = createYardJetty(yard), northJetty = wood && createNightwoodJetty(wood), mesaJetty = butte && createMesaJetty(butte);
  const crossings = [jetty, eastJetty, southJetty, northJetty, mesaJetty].filter(Boolean);
  root.add(...crossings.map(crossing => crossing.group));
  const districts = present.map(district => district.bounds);
  const bounds = {
    minX: Math.min(...districts.map(d => d.minX)), maxX: Math.max(...districts.map(d => d.maxX)),
    minZ: Math.min(...districts.map(d => d.minZ)), maxZ: Math.max(...districts.map(d => d.maxZ)),
  };
  const navigation = createNavigation([...present, ...crossings].map(part => part.terrain), bounds,
    { openings: crossings.map(crossing => crossing.opening), arrival: CITY_ARRIVAL });
  // The island and the plaza are only worth placing things on if their jetties
  // actually reach them; findWalkable would otherwise quietly drop them back in
  // the city.
  const forestReachable = navigation.isWalkable(jetty.landing.x, jetty.landing.z, 1);
  if (!forestReachable) console.warn('The jetty does not reach the island: its shore is unreachable from the city.');
  const plazaReachable = !!eastJetty && navigation.isWalkable(eastJetty.inland.x, eastJetty.inland.z, 1);
  if (plaza && !plazaReachable) console.warn('The east jetty does not reach the plaza: its street is unreachable from the city.');
  const yardReachable = navigation.isWalkable(southJetty.inland.x, southJetty.inland.z, 1);
  if (!yardReachable) console.warn('The south jetty does not reach the yard: its pier is unreachable from the city.');
  const woodReachable = !!northJetty && navigation.isWalkable(northJetty.inland.x, northJetty.inland.z, 1);
  if (wood && !woodReachable) console.warn('The north jetty does not reach the Nightwood: its road is unreachable from the city.');
  const mesaReachable = !!mesaJetty && navigation.isWalkable(mesaJetty.inland.x, mesaJetty.inland.z, 1);
  if (butte && !mesaReachable) console.warn('The mesa jetty does not reach the Red Mesa: its plain is unreachable from the city.');
  // Only what is near the player is drawn: the city chunk by chunk, the other
  // districts mesh by mesh, each crossing whole. The plaza's tiles join them
  // when its model arrives, and the story's people and props as they land.
  const streaming = createStreamer({ quality: lowPower ? 'low' : 'high' });
  for (const mesh of [...city.meshes, ...forest.meshes, ...yard.meshes, ...(wood?.meshes ?? []), ...(butte?.meshes ?? [])]) streaming.add(mesh);
  for (const crossing of crossings) streaming.add(crossing.group);
  const streetLights = createStreetLights({ lanterns: city.lanterns, materials: city.materials, heightAt: navigation.getHeight, lights: lowPower ? 2 : 4 });
  root.add(streetLights.group);
  if (plazaLights) root.add(plazaLights.group);

  const landmarks = [
    { id:'shrine', name:'Moonwell Sanctuary', ...navigation.findWalkable(0,-50,4), color:'#83e6ee' },
    // The wanderers keep their fire out on the mesa's eastern sands, across the
    // water from the yard, where the ground lies flattest near the jetty. With
    // the mesa turned off, the camp stands in the city, west of the square: the
    // story sends the player there either way.
    { id:'camp', name:'Wanderer’s Camp', ...(mesaReachable ? navigation.findWalkable(90,142,3) : navigation.findWalkable(-45,25,3)), color:'#ffc681' },
    { id:'watch', name:'Sunstone Watch', ...navigation.findWalkable(50,-20,3), color:'#f1d087' },
    ...(forestReachable ? [{ id:'hollow', name:'The Loner’s Hollow', ...navigation.findWalkable(-118,4,2.2), color:'#9ad07a' }] : []),
    // Before the cathedral's great door, in the market square.
    ...(plazaReachable ? [{ id:'cathedral', name:'Duskbell Cathedral', ...navigation.findWalkable(262,-40,2.2), color:'#ffb35c' }] : []),
    // In front of the radiation crates, the first thing off the south jetty.
    ...(yardReachable ? [{ id:'crates', name:'Hazard Crates', ...navigation.findWalkable(151,143,2.2), color:'#f2c14e' }] : []),
    // Where the road swings west, halfway through the wood.
    ...(woodReachable ? [{ id:'bend', name:'Owl’s Bend', ...navigation.findWalkable(60,-235,2.2), color:'#a9bcff' }] : []),
    // On the butte's highest point, where the climb up its gully and shoulder comes out.
    ...(mesaReachable ? [{ id:'summit', name:'Windcut Summit', ...navigation.findWalkable(-47,229,2.2), color:'#ff9a6b' }] : []),
  ];
  const markerGeometry=new THREE.OctahedronGeometry(1);
  const ringGeometry=new THREE.TorusGeometry(2,.055,6,48);
  const markers=[];
  for(const landmark of landmarks) {
    const group=new THREE.Group();group.name=landmark.name;group.position.set(landmark.x,landmark.y,landmark.z);root.add(group);
    const mat=new THREE.MeshStandardMaterial({color:landmark.color,emissive:landmark.color,emissiveIntensity:.9,metalness:.2,roughness:.3});
    // The shrine's crystal hangs clear of the Moonwell's roof (story.js).
    const crystal=new THREE.Mesh(markerGeometry,mat);crystal.position.y=landmark.id==='shrine'?6.6:2.6;
    crystal.scale.set(landmark.id==='shrine'?.95:.6,landmark.id==='shrine'?1.7:1,.7);group.add(crystal);
    const ring=new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:landmark.color,transparent:true,opacity:.8,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.position.y=.12;group.add(ring);
    const light=new THREE.PointLight(landmark.color,5,10,2);light.position.y=2.6;group.add(light);
    markers.push({crystal,ring,light,baseHeight:crystal.position.y});
  }
  // Shards and patrols sit across the water on both sides, so the island and
  // the plaza are somewhere the journey leads rather than only somewhere to
  // look at: down the market street, into the square and the side streets.
  const cityShards = [[0,9],[1,0],[-1,-10],[2,-20],[0,-32],[-12,9],[-23,16],[-35,23],[-42,34],[-49,17],[14,-7],[25,-13],[36,-17],[47,-26],[55,-12],[-15,-42],[16,-43],[-28,-60],[30,-63],[60,30]];
  const forestShards = [[-96,8],[-105,14],[-118,4],[-125,16]];
  const plazaShards = [[232,18],[268,-28],[272,60],[345,18],[427,62],[480,18]];
  // Round the stacks of the yard, and in the lanes between them.
  const yardShards = [[170,140],[138,165],[210,150],[176,178],[205,206],[150,212]];
  // Along the road through the wood, from the jetty to its far end.
  const woodShards = [[1,-197],[31,-215],[60,-235],[54,-258],[31,-279],[19,-290]];
  // Up the gully and the shoulder above it, and out on the plain either side of its foot.
  const mesaShards = [[-5,150],[-5,176],[-11,197],[-29,214],[-75,135],[65,135]];
  // The newest districts' come last, so progress saved before they existed
  // keeps its indices. A district the player can turn off keeps its slots
  // while it is off, empty: its shards keep their places, and those gathered
  // stay gathered for when it returns.
  const optional = (reachable, shards) => reachable ? shards : shards.map(() => null);
  const shardPositions = [...cityShards, ...(forestReachable ? forestShards : [[-65,-10],[66,-48],[-25,60],[25,48]]), ...optional(plazaReachable, plazaShards), ...(yardReachable ? yardShards : []), ...optional(woodReachable, woodShards), ...optional(mesaReachable, mesaShards)];
  const enemyPositions = [[-9,-17],[12,-30],[-17,-38],[28,-24],[-33,-12],[45,-42],...(forestReachable ? [[-107,18]] : []),...(plazaReachable ? [[300,18],[400,18]] : []),...(yardReachable ? [[172,160],[145,195]] : []),...(woodReachable ? [[48,-223],[42,-268]] : []),...(mesaReachable ? [[-50,140],[40,140]] : [])];

  let daylight=1;
  function setTime(hour) {
    daylight=daylightAt(hour);
    city.setTime(daylight);plaza?.setTime(daylight);streetLights.setTime(daylight);plazaLights?.setTime(daylight);
    for(const marker of markers) {marker.crystal.material.emissiveIntensity=.75+(1-daylight)*.65;marker.light.intensity=2+(1-daylight)*7;}
  }
  function setQuality(level) {
    const low=level==='low'||level==='performance'||level===0;
    city.setQuality(low);forest.setQuality(low);plaza?.setQuality(low?'low':level);yard.setQuality(low);wood?.setQuality(low);butte?.setQuality(low);streetLights.setQuality(low);plazaLights?.setQuality(low?'low':level);
    streaming.setQuality(low?'low':level);
    for(const marker of markers) marker.light.visible=!low;
  }
  function update(dt,time,position) {
    streaming.update(position);streetLights.update(position);plazaLights?.update(position);
    for(let i=0;i<markers.length;i++) {
      const marker=markers[i];marker.crystal.rotation.y=time*.35+i;
      marker.crystal.position.y=marker.baseHeight+Math.sin(time*1.2+i)*.16;
      marker.ring.material.opacity=.6+Math.sin(time*.9+i)*.12;
    }
  }
  setQuality(lowPower?'low':'high');setTime(15.5);scene.add(root);
  const diagnostics={ready:true,provider:'astra-world-map',asset:city.asset,assets:present.map(district=>district.asset),
    meshCount:city.meshes.length+forest.meshes.length+yard.meshes.length+(wood?.meshes.length??0)+(butte?.meshes.length??0),forestReachable,plazaReachable,yardReachable,woodReachable,mesaReachable,shore:jetty.landing,...navigation.diagnostics,
    get streetLights(){return streetLights.diagnostics;},get plaza(){return plaza?.diagnostics??null;},get plazaLights(){return plazaLights?.diagnostics??null;},get streaming(){return streaming.diagnostics;}};
  const within=(d,x,z)=>x>=d.minX && x<=d.maxX && z>=d.minZ && z<=d.maxZ;
  return {
    ...navigation,bounds,landmarks,shardPositions,enemyPositions,update,setTime,setQuality,diagnostics,streaming,
    // The ambience and the sky both read the ground the player is standing on.
    biomeAt(x,z) {
      return within(forest.bounds,x,z) ? 'forest' : plaza && within(plaza.bounds,x,z) ? 'plaza' : within(yard.bounds,x,z) ? 'yard' : wood && within(wood.bounds,x,z) ? 'nightwood' : butte && within(butte.bounds,x,z) ? 'mesa' : 'city';
    },
    // How high a step the ground allows here, where it differs from the default.
    stepHeightAt(x,z) {
      return plaza && within(plaza.bounds,x,z) ? lantern.step : undefined;
    },
    // The plaza is built of blocks: its ground is level everywhere, and every
    // change of height is a step, never a slope. Read as a slope, a stair's
    // edge would stop the player before the step height is even consulted.
    getNormal(x,z,out,feetY) {
      return plaza && within(plaza.bounds,x,z) ? (out.x=0,out.y=1,out.z=0,out) : navigation.getNormal(x,z,out,feetY);
    },
    // Fetches the detail that waits until the world is on screen: the plaza's
    // model, when the plaza is on. Its footprint is walked, and drawn, until
    // it arrives.
    stream({ prepare } = {}) {
      if (!plaza) return Promise.resolve();
      return plaza.load(async model => {
        plazaLights.excludeScenery(model);
        await prepare?.(model);
        model.traverse(tile => { if (tile.isMesh) streaming.add(tile); });
      });
    },
    dispose() {
      const geometries=new Set(),usedMaterials=new Set(),textures=new Set();
      root.traverse(object=>{
        if(object.geometry) geometries.add(object.geometry);
        for(const material of Array.isArray(object.material)?object.material:object.material?[object.material]:[]) usedMaterials.add(material);
      });
      for(const material of usedMaterials) for(const value of Object.values(material)) if(value?.isTexture) textures.add(value);
      for(const geometry of geometries) geometry.dispose();
      for(const material of usedMaterials) material.dispose();
      for(const texture of textures) texture.dispose();
      streetLights.dispose();plazaLights?.dispose();scene.remove(root);
    },
  };
}

// A timber boardwalk along one line of the harbour, through the given points
// ([x, height] pairs). A level stretch is deck, with cross boards, piles and a
// rail; a sloping one is a ramp. The navigator reads both as floor, the rest
// as scenery.
function boardwalk(name, { z, width }, path) {
  const group = new THREE.Group(); group.name = name;
  const timber = new THREE.MeshStandardMaterial({ color:'#71503b', roughness:.94 });
  const iron = new THREE.MeshStandardMaterial({ color:'#3b4247', metalness:.6, roughness:.55 });
  const boards = new THREE.MeshStandardMaterial({ color:'#7d5b43', roughness:.96 });
  function plank(fromX, fromY, toX, toY, thickness = .34) {
    const [x0,y0,x1,y1] = fromX <= toX ? [fromX,fromY,toX,toY] : [toX,toY,fromX,fromY];
    const length = Math.hypot(x1-x0, y1-y0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width), timber);
    mesh.rotation.z = Math.atan2(y1-y0, x1-x0);
    mesh.position.set((x0+x1)/2, (y0+y1)/2, z);
    mesh.translateY(-thickness/2);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  }
  for (let i = 1; i < path.length; i++) {
    const [[start, deck], [end, to]] = [path[i - 1], path[i]];
    plank(start, deck, end, to).name = deck === to ? 'jetty-deck' : 'jetty-ramp';
    if (deck !== to) continue;
    const way = Math.sign(end - start), beyond = x => (end - x) * way > 0;
    // Cross boards: a boardwalk this wide is a bare slab without them.
    for (let x = start + way * .8; beyond(x); x += way * 1.55) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(.9, .08, width - .12), boards);
      board.position.set(x, deck + .04, z);
      board.receiveShadow = true; board.name = 'jetty-board'; group.add(board);
    }
    for (let x = start + way * 1.5; beyond(x); x += way * 4.5) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(.4, deck - HARBOUR_LEVEL + 1, .4), timber);
        post.position.set(x, (deck + HARBOUR_LEVEL - 1) / 2, z + side * (width/2 - .35));
        post.castShadow = true; post.name = 'jetty-pile'; group.add(post);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(.14, 1.1, .14), iron);
        rail.position.set(x, deck + .55, post.position.z);
        rail.castShadow = true; rail.name = 'jetty-stanchion'; group.add(rail);
      }
    }
    for (const side of [-1, 1]) {
      const rope = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(end - start), .1, .1), iron);
      rope.position.set((start + end)/2, deck + 1.05, z + side * (width/2 - .35));
      rope.name = 'jetty-rail'; group.add(rope);
    }
  }
  return group;
}

// The corridor a crossing opens through the walls either end of it, from the
// quay to a few strides inland. Every cell of it has ground — deck, ramp or
// the district's own — beneath it; opening one that reaches past the decking
// over open water would clear a hole.
function corridor({ z, width, quay }, inland) {
  return { x: (inland + quay) / 2, z, w: Math.abs(quay - inland), d: width - 1.2 };
}

// A boardwalk from the waterfront pavement to the island's clearing. It steps
// over the harbour wall rather than through it, so the deck is the ground for
// as long as the crossing lasts — see the opening it declares.
function createForestJetty(forest) {
  // Walk in from the island's outline until the supplied ground comes up past
  // the rocky rim: that turf is where the boardwalk can land.
  const rim = forest.bounds.maxX + 1;
  let shore = null, ground = null;
  for (let x = rim; x > rim - 16; x -= .25) {
    const height = forest.heightAt(x, JETTY.z);
    if (height !== null && height > HARBOUR_LEVEL + 2) { shore = x; ground = height; break; }
  }
  if (shore === null) throw new Error('The forest island has no shore on the jetty line.');
  const landing = { x: shore - 2.5, z: JETTY.z, y: ground };
  const deckEnd = landing.x + 4;
  // The landing is buried a little in the turf so the island's own ground,
  // not the plank, is the higher surface where the two meet.
  const group = boardwalk('Harbour jetty', JETTY, [[JETTY.quay, .45], [JETTY.rise, JETTY.deck], [deckEnd, JETTY.deck], [landing.x, ground - .3]]);
  // The corridor has to clear the whole of the island's rocky rim, or the
  // first step off the planks is still walled in.
  return {
    group, landing,
    terrain: { layout: group, ground:/jetty-deck|jetty-ramp/, walkable: Infinity },
    opening: corridor(JETTY, landing.x - 4),
  };
}

// The Lantern Plaza with its lamps and the height of a stair in it: its two
// modules, its footprint and its navigation, fetched together.
async function loadLanternPlaza({ lowPower }) {
  const [{ PLAZA_STEP, PLAZA_TRANSFORM, loadPlazaDistrict }, { createPlazaLights }] = await Promise.all([import('./plaza-world.js'), import('./plaza-lighting.js')]);
  return { district: await loadPlazaDistrict({ lowPower }), lights: createPlazaLights({ transform: PLAZA_TRANSFORM }), step: PLAZA_STEP };
}

// A level boardwalk from the end of the spawn road to the rim of the plaza's
// plinth, overlapping the pavement at one end and the rim at the other.
function createPlazaJetty(plaza) {
  const landing = plaza.landing;
  const group = boardwalk('East jetty', EAST_JETTY, [[EAST_JETTY.quay, EAST_JETTY.deck], [landing.x, EAST_JETTY.deck]]);
  // Through the rim and the plinth's edge, onto the market street itself.
  const inland = { x: landing.x + 5, z: EAST_JETTY.z };
  return {
    group, landing, inland,
    terrain: { layout: group, ground:/jetty-deck|jetty-ramp/, walkable: Infinity },
    opening: corridor(EAST_JETTY, inland.x),
  };
}

// A level boardwalk south from the city's south-east corner to the yard's
// pier, overlapping the paving at one end and the pier at the other. A
// boardwalk is built along x: laid on the line z = -x and turned a quarter,
// it runs down z on the line of the landing instead.
function createYardJetty(yard) {
  const { landing } = yard, { width, quay, deck } = SOUTH_JETTY;
  const group = boardwalk('South jetty', { z: -landing.x, width }, [[quay, deck], [landing.z, deck]]);
  group.rotation.y = -Math.PI / 2;
  // Past the pier's edge, onto the yard's open floor.
  const inland = { x: landing.x, z: landing.z + 5 };
  return {
    group, landing, inland,
    terrain: { layout: group, ground:/jetty-deck|jetty-ramp/, walkable: Infinity },
    opening: { x: landing.x, z: (quay + inland.z) / 2, w: width - 1.2, d: inland.z - quay },
  };
}

// A boardwalk north from the city's north quay to the end of the Nightwood's
// road: level past the quay's edge, a ramp up to the height of the road, and
// level again out over the wood's bank, where its end is buried a little in
// the turf, as the west jetty's is. Laid along x and turned, as the south
// jetty is.
function createNightwoodJetty(wood) {
  const { landing } = wood, { width, quay, edge, deck, pitch } = NORTH_JETTY;
  const top = edge - (landing.y - deck) / pitch;
  const group = boardwalk('North jetty', { z: -landing.x, width }, [[quay, deck], [edge, deck], [top, landing.y], [landing.z + 2, landing.y], [landing.z, landing.y - .3]]);
  group.rotation.y = -Math.PI / 2;
  // Up the road, between its banks.
  const inland = { x: landing.x, z: landing.z - 5 };
  return {
    group, landing, inland,
    terrain: { layout: group, ground:/jetty-deck|jetty-ramp/, walkable: Infinity },
    opening: { x: landing.x, z: (quay + inland.z) / 2, w: width - 1.2, d: quay - inland.z },
  };
}

// A boardwalk south from the pavement above the city's south quay to the foot
// of the mesa's gully: up a ramp high enough to step over the harbour wall,
// as the west jetty does, level across the wall and the water, and its end
// buried a little in the sand. Laid along x and turned, as the south jetty is.
function createMesaJetty(butte) {
  const { landing } = butte, { width, quay, pavement, pitch } = MESA_JETTY;
  const top = quay + (landing.y - pavement) / pitch;
  const group = boardwalk('Mesa jetty', { z: -landing.x, width }, [[quay, pavement], [top, landing.y], [landing.z - 2, landing.y], [landing.z, landing.y - .3]]);
  group.rotation.y = -Math.PI / 2;
  // Onto the plain, at the gully's foot.
  const inland = { x: landing.x, z: landing.z + 5 };
  return {
    group, landing, inland,
    terrain: { layout: group, ground:/jetty-deck|jetty-ramp/, walkable: Infinity },
    opening: { x: landing.x, z: (quay + inland.z) / 2, w: width - 1.2, d: inland.z - quay },
  };
}
