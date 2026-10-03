# Animation provenance

`npc-gestures.js` is original animation data authored for Astra. It contains seven additive actor-space performances: Notice, Listen, Talk, Point, Concern, Shake, and LookAround. No external motion-capture samples, downloaded Mixamo animations, or character geometry are included in this file.

`npc-presence.js` retargets these rotation keys at runtime onto the existing Maren and Tobin rigs using their bind axes. Their previously supplied idle and talking animations continue underneath. The original model and embedded-animation sources remain credited in [../story/CREDITS.md](../story/CREDITS.md).

The imported playable characters and their pre-existing animation libraries were supplied with the project. This change does not assert or change ownership or licensing of those assets, and downloads no replacement character or motion pack.
