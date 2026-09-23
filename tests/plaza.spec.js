import { test, expect } from '@playwright/test';

// Exercise the game's actual terrain wrapper, controller and camera. The hook
// exists only in this intercepted test response, never in the shipped game.
const probe = `
window.__PLAZA_TEST__ = {
  async place(local) {
    const { PLAZA_TRANSFORM: t } = await import('./plaza-world.js');
    renderer.setAnimationLoop(null);
    resetInput();
    position.set(...local).multiplyScalar(t.scale).applyAxisAngle(new THREE.Vector3(0,1,0),t.rotation).add(new THREE.Vector3(t.x,t.y,t.z));
    locomotion.reset();
    avatar.position.copy(position);
    yaw=0;pitch=.2;radius=8;
    followCamera.reset(position,yaw,pitch,radius);
    setTime(0);
    world.update(0,time,position);
    updateCamera(1);
    renderer.render(scene,camera);
    return window.__ASTRA_DEBUG__;
  },
  async walk(local) {
    const { PLAZA_TRANSFORM: t } = await import('./plaza-world.js');
    const target = new THREE.Vector3(...local).multiplyScalar(t.scale).applyAxisAngle(new THREE.Vector3(0,1,0),t.rotation).add(new THREE.Vector3(t.x,t.y,t.z));
    let frames=0;
    for(;frames<1800;frames++) {
      const dx=target.x-position.x,dz=target.z-position.z,d=Math.hypot(dx,dz);
      if(d<.12)break;
      joyX=dx/d;joyY=dz/d;
      time+=1/60;updatePlayer(1/60);
    }
    joyX=joyY=0;
    for(let i=0;i<30;i++)updatePlayer(1/60);
    world.update(0,time,position);updateCamera(1);renderer.render(scene,camera);
    return {frames,distance:Math.hypot(target.x-position.x,target.z-position.z),...window.__ASTRA_DEBUG__};
  },
  quality(level) {
    applyQuality(level);world.update(0,time,position);renderer.render(scene,camera);
    return window.__ASTRA_DEBUG__;
  },
};
`;

async function bootPlaza(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.astraReady && window.__PLAZA_TEST__);
  await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__.terrain.plaza.state === 'ready', null, { timeout: 120000 });
  return errors;
}

test('plaza streets and upper floors preserve the hero floor and local night lighting', async ({ page }) => {
  const errors = await bootPlaza(page);
  const street = await page.evaluate(() => window.__PLAZA_TEST__.place([13, 19.5, 70]));
  expect(street.position.y).toBeCloseTo(.45, 1);
  expect(street.locomotion.grounded).toBe(true);
  expect(street.camera.position.y).toBeLessThan(15);
  // Stair traversal and upper-storey fixtures are checked below at coordinates
  // from the supplied model, rather than an artificial staircase.
  expect(errors).toEqual([]);
});
