import { readStory } from './story-script.js';
import { readChapterTwo } from './chapter-two-script.js';

// The keeper's book chooses the next passage from the saved story. Combat
// abilities and proximity alone can never provide a portal incantation.
const PASSAGES = Object.freeze({
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
});

const locked = reason => ({
  destination: null, mapName: null, title: 'The sleeping portal', spell: null, lockedReason: reason,
});

export function portalRoute(progress = {}, activeMap = 'city') {
  const story = readStory(progress);
  const chapter = readChapterTwo(progress);
  if (!story.ledger) return locked('Only the keeper\'s book can awaken this portal. Find and read Maren\'s ledger at the Wanderer\'s Camp.');
  if (progress?.restored !== true) return locked('The book\'s passage remains dark. Restore the Moonwell with Maren before awakening a portal.');
  if (!story.farewell) return locked('The book asks you to finish Maren\'s promise. Tell Tobin what happened at the Moonwell.');
  if (!chapter.accepted) return locked('The portal has no destination yet. Read Tobin\'s tide chart at the west jetty to reveal the first passage.');

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

  return { ...PASSAGES[destination], lockedReason: null };
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
