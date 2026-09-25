import { test, expect } from '@playwright/test';

// Exercise the game's actual terrain, controller and camera. The hook exists
// only in this intercepted test response, never in the shipped game. The
// patrols in the wood are put down first: a hero walking a fixed line past
// them would be fought, and sent back to the city.
const probe = `
window.__NIGHTWOOD_TEST__ = {
  place(x, z) {
    renderer.setAnimationLoop(null);
    for(const e of enemies){e.alive=false;e.respawn=1e9;}
    resetInput();
    position.set(x, world.getHeight(x, z), z);
    locomotion.reset();
    avatar.position.copy(position);
    yaw=0;pitch=.15;radius=8;
    followCamera.reset(position,yaw,pitch,radius);
    world.update(0,time,position);
  },
  walk(x, z) {
    for(let frames=0;frames<1800;frames++) {
      const dx=x-position.x,dz=z-position.z,d=Math.hypot(dx,dz);
      if(d<.12)break;
      joyX=dx/d;joyY=dz/d;
      time+=1/60;updatePlayer(1/60);
    }
    joyX=joyY=0;
    for(let i=0;i<30;i++)updatePlayer(1/60);
    const { terrain, locomotion: stride } = window.__ASTRA_DEBUG__;
    return {distance:Math.hypot(x-position.x,z-position.z),y:position.y,ground:terrain.height,region:world.biomeAt(position.x,position.z),inWater:stride.inWater};
  },
};
`;

test('the Nightwood is fetched only once turned on, and its road is walked from the north quay', async ({ page }) => {
  test.setTimeout(240000);
  const errors = [], requested = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  await page.route('**/game.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n${probe}` });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.astraReady && window.__NIGHTWOOD_TEST__);
  await expect(page.locator('#loading')).toBeHidden();
  const fetched = () => requested.filter(path => path.includes('/map/') || path.endsWith('/nightwood-world.js'));
  expect(fetched()).toEqual([]);

  // Turned on in the settings, it takes a fresh world, and only then is fetched.
  await page.getByRole('button', { name: 'Open settings' }).click();
  const setting = page.locator('#nightwood-setting');
  await expect(setting).not.toBeChecked();
  await Promise.all([page.waitForEvent('load'), setting.click()]);
  await page.waitForFunction(() => window.astraReady && window.__NIGHTWOOD_TEST__);
  await expect(page.locator('#loading')).toBeHidden();
  expect(fetched()).toEqual(expect.arrayContaining(['/nightwood-world.js', '/map/a_forest_3_with_a_road_at_night_for_game.glb']));
  const { terrain } = await page.evaluate(() => window.__ASTRA_DEBUG__);
  expect(terrain.assets).toHaveLength(5);
  expect(terrain.woodReachable).toBe(true);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(setting).toBeChecked();
  await page.getByRole('button', { name: 'Close menu' }).click();

  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
  // On the promenade along the north quay, then up the ramp, along the deck,
  // off its buried end, and round both of the road's bends to the far side.
  await page.evaluate(() => window.__NIGHTWOOD_TEST__.place(0, -146));
  const route = [[0,-155],[0,-165],[0,-176],[1,-197],[13,-207],[31,-215],[48,-223],[60,-235],[61,-247],[54,-258],[42,-268],[31,-279],[19,-290]];
  for (const [x, z] of route) {
    const step = await page.evaluate(([x, z]) => window.__NIGHTWOOD_TEST__.walk(x, z), [x, z]);
    expect(step.distance, `Could not reach ${x},${z}`).toBeLessThan(.2);
    expect(step.inWater, `In the water at ${x},${z}`).toBe(false);
    expect(Math.abs(step.y - step.ground), `Not standing on the ground at ${x},${z}`).toBeLessThan(.05);
    if (z <= -176) expect(step.region).toBe('nightwood');
  }
  expect(errors).toEqual([]);
});
