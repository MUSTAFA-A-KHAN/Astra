# Astra opening: The bell that should not ring

The new arrival sequence precedes **The Last Keeper**. The Long Tide, Maren, Tobin, the Moonwell, and the later chapters remain the foundation of the story. The player hears an impossible bell, investigates a drowned lantern and a freshly damaged memorial, confronts a trapped echo, chooses its fate, then takes the evidence to Tobin. His warning gives the journey to the Moonwell a personal reason.

## Repository audit

Before these changes, a fresh journey began in the city with a guiding mote and a notice-board objective. The introduction was a sentence in the journal rather than a narrated scene. The board named Maren among the drowned before the player met her. The critical route then required portal travel to Maren, seven introductory dialogue lines, a return portal, five shards, and eight ferryman lines before directing the player toward conflict. Existing movement, combat, traversal, streaming, and conversation systems were already substantial; the weak point was the order and density of the opening events.

| Existing system | Integration decision |
| --- | --- |
| `game.js`: character selection, movement, interactions, health, attack/ability, saving | Retain the existing runtime and controls; coordinate the prologue with its input and pause rules. |
| `story-script.js`, `story.js`: Maren, Tobin, memorial, ledger, Hart, Moonwell | Keep chapter progression and its ending; attach the new arrival before the chapter and preserve old saves. |
| `chapter-two-*`: lost Tidewarden voice and root/bell/iron locks | Foreshadow the locks through the sealed fragment rather than explain the full chapter. |
| `chapter-three-*`: forgotten shore, Ilyra, Oren, the Unwritten | An erased memorial name introduces the broader fear of being forgotten. |
| `camera.js`, `conversation-cinematic.js`, `portal-cinematic.js` | Reuse the established camera and dialogue handoff; keep the new introduction brief and skippable. |
| `guide.js` | Continue to use an in-world light to connect objectives. |
| `characters.js`: procedural heroes and imported rigs | Retain the roster and its animation controller. Existing imported libraries already include talk, point, look-around, hit, roll, death, and book-reading actions. |
| `audio.js`, `audio-manifest.js` | Retain local sound playback, footsteps, ambience, reactive music, voice bus and automatic music ducking. |
| `tools/generate-voice.py`, `tools/voice-direction.mjs` | Extend the existing Microsoft voice pipeline rather than introduce browser-dependent speech synthesis. |
| `world-map.js`, map modules, `streaming.js` | Keep portal destinations unloaded until needed. Stage the opening in the arrival district. |

The game already contains the city, Red Mesa sanctuary, Pine Islet, Skibidi Yard, Ashen Observatory, and optional Street City, Lantern Plaza, and Nightwood Road. The opening does not need another environment download.

## Flow and player agency

1. **Impossible bell:** short narrated prologue with cinematic framing establishes that the Long Tide is returning in some form. The player can skip it.
2. **Two clues, either order:** investigate the warm lantern and fresh scratches in the memorial. Each discovery is saved. Short voiced exchanges connect visible evidence with the mystery.
3. **The street remembers:** the second discovery triggers a breach and an echo encounter. Existing attack and ability controls are introduced in a directed conflict.
4. **A voice remains:** after the hostile shape breaks, return to the lantern. **Release the memory** reveals that someone called the light away. **Seal the breach** preserves black glass marked with root, bell, and iron. The decision is exclusive and persists.
5. **A witness with something to hide:** Tobin reacts to the chosen outcome, exposes his own unresolved guilt, and sends the player to Maren through the city portal book. The existing Moonwell chapter continues.

These beats are intended to fill the first several minutes through exploration, combat, and travel, rather than minutes of forced dialogue. Timing depends on how quickly the player investigates and fights. The script gives no conversational beat more than four lines.

## Existing asset inventory

These measurements are from the supplied runtime GLBs before the opening work. Counts describe glTF mesh/material/skin objects, not peak renderer draw calls.

| Runtime asset | Size | Meshes / materials / skins | Available animation and use |
| --- | ---: | --- | --- |
| `assets/story/restless-wisp.glb` | 0.26 MiB | 1 / 1 / 1 | Eight clips: idle, walk, attack, hurt, death, knockdown, down-idle, recovery. Existing drowned enemy. |
| `assets/story/harbour-villager.glb` | 2.55 MiB | 7 / 7 / 1 | Mixamo-compatible villager; existing separate Idle/Talk clips. Tobin. |
| `assets/story/moonwell-keeper.glb` | 0.95 MiB | 6 / 5 / 1 | Existing keeper animation. Maren. |
| `assets/story/quest-notice-board.glb` | 0.47 MiB | 1 / 1 / 0 | Static arrival memorial. |
| `assets/story/old-lantern.glb` | 1.00 MiB | 1 / 1 / 0 | Static lantern prop. |
| `assets/story/light-shard.glb` | 0.20 MiB | 1 / 1 / 0 | Existing Moonwell light collectible. |
| `assets/story/harbour-mythic-whale.glb` | 0.91 MiB | 1 / 1 / 1 | Animated Tidewarden in the harbour. |
| `gwen_stacy.glb` / `jj-mo-jj.glb` | 23.04 / 23.47 MiB | Each 1 / 1 / 1 | Existing Mixamo/UAL/MCU motion libraries, loaded when the character is selected. |

All 26 existing story GLBs have source, author, license, and optimization notes in [assets/story/CREDITS.md](assets/story/CREDITS.md). They use CC BY 4.0. Existing sound and voice attribution is in [assets/audio/CREDITS.md](assets/audio/CREDITS.md). Imported player models were already supplied with the repository; their presence is not evidence of new licensing or ownership. Any newly acquired asset must have its own provenance recorded with the asset.

## Saves and verification

Opening progress is kept separately from the established chapter flags. Existing earned chapter progress skips the arrival sequence. Saving lobby preferences alone does not skip it. Clues are individually persistent; a committed decision resumes at the witness objective and cannot be rewarded again.

The pre-change unit baseline was **169 passing tests**. `tests/opening.test.mjs` checks migration, strict save fields, clue order and reload, stage gating, exclusive decisions, objective progress, and dialogue handoff. `tests/opening.spec.js` covers the playable entry and encounter through real UI and combat controls, with movement positioning exposed only in intercepted test responses. The original story browser suite explicitly starts after the opening so it continues to test the complete Moonwell chapter.

Run `npm run test:unit` for unit coverage and `npx playwright test tests/opening.spec.js --project=desktop` for the fresh opening. Mobile browser projects can be selected with `--project=android` or `--project=ipad`.
