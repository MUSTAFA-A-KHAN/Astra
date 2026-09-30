export const CHAPTER_THREE = Object.freeze({
  eyebrow: 'CHAPTER THREE', title: 'The Shared Flame',
  intro: 'The Tidewarden can speak again. Now the Reach must learn to answer: a light in every hand, instead of one keeper standing alone.',
});

export const MEMORY_IDS = Object.freeze(['root', 'rain', 'moon']);
export const MEMORY_FLAGS = Object.freeze(['memoryRoot', 'memoryRain', 'memoryMoon']);
export const LENS_FACES = Object.freeze(['SEA', 'HEARTH', 'SKY']);
export const LENS_TARGET = Object.freeze([2, 0, 1]);
export const RELAY_LAMPS = Object.freeze(['dusk', 'tide', 'dawn']);
export const RELAY_SECONDS = 90;
export const RECORD_FLAGS = Object.freeze(['recordNorth', 'recordWest', 'recordEast']);
export const BOSS_HP = 1000;
const FLAGS = ['accepted', ...MEMORY_FLAGS, 'lenses', 'relay', 'metIlyra', ...RECORD_FLAGS, 'metOren', 'boss', 'complete'];

export function readChapterThree(saved) {
  return Object.fromEntries(FLAGS.map(flag => [flag, saved?.chapterThree?.[flag] === true]));
}

export function chapterThreeUnlocked(progress = {}) {
  return progress.restored === true && progress.story?.farewell === true &&
    ['accepted', 'roots', 'bells', 'valves', 'vigil', 'warden', 'complete'].every(flag => progress.chapterTwo?.[flag] === true);
}

export const CHAPTER_THREE_STEPS = [
  { id: 'summons', map: 'mesa', where: 'MOONWELL', title: 'A light in every hand',
    description: 'Listen at the meridian seal beside the Moonwell. The Tidewarden has remembered what the keepers left behind.',
    recap: 'The Tidewarden asked you to rekindle a shared flame, so no keeper would have to stand watch alone.' },
  { id: 'memories', map: 'forest', where: 'PINE ISLET', title: 'Those who kept the watch',
    description: 'Read the book at the city portal and cast the passage to Pine Islet. Listen to the memories in the root, rain and moon stones. Each remembers one part of the shared flame.',
    recap: 'A gardener, a ferryman and a child each carried the light. You recovered all three memories.' },
  { id: 'lenses', map: 'forest', where: 'PINE ISLET', title: 'No light turns alone',
    description: 'Read the root tablet, then turn the three lenses: ROOT to SKY, RAIN to SEA, MOON to HEARTH. Each turn also moves the next lens: root → rain → moon → root.',
    recap: 'You aligned the linked lenses and joined the three memories into a living flame.' },
  { id: 'relay', map: 'yard', where: 'SKIBIDI YARD', title: 'Ninety seconds of dawn',
    description: 'Cast the islet portal spell to reach the yard. Read the pressure ledger for instructions. Take a flame from the beacon, light the DUSK, TIDE and DAWN lamps in any order, then return it to the beacon within 90 seconds.',
    recap: 'You carried the flame through all three lamps and returned before it faded. The yard can keep its own light.' },
  { id: 'threshold', map: 'observatory', where: 'ASHEN OBSERVATORY', title: 'The shore erased from every chart',
    description: 'The shared flame reveals a new passage in the yard’s portal book. Cast it to the Ashen Observatory and speak with Ilyra, the astronomer waiting beside its broken instruments.',
    recap: 'Ilyra revealed that the Long Tide erased a whole island from the Reach’s memory.' },
  { id: 'records', map: 'observatory', where: 'ASHEN OBSERVATORY', title: 'Three accounts of the same night',
    description: 'Explore the observatory’s north, west and east memorials. Recover the missing accounts of the night the stars went dark.',
    recap: 'The memorials revealed a deliberate sacrifice: the keepers hid the island to stop the Long Tide reaching the harbour.' },
  { id: 'witness', map: 'observatory', where: 'ASHEN OBSERVATORY', title: 'The name that would not drown',
    description: 'Find Oren at the southern watch. Tell the lost apprentice what the memorials remember, and learn what is feeding on the island’s silence.',
    recap: 'Oren named the Unwritten, a hunger that grows wherever people are forgotten. The shared flame can expose its heart.' },
  { id: 'boss', map: 'observatory', where: 'THE STAR CHAMBER', title: 'Break the Unwritten',
    description: 'Challenge the Unwritten at the central star chamber. Escape or jump its red pulse, then attack its exposed gold heart. At two-thirds and one-third health, destroy its echo guards to break their shield.',
    recap: 'The Unwritten broke apart. Ilyra and Oren’s island returned to the Reach’s memory.' },
  { id: 'homecoming', map: 'mesa', where: 'MOONWELL', title: 'The watch belongs to everyone',
    description: 'Read the observatory portal book and cast the homeward spell. Return to the meridian seal beside the Moonwell and share the flame with the Reach.',
    recap: 'The Reach took up the watch together. Maren’s light became a beginning, no longer a burden.' },
  { id: 'complete', map: 'mesa', where: 'THE VERDANT REACH', title: 'A thousand small beginnings',
    description: 'The shared flame burns from the roots to the harbour. The portals remain open, and the Reach is yours to explore.',
    recap: 'You gave the Reach a light that belongs to everyone.' },
];

