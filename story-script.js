// The Last Keeper: the Verdant Reach's first chapter, as words and as steps.
//
// Twenty winters ago, on the Night of the Long Tide, the sea came over the quay
// and the Moonwell went dark. Its light broke into shards across the city, and
// everyone the water took came back as a wisp. Maren, the well's keeper,
// carried its heart down into the cistern to keep it dry, and never came up.
// She is still waiting at the well for someone to finish her work — and the
// story is the player finding that out.
//
// This module is only words and the order they come in; story.js stands the
// people and props in the world, and game.js runs the conversations.

export const CHAPTER = { eyebrow: 'CHAPTER ONE', title: 'The Last Keeper' };

export const PEOPLE = {
  maren: { name: 'Maren', title: 'Keeper of the Moonwell', color: '#9fdcff' },
  tobin: { name: 'Tobin', title: 'Ferryman', color: '#e9c38b' },
  notice: { name: 'Harbour notice board', color: '#d8c7a3' },
  ledger: { name: 'The keeper’s ledger', color: '#d8c7a3' },
};

// Each step is done once its test passes, and the story stands at the first
// that has not. Shards and wisps count whenever they were won, so a player who
// wanders ahead is never made to do a step twice, and once the well is lit
// nothing before it is asked for again. `where` names the place a step
// without a count sends the player to.
export const STEPS = [
  { id: 'keeper', where: 'MOONWELL', title: 'The woman at the well', description: 'Someone is waiting at the Moonwell Sanctuary. Follow the blue marker.', recap: 'Maren, the Keeper, asked you to gather the Moonwell’s scattered light.', done: p => p.story.keeper },
  { id: 'shards', title: 'A glimmer in the green', description: 'Gather 5 shards of the Moonwell’s light along the city streets.', recap: 'You gathered five shards of the old light.', goal: 5, count: p => p.collected.size, done: p => p.collected.size >= 5 || p.restored },
  { id: 'ferryman', where: 'WEST JETTY', title: 'The ferryman’s tale', description: 'Find Tobin the ferryman where the west jetty meets the quay.', recap: 'Tobin told you about the Night of the Long Tide — and went pale at Maren’s name.', done: p => p.story.ferryman },
  { id: 'wisps', title: 'Quiet the restless', description: 'Release 3 restless wisps. They were people once.', recap: 'You released the drowned, and heard what they remembered.', goal: 3, count: p => p.kills, done: p => p.kills >= 3 || p.restored },
  { id: 'ledger', where: 'WANDERER’S CAMP', title: 'The keeper’s ledger', description: 'The wanderers pulled a book from the flooded cistern. Look for it at the Wanderer’s Camp.', recap: 'The ledger’s last page told you how Maren died.', done: p => p.story.ledger },
  { id: 'restore', where: 'MOONWELL', title: 'Awaken the Moonwell', description: 'Take the light back to Maren at the Moonwell.', recap: 'The Moonwell woke, and the Keeper went home with the Hart.', done: p => p.restored },
  { id: 'farewell', where: 'WEST JETTY', title: 'What the ferryman saw', description: 'Tell Tobin what happened at the well.', recap: 'You gave Tobin Maren’s last words.', done: p => p.story.farewell },
  { id: 'complete', title: 'A light returned', description: 'The Moonwell shines again. The Reach is yours to explore.', done: () => false },
];

export const storyStep = progress => STEPS.findIndex(step => !step.done(progress));
export const stepId = progress => STEPS[storyStep(progress)].id;

// The flags a save carries. A save from before the story finished the old
// chapter by restoring the shrine: it keeps its ending rather than being sent
// back to meet a keeper who has already gone.
export function readStory(saved) {
  const story = { keeper: false, ferryman: false, ledger: false, farewell: false, notice: false };
  if (saved?.story && typeof saved.story === 'object') for (const key of Object.keys(story)) story[key] = saved.story[key] === true;
  else if (saved?.restored === true) for (const key of Object.keys(story)) story[key] = true;
  return story;
}

export const INTRO = 'An old light sleeps beneath the city. Its keeper is still waiting for it.';

