import { test, expect } from '@playwright/test';

const previous = { quality: 'low', sound: false, hero: 'warden', restored: true, kills: 3, collected: [0,1,2,3,4], story: { keeper: true, ferryman: true, ledger: true, farewell: true, notice: true }, chapterTwo: Object.fromEntries(['accepted','roots','bells','valves','vigil','warden','complete'].map(flag => [flag,true])) };
// Test-only movement and clock control. UI events, quest gates, combat damage,
// terrain loading, collision placement and localStorage use production code.
const probe = `
renderer.setAnimationLoop(null);
window.__THREE_TEST__={
  render(){chapterThree.update(0,0,position,{active:false});chapterThree.root.visible=true;world.update(0,0,position);updateHUD();drawMap();camera.position.set(position.x+15,position.y+14,position.z+18);camera.lookAt(position.x,position.y+2,position.z);renderer.render(scene,camera);},
  place(id){const p=id==='keeper-spellbook'?portal.places.reading:chapterThree.places[id];position.set(p.x,p.y,p.z);if(p.facing!==undefined&&id!=='keeper-spellbook'){position.x+=Math.sin(p.facing)*3.4;position.z+=Math.cos(p.facing)*3.4;}locomotion.reset();avatar.position.copy(position);closed.at=0;const near=nearbyInteraction();$('interaction-hint').hidden=!near;if(near)$('interaction-text').textContent=near.label;this.render();return near;},
  async finishCrossing(){for(let i=0;i<1200&&portalJourney;i++){time+=.05;portal.update(.05,time);updatePortalJourney(.05);await new Promise(resolve=>setTimeout(resolve,5));}if(portalJourney)throw Error('Portal did not finish: '+portalJourney.phase);this.render();return world.activeMap;},
  tick(seconds,active=true){for(let t=0;t<seconds;t+=.05){hurtTimer=Math.max(0,hurtTimer-.05);chapterThree.update(.05,t,position,{active:active&&!dialog.open&&!chat});}this.render();},
  retreat(){const p=chapterThree.places.unwritten;position.set(p.x+14,p.y,p.z);avatar.position.copy(position);},
  hit(guard=false){const f=chapterThree.combatants.find(f=>f.alive&&f.boss!==guard);if(!f)return;position.copy(f.group.position);position.x+=1.5;avatar.position.copy(position);attackTimer=0;attack(false);this.render();},
  fallen(){respawnPlayer();this.render();},
  summary(){return {step:currentStep().id,...chapterThree.diagnostics,map:world.activeMap,goal:questObjective(),portal:portalRoute(progress,world.activeMap)};},
  overview(){position.set(400,3,-305);world.update(0,0,position);chapterThree.update(0,0,position,{active:false});camera.position.set(485,115,-205);camera.lookAt(400,3,-320);renderer.render(scene,camera);},
};
`;
async function boot(page,saved=previous) {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(saved=>{if(!sessionStorage.getItem('three-seeded')){localStorage.setItem('astra-journey-v1',JSON.stringify(saved));sessionStorage.setItem('three-seeded','yes');}},saved);
  await page.route('**/game.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n'+probe});});
  await page.goto('/');await page.waitForFunction(()=>window.astraReady&&window.__THREE_TEST__,null,{timeout:120000});
  await page.locator('#play-button').click();return errors;
}
const state=page=>page.evaluate(()=>window.__THREE_TEST__.summary());
async function use(page,id) {
  const near=await page.evaluate(id=>window.__THREE_TEST__.place(id),id);expect(near?.id).toBe(id);
  if(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches))await page.locator('#interact-button').click();
  else await page.keyboard.press('f');
  await page.evaluate(()=>window.__THREE_TEST__.render());
}
async function read(page,id) {
  await use(page,id);await expect(page.locator('#conversation')).toBeVisible();
  // The existing skip control is also available to a keyboard on touch devices.
  await page.keyboard.press('Escape');await expect(page.locator('#conversation')).toBeHidden();
}
async function travel(page,map) {
  await use(page,'keeper-spellbook');
  if(await page.locator('#menu-dialog').isVisible())await page.locator(`[data-portal-destination="${map}"]`).click();
  await expect(page.locator('#conversation')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#conversation')).toBeHidden();
  expect(await page.evaluate(()=>window.__THREE_TEST__.finishCrossing())).toBe(map);
  expect(await page.evaluate(()=>window.__ASTRA_DEBUG__.terrain.residentMaps)).toEqual([map]);
}

test('Chapter Three plays from the saved meridian ending through the lost shore and final return',async({page})=>{
  test.setTimeout(300000);const errors=await boot(page);
  await expect(page.locator('#quest-eyebrow')).toHaveText('CHAPTER THREE · THE SHARED FLAME');
  expect((await state(page)).map).toBe('city');
  await travel(page,'mesa');await read(page,'sharedSeal');
  await travel(page,'city');await travel(page,'forest');
  for(const id of ['memoryRain','memoryRoot','memoryMoon'])await read(page,id);
  expect((await state(page)).step).toBe('lenses');await read(page,'lensTablet');
  for(const id of ['lensRoot','lensRoot','lensRain'])await use(page,id);
  expect((await state(page)).step).toBe('relay');await travel(page,'yard');
  await read(page,'relayLedger');await use(page,'flame');
  await page.locator('#journal-button').click();await page.evaluate(()=>window.__THREE_TEST__.tick(100));
  expect((await state(page)).remaining).toBe(90);await page.keyboard.press('Escape');
  await page.evaluate(()=>window.__THREE_TEST__.tick(91));expect((await state(page)).remaining).toBe(0);
  await use(page,'flame');await use(page,'lampDusk');await page.evaluate(()=>window.__THREE_TEST__.fallen());expect((await state(page)).lamps).toEqual([]);
  await use(page,'flame');for(const id of ['lampTide','lampDawn','lampDusk'])await use(page,id);await use(page,'flame');
  expect((await state(page)).step).toBe('threshold');
  await travel(page,'observatory');
  await page.evaluate(()=>window.__THREE_TEST__.overview());await page.screenshot({path:test.info().outputPath('observatory.png')});
  await read(page,'ilyra');for(const id of ['recordWest','recordNorth','recordEast'])await read(page,id);
  await read(page,'oren');expect((await state(page)).step).toBe('boss');
  await page.reload();await page.waitForFunction(()=>window.astraReady&&window.__THREE_TEST__,null,{timeout:120000});await page.locator('#play-button').click();
  expect((await state(page)).map).toBe('observatory');expect((await state(page)).step).toBe('boss');
  await use(page,'unwritten');await page.evaluate(()=>window.__THREE_TEST__.hit());expect((await state(page)).combat.enemies[0].hp).toBe(1000);
  await page.evaluate(()=>window.__THREE_TEST__.fallen());expect((await state(page)).combat.active).toBe(false);await use(page,'unwritten');
  await page.screenshot({path:test.info().outputPath('unwritten.png')});
  for(const phase of [1,2,3]) {
    await page.evaluate(()=>{window.__THREE_TEST__.retreat();window.__THREE_TEST__.tick(3.3);});
    for(let n=0;n<80&&(await state(page)).combat.active&&(await state(page)).combat.phase===phase;n++)await page.evaluate(()=>window.__THREE_TEST__.hit());
    for(let n=0;n<40&&(await state(page)).combat.enemies.some(e=>e.alive&&!e.boss);n++)await page.evaluate(()=>window.__THREE_TEST__.hit(true));
  }
  expect((await state(page)).step).toBe('homecoming');await travel(page,'city');await travel(page,'mesa');await read(page,'sharedSeal');
  await expect(page.locator('#quest-count')).toHaveText('COMPLETE');
  await page.locator('#journal-button').click();await expect(page.locator('#dialog-eyebrow')).toContainText('THE SHARED FLAME');
  for(const title of ['Chapter Two · The Drowned Meridian','Chapter One · The Last Keeper'])await expect(page.locator('#menu-dialog')).toContainText(title);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('astra-journey-v1')));expect(saved.chapterThree.complete).toBe(true);expect(saved.chapterTwo.complete).toBe(true);
  await page.reload();await page.waitForFunction(()=>window.astraReady&&window.__THREE_TEST__,null,{timeout:120000});expect((await state(page)).step).toBe('complete');
  expect((await state(page)).map).toBe('mesa');
  expect(errors).toEqual([]);
});
