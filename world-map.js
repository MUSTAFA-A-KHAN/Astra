import * as THREE from 'three';
import { createNavigation } from './navigation.js';
import { CITY_ARRIVAL, loadCityDistrict } from './city-world.js';
import { loadForestDistrict } from './forest-world.js';

// The Verdant Reach is two supplied models standing in one harbour: the city
// on its quay, and the Forest Loner diorama moored off its western seawall.
// This module places them, joins them with a jetty, and hands the game a
// single piece of ground that spans both.
export const HARBOUR_LEVEL = -6.65;
// The crossing: a boardwalk on the pavement's line, high enough to step over
// the harbour wall, running out to the island's clearing.
const JETTY = { z: 11, width: 6, deck: 2.4, quay: -69.5, rise: -75 };

export async function createWorld(scene, { lowPower = false } = {}) {
  const [city, forest] = await Promise.all([loadCityDistrict({ lowPower }), loadForestDistrict({ lowPower, waterline: HARBOUR_LEVEL })]);
  const root = new THREE.Group(); root.name = 'The Verdant Reach';
  root.add(city.root, forest.root);
  // The city model includes canal banks, but no water surface. The level sits
  // inside those banks, below the supplied roads, and out past the seawall it
  // becomes the harbour the island stands in.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color:'#355a64', roughness:.34, metalness:.25 }));
  water.name = 'Harbour water'; water.rotation.x = -Math.PI/2; water.position.y = HARBOUR_LEVEL; water.receiveShadow = true; root.add(water);

  const jetty = createJetty(forest);
  root.add(jetty.group);
  const bounds = {
    minX: Math.min(city.bounds.minX, forest.bounds.minX) , maxX: Math.max(city.bounds.maxX, forest.bounds.maxX),
    minZ: Math.min(city.bounds.minZ, forest.bounds.minZ), maxZ: Math.max(city.bounds.maxZ, forest.bounds.maxZ),
  };
  const navigation = createNavigation([city.terrain, forest.terrain, jetty.terrain], bounds, { openings: [jetty.opening], arrival: CITY_ARRIVAL });
  // The island is only worth placing things on if the jetty actually reaches
  // it; findWalkable would otherwise quietly drop them back in the city.
  const forestReachable = navigation.isWalkable(jetty.landing.x, jetty.landing.z, 1);
  if (!forestReachable) console.warn('The jetty does not reach the island: its shore is unreachable from the city.');

  const landmarks = [
    { id:'shrine', name:'Moonwell Sanctuary', ...navigation.findWalkable(0,-50,4), color:'#83e6ee' },
    { id:'camp', name:'Wanderer’s Camp', ...navigation.findWalkable(-45,25,3), color:'#ffc681' },
    { id:'watch', name:'Sunstone Watch', ...navigation.findWalkable(50,-20,3), color:'#f1d087' },
    ...(forestReachable ? [{ id:'hollow', name:'The Loner’s Hollow', ...navigation.findWalkable(-118,4,2.2), color:'#9ad07a' }] : []),
  ];
  const markerGeometry=new THREE.OctahedronGeometry(1);
  const ringGeometry=new THREE.TorusGeometry(2,.055,6,48);
  const markers=[];
  for(const landmark of landmarks) {
    const group=new THREE.Group();group.name=landmark.name;group.position.set(landmark.x,landmark.y,landmark.z);root.add(group);
    const mat=new THREE.MeshStandardMaterial({color:landmark.color,emissive:landmark.color,emissiveIntensity:.9,metalness:.2,roughness:.3});
    const crystal=new THREE.Mesh(markerGeometry,mat);crystal.position.y=landmark.id==='shrine'?3.4:2.6;
    crystal.scale.set(landmark.id==='shrine'?.95:.6,landmark.id==='shrine'?1.7:1,.7);group.add(crystal);
    const ring=new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:landmark.color,transparent:true,opacity:.8,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.position.y=.12;group.add(ring);
    const light=new THREE.PointLight(landmark.color,5,10,2);light.position.y=2.6;group.add(light);
    markers.push({crystal,ring,light,baseHeight:crystal.position.y});
  }
  // Four of the shards and one of the patrols sit across the water, so the
  // island is somewhere the journey leads rather than only somewhere to look at.
  const cityShards = [[0,9],[1,0],[-1,-10],[2,-20],[0,-32],[-12,9],[-23,16],[-35,23],[-42,34],[-49,17],[14,-7],[25,-13],[36,-17],[47,-26],[55,-12],[-15,-42],[16,-43],[-28,-60],[30,-63],[60,30]];
  const forestShards = [[-96,8],[-105,14],[-118,4],[-125,16]];
  const shardPositions = [...cityShards, ...(forestReachable ? forestShards : [[-65,-10],[66,-48],[-25,60],[25,48]])];
  const enemyPositions = [[-9,-17],[12,-30],[-17,-38],[28,-24],[-33,-12],[45,-42],...(forestReachable ? [[-107,18]] : [])];

  let daylight=1;
  function setTime(hour) {
    daylight=THREE.MathUtils.clamp(Math.sin((hour-6)/12*Math.PI)*1.4,0,1);
    city.setTime(daylight);
    for(const marker of markers) {marker.crystal.material.emissiveIntensity=.75+(1-daylight)*.65;marker.light.intensity=2+(1-daylight)*7;}
  }
  function setQuality(level) {
    const low=level==='low'||level==='performance'||level===0;
    city.setQuality(low);forest.setQuality(low);
    for(const marker of markers) marker.light.visible=!low;
  }
  function update(dt,time) {
    for(let i=0;i<markers.length;i++) {
      const marker=markers[i];marker.crystal.rotation.y=time*.35+i;
      marker.crystal.position.y=marker.baseHeight+Math.sin(time*1.2+i)*.16;
      marker.ring.material.opacity=.6+Math.sin(time*.9+i)*.12;
    }
  }
  setQuality(lowPower?'low':'high');setTime(15.5);scene.add(root);
  const diagnostics={ready:true,provider:'astra-world-map',asset:city.asset,assets:[city.asset,forest.asset],
    meshCount:city.meshes.length+forest.meshes.length,forestReachable,shore:jetty.landing,...navigation.diagnostics};
  return {
    ...navigation,bounds,landmarks,shardPositions,enemyPositions,update,setTime,setQuality,diagnostics,
    // The ambience and the sky both read the ground the player is standing on.
    biomeAt(x,z) {
      return x>=forest.bounds.minX && x<=forest.bounds.maxX && z>=forest.bounds.minZ && z<=forest.bounds.maxZ ? 'forest' : 'city';
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
      scene.remove(root);
    },
  };
}

