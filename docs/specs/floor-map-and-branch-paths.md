# Floor map and branching paths

Status: approved design, not yet built. Branch: `feat/floor-map-and-branch-paths`.
This spec is transient: once the feature is built, fold what still holds into
`docs/technical-decisions.md` §1, `docs/developer-guide.md` and the CLAUDE.md
summary of floor generation, then delete this file.

## Why

Today every route through a floor has the same length. A branch point is one
stage holding a combat room and an event room, so the only choice a player
ever makes is "this fight or that event", one room at a time, with no view of
what lies past the next room.

The goal is a floor the player reads and plans across. Two moments drive it:

- The party is worn down (HP and MP around half). The player looks for the
  route with the fewest fights, a short one or one with more events, and
  accepts less EXP for it.
- The party is close to a level-up, which refills every living member's HP
  and MP. The player takes the route with the most fights, betting on reaching
  the level before someone dies.

Nothing in the game suggests a route. The player sees the shape of the floor
and decides; working out which shape suits which situation is part of what a
run teaches.

## Goals

- Floors whose routes really differ: in length, and in how many fights,
  events and rests they hold.
- A map of the whole floor, from the entrance to the guard room, shown while
  the player chooses a path, so a route can be planned rooms ahead.
- Some rooms whose type stays hidden until the party enters them.

## Non-goals

- No route themes. The generator does not build a "combat lane" or an "event
  lane" on purpose; lanes are random within the rules below.
- The map shows no monsters, no difficulty and no rewards. What is in a room,
  how strong it is and what it pays are learned only by entering it.
- No hints about attrition. The game never tells the player that MP does not
  refill between fights or which route is safer.
- No new room kinds in this change. A later room kind with stronger monsters
  is possible; the generator and the map should not make it hard to add.
- No retuning of satiety, EXP or item drops in this change (see Follow-up).

## Anti-goals

- A route with no rest room. Every route must offer at least one.
- A map that is not aligned. Rooms in the same column must line up exactly,
  top to bottom, on every floor.
- Unknown rooms bunched together.

## Floor shape

A floor is still a directed graph from one entrance room to one guard room
(elite or boss), with no dead ends and no way back. What changes is how
branches are built.

A *route* is any walk from the entrance to the guard room. Every rule below
holds for every route of every floor.

Route rules:

| Rule | Value |
|---|---|
| Rooms on the shortest route, entrance and guard included | at least 10 |
| Rooms on the longest route, entrance and guard included | at most 15 |
| Rest rooms on a route | 1 to 3 |
| Event rooms on a route | 2 to 6; 5 or 6 is rare, most routes hold 2 to 4 |
| Two event rooms in a row on a route | never |
| Two rest rooms in a row on a route | never |

Branch rules:

- A split sends the route into 2 or more lanes that later join again.
- A lane holds at least 2 rooms before it joins.
- A lane may split again inside itself (nested branches), and its sub-lanes
  join before the lane itself joins.
- At any point along the floor, at most 4 lanes run side by side, nested
  lanes included.
- A join may also be a split: lanes can meet and part again at the same
  point, with no shared room between.
- How many splits a floor has, and where, is random within these rules.
- The entrance and the guard room are single rooms on every floor. The
  entrance keeps its current role (the Gatekeeper on floor 1, the entry ambush
  check on later floors); the guard room stays the floor's elite or boss.

All of these numbers are new or changed fields in `floorGeneration` in
`data/balance-config.json`, read through `src/data/floorPatterns.ts`. The
values in the table are the first values to set. Fields the old generator used
that no longer mean anything (`maxBranches`, `minBranchStartStage`,
`minBranchSpacing`, the standalone-event fields) are removed. How rare 5 or 6
events is, is a weight in the same section.

## Unknown rooms

An unknown room shows as `[?]` on the map. Its real type (combat, event or
rest) is fixed when the floor is generated and counts toward every route rule
by that real type; only the display hides it.

- The number of unknown rooms on a floor is drawn at random around a mean that
  rises with depth: about 0 to 1 on the first floors, about 12 by floor 100,
  never negative. The count goes up and down from floor to floor rather than
  following a fixed table, so two floors at the same depth differ. Past floor
  100 the mean stays at its floor-100 level. The mean at floor 1, its growth
  per floor, the spread and the cap are `floorGeneration` fields.
- Unknown rooms are spread out: never two in a row on any route, and spread
  along the floor rather than packed into one stretch or one lane.
- The entrance and the guard room are never unknown.
- The Paths list names an unknown room `??? (unknown)`, because room names in
  `data/room-names.json` are drawn per room type and would give the type away.
- Once the party enters an unknown room, its type and name show as normal, on
  the map and everywhere else, for the rest of the floor.
- When the rules leave no room to place the drawn number of unknown rooms, the
  generator places fewer rather than breaking a rule.
- A player can sometimes deduce an unknown room's type from the route rules,
  for example when a route needs one more rest and the unknown room is the
  only candidate. This is accepted; the generator does not try to prevent it.

## The floor map

While the party chooses its next room (the `room` screen), the Battlefield
panel shows the map of the whole floor instead of the party and monster
sprites. Every other screen keeps the normal battlefield: combat, event rooms,
rest rooms, rewards, and the scenes that take priority on arrival (the
Gatekeeper, an entry ambush, a journal pickup, the floor-100 checkpoint, the
founder floor).

Layout, as approved in the mockup (example floor, the party at the first
split):

