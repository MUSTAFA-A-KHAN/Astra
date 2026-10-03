import { test, expect } from '@playwright/test';
import { existingJourney } from './existing-journey.js';

test('jj-mo-jj can be selected and uses Spiderman’s full animation library', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Asset validation runs once on desktop.');
  test.setTimeout(240000);
  await existingJourney(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.astraReady === true);
  await page.locator('[data-hero="jj-mo-jj"]').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.hero === 'jj-mo-jj' && !window.__ASTRA_DEBUG__.switching);
  await expect(page.locator('[data-hero="jj-mo-jj"]')).toHaveAttribute('aria-pressed', 'true');
  const result = await page.evaluate(async () => {
    const { createHero } = await import('/characters.js');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    const [original, supplied] = await Promise.all([
      loader.loadAsync('/gwen_stacy.glb'), loader.loadAsync('/jj-mo-jj.glb'),
    ]);
    const hero = await createHero('jj-mo-jj');
    const names = [];
    const missingBindings = [];
    for (const clip of supplied.animations) {
      names.push(clip.name);
      for (const track of clip.tracks) {
        if (!supplied.scene.getObjectByName(track.name.split('.')[0])) missingBindings.push(track.name);
      }
    }
    const selected = hero.diagnostics.selectedAnimations;
    const states = ['Idle', 'Walk', 'Run', 'Jump', 'Attack', ...Object.keys(selected.emotes), ...Object.keys(selected.actions), 'Read'];
    let invalidTransforms = 0;
    for (const state of states) {
      hero.cue(state);
      for (let frame = 0; frame < 60; frame++) {
        hero.animate(1 / 30, { state, speed: state === 'Run' ? 8 : state === 'Walk' ? 3 : 0,
          moving: state === 'Walk' || state === 'Run', time: frame / 30, fidget: false });
        hero.group.updateMatrixWorld(true);
        hero.group.traverse(object => {
          if (object.isBone && !object.matrixWorld.elements.every(Number.isFinite)) invalidTransforms++;
        });
      }
    }
    hero.dispose();
    return { names: names.sort(), originalNames: original.animations.map(clip => clip.name).sort(),
      missingBindings: [...new Set(missingBindings)], selected, invalidTransforms };
  });
  expect(result.names).toEqual(result.originalNames);
  expect(result.missingBindings).toEqual([]);
  expect(result.invalidTransforms).toBe(0);
  expect(result.selected.emotes.Dance).toHaveLength(4);
  expect(Object.keys(result.selected.emotes)).toEqual(expect.arrayContaining(['Wave', 'Cheer', 'Sing']));
  expect(result.selected.read.loop).toMatch(/Read_Loop/);
  expect(result.selected.injured.walk).toBeTruthy();
  await page.locator('#play-button').click();
  await page.waitForFunction(() => window.__ASTRA_DEBUG__?.screen === 'game');
  await page.screenshot({ path: testInfo.outputPath('jj-mo-jj.png') });
  expect(errors).toEqual([]);
});
