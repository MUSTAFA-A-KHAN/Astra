import { test, expect } from '@playwright/test';

// Only intercepted test responses expose movement/time controls. Interactions,
// conversations, hit detection and saves still run through the shipped game.
const probe = `
renderer.setAnimationLoop(null);
window.__CHAPTER_TEST__ = {
  place(id) {
    const p=chapterTwo.places[id],offset=p.facing===undefined?0:3.4;
    position.set(p.x+Math.sin(p.facing||0)*offset,p.y,p.z+Math.cos(p.facing||0)*offset);
    locomotion.reset();avatar.position.copy(position);resetInput();
    chapterTwo.update(0,time,position,{active:false});
    const near=nearbyInteraction();$('interaction-hint').hidden=!near;
    if(near)$('interaction-text').textContent=near.label;
    updateHUD();followCamera.reset(position,0,.5,16);updateCamera(1);renderer.render(scene,camera);
    return near;
  },
  tick(seconds,active=true) {
    for(let elapsed=0;elapsed<seconds;elapsed+=.05){time+=.05;hurtTimer=Math.max(0,hurtTimer-.05);attackTimer=Math.max(0,attackTimer-.05);chapterTwo.update(.05,time,position,{active});}
    updateHUD();return window.__ASTRA_DEBUG__;
  },
  hit(index=0) {
    const f=chapterTwo.combatants.filter(f=>f.alive)[index];if(!f)return;
    position.copy(f.group.position);position.x+=1.5;avatar.position.copy(position);
    attackTimer=0;attack(false);updateHUD();
    return window.__ASTRA_DEBUG__;
  },
  retreat() {const p=chapterTwo.places.warden;position.set(p.x-12,p.y,p.z);},
  fallen() {respawnPlayer();updateHUD();},
  sites() {return Object.entries(chapterTwo.places).map(([id,p])=>({id,map:world.biomeAt(p.x,p.z),walkable:world.isWalkable(p.x,p.z,.52)}));},
};
`;
const snapshot = page => page.evaluate(() => window.__ASTRA_DEBUG__);
const state = async page => (await snapshot(page)).chapterTwo;
async function boot(page, saved = {}) {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(saved => {if(!sessionStorage.getItem('chapter-seeded')){localStorage.setItem('astra-journey-v1',JSON.stringify({quality:'low',sound:false,...saved}));sessionStorage.setItem('chapter-seeded','yes');}},saved);
  await page.route('**/game.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\n'+probe});});
  await page.goto('/');await page.waitForFunction(()=>window.astraReady&&window.__CHAPTER_TEST__,null,{timeout:120000});
  await page.locator('#play-button').click();
  return errors;
}
async function use(page,id){
  const nearby=await page.evaluate(id=>window.__CHAPTER_TEST__.place(id),id);
  expect(nearby?.id).toBe(id);
  if(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches))await page.locator('#interact-button').click();
  else await page.keyboard.press('f');
}
async function read(page,id){
  await use(page,id);await expect(page.locator('#conversation')).toBeVisible();
  if(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches)){
    for(let i=0;i<30&&await page.locator('#conversation').isVisible();i++)await page.locator('#conversation').click();
  }else await page.keyboard.press('Escape');
  await expect(page.locator('#conversation')).toBeHidden();
}
const chapterOneDone={restored:true,kills:3,collected:[0,1,2,3,4],story:{keeper:true,ferryman:true,ledger:true,farewell:true,notice:true}};

test('Chapter Two waits for Tobin’s farewell and keeps its trials on their own maps',async({page})=>{
  test.setTimeout(180000);const errors=await boot(page);
  await expect(page.locator('#quest-eyebrow')).toContainText('CHAPTER ONE');
  expect((await state(page)).unlocked).toBe(false);
  const sites=await page.evaluate(()=>window.__CHAPTER_TEST__.sites());
  for(const id of ['rootTablet','root','rain','moon'])expect(sites.find(p=>p.id===id)).toMatchObject({map:'forest',walkable:true});
  for(const id of ['bellTablet','dusk','tide','dawn','beacon'])expect(sites.find(p=>p.id===id)).toMatchObject({map:'plaza',walkable:true});
  for(const id of ['valvePanel','valve1','valve2','valve3','warden'])expect(sites.find(p=>p.id===id)).toMatchObject({map:'yard',walkable:true});
  expect(errors).toEqual([]);
});

