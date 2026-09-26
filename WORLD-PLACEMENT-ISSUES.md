# World placement issues

Checked on 2026-09-26 against commit `6513d59`, by booting the game headlessly and photographing every placed object in the city, the forest islet and the yard.

Updated later on 2026-09-26: #3, #9, #10, #13, #17 and #18 are fixed (see [Fixed](#fixed)). #15 is better but still open.

Coordinates are world units (x, z). North is −z.

## Why most of these happen

- **Snapping to roads.** Props are placed at fixed coordinates, or at an offset from the arrival point, and then moved to the nearest walkable spot. The arrival point (`CITY_ARRIVAL`, (0, 18)) is the main crossroads, and the navigator counts road asphalt as walkable ground. So most things end up on the road.
- **Portal mode removed things the story relied on.** Since commit `4d52bac`, `createWorld({ portalTravel: true })` loads only the city (and, since #3 was fixed, the Red Mesa with it). The west jetty and the islet next to the quay no longer exist, but Tobin and his boat are still placed for them.
- **Portal placement checked too little (fixed).** `placePortal()` only checked that the book and the reading spot were clear. It did not check the dais (the stepped platform the arch stands on) or the ring of flying stones, which reach 12.4 m from the centre. The portal also had no collision at all.

## City: story (The Last Keeper)

### 1. Tobin's rowboat lies on the quay road

- **Where:** (−70.8, 24.5), on the asphalt next to a bus stop. [story.js:129](story.js#L129), [story.js:234-237](story.js#L234-L237)
- **What's wrong:** the oars are posed as if rowing, so their blades go down into the road. The boat is also tilted 6° (`model.rotation.z = .1`) with nothing under it.
- **Fix:** moor it in the water just outside the west seawall, by the ladder. Set its height to `HARBOUR_LEVEL`, remove the tilt, and add a gentle bob in `update`. Move its three colliders (`story-boat-*`) off the road.

### 2. Tobin stands in the road, at a jetty that no longer exists

- **Where:** (−70.5, 16). [story.js:126-127](story.js#L126-L127)
- **What's wrong:** he is placed "where the west jetty leaves the quay", but portal mode never builds the jetty. He stands on the asphalt facing the city.
- **Fix:** stand him on the pavement at the seawall ladder, facing the boat and the water. Update the jetty line in [story-script.js:165](story-script.js#L165).

### 4. The wanderers' camp spans the main east–west road

- **Where:** x −50 to −36, z 11 to 18. The camp point comes from [portal-map-world.js:30](portal-map-world.js#L30); offsets are in [story.js:118-122](story.js#L118-L122) and [gameplay-world.js:49](gameplay-world.js#L49), [:109](gameplay-world.js#L109), [:114](gameplay-world.js#L114).
- **What's wrong:** the tent, fire, ledger stand, camp lantern, market stall and smithy all stand on the asphalt.
- **Fix:** move the `camp` point to a garden square (for example around (40, 50)) or the park. The offsets follow.

### 5. The campfire looks like a pile of boulders

- **Where:** [story.js:246](story.js#L246)
- **What's wrong:** the model is scaled so its whole stone scatter is 1.6 m × M (about 3 m) long. The actual fire ends up tiny (about 0.4 m) and off-centre from the camp's ring.
- **Fix:** size and centre the model on the fire itself with the `measure` option, for example `measure: m => /Firewood|Flames/.test([m.material].flat()[0].name)`. `fit()` already centres on the measured box. Hide the big outer `Stones` meshes if they still crowd it.

### 6. The notice board stands in the middle of the arrival crossroads

- **Where:** arrival point + (7, −7), about (6.6, 10.6). [story.js:123](story.js#L123)
- **Fix:** put it on the pavement corner next to the arrival point, facing the street.

## City: activities

### 7. The horse, crates, lookout and wading pool are on the road

- **Where:**
  - Trail horse (6.1, 19.1): [gameplay-world.js:84](gameplay-world.js#L84)
  - Both supply crates (−3.9 and −6.7, 14.6): [gameplay-world.js:103](gameplay-world.js#L103)
  - Ladder lookout (7.9, 26.6), on a zebra crossing: [gameplay-world.js:50](gameplay-world.js#L50)
  - Wading pool (−4.9, 28.9), on a zebra crossing: [gameplay-world.js:63](gameplay-world.js#L63)
- **Fix:** give each one a hand-picked pavement or park spot instead of an offset from the arrival point.

### 8. The wading pool has no floor

- **Where:** [gameplay-world.js:66](gameplay-world.js#L66)
- **What's wrong:** the water is a transparent disc with nothing under it, so the asphalt and crossing stripes show through.
- **Fix:** add a stone floor disc just under the water.

## City: other

### 11. The Sunstone Watch landmark marks empty pavement

- **Where:** (51.4, −4.1), in front of a house door. [portal-map-world.js:31](portal-map-world.js#L31)
- **What's wrong:** there is only a floating crystal and a ring. `assets/story/sunstone-watchtower.glb` was packed and credited for this landmark (see `assets/story/CREDITS.md`) but is never loaded.
- **Fix:** load and place the watchtower at the landmark, as `story.js` does for its other models. Otherwise remove the landmark.

### 12. Eight city shards were placed inside buildings

- **Where:** `CITY_SHARDS` in [portal-map-world.js:11](portal-map-world.js#L11); they are snapped in [game.js:274](game.js#L274).
- **What's wrong:** these are pushed 4–22 m onto the nearest street. Shard 8 lands inside the campfire ring.

  | Shard | Placed at | Ends up at |
  | --- | --- | --- |
  | 7 | (−35, 23) | (−34.9, 19.1) |
  | 8 | (−42, 34) | (−42.4, 19.1), in the campfire |
  | 11 | (25, −13) | (17.6, −13.1) |
  | 12 | (36, −17) | (35.6, −5.6) |
  | 13 | (47, −26) | (46.9, −41.6) |
  | 15 | (−15, −42) | (−6.4, −42.4) |
  | 17 | (−28, −60) | (−6.4, −57.4) |
  | 18 | (30, −63) | (17.6, −66.4) |

- **Fix:** give these eight new spots on open pavement, at least 3 m from any prop. Keep their positions in the list so saved progress still matches.

### 14. The lobby's hero pedestal stands in the crossroads (low priority)

- **Where:** the pedestal sits at the arrival point, [game.js:131-133](game.js#L131-L133), which comes from `CITY_ARRIVAL` in [city-world.js:10](city-world.js#L10).
- **What's wrong:** on the character screen the hero stands in the middle of the road, with wisps floating behind.
- **Fix:** move `CITY_ARRIVAL` onto a plaza (things placed relative to the arrival point move with it), or hide the enemies while the lobby is showing.

## Forest islet (portal destination)

### 15. The portal does not fit on the islet (partly fixed)

- **Where:** portal at (−119, 17.8), in the grass clearing west of the path. It used to stand at (−110.7, 14.3), with the dais's bottom step over the fence line and a barrel inside it.
- **What's better:** the footprint check from #9 moved the dais off the fence line and away from the truck and barrels. It now stands 18 m from the arrival point.
- **What's left:** no spot on the islet fits the whole gate. The largest clear circle is 5 m in radius, near (−114, 11). The dais and arch need 6 m, and the awake stones fly 13 m. No spot is level across the dais either, so placement falls back to the roomiest spot it finds. The awake stones still fly out over the fence and the cliff.
- **Fix:** make room on the islet by moving the barrels, fence posts or rocks around the clearing. Otherwise, accept this best-effort placement.

### 16. Two rune sites are hard to see or reach

- **Where:** [chapter-two-world.js:46](chapter-two-world.js#L46), [:49](chapter-two-world.js#L49)
- **What's wrong:** the root tablet (−99.4, 9.4) is jammed under the pickup truck's tailgate, against the cliff fence. The moon rune (−121.1, 0.4) is hidden inside a bush under the boardwalk.
- **Fix:** move both to open clearing ground.

## Settings

### 19. The Lantern Plaza and Nightwood toggles do nothing

- **Where:** [game.js:961](game.js#L961); [world-map.js:46-50](world-map.js#L46-L50) returns the portal world before reading them.
- **What's wrong:** the toggles still save and reload the page, but portal mode never loads those districts.
- **Fix:** hide the toggles while portal travel is on, or make those districts portal destinations.
- **Update:** the Red Mesa toggle is gone. The mesa now always loads with the city, because the Moonwell stands on it (see #3).

## Fixed

### 3. The Moonwell sanctuary was built in the middle of a street

- **Was:** at (0, −50), on the north–south street. The well, the 14 m stone circle, Maren, the Hart, the chest and the lantern all stood on the road, with lane markings running through the well.
- **Fixed:** the sanctuary now stands on the Red Mesa (the "Worldmachine Terrain" model), on its eastern sands at `MOONWELL` (90, 140) in [portal-map-world.js](portal-map-world.js). The street at (0, −50) is clear.
  - In portal mode the city map now loads with the mesa and the mesa jetty (`loadCityAndMesa` in [world-map.js](world-map.js)), so the sanctuary can be walked to from the start of the story. The Red Mesa settings toggle is removed.
  - The spot is the flattest open ground on the mesa within reach of the city: 15 m clear, level to 0.4 across the stone circle and 0.64 out to Maren. It is about 98 m along the sand from the jetty's end.
  - The shrine landmark carries an `approach` (the jetty's end). [story.js](story.js) turns the whole sanctuary to face it, so Maren still waits on the side the player arrives from, with the well behind her.
  - The pillars' colliders are now measured from the stone circle's own foot. They used to use a fixed world height that only worked at street level, so on the mesa they would have got none.
- **Found on the way:** the kerb along the south quay stands 0.5 above both the road and the pavement, just over the 0.48 step height. The mesa jetty started on that pavement, so it could not be reached from the city at all. The legacy world only reached it by a back route along the west seawall, and its test teleported onto the pavement. The jetty now starts at the road's edge (z 82) and ramps up over the kerb.
- **Checked by:** the new test in `tests/optional-districts.spec.js` walks from the street over the jetty to Maren, and checks that every piece of the sanctuary stands in the mesa region.

### 13. A wisp patrolled inside the Moonwell sanctuary

- **Was:** the patrol at (−17, −38) ended up a few metres from Maren and the Hart.
- **Fixed by #3:** the sanctuary moved to the mesa, and no patrol walks there. The patrol still runs on the street.

### 9. The portal stood on the quay road and cut through a tree

- **Was:** at (−63, 37). The dais hung over the kerb and the lectern stood in the lane. Once awake, the spinning arch and flying stones passed through the street tree and planter beside it.
- **Fixed:** the city anchor is now the north-east car park, `CITY_PORTAL` (95, −100.5) in [game.js:159](game.js#L159). It is the only off-road spot in the city with a clear 13 m circle. Pavements never clear even 6 m, because trees, lamps and parked cars are part of the street meshes.
  - `portalClearance()` ([game.js:163](game.js#L163)) measures how far the gate could spread before it met something: the map's obstacles, a story or chapter-two site, a prop's collider, or the arrival point.
  - `portalLevel()` keeps kerbs and banks out from under the dais.
  - `placePortal()` takes the first spot that is level and 13 m clear. If there is none, it takes the best spot found: level ground first, then the most room.
- **Limit:** the navigator does not record tree canopies above 5 m, so the check cannot see them. The nearest canopy to the car-park spot is 13.6 m away.

### 10. You could walk straight through the portal

- **Was:** `collision` was not passed to `createPortal`, so the portal registered no colliders at all, not even the lectern's.
- **Fixed:** [game.js:154](game.js#L154) passes `collision`. `GATE_PARTS` in [portal-world.js:15](portal-world.js#L15) adds four circle colliders, measured from the model:
  - the dais: 4.55 m radius and 1.7 m high, above the hero's 1.53 m jump
  - the arch's two feet, which stand on the ground outside the dais
  - the arch's crown, which only blocks the camera

  The lectern's collider now registers too. Walking at the gate from six directions stops the hero at the dais edge in every map. `tests/portal-world.test.mjs` checks the colliders at three facings and checks that the aperture stays open to the camera.

### 17. Arriving in the yard put the hero inside the portal's dais

- **Was:** outside the city, the portal search started on the arrival point, and in the yard the portal landed exactly on it, at (169.9, 136.1).
- **Fixed:** the arrival point counts as an obstacle in `portalClearance()`. The yard portal now stands at (200.4, 148.8), 33 m from the arrival point, with its full 13 m clear. This matters more since #10: arriving inside the dais's collider would shove the hero around.

### 18. Valve 1 was buried under the edge of the dais

- **Was:** chapter-two sites were kept 6 m from the book, not from the portal. Valve 1 ended up 4 m from the portal's centre.
- **Fixed:** sites are now measured from the portal's centre, as part of its clearance. Valve 1 is 31.6 m away, and the nearest yard site, the bell tablet, is 19.2 m away.

## Stopping this from recurring

- When placing a prop, look straight down at the spot and reject road asphalt. The city's `streets…mat005` meshes are the roads, and pavement is `floor_sidewalk`. The car parks are the same `streets…mat005` asphalt, and the portal stands in the north-east one on purpose, so a road check has to tell car parks from roads by area.
- Add a test that fails when any story, activity or portal prop lands on asphalt or overlaps another.

## How these were found

A probe was appended to `game.js` through `page.route` in a scratch Playwright script, the same way `tests/story.spec.js` does it. It entered the game and waited for the 14 story models. It then stopped the animation loop and, for each placed object, recorded the ground height and the mesh name straight below it. It also rendered a close-up and a north-up, labelled top-down view of each map. The forest and yard were reached by calling `world.travelTo(map)` and then `arriveThroughPortal(arrival)`. The awake portal was rendered with `portal.setPhase('ready', 1)`.
