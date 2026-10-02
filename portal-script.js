import { readStory } from './story-script.js';
import { readChapterTwo } from './chapter-two-script.js';
import { chapterThreeUnlocked, readChapterThree } from './chapter-three-script.js';

// The keeper's book chooses the next passage from the saved story. Combat
// abilities and proximity alone can never provide a portal incantation.
export const PASSAGES = Object.freeze({
  mesa: Object.freeze({
    destination: 'mesa', mapName: 'Red Mesa', title: 'The sanctuary passage',
    spell: 'By keeper’s light and crimson sand, bear me to the Moonwell’s land.',
  }),
  observatory: Object.freeze({
    destination: 'observatory', mapName: 'The Ashen Observatory', title: 'The forgotten passage',
    spell: 'By hands that share and hearts that know, reveal the shore lost long ago.',
  }),
  forest: Object.freeze({
    destination: 'forest', mapName: 'Pine Islet', title: 'The root passage',
    spell: 'By Maren\'s light and keeper\'s word, wake the path the roots have heard.',
  }),
  yard: Object.freeze({
    destination: 'yard', mapName: 'Skibidi Yard', title: 'The drowned passage',
    spell: 'Root unbound and silver thread, wake the road where iron has slept.',
  }),
  city: Object.freeze({
    destination: 'city', mapName: 'The Moonwell City', title: 'The homeward passage',
    spell: 'Voice returned and lantern bright, carry us home to the keeper\'s light.',
  }),
  street: Object.freeze({
    destination: 'street', mapName: 'Street City', title: 'The city passage', explore: true,
    spell: 'By lantern glow and keeper\'s key, let distant streets unfold for me.',
  }),
  plaza: Object.freeze({
    destination: 'plaza', mapName: 'Lantern Plaza', title: 'The lamplit passage', explore: true,
    spell: 'By Duskbell\'s toll and amber flame, light the square that keeps its name.',
  }),
  nightwood: Object.freeze({
    destination: 'nightwood', mapName: 'Nightwood Road', title: 'The moonlit passage', explore: true,
    spell: 'By silver moon and pinewood deep, open the road where shadows sleep.',
  }),
});
// Places the book offers from the city for their own sake, once its other
// passages have opened; each one's way back is the homeward passage.
export const EXPLORATIONS = Object.freeze(Object.keys(PASSAGES).filter(map => PASSAGES[map].explore));

const locked = reason => ({
  destination: null, mapName: null, title: 'The sleeping portal', spell: null, lockedReason: reason,
});

export function portalRoute(progress = {}, activeMap = 'city', requestedDestination) {
  const story = readStory(progress);
  const chapter = readChapterTwo(progress);
  const third = readChapterThree(progress);
  const select = passage => requestedDestination === undefined || requestedDestination === passage.destination
    ? { ...passage, lockedReason: null }
    : locked('The keeper\'s book has not revealed that passage from this district.');
  // The lectern already holds the sanctuary spell. Meeting the keeper and
  // returning to the city must never depend on restoring her well first.
  if (activeMap === 'mesa') return select(PASSAGES.city);
  if (activeMap === 'city' && (requestedDestination === 'mesa' || requestedDestination === undefined &&
    (!story.ledger || progress?.restored !== true || !story.farewell || !chapter.accepted ||
      chapter.warden && !chapter.complete || chapterThreeUnlocked(progress) && (!third.accepted || third.boss && !third.complete)))) return select(PASSAGES.mesa);
  if (!story.ledger) return locked('Only the keeper\'s book can awaken this portal. Find and read Maren\'s ledger at the Wanderer\'s Camp.');
  if (progress?.restored !== true) return locked('The book\'s passage remains dark. Restore the Moonwell with Maren before awakening a portal.');
  if (!story.farewell) return locked('The book asks you to finish Maren\'s promise. Tell Tobin what happened at the Moonwell.');
  if (!chapter.accepted) return locked('The portal has no destination yet. Read Tobin\'s tide chart at the west jetty to reveal the first passage.');
  if (activeMap === 'city' && EXPLORATIONS.includes(requestedDestination)) return select(PASSAGES[requestedDestination]);
  if (EXPLORATIONS.includes(activeMap)) return select(PASSAGES.city);
  if (chapterThreeUnlocked(progress)) {
    if (activeMap === 'yard' && third.relay) return select(PASSAGES.observatory);
    if (activeMap === 'observatory') return select(PASSAGES.city);
  }

  let destination;
  if (activeMap === 'city') destination = 'forest';
  else if (activeMap === 'forest') {
    if (!chapter.complete && !chapter.roots) return locked('The root lock still holds this passage. Read the root tablet and awaken its three runes before returning to the book.');
    destination = 'yard';
  } else if (activeMap === 'yard') {
    if (!chapter.complete && !['roots', 'bells', 'valves', 'vigil', 'warden'].every(flag => chapter[flag])) {
      return locked('The homeward spell needs the Tidewarden\'s voice. Open the three locks, keep the beacon\'s vigil, and defeat the Hollow Warden.');
    }
    destination = 'city';
  } else return locked('No keeper passage answers from this district.');

  return select(PASSAGES[destination]);
}

export function portalChoices(progress = {}, activeMap = 'city') {
  const route = portalRoute(progress, activeMap);
  if (activeMap !== 'city') return route.destination ? [route] : [];
  return [route, ...['mesa', 'forest', ...EXPLORATIONS].filter(destination => destination !== route.destination)
    .map(destination => portalRoute(progress, activeMap, destination))].filter(choice => choice.destination);
}

// The reading ends on the spell itself, so the gate answers the moment it is
// said; what the words do then is shown over the gate as it stirs.
export const SPELL_TAKES = 'The words leave the page as light. The portal stirs, drawing the far shore into focus.';

export function portalConversation(route) {
  if (!route?.destination || route.lockedReason || !route.spell) {
    return { lines: [[null, route?.lockedReason || 'The keeper\'s book has not revealed a passage yet.']] };
  }
  return { lines: [
    [null, 'You open the keeper\'s ledger on the portal lectern. Its ink gathers into a spell beneath your hands.'],
    [null, `A silver line leads toward ${route.mapName}. You read each word from the book before raising your hand to the sleeping gate.`],
    ['you', route.spell, 'incantation'],
  ] };
}
