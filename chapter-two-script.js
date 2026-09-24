// Chapter Two keeps its saved milestones separate from The Last Keeper.
// Conversations supply clues; the world runtime awards each completed trial.
export const CHAPTER_TWO = Object.freeze({
  eyebrow: 'CHAPTER TWO',
  title: 'The Drowned Meridian',
  intro: 'The Moonwell is awake. Far beyond its light, something is answering with a stolen voice.',
});

export const RUNE_ORDER = Object.freeze(['root', 'rain', 'moon']);
export const BELL_ORDER = Object.freeze(['dusk', 'tide', 'dawn']);
export const CHALLENGE_RULES = Object.freeze({
  valveSeconds: 45,
  waves: 3,
  baseEnemyHP: 140,
  bossHP: 600,
  waveCounts: Object.freeze([2, 3, 4]),
});

const FLAGS = ['accepted', 'roots', 'bells', 'valves', 'vigil', 'warden', 'complete'];

export function readChapterTwo(saved) {
  const source = saved?.chapterTwo;
  return Object.fromEntries(FLAGS.map(flag => [flag, source?.[flag] === true]));
}

export const CHAPTER_TWO_STEPS = [
  {
    id: 'summons', map: 'city', where: 'WEST JETTY',
    title: 'A chart that bleeds',
    description: 'After telling Tobin about Maren, read his tide chart at the west jetty. The ink has begun to move.',
    recap: 'Tobin traced three locks holding the Tidewarden\'s stolen voice beyond the Moonwell\'s reach.',
  },
  {
    id: 'roots', map: 'forest', where: 'PINE ISLET',
    title: 'The memory beneath the roots',
    description: 'Cross the west bridge to Pine Islet. Read the root tablet, then awaken its three runes in the remembered order.',
    recap: 'The root lock remembered the living world and released its first note.',
  },
  {
    id: 'bells', map: 'yard', where: 'SKIBIDI YARD',
    title: 'Bells for a missing dawn',
    description: 'Take the south bridge to Skibidi Yard, where the salvage crews stacked the drowned bells. Read the bell-ringer\'s verse by the landing and sound the three bells in order.',
    recap: 'The bells carried a night across the water, returning the second note.',
  },
  {
    id: 'valves', map: 'yard', where: 'SKIBIDI YARD',
    title: 'Forty-five borrowed seconds',
    description: 'Back by the landing in Skibidi Yard, close all three pressure valves within 45 seconds. The timer starts when you close the first valve.',
    recap: 'You closed the three valves before pressure returned and freed the last note from the old pumping yard.',
  },
  {
    id: 'vigil', map: 'yard', where: 'SKIBIDI YARD',
    title: 'Keep the last light burning',
    description: 'Find the meridian beacon in the west lane of Skibidi Yard. Kindle it and survive three waves of drowned echoes: two, three, then four.',
    recap: 'Three waves broke against your vigil. The beacon revealed the Hollow Warden hiding in the pumping yard.',
  },
  {
    id: 'warden', map: 'yard', where: 'SKIBIDI YARD',
    title: 'The voice beneath the tide',
    description: 'At the north end of Skibidi Yard, challenge the Hollow Warden. Jump over its red pulse or move clear, then strike while its shield is down to free the Tidewarden\'s stolen voice.',
    recap: 'The Hollow Warden\'s iron shell broke apart, freeing the Tidewarden\'s stolen voice.',
  },
  {
    id: 'homecoming', map: 'city', where: 'MOONWELL',
    title: 'A promise with no keeper',
    description: 'Bring the Tidewarden\'s voice to the meridian seal beside the Moonwell. Let the Reach hear the promise it forgot.',
    recap: 'The three locks opened into one promise: no soul would have to keep the light alone again.',
  },
  {
    id: 'complete', map: 'city', where: 'MOONWELL',
    title: 'The sea remembers your name',
    description: 'The meridian is whole. From Pine Islet to the pumping yard, the lights answer one another across the water.',
    recap: 'You returned the Tidewarden\'s voice and joined the Reach\'s scattered lights.',
  },
];

export function chapterTwoStep(state = {}) {
  const index = FLAGS.findIndex(flag => state?.[flag] !== true);
  return CHAPTER_TWO_STEPS[index < 0 ? CHAPTER_TWO_STEPS.length - 1 : index];
}

export const CHAPTER_TWO_PEOPLE = {
  chart: { name: 'Tobin', title: 'Ferryman', color: '#e9c38b' },
  rootTablet: { name: 'The root tablet', title: 'First lock', color: '#9ad07a' },
  bellTablet: { name: 'The bell-ringer\'s verse', title: 'Second lock', color: '#ffb35c' },
  valvePanel: { name: 'The pressure ledger', title: 'Third lock', color: '#ff9276' },
  beacon: { name: 'The meridian beacon', title: 'A vigil for the drowned', color: '#afeaff' },
  warden: { name: 'The Tidewarden', title: 'Guardian without a voice', color: '#8bdcff' },
  seal: { name: 'The meridian seal', title: 'The Moonwell', color: '#d9c5ff' },
};

const say = (speaker, text) => [speaker, text];
const narration = (...lines) => ({ lines: lines.map(text => say(null, text)) });