// A line is [speaker, text]. 'you' is the hero, by name; null is narration.
const say = (who, text) => [who, text];

// What each person says, by the step the story stands at. A step not listed
// falls back to `default`. `sets` marks the flag a conversation earns once it
// has been heard to the end.
export const CONVERSATIONS = {
  maren: {
    keeper: { sets: 'keeper', lines: [
      say('maren', 'Ah. Someone who can still see me. Come closer, traveller — my eyes aren’t what they were.'),
      say('maren', 'This is the Moonwell. Twenty winters ago it burned so bright the fishing boats steered home by it, and the dead of the Reach slept easy beneath it.'),
      say('maren', 'Then came the Night of the Long Tide. The sea climbed the quay, the well went dark, and its light broke into shards and scattered through the streets.'),
      say('maren', 'I have been waiting a long while for hands that can carry them. Mine can’t. Not anymore.'),
      say('you', 'How many do you need?'),
      say('maren', 'Five will wake it. They glitter like frost on the cobbles; you’ll know them when you see them.'),
      say('maren', 'And when you have them, find Tobin, the ferryman at the west jetty. He’ll tell you what walks these streets after dark.'),
    ] },
    shards: { lines: [say('maren', 'Five shards, traveller. The light remembers where it fell, even if the city has forgotten.')] },
    ferryman: { lines: [say('maren', 'You found them. I can feel them humming from here. Now go and see Tobin at the west jetty — and don’t let him tell you he’s busy. He isn’t.')] },
    wisps: { lines: [say('maren', 'The wisps. Poor souls. Be gentle with them, if you can — they only want to be let go.')] },
    ledger: { lines: [say('maren', 'The camp? The wanderers keep a fire there. I used to take them lamp oil…'), say('maren', 'Go on. I’ll be here. I’m always here.')] },
    restore: { sets: 'restored', finale: true, lines: [
      say('you', 'I found your ledger, Maren. In the cistern.'),
      say('maren', 'Ah.'),
      say('maren', 'Then you know. I was halfway up the cistern stairs when the water found me. I remember the cold. And then I remember standing here, waiting.'),
      say('maren', 'I couldn’t leave. Not with the well dark. A keeper doesn’t go home until the lamps are lit.'),
      say('maren', 'You carry the light now. Pour it into the well, traveller, and let an old woman finish her shift.'),
    ] },
    // Heard once the well is lit, while the Hart stands in its glow.
    finale: { lines: [
      say(null, 'A great stag of silver light steps out of the well’s glow and lowers its antlers to her.'),
      say('maren', 'Oh… there you are, old friend. I kept the light as long as I could.'),
      say('maren', 'Tell Tobin it wasn’t his fault. It never was.'),
      say('maren', 'And traveller — the well will need a keeper.'),
      say(null, 'She sets her lantern down at the well’s edge, rests a hand on the Hart’s neck, and walks with it into the light. For the first time in twenty winters, the Moonwell shines over the Reach.'),
    ] },
  },
  tobin: {
    default: { lines: [say('tobin', 'Ferry’s closed. Tide’s wrong. Tide’s always wrong, these days.')] },
    ferryman: { sets: 'ferryman', lines: [
      say('tobin', 'Mind those boards, they’re older than I am. Name’s Tobin. I ferry folk out to the islet, when there’s anyone left who wants to go.'),
      say('you', 'Maren sent me. The keeper, up at the Moonwell.'),
      say('tobin', '…Maren.'),
      say('tobin', 'You’ve a cruel sense of humour, stranger. Or you’ve been drinking harbour water.'),
      say('tobin', 'Never mind. Those shards — I can see them glowing through your pack. So the old stories are true.'),
      say('tobin', 'The wisps came the morning after the Long Tide. One for every soul the sea took. They aren’t wicked. They’re lost, and lost things lash out.'),
      say('tobin', 'Quiet three of them. Then go to the Wanderer’s Camp, west of the square. The wanderers dragged a book out of the flooded cistern, years back. Nobody’s had the stomach to read it.'),
      say('tobin', 'And if you see something big out in the harbour, glowing blue under the water — that’s the Tidewarden. It’s circled the bay since the well went dark. Leave it be.'),
    ] },
    wisps: { lines: [say('tobin', 'Three of them. They drift where they drowned — the lanes, the square, the old cistern steps.')] },
    ledger: { lines: [say('tobin', 'The camp’s west of the square. Look for the fire; the wanderers never let it go out.')] },
    restore: { lines: [say('tobin', 'You read it, then. I can see it on your face.'), say('tobin', 'Go on up to the well. Whatever’s waiting there, it’s waited long enough.')] },
    farewell: { sets: 'farewell', lines: [
      say('tobin', 'I saw it from the jetty. The whole harbour lit up silver, like the old days. Even the Tidewarden came up to look.'),
      say('you', 'Maren is at rest. She asked me to tell you it wasn’t your fault.'),
      say('tobin', '…'),
      say('tobin', 'I rowed back for her. Three times. The third time, the cistern was already under water.'),
      say('tobin', 'Twenty years I’ve tied this boat up every night and not slept a wink. Thank you, friend. I think tonight I will.'),
      say('tobin', 'Folk will start leaving wish-coins in the well again, you know. Somebody ought to count them. Keeper.'),
    ] },
    complete: { lines: [say('tobin', 'Fair winds, Keeper. Ha — listen to me. Keeper. It suits you.')] },
  },
  // Reading, rather than talking: the notice board stands by the arrival
  // square from the start, so a player who stops to read it meets Maren
  // already knowing more than she does.
  notice: {
    default: { sets: 'notice', lines: [
      say(null, 'WANTED: lamp oil, any quantity. Enquire at the camp market.'),
      say(null, 'FERRY to Pine Islet — ask for Tobin at the west jetty. No crossings after dark.'),
      say(null, 'Beneath the newer notices, a weathered plaque is nailed to the wood: IN MEMORY OF THOSE TAKEN BY THE LONG TIDE.'),
      say(null, 'The names run to the bottom of the board. The last is carved deeper than the rest: MAREN ASHDOWN, KEEPER OF THE MOONWELL.'),
    ] },
  },
  ledger: {
    default: { lines: [say(null, 'A water-stained book lies open by the fire. The wanderers have weighted its pages with a stone. It isn’t yours to read — not yet.')] },
    ledger: { sets: 'ledger', lines: [
      say(null, 'Page after page of tidy handwriting: oil for the lamps, the depth of the well, the name of every child who ever dropped a wish-coin into it.'),
      say(null, 'The last entry is written in a hurry. The ink has run.'),
      say(null, '“The tide is at the door. The well’s heart will drown if it stays in the sanctuary, so I am carrying it down to the cistern, where the stone is thick and the water can’t reach.”'),
      say(null, '“If I don’t come back up, whoever finds this: the heart is safe. Gather its light, bring it home, and the Moonwell will wake. Tell Tobin I’m not angry with him. — M.”'),
      say(null, 'Below it, in another hand: “Found in the cistern beside her lantern, after the water went down. Maren Ashdown, Keeper of the Moonwell, lost on the Night of the Long Tide. May the light find her.”'),
      say(null, 'You close the book. Whoever is waiting at the well, Maren Ashdown has been dead for twenty years.'),
    ] },
  },
};
CONVERSATIONS.ledger.restore = CONVERSATIONS.ledger.farewell = CONVERSATIONS.ledger.complete = { lines: CONVERSATIONS.ledger.ledger.lines };

export function conversation(person, step) {
  const table = CONVERSATIONS[person];
  return table?.[step] || table?.default || null;
}

// What the drowned say as they are released: the first three in order, as the
// step asks for three, and any after that at random.
export const WHISPERS = [
  '“…so cold… the water came up the stairs so fast…”',
  '“…Keeper? Keeper, where is the light…”',
  '“…tell Tobin… he couldn’t row back for all of us…”',
  '“…is my boat still tied at the jetty…”',
  '“…I can see the well from here… why is it dark…”',
];
export const whisper = (kills, random = Math.random) => WHISPERS[kills <= 3 ? Math.max(0, kills - 1) : 3 + Math.floor(random() * (WHISPERS.length - 3))];
