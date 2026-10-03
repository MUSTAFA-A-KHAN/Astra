// Traversal/rig regression suites resume past the arrival incident. Fresh
// startup, progression, and migration are covered in opening.spec.js.
export async function existingJourney(page) {
  await page.addInitScript(() => {
    const saved = JSON.parse(localStorage.getItem('astra-journey-v1') || '{}');
    saved.opening = { stage: 'complete' };
    localStorage.setItem('astra-journey-v1', JSON.stringify(saved));
  });
}
