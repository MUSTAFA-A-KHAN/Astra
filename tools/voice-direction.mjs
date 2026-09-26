// Who voices the hero, how each feeling sounds, and every line a hero says
// aloud. tools/generate-voice.py records from this; run on its own it prints
// the same as JSON for it.
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
import { CONVERSATIONS, CAMP_DIRECTIONS, conversation } from '../story-script.js';
import { CHAPTER_TWO_PEOPLE, chapterTwoConversation } from '../chapter-two-script.js';
import { portalRoute, portalConversation } from '../portal-script.js';

// The heroes who speak their lines, by hero id. `edge` is the free voice
// (Microsoft Edge's read-aloud service), `azure` the one used with a key: it
// must be a voice that has the styles below. `pitch` (Hz) and `rate` (%) are
// added to every feeling, to fit the voice to the hero.
export const CAST = {
  // Gwen Stacy under the mask: quick and bright, and softer than she lets on.
  Spiderman: { edge: 'en-US-AvaMultilingualNeural', azure: 'en-US-JaneNeural', pitch: 6, rate: 4 },
};

// rate and volume in %, pitch in Hz, all against the voice's own. `pause` is
// the silence between sentences in seconds; `commas`, when set, splits the
// clauses too and holds this long at each. `arc` is added again for every
// piece after the first, so a line can sink or climb as it goes. `style` and
// `degree` are the Azure speaking style (degree 0.01–2); `echo` gives the
// words the ring of something more than speech.
export const FEELINGS = {
  // Leaning in, ready to help: bright and quick.
  eager: { rate: 6, pitch: 14, volume: 0, pause: .28, style: 'excited', degree: .8 },
  // Plain and sure, to someone who needs convincing.
  earnest: { rate: 0, pitch: 3, volume: 0, pause: .38, style: 'friendly', degree: 1 },
  // Treading carefully around what she has just found out.
  hesitant: { rate: -12, pitch: -8, volume: -10, pause: .8, arc: { pitch: -4 }, style: 'sad', degree: 1.3 },
  // Hard news, carried kindly.
  tender: { rate: -10, pitch: -5, volume: -8, pause: .62, arc: { rate: -4, pitch: -3 }, style: 'sad', degree: .8 },
  // Weighing the danger, and going anyway.
  resolute: { rate: -5, pitch: -6, volume: 0, pause: .35 },
  // Warm, and looking ahead.
  hopeful: { rate: -14, pitch: 6, volume: 0, pause: .4, style: 'hopeful', degree: 1.2 },
  // Read aloud from the keeper's book: slow and measured, each clause set
  // apart and each a little stronger, ringing as it leaves the page.
  incantation: { rate: -16, pitch: -8, volume: 5, pause: .5, commas: .42, arc: { pitch: 4, volume: 3 }, echo: true },
};

// Every line a hero says, with its feeling: all of both chapters, at every
// step and in either camp, and the spell for each of the book's passages.
export function voicedLines() {
  const lines = new Map();
  const take = entry => {
    for (const [who, text, feeling] of entry?.lines ?? []) {
      if (who !== 'you') continue;
      const known = lines.get(text);
      if (known && known.feeling !== feeling) throw new Error(`“${text}” is felt as both ${known.feeling} and ${feeling}`);
      lines.set(text, { text, feeling });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify({ cast: CAST, feelings: FEELINGS, lines: voicedLines() }, null, 2));
}