export function chapterThreeStep(state = {}) {
  const index = !state.accepted ? 0 : !MEMORY_FLAGS.every(flag => state[flag] === true) ? 1 :
    !state.lenses ? 2 : !state.relay ? 3 : !state.metIlyra ? 4 : !RECORD_FLAGS.every(flag => state[flag] === true) ? 5 :
    !state.metOren ? 6 : !state.boss ? 7 : !state.complete ? 8 : 9;
  return CHAPTER_THREE_STEPS[index];
}

// A lens drives its clockwise neighbour. Three turns always undo a move.
export function turnLens(faces, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 3) return [...faces];
  return faces.map((face, i) => (face + (i === index || i === (index + 1) % 3 ? 1 : 0)) % 3);
}
export const lensesAligned = faces => faces.length === 3 && faces.every((face, i) => face === LENS_TARGET[i]);

export const CHAPTER_THREE_PEOPLE = {
  sharedSeal: { name: 'The meridian seal', title: 'The shared flame', color: '#f6d99b', read: true },
  memoryRoot: { name: 'The gardener’s memory', title: 'Root stone', color: '#9ad07a', read: true },
  memoryRain: { name: 'The ferryman’s memory', title: 'Rain stone', color: '#72c8ef', read: true },
  memoryMoon: { name: 'The child’s memory', title: 'Moon stone', color: '#d5b6fa', read: true },
  lensTablet: { name: 'The keeper lenses', title: 'Pine Islet', color: '#f6d99b', read: true },
  relayLedger: { name: 'The lamplighter’s ledger', title: 'The pumping yard', color: '#f6d99b', read: true },
  sharedVoice: { name: 'The Tidewarden', title: 'Guardian of the passage', color: '#8bdcff' },
  ilyra: { name: 'Ilyra', title: 'Astronomer of the lost shore', color: '#b8c5ff' },
  oren: { name: 'Oren', title: 'The apprentice who stayed', color: '#ffce8d' },
  recordNorth: { name: 'The northern memorial', title: 'An astronomer’s account', color: '#b8c5ff', read: true },
  recordWest: { name: 'The western memorial', title: 'The keeper council', color: '#b8c5ff', read: true },
  recordEast: { name: 'The eastern memorial', title: 'An unfinished letter', color: '#ffce8d', read: true },
};
const narration = (...text) => ({ lines: text.map(line => [null, line]) });

