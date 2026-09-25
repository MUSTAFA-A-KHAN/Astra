/** Local files; source authors, license URLs and edits are in assets/audio/CREDITS.md. */
export const AUDIO_ASSETS = Object.freeze({
  // Recordings of someone walking, cut into single steps as they load: each
  // stride plays one, drawn from every recording of the ground underfoot.
  walkDirt: { files: ['walks/soumages-walking-on-dirt-363354.ogg'], steps: true, volume: .1},
  walkGrass: { files: ['walks/freesound_community-walking-through-grass-80308.ogg', 'walks/joentnt-walk-on-grass-2-291985.ogg'], steps: true, volume: .2 },
  walkGravel: { files: ['walks/kokoreli777-walking-on-a-gravel-169409.ogg'], steps: true, volume: .1 },
  walkWater: { files: ['walks/alex_jauk-walking-in-water-199418.ogg'], steps: true, volume: .5 },
  walkHorse: { files: ['walks/yodguard-horse-walking-sound-4-450266.ogg'], steps: true, volume: .4 },
  sword: { files: ['sword-1.ogg', 'sword-2.ogg'], volume: .7 },
  jump: { files: ['jump.ogg'], volume: .4 },
  landing: { files: ['landing.ogg'], volume: .6 },
  climb: { files: ['climb.ogg'], volume: .65 },
  hit: { files: ['hit-1.ogg', 'hit-2.ogg'], volume: .7 },
  interaction: { files: ['interaction.ogg'], volume: .55 },
  breathing: { files: ['breathing.ogg'], bus: 'effects', volume: .03 },
  wind: { files: ['wind.ogg'], bus: 'ambience', volume: .55 },
  birds: { files: ['birds.ogg'], bus: 'ambience', volume: .5 },
  market: { files: ['market.ogg'], bus: 'ambience', volume: .38 },
  animals: { files: ['animals.ogg'], bus: 'ambience', volume: .55 },
  blacksmith: { files: ['blacksmith.ogg'], bus: 'ambience', volume: .7 },
  water: { files: ['water.ogg'], bus: 'ambience', volume: .6 },
  fire: { files: ['fire.ogg'], bus: 'ambience', volume: .55 },
  musicExploration: { files: ['music-exploration.ogg'], bus: 'music', volume: .7 },
  musicSuspicion: { files: ['music-suspicion.ogg'], bus: 'music', volume: .65 },
  musicCombat: { files: ['music-combat.ogg'], bus: 'music', volume: .75 },
  musicVictory: { files: ['music-victory.ogg'], bus: 'music', volume: .75 },
});