// A timber boardwalk from the waterfront pavement to the island's clearing.
// It steps over the harbour wall rather than through it, so the deck is the
// ground for as long as the crossing lasts — see the opening it declares.
function createJetty(forest) {
  const group = new THREE.Group(); group.name = 'Harbour jetty';
  const timber = new THREE.MeshStandardMaterial({ color:'#71503b', roughness:.94 });
  const iron = new THREE.MeshStandardMaterial({ color:'#3b4247', metalness:.6, roughness:.55 });
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

  function plank(fromX, fromY, toX, toY, width, thickness = .34) {
    const [x0,y0,x1,y1] = fromX <= toX ? [fromX,fromY,toX,toY] : [toX,toY,fromX,fromY];
    const length = Math.hypot(x1-x0, y1-y0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width), timber);
    mesh.rotation.z = Math.atan2(y1-y0, x1-x0);
    mesh.position.set((x0+x1)/2, (y0+y1)/2, JETTY.z);
    mesh.translateY(-thickness/2);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  }
  // Named for the navigator: the decking is floor, the rest is scenery.
  plank(JETTY.quay, .45, JETTY.rise, JETTY.deck, JETTY.width).name = 'jetty-ramp-quay';
  plank(JETTY.rise, JETTY.deck, deckEnd, JETTY.deck, JETTY.width).name = 'jetty-deck';
  // The landing is buried a little in the turf so the island's own ground,
  // not the plank, is the higher surface where the two meet.
  plank(deckEnd, JETTY.deck, landing.x, ground - .3, JETTY.width).name = 'jetty-ramp-shore';
  // Cross boards: a boardwalk this wide is a bare slab without them.
  const boards = new THREE.MeshStandardMaterial({ color:'#7d5b43', roughness:.96 });
  for (let x = JETTY.rise - .8; x > deckEnd; x -= 1.55) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(.9, .08, JETTY.width - .12), boards);
    board.position.set(x, JETTY.deck + .04, JETTY.z);
    board.receiveShadow = true; board.name = 'jetty-board'; group.add(board);
  }
  for (let x = JETTY.rise - 1.5; x > deckEnd; x -= 4.5) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(.4, JETTY.deck - HARBOUR_LEVEL + 1, .4), timber);
      post.position.set(x, (JETTY.deck + HARBOUR_LEVEL - 1) / 2, JETTY.z + side * (JETTY.width/2 - .35));
      post.castShadow = true; post.name = 'jetty-pile'; group.add(post);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.14, 1.1, .14), iron);
      rail.position.set(x, JETTY.deck + .55, post.position.z);
      rail.castShadow = true; rail.name = 'jetty-stanchion'; group.add(rail);
    }
  }
  for (const side of [-1, 1]) {
    const rope = new THREE.Mesh(new THREE.BoxGeometry(JETTY.rise - deckEnd, .1, .1), iron);
    rope.position.set((JETTY.rise + deckEnd)/2, JETTY.deck + 1.05, JETTY.z + side * (JETTY.width/2 - .35));
    rope.name = 'jetty-rail'; group.add(rope);
  }
  // The corridor runs a few strides past the landing: it has to clear the whole
  // of the island's rocky rim, or the first step off the planks is still walled
  // in. Every cell of it has ground — deck, ramp or turf — beneath it; opening
  // one that reaches past the decking over open water would clear a hole.
  const inland = landing.x - 4;
  return {
    group, landing,
    terrain: { layout: group, ground:/jetty-deck|jetty-ramp/, walkable: Infinity },
    opening: { x: (inland + JETTY.quay) / 2, z: JETTY.z, w: JETTY.quay - inland, d: JETTY.width - 1.2 },
  };
}