export function chapterThreeConversation(person, state = {}) {
  if (!Object.hasOwn(CHAPTER_THREE_PEOPLE, person)) return null;
  const step = chapterThreeStep(state).id;
  if (person === 'sharedSeal') {
    if (step === 'summons') return { sets: 'accepted', lines: [
      [null, 'The seal is warm. Beneath the stone, the Tidewarden takes a breath that stirs every wish-coin in the well.'],
      ['sharedVoice', 'We promised that no keeper would stand alone. A promise needs hands, little light. Mine can guard the passage. Yours can carry the flame.'],
      ['sharedVoice', 'On Pine Islet, three stones remember the people who once shared the watch. Hear them. Turn their lenses together. Bring their flame to the yard. Its light may reveal the shore we lost.'],
      [null, 'In Maren’s ledger, three words brighten: root, rain, moon. The city portal still knows the way.'],
    ] };
    if (step === 'homecoming') return { sets: 'complete', lines: [
      [null, 'You open your hands above the seal. The flame divides into a hundred small lights, and not one grows dimmer.'],
      ['sharedVoice', 'The gardener kept it through the winter. The ferryman carried it over dark water. A child left it in a window for someone who was late.'],
      ['sharedVoice', 'Maren thought she was the last. She was only the one who remembered. Now the Reach remembers with her.'],
      [null, 'Across the harbour, windows answer. The yard’s lamps hold steady. Under Pine Islet, the roots shine like a map of all the roads home.'],
      ['sharedVoice', 'And beyond them, Ilyra lights her telescope. Oren writes his name in a new ledger. No shore, and no soul, will be left outside our remembering.'],
      [null, 'At the bottom of the Moonwell, a wish-coin settles. For the first time, the watch belongs to everyone.'],
    ] };
    return narration(step === 'complete' ? 'The shared flame burns steadily. Somewhere across the Reach, someone is lighting a lamp for someone else.' : 'Three memories, three lenses, three lamps. The Reach is waiting for a flame it can share.');
  }
  if (!state.accepted) return narration('The stone listens toward the Moonwell. Hear the Tidewarden at the meridian seal first.');
  if (person === 'ilyra') return { ...(step === 'threshold' ? { sets: 'metIlyra' } : {}), lines: [
    ['ilyra', 'A living flame. I had almost forgotten its colour. I am Ilyra. I charted these stars before the sea learned how to swallow names.'],
    ['ilyra', 'We hid this shore from the Long Tide. But something stayed behind in the silence. It eats every memory we let go.'],
    ['ilyra', 'Read the three memorials: north, west and east. Then find Oren at the southern watch. He remembers the name I cannot bear to say.'],
  ] };
  if (RECORD_FLAGS.includes(person)) {
    const words = {
      recordNorth: ['“The stars did not go out. We covered the lens. The signal would have led the Long Tide straight to the harbour.” — Ilyra', 'Someone has underlined WE. The island was hidden by its own keepers.'],
      recordWest: ['“Let our shore be forgotten, if the Reach can live. Leave one witness. One name may be enough to find the road back.” — the keeper council', 'Below the decree, a younger hand has written: “Who will remember the witness?”'],
      recordEast: ['“Maren, I volunteered. Tell them I was not lost. Tell them I stayed. Your friend, Oren.”', 'The letter was never sent. A small lantern has burned beside it for twenty years.'],
    };
    return { ...narration(...words[person]), ...(step === 'records' && !state[person] ? { sets: person } : {}) };
  }
  if (person === 'oren') return { ...(step === 'witness' ? { sets: 'metOren' } : {}), lines: [
    ['oren', 'You read the letter. Then she did not forget me. It simply never reached her.'],
    [null, 'You tell Oren about the Moonwell, the ferryman, and the light Maren kept burning. His lantern steadies.'],
    ['oren', 'The thing in the star chamber calls itself the Unwritten. It wears our missing years like armour. Your shared flame can open its heart.'],
    ['oren', 'Wait for the red circle to break. Jump or leave its reach, then strike the gold heart. Twice it will call guards; while they live, its shield cannot break.'],
    ['oren', 'If you fall, come back. This time someone will remember you.'],
  ] };
  const memory = MEMORY_FLAGS.indexOf(person);
  if (memory >= 0) {
    const lines = [
      ['A gardener cups a flame between earth-stained hands. “I kept it through the winter, so the seeds would remember the sun.”', 'The ROOT lens must face the SKY.'],
      ['A ferryman hangs a lantern over black water. “I carried it for those who could no longer see the shore.”', 'The RAIN lens must face the SEA.'],
      ['A child leaves a light in a window. “Someone is still on their way. We should make the house easy to find.”', 'The MOON lens must face the HEARTH.'],
    ][memory];
    return { ...narration(...lines), ...(step === 'memories' && !state[person] ? { sets: person } : {}) };
  }
  if (person === 'lensTablet') return narration(
    'ROOT looks to SKY. RAIN looks to SEA. MOON looks to HEARTH. The three memories show the way.',
    'Every turn moves two lenses: root moves rain, rain moves moon, moon moves root. Faces cycle SEA → HEARTH → SKY. Three turns undo a move.',
    'Read the current faces in your tracker and beside each turn prompt. Nothing is lost by experimenting; there is no timer.',
  );
  if (person === 'relayLedger') return narration(
    'Take the shared flame from the meridian beacon. Light the lamps under the DUSK, TIDE and DAWN bells in any order, then bring it back to the beacon.',
    'You have 90 seconds, including the return. Already lit lamps do not refresh the flame. Your guide points to the nearest unlit lamp.',
    'If it fades, you fall, or you leave the yard, take a new flame from the beacon. Completed memories and lenses stay safe. Menus and conversations pause the clock.',
  );
  return narration('A light in every hand. No keeper alone.');
}
