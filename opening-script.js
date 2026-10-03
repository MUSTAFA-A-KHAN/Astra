// The harbour remembers. This short opening precedes the existing chapter;
// separate save flags keep returning players' Moonwell progress intact.
export const OPENING_TITLE = 'The bell that should not ring';
export const OPENING_PEOPLE = {
  narrator: { name: 'The Reach', title: 'A memory beneath the tide', color: '#bfdbeb' },
  openingLantern: { name: 'A drowned lantern', color: '#bceee6', read: true },
  openingMemorial: { name: 'The harbour memorial', color: '#d8c7a3', read: true },
  openingEcho: { name: 'The last echo', title: 'Someone is still inside', color: '#bceee6' },
};
export const OPENING_LINES = {
  prologue: [
    ['narrator', 'Twenty winters ago, the sea climbed these streets. The harbour bell rang once. Then nothing.', 'haunted'],
    ['narrator', 'Tonight, it rang again. The ropes are cut. The bell tower is empty.', 'mysterious'],
    ['you', 'That lantern... Someone is carrying it under the water.', 'hesitant'],
  ],
  lantern: [
    ['you', 'Still warm. The street is dry, but the flame is drowning.', 'hesitant'],
    ['narrator', 'Inside the glass, a tiny handprint appears. From the other side.', 'mysterious'],
  ],
  memorial: [
    ['narrator', 'In memory of those taken by the Long Tide. One name has been scraped away. The cuts are fresh.', 'haunted'],
    ['you', 'Someone came back to erase a dead person.', 'resolute'],
  ],
  breach: [['narrator', 'The bell answers from beneath your feet.', 'mysterious']],
  released: [['narrator', 'The shape breaks. A human voice remains, caught inside the light.', 'tender']],
  mercy: [
    ['you', 'I hear you. You can let go.', 'tender'],
    ['narrator', 'A last breath: the keeper did not put out the light. Someone called it away.', 'haunted'],
  ],
  seal: [
    ['you', 'No more. This street belongs to the living.', 'resolute'],
    ['narrator', 'The lantern seals around a sliver of black glass. Three notches. Root, bell, iron.', 'mysterious'],
  ],
  witnessMercy: [
    ['tobin', 'You listened to it? Most people run. I ran, once.', 'grieving'],
    ['you', 'It said someone called the light away. Who?', 'earnest'],
    ['tobin', 'Maren kept that light. Find her at the Moonwell. If she answers... ask why she never came home.', 'haunted'],
    ['tobin', 'The book by the city portal knows the way. Take the little light with you. It remembers her.', 'warm'],
  ],
  witnessSeal: [
    ['tobin', 'You closed it. Good. I have buried enough people from this street.', 'weary'],
    ['you', 'There was black glass inside. Three marks cut into it.', 'earnest'],
    ['tobin', 'Keep it. Maren knew those marks. Find the Moonwell, and ask what she was keeping out.', 'mysterious'],
    ['tobin', 'Read the book by the city portal. And if she asks about me... tell her the boat is still tied up.', 'tender'],
  ],
};
export const OPENING_STAGES = ['prologue', 'investigate', 'breach', 'encounter', 'choice', 'witness', 'complete'];
export function readOpening(saved = {}) {
  const raw = saved.opening;
  // Lobby/settings saves alone are still newcomers; actual old story progress is not.
  const legacy = !raw && (saved.restored === true || saved.xp > 0 || saved.kills > 0 || saved.collected?.length ||
    ['mesa', 'forest', 'yard', 'plaza', 'nightwood', 'observatory', 'street'].includes(saved.map) ||
    Object.values(saved.story || {}).some(v => v === true));
  const state = { stage: legacy ? 'complete' : 'prologue', lantern: false, memorial: false, choice: null };
  if (raw && OPENING_STAGES.includes(raw.stage)) state.stage = raw.stage;
  state.lantern = raw?.lantern === true; state.memorial = raw?.memorial === true;
  state.choice = ['mercy', 'seal'].includes(raw?.choice) ? raw.choice : null;
  // A saved cinematic restarts at its safe edge. A choice already made must not pay twice.
  if (state.choice && state.stage === 'choice') state.stage = 'witness';
  if (state.stage === 'witness' && !state.choice) state.stage = 'choice';
  return state;
}
export function openingStep(state) {
  const base = { map: 'city', where: 'ARRIVAL SQUARE' };
  const steps = {
    prologue: ['A bell beneath the tide', 'Listen to the harbour.'],
    investigate: ['Something came ashore', 'Inspect the warm lantern and the scratched memorial nearby. Follow the light.'],
    breach: ['The street remembers', 'Something is coming through.'],
    encounter: ['Hold back the drowned', 'Break the echo with Attack (Q) or your ability (E). Move away between its strikes.'],
    choice: ['A voice inside the light', 'Return to the lantern. Release the trapped memory, or seal the breach.'],
    witness: ['The man who heard it before', 'Find Tobin at the west jetty. He recognised the bell. Follow the light.'],
    complete: ['Find the last keeper', 'Read the city portal book and find Maren at the Moonwell.'],
  };
  const [title, description] = steps[state.stage];
  return { ...base, id: `opening-${state.stage}`, title, description,
    ...(state.stage === 'investigate' ? { goal: 2, count: () => Number(state.lantern) + Number(state.memorial) } : {}),
    ...(state.stage === 'witness' ? { where: 'WEST JETTY' } : {}),
  };
}
export function openingClue(state, id) {
  if (state.stage !== 'investigate' || !['lantern', 'memorial'].includes(id) || state[id]) return false;
  state[id] = true;
  if (state.lantern && state.memorial) state.stage = 'breach';
  return true;
}
export function openingChoice(state, choice) {
  if (state.stage !== 'choice' || state.choice || !['mercy', 'seal'].includes(choice)) return false;
  state.choice = choice; state.stage = 'witness'; return true;
}