test('The Drowned Meridian plays through puzzles, retries, waves, boss and saved ending',async({page})=>{
  test.setTimeout(300000);const errors=await boot(page,chapterOneDone);
  await expect(page.locator('#quest-eyebrow')).toHaveText('CHAPTER TWO · THE DROWNED MERIDIAN');
  await read(page,'chart');expect((await state(page)).step).toBe('roots');
  await read(page,'rootTablet');
  await page.screenshot({path:`test-results/chapter-two-${test.info().project.name}-forest.png`});
  await use(page,'rain');expect((await state(page)).runeIndex).toBe(0);
  for(const id of ['root','rain','moon'])await use(page,id);
  expect((await state(page)).step).toBe('bells');
  await read(page,'bellTablet');
  await page.screenshot({path:`test-results/chapter-two-${test.info().project.name}-plaza.png`});
  await use(page,'dawn');expect((await state(page)).bellIndex).toBe(0);
  for(const id of ['dusk','tide','dawn'])await use(page,id);
  expect((await state(page)).step).toBe('valves');
  await read(page,'valvePanel');await use(page,'valve1');
  await page.screenshot({path:`test-results/chapter-two-${test.info().project.name}-yard.png`});
  await page.evaluate(()=>window.__CHAPTER_TEST__.tick(46,false));
  expect((await state(page)).valveTime).toBe(45);
  await page.evaluate(()=>window.__CHAPTER_TEST__.tick(46));
  expect((await state(page)).valves).toEqual([]);
  for(const id of ['valve2','valve1','valve3'])await use(page,id);
  expect((await state(page)).step).toBe('vigil');
  await page.reload();await page.waitForFunction(()=>window.astraReady&&window.__CHAPTER_TEST__,null,{timeout:120000});await page.locator('#play-button').click();
  expect((await state(page)).flags).toMatchObject({roots:true,bells:true,valves:true,vigil:false});
  await use(page,'beacon');expect((await state(page)).wave).toBe(1);
  await page.evaluate(()=>window.__CHAPTER_TEST__.fallen());expect((await state(page)).arena).toBe(null);
  await use(page,'beacon');
  for(const wave of [1,2,3]){
    expect((await state(page)).wave).toBe(wave);
    expect((await state(page)).enemies.filter(e=>e.alive)).toHaveLength(wave+1);
    for(let attacks=0;attacks<80&&(await state(page)).enemies.some(e=>e.alive);attacks++)await page.evaluate(()=>window.__CHAPTER_TEST__.hit());
    expect((await state(page)).enemies.every(e=>!e.alive)).toBe(true);
    await page.evaluate(()=>window.__CHAPTER_TEST__.tick(2.1));
  }
  expect((await state(page)).step).toBe('warden');
  await use(page,'warden');await page.evaluate(()=>window.__CHAPTER_TEST__.hit());
  expect((await state(page)).enemies[0].hp).toBe(600);
  await page.evaluate(()=>{window.__CHAPTER_TEST__.retreat();window.__CHAPTER_TEST__.tick(3.5);});
  await expect(page.locator('#chapter-status')).toContainText('SHIELD DOWN');
  for(let attacks=0;attacks<60&&(await state(page)).step==='warden';attacks++)await page.evaluate(()=>window.__CHAPTER_TEST__.hit());
  expect((await state(page)).step).toBe('homecoming');
  await read(page,'seal');expect((await state(page)).step).toBe('complete');
  await expect(page.locator('#quest-count')).toHaveText('COMPLETE');
  await page.locator('#journal-button').click();await expect(page.locator('#dialog-content')).toContainText('The sea remembers your name');
  await page.screenshot({path:'test-results/chapter-two-complete.png'});
  await page.reload();await page.waitForFunction(()=>window.astraReady&&window.__CHAPTER_TEST__,null,{timeout:120000});
  expect((await state(page)).step).toBe('complete');expect((await snapshot(page)).story.restored).toBe(true);
  expect(errors).toEqual([]);
});
