// Who is voiced, how each feeling sounds, and every line spoken aloud.
// tools/generate-voice.py records from this; run on its own it prints the
// same as JSON for it.
//
//   node tools/voice-direction.mjs
//
// A line's feeling is set beside its words in the story scripts. Microsoft's
// free neural voices take a speaking rate, a pitch and a volume and nothing
// else, so a feeling is a shape made of those: each sentence (and, for some
// feelings, each clause) is spoken on its own, pitched and paced for where it
// falls in the line, and the pieces are joined with pauses of the feeling's
// length. With an Azure Speech key the voice is also given Microsoft's own
// speaking style for the feeling, which changes the delivery itself.
import { fileURLToPath } from 'node:url';
import { PEOPLE, CONVERSATIONS, CAMP_DIRECTIONS, conversation } from '../story-script.js';
import { CHAPTER_TWO_PEOPLE, chapterTwoConversation } from '../chapter-two-script.js';
import { portalRoute, portalConversation } from '../portal-script.js';

// Who speaks aloud: heroes by hero id, for the lines the scripts give to
// 'you', and people by the voice their speakers name (their own id, unless
// they say otherwise). `edge` is the free voice (Microsoft Edge's read-aloud
// service) and `azure` the one used with a key, which should have the styles
// below. `f0` is roughly the voice's own speaking pitch in Hz, for turning the
// percentages here into the Hz Edge takes. `pitch` and `rate` (%) are added to
// every feeling, to fit the voice to the character, and `echo` gives them all
// a quality of their own.
export const CAST = {
  heroes: {
    // Gwen Stacy under the mask: quick and bright, and softer than she lets on.
    Spiderman: { edge: 'en-US-AvaMultilingualNeural', azure: 'en-US-JaneNeural', f0: 200, pitch: 3, rate: 4 },
  },
  people: {
    // The keeper, twenty years drowned: older and slower than the voice, and
    // not quite in the room with you.
    maren: { edge: 'en-GB-SoniaNeural', azure: 'en-GB-SoniaNeural', f0: 190, pitch: -6, rate: -8, echo: 'faint' },
    // The ferryman: low, weathered, and sparing with his words.
    tobin: { edge: 'en-GB-RyanNeural', azure: 'en-GB-RyanNeural', f0: 110, pitch: -4, rate: -8 },
  },
};

// rate, pitch and volume in %, against the voice's own. `pause` is the
// silence between sentences in seconds; `commas`, when set, splits the
// clauses too and holds this long at each. `arc` is added again for every
// piece after the first, so a line can sink or climb as it goes. `style` and
// `degree` are the Azure speaking style (degree 0.01–2; a voice without the
// style speaks without one); `echo: 'ring'` gives the words the ring of
// something more than speech.
export const FEELINGS = {
  // Leaning in, ready to help: bright and quick.
  eager: { rate: 6, pitch: 7, volume: 0, pause: .28, style: 'excited', degree: .8 },
  // Plain and sure, to someone who needs convincing.
  earnest: { rate: 0, pitch: 1.5, volume: 0, pause: .38, style: 'friendly', degree: 1 },
  // Treading carefully around what she has just found out.
  hesitant: { rate: -12, pitch: -4, volume: -10, pause: .8, arc: { pitch: -2 }, style: 'sad', degree: 1.3 },
  // Hard news, carried kindly.
  tender: { rate: -10, pitch: -2.5, volume: -8, pause: .62, arc: { rate: -4, pitch: -1.5 }, style: 'sad', degree: .8 },
  // Weighing the danger, and going anyway.
  resolute: { rate: -5, pitch: -3, volume: 0, pause: .35 },
  // Warm, and looking ahead.
  hopeful: { rate: -14, pitch: 3, volume: 0, pause: .4, style: 'hopeful', degree: 1.2 },
  // Read aloud from the keeper's book: slow and measured, each clause set
  // apart and each a little stronger, ringing as it leaves the page.
  incantation: { rate: -16, pitch: -4, volume: 5, pause: .5, commas: .42, arc: { pitch: 2, volume: 3 }, echo: 'ring' },
  // Remembering something lovely from a long way off.
  wistful: { rate: -8, pitch: -1, volume: -4, pause: .55, arc: { pitch: -1 }, style: 'sad', degree: .5 },
  // Proud of something that was, and smiling at it.
  fond: { rate: -6, pitch: 2, volume: 0, pause: .45, style: 'cheerful', degree: .4 },
  // Telling of the night the sea came in: low and slow, sinking as it goes.
  haunted: { rate: -12, pitch: -4, volume: -6, pause: .7, arc: { pitch: -1, rate: -2 }, style: 'sad', degree: 1.2 },
  // Tired all the way down, and trailing off.
  weary: { rate: -10, pitch: -3, volume: -8, pause: .65, arc: { pitch: -2, rate: -3, volume: -3 }, style: 'sad', degree: 1 },
  // Kind, and meaning it.
  warm: { rate: -4, pitch: 2, volume: 0, pause: .4, style: 'friendly', degree: 1 },
  // Something unsaid behind the words: hushed and drawn out.
  mysterious: { rate: -12, pitch: -4, volume: -10, pause: .7, arc: { pitch: -1, volume: -3 }, style: 'whispering', degree: .6 },
  // A smile in the voice.
  amused: { rate: 4, pitch: 4, volume: 0, pause: .32, arc: { pitch: 1 }, style: 'cheerful', degree: .7 },
  // Joy through tears: slow, soft, catching.
  moved: { rate: -14, pitch: 3, volume: -8, pause: .85, style: 'sad', degree: .6 },
  // Clipped and low: he has said it too many times.
  gruff: { rate: 2, pitch: -5, volume: 3, pause: .3, arc: { pitch: -1 }, style: 'unfriendly', degree: .6 },
  // The name knocks the wind out of him.
  stunned: { rate: -22, pitch: -6, volume: -14, pause: .6, style: 'sad', degree: .8 },
  // Hurt, and hitting back.
  bitter: { rate: 3, pitch: -2, volume: 4, pause: .35, arc: { pitch: -2 }, style: 'angry', degree: .5 },
  // Hushed wonder at a thing he stopped believing in.
  awed: { rate: -10, pitch: 3, volume: -6, pause: .55, arc: { pitch: 1 }, style: 'hopeful', degree: .8 },
  // Twenty years of it, breaking: slow, sinking, long silences.
  grieving: { rate: -16, pitch: -5, volume: -8, pause: .95, arc: { pitch: -2, rate: -3, volume: -3 }, style: 'sad', degree: 1.6 },
  // A weight set down: easing, and lifting at the end.
  grateful: { rate: -8, pitch: 2, volume: -2, pause: .6, arc: { pitch: 2 }, style: 'friendly', degree: 1 },
};