export function chapterTwoConversation(person, state = {}) {
  if (!Object.hasOwn(CHAPTER_TWO_PEOPLE, person)) return null;
  if (person === 'chart') {
    if (state.complete) return { lines: [say('chart', 'Heard the bells from here this morning. First time in twenty years they sounded like a beginning. Fair winds, Keeper.')] };
    if (state.accepted) return { lines: [
      say('chart', 'Root, bell, iron. One lock on Pine Islet, two in the old pumping yard. Three locks on one stolen voice.'),
      say('chart', state.warden ? 'Bring its voice to the seal beside the Moonwell. Let the whole harbour hear it.' : 'When all three locks open, kindle the meridian beacon among the yard\'s stacks. Then face the Hollow Warden at the yard\'s far end and free the Tidewarden\'s voice.'),
    ] };
    return { sets: 'accepted', lines: [
      say('chart', 'Keeper. I slept, just as I said I would. Then the tide knocked on my door. From the inside.'),
      say(null, 'On Tobin\'s chart, ink creeps upstream. Three black circles tighten around a silver line.'),
      say('chart', 'Maren woke the Moonwell, but its light found a promise left unfinished. The Tidewarden, that great whale in the harbour, is still trying to speak.'),
      say('chart', 'The Long Tide stole its voice and sealed it in drowned iron. Three locks hold it: a memory under Pine Islet, then a song and a breath in the old pumping yard, where the salvage crews stacked the drowned bells.'),
      say('you', 'And if I open them?'),
      say('chart', 'Kindle the meridian beacon among the yard\'s stacks. It will reveal the Hollow Warden at the yard\'s far end: an iron shell with our guardian\'s voice trapped inside. Break that shell and bring the voice home.'),
      say('chart', 'Begin across the west bridge, at the root tablet. Maren left you a light. This time you must carry it beyond the city.'),
    ] };
  }

  if (!state.accepted) return narration('A thin silver line points back toward the west jetty. Tobin\'s tide chart may explain what this place is waiting for.');

  if (person === 'rootTablet') return narration(
    'Three carvings wind around the stone: a buried root, falling rain, and a crescent moon.',
    '"First the ROOT holds the earth. Then the RAIN wakes what sleeps. Last the MOON remembers its name."',
    state.roots ? 'The completed root lock hums softly. Its note is already yours.' : 'Touch the runes in that order. A wrong rune clears the sequence; begin again at the root.',
  );
  if (person === 'bellTablet') return narration(
    'A bell-ringer has scratched a verse into the brass: "DUSK closes the harbour. TIDE carries the lost. DAWN calls them home."',
    state.bells ? 'All three bells answer with a single clear note. The second lock is open.' : 'Sound the bells in the order of the verse. A wrong bell silences the phrase and resets it.',
  );
  if (person === 'valvePanel') return narration(
    'A warning survives under the rust: "Close every pressure valve before the pumps fight back." This panel holds the instructions; the valves control the pressure.',
    state.valves ? 'The pumps breathe evenly again. The third lock is open.' : 'Close all three marked valves in any order. The 45-second timer starts when you close the first valve.',
    'If time runs out, all three valves reopen. Retry from any valve. You keep the locks you have already opened.',
  );
  if (person === 'beacon') {
    if (!(state.roots && state.bells && state.valves)) return narration('Three hollow sockets circle the beacon: root, bell, iron. Open all three locks before kindling its flame.');
    if (state.vigil) return narration('The beacon holds steady. Its light reveals the Hollow Warden at the north end of the yard. Break the iron shell to free the Tidewarden\'s voice.');
    return narration(
      'The three notes settle into the beacon. Something in the water answers with teeth.',
      'Kindle the beacon to call three waves of drowned echoes: two, then three, then four. These echoes are stronger than the city\'s restless ghosts.',
      'Defeat every echo to finish each wave. Stay near the beacon: falling or leaving its grounds resets the vigil. Kindle it again to retry.',
    );
  }
  if (person === 'warden') {
    if (!state.vigil) return narration('The Hollow Warden waits inside its drowned iron shell. Complete the beacon\'s three-wave vigil to reveal it.');
    if (state.warden) return { lines: [say('warden', 'Maren. She carried my last word through the flood. Now you carry it home.')] };
    return narration(
      'The Hollow Warden rises, an iron prison holding the Tidewarden\'s stolen voice. Your blows cannot pierce its closed shield.',
      'Its red circle swells for 3.4 seconds before the pulse. Jump over the surge or move outside the circle. Its shield opens for the next 3.6 seconds; attack during the silver glow.',
      'If you fall or leave the grounds, challenge the Hollow Warden again. Your completed locks and vigil remain saved.',
    );
  }
  if (!FLAGS.slice(0, -1).every(flag => state[flag] === true)) return narration('The seal has a place for a voice, but no voice to carry. Open the three locks, survive the beacon\'s vigil, then break the Hollow Warden in Skibidi Yard to free the Tidewarden\'s voice.');
  if (state.complete) return narration('The Moonwell answers the distant bells. No light in the Reach burns alone.');
  return { sets: 'complete', lines: [
    say(null, 'You place your hand on the seal. The Tidewarden\'s voice moves through the stone, deep as an oar striking still water.'),
    say('warden', 'I remember the promise. I guard the passage. You keep the light. Neither of us carries the lost alone.'),
    say(null, 'Across Pine Islet, the roots shine silver. In the yard, the salvaged bells ring for dawn, and the old pumps breathe with the tide instead of against it.'),
    say('you', 'Then let this be the first night we keep it together.'),
    say(null, 'A wish-coin turns once at the bottom of the Moonwell. For a moment, you could swear you hear Maren laughing.'),
  ] };
}

// Only a correct, complete sequence awards a lock. Mistakes reset the attempt.
export function advanceSequence(order, progress, token) {
  const index = Number.isInteger(progress) && progress >= 0 && progress < order.length ? progress : 0;
  const correct = order.length > 0 && token === order[index];
  const next = correct ? index + 1 : 0;
  return { progress: next, correct, complete: correct && next === order.length };
}