```
Floor 3  ·  the guard is 9–12 rooms ahead

[ · ]━━[ ■ ]┳━[1 ·]┳━[ △ ]━━[ · ]┳━[ · ]┳━[ ○ ]━━[ · ]━━━━━━━┳━[ · ]━━[ △ ]━━[ · ]━━[ ○ ]━━[ ☠ ]
            ┃      ┃             ┃      ┃                    ┃
            ┃      ┗━[ ○ ]━━[ · ]┛      ┣━[ · ]━━[ ○ ]━━[ ? ]┛
            ┃                           ┃
            ┣━[2 ○]━━[ · ]━━━━━━━━━━━━━━┫
            ┃                           ┃
            ┗━[3 ·]━━[ ? ]━━[ · ]━━━━━━━┛

[1] 4 rooms    [2] 2 rooms    [3] 3 rooms    then 7–8 rooms to the guard

■ you    · fight    ○ event    △ rest    ? unknown    ☠ guard
```

- Every room is a cell exactly 5 characters wide, and columns are 7
  characters apart (a 2-character gap). Rooms in the same column line up
  exactly, top to bottom. A 15-room route needs 103 columns, inside the
  Battlefield's 113 at the smallest supported terminal (150×45).
- A room's column is its position along the floor. A lane shorter than its
  neighbours keeps its rooms in the first columns of the split and runs its
  line on to the shared join.
- The first lane of a split continues on the row it came from; the other
  lanes stack below it, one blank connector row between lanes. A nested split
  stacks its sub-lanes the same way, pushing the outer split's later lanes
  down.
- Junctions use the heavy box-drawing set (`━ ┃ ┳ ┣ ┗ ┫ ┛ ╋ ┻`). A split
  junction sits in the first cell of the gap after the room before it; a join
  sits in the first cell of the gap after the lane's last column. When a join
  is also a split, the two junctions share one column and their glyphs merge
  (for example `┣`, `┫`, `╋`).
- Cells: `[ · ]` fight, `[ ○ ]` event, `[ △ ]` rest, `[ ? ]` unknown,
  `[ ☠ ]` guard, `[ ■ ]` the room the party is in. A room the party can move
  to next carries its key in the cell (`[1 ·]`), matching the Paths list.
  Rooms already passed and their lines are dimmed. Colours follow the mockup:
  the current room in the title colour, keys in the key-hint colour, each room
  type in its own colour.
- Above the map: `Floor N  ·  the guard is X–Y rooms ahead` (`X` when the
  shortest and longest remaining routes are equal).
- Below the map, at a split: one count per choice, the rooms on that lane up
  to its join, then the range of rooms from that join to the guard. With only
  one way on, the line shows just the rooms to the guard.
- A legend line closes the block. The title, map, counts and legend share one
  left edge; the block as a whole is centred in the Battlefield.
- The Path bar above the Battlefield keeps showing the rooms visited so far.
- All text on the map comes from `data/strings.json`, including the legend
  and the `rooms` counts (with the `{{n|one|many}}` plural form).

## Constraints

- Data-driven: every number above lives in `data/balance-config.json`; the
  generator and the map read it and handle any valid combination.
- Engine and UI code name no content id (`test/noContentIds.test.ts`).
- The map is drawn from the floor's room graph (`connectedRoomIds`), not from
  stored coordinates, so a save from an older version, sitting mid-floor on a
  floor built by the old generator, still draws. A room stores only whether it
  is hidden; a room without the flag is visible. Saves from
  `OLDEST_LOADABLE_SAVE_VERSION` onward must keep loading.
- The generator stays deterministic for a given run seed, and a floor is
  generated whole when the party reaches it, as today.
- Footers keep the key-hint grammar (`test/keyHints.test.ts`); the room
  screen's footer is unchanged.
- The map must pass the random-play layout checks at 150×45 and at the play
  sizes (no clipped text, no text touching a panel border).
- `docs/technical-decisions.md` §1 and the CLAUDE.md summary describe the old
  generator and name fields this change removes, so they are rewritten in the
  same change; `bun run docs:sync --check` fails on a doc that pairs a removed
  field with a value.
- Seeded tests and random-play evidence that depend on floor layouts change
  with the new generator and are updated in the same change, not left failing.

## Left to the builder

- How the generator meets the rules: build by construction, or generate and
  check every route with a bounded number of retries and a fallback layout
  that always passes. Route checks should run over the graph (minimum and
  maximum counts per room), not by listing every route, since nested splits
  multiply routes.
- Which lane of a split is drawn first, and how ties in lane length are
  broken.
- The exact formula for the unknown-room mean, spread and cap, within the
  behaviour described above.
- How "spread along the floor" is enforced for unknown rooms (for example a
  per-segment cap).
- The generator's internal data structure; the old stage list can go.
- Splitting the work into reviewable commits.

## Verification

- A property test over many seeds and depths: every route meets every route
  rule, every lane has at least 2 rooms before its join, no column holds more
  than 4 lanes, there are no dead ends, every room is reachable, no two
  unknown rooms sit in a row, and the entrance and guard are never hidden.
- Map tests: the example floor above renders exactly as shown; rooms in one
  column share an x position; a 15-room route fits in 113 columns; an old
  save's floor draws.
- `bun run typecheck`, `bun test`, `bun run docs:sync --check`.
- `bun run random-play` with no failures and no new layout warnings on the
  room screen.
- Play it in the real terminal at 150×45: walk a floor, take a split, enter an
  unknown room.

## Follow-up (separate changes)

- Floors grow from 7–12 rooms per route to 10–15. That means more satiety
  drain, more EXP and coins, and more wear per floor. Measure with
  `bun run random-play` and `bun run curve` once this lands, then retune
  satiety, EXP and Exploration Kits as needed.