// Whose voice a speaker in the scripts speaks with.
const SPEAKERS = { ...PEOPLE, ...CHAPTER_TWO_PEOPLE };
export const voiceOf = who => (who === 'you' ? 'you' : SPEAKERS[who]?.voice ?? who);

// Every line with words in it that anyone speaks, as { voice, text, feeling },
// where voice is 'you' for the hero: all of both chapters, at every step and
// in either camp, and the spell for each of the book's passages. Narration and
// things read are no one's voice, and are left out.
export function spokenLines() {
  const lines = new Map();
  const take = entry => {
    for (const [who, text, feeling] of entry?.lines ?? []) {
      if (who === null || !/\p{L}/u.test(text)) continue;
      const voice = voiceOf(who), key = `${voice}\n${text}`, known = lines.get(key);
      if (known && known.feeling !== feeling) throw new Error(`${voice}'s “${text}” is felt as both ${known.feeling} and ${feeling}`);
      lines.set(key, { voice, text, feeling });
    }
  };
  for (const [person, table] of Object.entries(CONVERSATIONS)) {
    for (const step of Object.keys(table)) for (const camp of Object.keys(CAMP_DIRECTIONS)) take(conversation(person, step, { camp }));
  }
  const flags = ['accepted', 'roots', 'bells', 'valves', 'vigil', 'warden', 'complete'];
  for (let bits = 0; bits < 1 << flags.length; bits++) {
    const state = Object.fromEntries(flags.map((flag, i) => [flag, !!(bits & 1 << i)]));
    for (const person of Object.keys(CHAPTER_TWO_PEOPLE)) take(chapterTwoConversation(person, state));
  }
  const finished = { restored: true, story: { keeper: true, ferryman: true, ledger: true, farewell: true, notice: true }, chapterTwo: Object.fromEntries(flags.map(flag => [flag, true])) };
  for (const map of ['city', 'forest', 'yard']) take(portalConversation(portalRoute(finished, map)));
  return [...lines.values()];
}

// What each member of the cast records: the hero's lines for every hero, and
// each person's own.
export function scripts() {
  const lines = spokenLines();
  return {
    heroes: Object.fromEntries(Object.keys(CAST.heroes).map(id => [id, lines.filter(line => line.voice === 'you')])),
    people: Object.fromEntries(Object.keys(CAST.people).map(id => [id, lines.filter(line => line.voice === id)])),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify({ cast: CAST, feelings: FEELINGS, scripts: scripts() }, null, 2));
}
