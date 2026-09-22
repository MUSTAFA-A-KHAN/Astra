# Astra asset pipeline

## Character architecture

Astra treats character geometry and animation data as separate concerns.

```
character/
  base.glb

animations/
  locomotion.glb
  combat.glb
  emotes.glb
  traversal.glb
```

The browser should download a character mesh/skeleton once and reuse the cached source asset. Animation packs are optional and loaded on demand.

## Compatibility rule

A shared animation pack may be used only when the target character and animation source expose a compatible skeleton. Astra's `AnimationManager` compares the rig bone topology and parent relationships before sharing clips.

A compatible result requires, at minimum:

- matching bone names
- matching parent relationships
- compatible hierarchy
- compatible rest/bind pose expectations

A visually similar character is not automatically compatible.

When the check fails, the character keeps its own embedded/character-specific clips. No blind retargeting is performed.

## Current characters

| Character | Mesh | Animation source | Shared packs |
|---|---|---|---|
| Cael | built-in procedural | built-in procedural | no |
| Lyra | built-in procedural | built-in procedural | no |
| Elowen | built-in procedural | built-in procedural | no |
| Rei | `rigged-model-optimized.glb` | character-specific embedded clips | not assumed compatible |
| Arthur | `Arthur-rigged-under-25mb.glb` | character-specific embedded clips | not assumed compatible |

This is intentional. Retargeting can be added later behind `AnimationManager` without changing gameplay code.

## Runtime managers

- `AssetManager`: request deduplication, memory cache, external URLs, fetch/parse, progress and errors.
- `CharacterManager`: character lifecycle, cached character instances and activation.
- `AnimationManager`: animation-pack loading, rig compatibility and clip selection.
- `GraphicsQualityManager`: adaptive pixel ratio and shadow settings.
- `LODManager`: distance-based LOD state hooks.
- `LoadingManager`: UI loading state and progress.
- `CacheManager`: lightweight session metadata cache.

## Recommended future asset layout

When a character is converted to a mesh-only base file, keep animation data out of that GLB:

```
assets/characters/rei/base.glb
assets/animations/humanoid/locomotion.glb
assets/animations/humanoid/combat.glb
```

Only place animations back into the character file when the rig is intentionally character-specific or when separation provides no practical benefit.

## Important implementation detail

Three.js animation clips are not magically retargeted just because two GLBs are both humanoid. Sharing clips across incompatible rigs can produce incorrect deformation, reversed limbs or broken root motion. Astra therefore fails safe and stays character-specific until an explicit retargeting layer is introduced.
