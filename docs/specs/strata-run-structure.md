# Spec: Strata run structure (M1)

Not yet implemented. This spec is transient: once M1 ships, fold what still holds into
`docs/developer-guide.md` and `docs/gameplay-decisions/*`, then delete this file.

## Goal

Turn the open-ended descent into a run with a shape and a reachable end: four Strata of three
floors each, a final floor, endings a slot reaches over one or more runs, and an Endless mode after
that. The aim is an engaging run, high replay value, and a story the player experiences instead of
one hidden behind floor 100. The TUI build is the design prototype. The later Unity build ports
this design and does not extend it.

The body of this spec names data fields, not values. Values already fixed are listed once in the
appendix; they move into `data/*.json` during implementation and are then deleted from here.

## Prerequisite

The per-slot profile (`slotN.profile.json`, `feat/save-slot-runs`) is merged before M1a starts.
§6.5 adds fields to it.

## Delivery

One spec, three implementation plans, built in order:

- M1a, structure: Strata, the 1–13 depth scale, branching floors, the four Strata rules, floor 13,
  endings, ending progress kept per slot, Endless, skill points (using existing skills and
  passives), progression compression.
- M1b, monsters and atmosphere: monster rework and new monsters, sprites, Stratum entry text,
  omens, room names.
- M1c, class content: rank 4 for every skill and four passive pairs per class, written around
  each class's build directions.

M1a must be playable and balanceable with the existing monster roster assigned to Strata
provisionally (§3.1), before any M1b content lands.

---

## 1. Run structure

| Stratum | Floors | Last floor ends with |
|---|---|---|
| S1, abandoned dungeon | 1–3 | S1 Stratum boss |
| S2, sewer | 4–6 | S2 Stratum boss |
| S3, roots and breathing stone | 7–9 | S3 Stratum boss |
| S4, repeating rooms under stars | 10–12 | S4 Stratum boss, then the ending checkpoint |
| Final floor | 13 | The Founder (only after choosing Continue) |
| Endless | 14+ | A Stratum boss every `endless.bossFloorInterval` floors |

- Normal floors are pre-built branching floors that split and merge back into one guard room
  (§1.4), replacing the stage graph of `generateFloorLayout`.
- Floors 1 and 2 of a Stratum end in a guard room holding one of that Stratum's Elites, never its
  `bossArchetypeId`. Floor 3 of a Stratum ends in that Stratum's boss.
- `level-growth.json`'s `bossFloorInterval` is removed. The true Bosses are the four Stratum
  bosses, The Founder, and the Endless bosses.
- Floor 1 still opens at the Gatekeeper.
- Mid-run saves stay. `GameState` changes shape, and a 1.x run (depth up to 100) has no meaningful
  place on the new scale, so `OLDEST_LOADABLE_SAVE_VERSION` (`src/engine/save.ts`) is raised to
  2.0.0 and no `VERSION_MIGRATIONS` step is written: in-progress 1.x runs stop loading. Slot
  profiles keep loading, abilities and retired characters included.

### 1.1 Depth scale

`floor.depth` remains the single coordinate for everything depth-driven, now on a 1–13 scale and
continuing upward in Endless. Every depth-keyed threshold in `data/*.json` is rewritten onto this
scale (see §5).

On top of that shared curve, a Stratum may declare an optional `tuning` block that multiplies
monster stats and EXP while the party is inside that Stratum, so entering a new Stratum is a step
up rather than a smooth ramp. Artifact rarity and shop tiers already step once per Stratum (§5)
and take no multiplier. A Stratum without `tuning` uses the shared curve as is. Endless floors
belong to no Stratum and use only the shared curve.

### 1.2 New data file: `data/strata.json`

One record per Stratum:

- `id`, `floors` (the depths it covers), `bossArchetypeId`
- `rule`: `{ kind, ...params }`, see §2
- `entryText`: the line shown on first entering the Stratum
- `roomNames`: per room tag (combat, rest, boss, event), replacing the global set in
  `data/room-names.json` for floors inside a Stratum
- `omenIds`: the Stratum's omens, see §2.5
- `tuning`: optional, see §1.1

A thin loader in `src/data/strata.ts` validates the shape and exposes typed accessors
(`getStratum`, `stratumForDepth`), like every other `src/data/*.ts` loader.

### 1.3 Changes to existing data

- `monsters.json`: `minFloor` is replaced by `stratum`. Every archetype except The Founder belongs
  to exactly one Stratum.
- `events.json`: a new `strata` field lists the Strata the event can roll in. `minFloorDepth`
  stays, rewritten onto the new scale, and is used only for gates that fall inside a Stratum.
- `floor-milestones.json`: omens are grouped by Stratum instead of `maxFloor`, and `interval` is
  removed (see §2.5).
- `balance-config.json`:
  - `endings`: the checkpoint depth and the Founder depth move to the new scale and stay in data.
  - `floorGeneration`: the stage-graph fields (`minPathRooms`, `maxPathRooms`, `maxBranches`,
    `minBranchStartStage`, `minBranchSpacing`, the standalone-event fields) are replaced by the
    branch and route fields in §1.4; the per-path event and rest bounds become per-route.
  - new `endless` block: `bossFloorInterval`.

### 1.4 Branching floors

A normal floor is built whole on entry: one entrance, one guard room, and branches between them
that split and merge freely.

- Branches run in lanes, side by side, and keep their order: no two branches ever cross. A split
  opens a new lane next to the branch it leaves.
- A merge only joins two branches in neighbouring lanes. They need not come from the same split,
  and a merged branch can later split again or merge with its new neighbour.
- Splits and merges never follow each other directly. No room is both a merge and a split, and
  every branch runs at least `minBranchRooms` rooms between one split or merge and the next.
- At most `maxParallelBranches` branches run side by side, and no two branches leaving a split
  lead to the same room through the same room types.
- Every branch ends in the guard room, and there are no dead ends: every room lies on some route
  from the entrance to the guard room.
- A route is one way through the floor, entrance to guard room. Route lengths stay within
  `minRouteRooms`–`maxRouteRooms`, and the shortest and longest routes differ by at least
  `minRouteLengthGap` rooms.
- Every route holds at least `minCombatRoomsPerRoute` combat rooms and respects the event and rest
  bounds (`maxEventRoomsPerRoute`, `minRestRoomsPerRoute`, `maxRestRoomsPerRoute`). Every floor
  still has at least `minEventRoomsPerFloor` event rooms.
- On entering a floor, the map shows the whole layout. At each split, the choice screen shows each branch's rooms up to its next
  split or merge, with their types, and the shortest and longest route left to the guard room
  through it. The party picks a branch at every split and never goes back.
- A long route means more combat (EXP, coins, drops) and more events, at the cost of more satiety
  drain and fear. A short route reaches the guard room sooner with less of both.
- The Gatekeeper's blessing on floor 1 counts rooms along the route taken.
- Floor 13 is a single line of rooms with its own builder (§6.2).

A property test replaces the stage-graph test (§8), and `technical-decisions.md` §1 is rewritten
for the floor builder.

---

## 2. Strata rules and atmosphere

Each Stratum carries exactly one `rule`. The engine supports a small, fixed set of rule kinds, and
each kind's parameters are data. Behavior that belongs to a specific monster (acid, bleed,
targeting style, self-destruct) lives in that monster's kit, traits or `aiPattern`, not in the
rule. Rule kinds are named apart from `aiPattern` values (`bloodthirsty`, `dread`, ...) so the two
never read as the same field.

Rules describe reflexes, never intent (`12-world-bible.md` §12.4). Player-facing text shows what
happens (acid eats, blood draws blows, fear feeds something), never that the dungeon or its
creatures choose or hunt.

### 2.1 S1: no rule

The baseline Stratum, where the player learns the game.

### 2.2 S2: Erosion (`rule.kind: "erosion"`)

Every `intervalRounds` rounds of a combat, counted from that combat's first round, every living
party member receives the rule's `statusIds` (`acid-burn` and `corroded`, both existing).

Most S2 monsters carry the `self-destruct` trait (`monster-traits.json`, threshold and blast per
archetype in data), and have low base stats to compensate:

- When the monster's HP falls below its threshold, from any source including damage over time, it
  is primed and the log says so at once (it swells, it boils; the text is per monster).
- On its next own turn, a primed monster detonates instead of acting, damages the whole party, and
  dies. A primed monster that loses its turn (stun) detonates on the next turn it gets.
- If it is killed before that turn, it does not detonate.
- Death by detonation counts as a kill for EXP, coins and drops.

The player can finish it first or guard against the blast.

### 2.3 S3: Blood Scent (`rule.kind: "blood-scent"`)

One party member at a time carries `focused`, a new debuff in `status-effects.json`, for
`focusDurationRounds` rounds, first assigned at the start of each combat's first round. While it
is active, every monster attack that picks a target picks the focused character.

- Target choice: the living party member with the most `bleeding` stacks. If nobody is bleeding,
  or on a tie, the one with the lowest current HP as a percentage of max HP.
- `focused` overrides `taunt` and the Paladin's `challenge` pull. If the focused character is
  `stealthed`, monsters use normal targeting for that round and the focus stays where it is.
- When the duration ends or the focused character dies, a new target is chosen at once by the same
  rule.

Scent thresholds: at the start of each round, party HP is summed as a percentage of the party's
total max HP, with dead characters counting as 0 HP. For each threshold in `scentThresholds` the
sum is below, every monster holds one step of the rule's `scentStatusId`. Steps are recomputed
every round, so healing the party takes them away.

### 2.4 S4: Night Terror (`rule.kind: "night-terror"`)

- `minFear`: no character's fear can drop below this value while in S4. On entering S4, any
  character below it is raised to it.
- Fear-tier debuff: on top of the existing fear-tier penalties (`04-fear-combat.md`), each fear
  tier above Calm applies its entry of `fearTierStatusIds`, a stat-reduction debuff that grows
  stronger per tier.
- Every monster in an S4 room gains stats in proportion to the party's total fear
  (`fearStatScaling`).

Two further S4 traits are not part of the rule:

- `prescient`, a new `aiPattern` given to some S4 monsters. It is a profile in
  `targeting.profiles` like the existing six, weighting a new targeting factor, `queued`: a score
  for the character who queued a support action this round (heal, guard, a buff on an ally) or the
  highest-MP-cost skill, with its rank scores in `targeting`. No text explains this.
- Identical rooms: every S4 room uses the same name, and the split choice screen shows an S4
  branch's length but not its room types. A room's type (combat, event, rest) shows only once the party
  enters it.

### 2.5 Showing rules and atmosphere to the player

- Rules appear as a short HUD tag next to the stat they affect, and their effects land visibly in
  the log. No screen explains the mechanism.
- Entry text is one line on first entering a Stratum, following §12.11's one-observable-change
  rule. Drafts, to be finalized in M1b:
  - S1: *"The stairs give out onto stonework someone meant to keep. Nobody kept it."*
  - S2: *"The passage narrows and runs wet. Every surface down here slopes the same way."*
  - S3: *"The roots in the walls are warm. Some of them draw back from your hands."*
  - S4: *"Where the ceiling should be, there are stars — clearer than any you remember from above."*
- One omen is shown per floor, after the floor's guard room is cleared, so three per Stratum. The
  existing 12 omens fall into four bands; the first and last already fit S1 and S4, and the middle
  two are rewritten for S2 and S3 in M1b. Floor 13 and Endless floors show no omen.
- Floor 13's rooms use the names of the Stratum each room is drawn from. Endless floors use the
  global `room-names.json`.

### 2.6 Internal only: the body metaphor

The four Strata follow the anatomy of a body from the outside in: outer layer, gullet, nerve and
flesh, mind. As the dream nears its core it takes on the shape of the one dreaming it
(`12-world-bible.md` §12.1). These labels never appear in player-facing text; the player sees only
concrete images and draws the conclusion. M1a adds this as an internal section of
`12-world-bible.md`.

---

## 3. Monsters (M1b)

### 3.1 Roster by Stratum

Each Stratum has about 10 normal monsters, 3 Elites (which can also appear at Boss tier) and 1
Stratum boss: 59 archetypes plus The Founder, made of the 42 existing ones reworked and 17 new.
`skeleton-guard` keeps its normal role alongside its Elite one, so it appears in both S1 columns.

| Stratum | Normal | Elite | Stratum boss |
|---|---|---|---|
| S1 | dungeon-rat, black-bat, vampire-bat, snake, spider, skeleton, skeleton-archer, skeleton-mage, skeleton-warrior, skeleton-guard, zombie, ghost, goblin, goblin-shaman (14) | skeleton-guard, zombie-knight, giant-spider | lich |
| S2 | slime, swamp-slime, toxic-toad, lava-slime, lizard, armored-beetle, water-elemental, fire-elemental, orc-brute, ghoulish-crawler (10) | orc-chieftain, 2 new | void-amalgamation |
| S3 | cultist-initiate, cultist-zealot, lesser-vampire, 7 new (10) | dark-knight, vampire-lord, 1 new | new |
| S4 | wraith, mimic, gargoyle, lesser-golem, cave-bear, dire-wolf, 4 new (10) | ancient-golem, 2 new | dragon |

Provisional assignment for M1a: the table's existing archetypes, with `vampire-lord` standing in
as the S3 boss until M1b adds the real one. That leaves S3 with one Elite (`dark-knight`) and ten
Elite/Boss archetypes in all, which floor 13 accounts for (§6.2).

### 3.2 What each Stratum's monsters are

- S1, abandoned dungeon: an ordinary dungeon's dead and small things. Bones, the walking dead,
  vermin, scavengers, shadow creatures. Light rework: descriptions retuned, most sprites kept.
- S2, sewer: malformed things with no settled shape, some half-dissolved by acid and still moving.
  Heavy rework, for example lava-slime becomes a half-eaten mass of flesh, fire-elemental a swollen
  gas sac (the clearest self-destruct case), orc-brute and orc-chieftain hulking bodies with half
  their mass eaten away that still stand up. Most carry the self-destruct trait.
- S3, roots and breathing stone: only the mad, human in shape with nothing human left. Every S3
  monster must read as someone who was once a person (human proportions, remnants of clothing,
  tools or habits), so its race is `human-like` or a new race defined on that basis, never `beast`
  or `demi-human`; `undead` stays only where the creature still reads as a dead person
  (lesser-vampire, vampire-lord). Many kits apply `bleeding`, and `bloodthirsty` suits most of
  them. This Stratum needs the most new monsters (9) and is written first in M1b.
- S4, the mind: nightmares, the shapes the worst fears take, fused and wrong. The dragon sets the
  model. From a distance it is called a dragon because that is the nearest word; up close it is
  several nightmares joined into one, malformed, more frightening than any real dragon. Some carry
  `prescient`, others `dread`.

### 3.3 Rework scope per archetype

- Name and `id` change together, with every reference updated in the same change (data, engine,
  UI, tests, docs), per the repo convention. The list of names is approved before any data is
  written, then goes through a craft review (`narrative-craft-panel`).
- Descriptions are rewritten in the existing voice, with one wrong detail each.
- Sprites: S1 mostly kept, S2–S4 redrawn in `game-editor`.
- Kits: S2 adds the self-destruct trait, S3 adds bleed, some S4 monsters get `prescient`. Each new
  Elite and Boss gets its own data-declared kit (cooldowns, conditions, target rules, telegraphs,
  phases), like the existing ten; reworked ones keep theirs, retuned to their Stratum.
- Race changes where the creature's nature changed. S4 gets a new race (working id `nightmare`)
  with its own resistances and weaknesses, so S4 creatures don't fight like ordinary undead or
  beasts. This is data only.
- Each monster's M1b entry also carries a fuller visual brief for future Unity art. In-game text
  stays spare; the brief does not.

---

## 4. Class progression

### 4.1 Skills

The skill set of all 12 classes stays as it is: a basic attack plus six skills, the ultimate in
slot 6 (`isUltimate`), and the `[1-7]` combat skill menu. No skill is added. Every skill gains a
fourth rank (M1c), and the per-rank `unlockLevel` in `classes.json` is replaced by the point gates
below.

Rank 4 is not a bigger rank 3. It changes how the skill plays (a new rider, a different target
rule, a cost turned into a payoff), so choosing which skills reach it shapes the character.

### 4.2 Skill points

Skill points replace automatic rank unlocks entirely. They buy ranks only.

- At level 1 there are no points; every character starts with only the basic attack.
- Every level-up gives 1 point per character, and every point is spent at once: points never carry
  over to a later level.
- Points buy:
  - skill ranks 1–3: 6 skills × 3 ranks, where rank 1 unlocks the skill
  - skill rank 4: on at most `maxRank4Skills` of a character's six skills
  - class passive ranks: the existing `passiveSkill`, 3 ranks
- The point budget at the level cap exactly covers that build, so every character finishes the run
  with every skill at rank 3, the class passive maxed and `maxRank4Skills` skills at rank 4. Builds
  differ in which skills reach rank 4, the order of investment, and the passive pairs (§4.3).
- Gates are minimum levels stored in `classes.json`, never hardcoded:
  - rank 1 of each skill has a minimum level per slot, with the ultimate's notably later
  - rank 4 of any skill has a minimum level, on top of rank 3
  - class passive rank 1 has a minimum level
  - ranks 2 and 3 of anything require only the previous rank
- A gate opens an option, it does not force a pick.
- From level 2 to `minPointChoicesUntilLevel`, whatever the character bought before, at least
  `minPointChoices` purchases are open. After that, at least one is always open: the last levels
  finish the ranks still missing. The gates and the rank-4 limit are set so this holds, and a test
  walks every reachable build to check it (§8).
- Spent points are permanent for the run (no respec), matching the Artifact design.

### 4.3 Passive pairs (M1c)

Optional passives come in pairs and cost no points.

- Each class has `passivePairs`: four pairs of two class-specific passives, 96 across the 12
  classes. Each pair has its own level in data.
- At a pair's level, the character must take one of its two passives. The other is gone for the
  run. A character finishes with four optional passives, one from each pair.
- Taken passives are permanent for the run, like spent points.
- Optional passives must not duplicate ability effects (`11-abilities.md`). Abilities are
  untouched and stay a separate, pre-run system.

### 4.4 The level-up screen

A level-up screen opens after every combat that levels the party up, one character at a time, and
does not close until each character has spent the level's point and, at a pair's level, taken one
of the pair. A combat that grants several levels runs the screen once per level. EXP comes only
from combat, so this covers every level-up. Its footer follows the key-hint grammar
(`src/ui/keyHints.ts`, enforced by `test/keyHints.test.ts`).

### 4.5 Build directions (design only)

Each class's rank 4s and passive pairs are written around two build directions, for example a
Knight that holds the line against a Knight that answers every hit. Each pair sets the two
directions against each other, one passive for each, and each direction has skills whose rank 4
pays it off. A character can follow one direction through all four pairs or mix them.

Directions are a design tool, recorded in `01-class-skill.md`. They are not data and never shown in
game: the player reads what fits together from the descriptions.

---

## 5. Progression compression

This section gives method and targets only; values are tuned with `random-play` during balancing.

- Level cap (`maxLevel`) is lowered. A party taking the long routes should reach it at about the S4
  boss, at roughly two levels per floor, with the first level-up right after the first combat. A
  party taking short routes ends below that by design; `random-play` measures how far.
- Level-keyed data (`level-growth.json` growth tiers and EXP tiers, every gate in §4.2, the pair levels in §4.3) is rescaled
  to the new cap, keeping relative order. Thresholds that would collapse onto the same level are
  spread apart.
- Monster scaling: `monsterDepthBuffBracketFloors` becomes one floor per bracket on the new scale,
  plus each Stratum's `tuning` multiplier. Endless continues the shared curve.
- Artifact rarity and shop tiers: `floorsPerStep` becomes one Stratum per step, and each source's
  anchors move to the new scale.
- Abilities: `abilities.depthCap` moves to the new scale. Elite and Boss kills still unlock
  abilities instantly.
- Stardust is earned from a Stratum boss on its own Stratum's last floor, from The Founder, and
  from Endless bosses, instead of every `bossFloorInterval` floors. Floor 13's boss-tier rooms
  give none. The amount is retuned so a run's total supports a sensible buyback.
- `expRewardDepthRate` is retuned to the level-cap target.
- Event gating maps the discovery curve onto Strata through `strata`: events gated at depth 15
  open from S2, 35 from S3, 70 in S4 only. The early gates (2, 3, 10) become `minFloorDepth`
  values inside S1.
- `chainTier2MinFloorDepth` and `chainTier3MinFloorDepth` become the first floor of S2 and S3.
- Chain thresholds (`circleRemembers*`, `bloodDebt*`, `freeTakenThreshold`) and the Camp
  Reflection tiers count across a slot's runs (§6.5), so they are not rescaled to one run's length.
  Balancing checks how many runs a slot takes to reach each ending.
- `fearPerRoundDepthGrowth` is retuned for 12 floors. Satiety, Camp and rest rooms keep their
  mechanics; balancing checks that satiety still matters on short and long routes alike.
- `random-play` reports per Stratum and per route length taken: survival rate through each Stratum
  boss, average level at each Stratum boss, rooms and rounds per run, Stardust earned and buybacks
  made, and runs per slot to each ending. Target rates are set during balancing, outside this
  spec.

---

## 6. Floor 13, endings, The Founder

### 6.1 The ending checkpoint

The logic of Part F.1 (`10-event-narrative.md`) is unchanged: Leave (when its triggers fire),
otherwise Stay, Let Go or Continue. It fires after the S4 boss. Its conditions read the slot's
totals (§6.5) instead of the run's.

### 6.2 Floor 13, the last floor

Floor 13 has its own builder:

- A single line of rooms (count from data, The Founder's room included), with no branches, rest
  rooms or events.
- Every room before the last is a boss room: one Elite/Boss archetype from one Stratum at Boss
  tier, plus a number of that Stratum's normal monsters set in data. That Stratum's rule and
  atmosphere apply inside the room, so the floor moves between ordinary, damp, crawling and
  crushing from room to room.
- Stratum order is shuffled with two constraints: no two adjacent rooms from the same Stratum, and
  every Stratum appears at least twice.
- No boss repeats within the floor. The 16 Elite/Boss archetypes across the four Strata (The
  Founder excluded) cover the room count. Until M1b lands, the provisional roster holds ten, and
  the room count is capped at ten plus The Founder's room.
- Between rooms the party can use items and Camp (paid with an Exploration Kit, as today), nothing
  else.
- The last room is The Founder's alone, under no Stratum rule.

### 6.3 The Founder's room

This staging script is shared by the TUI and Unity builds.

1. Arrival: a library. Ritual circles are drawn densely across the floor and walls, the spiral mark
   turning both inward (sealing) and outward (inviting), overlapping. This is the room where the
   schism began, and it does not say which side was right (§12.9). Books lie scattered across the
   floor and the shelves. In the middle stands a low dais, and The Founder stands on it in human
   form.
2. Dialogue: the six lines and two interleaved beats from Part F.5, unchanged. Only the arrival
   description is rewritten, since the current one ("no face left to speak from") contradicts the
   human form.
3. Transformation: the circles light, the books rise and burn, and the burning sounds like the
   things the party fought on the way down, layered over each other. The scene says only that it
   sounds like them. It never states the books made the monsters, which would make The Founder the
   dungeon's architect and contradict §12.6 and §12.4. The Founder becomes the final form: more
   brain than body, nerve-thick ropes trailing where legs should be. This is the existing
   description, kept because it already combines S3's nerve and flesh with S4's mind.
4. The fight is against the final form only. The existing kit stays; stats come from floor 13 on
   the new scale plus any tuning.

On the TUI, steps 1–3 are paced text beats plus a sprite swap (human form to final form), on the
existing founder dialogue screen. The Unity build stages it in full.

### 6.4 After an ending

- True ending (The Founder defeated): the run ends on the victory screen; it no longer continues
  past The Founder. The events marked `removedOnFounderVictory` leave the pool for every later run
  in the slot.
- Endless mode unlocks for a slot once that slot reaches any ending (Stay, Let Go, Leave or the
  true ending), recorded in the slot profile. It is chosen when starting a run in that slot.
  Floors 1–12 play exactly as in a normal run, Strata and their rules included. After floor 12
  there is no checkpoint and no floor 13: the run continues at floor 14 with branching floors, monster
  and event pools from all four Strata, and no Stratum rule. Every `endless.bossFloorInterval`
  floors, counted from floor 13, the guard room holds a Boss drawn from the four Stratum bosses.
  Death in Endless is ordinary permadeath (abilities lost, Stardust buyback).

### 6.5 Ending progress kept per slot

The state the checkpoint and the chain events read moves from `GameState` into the slot profile:

- `narrativeCounters` (all five counters), `loreExposureCount` and `eventOutcomes`
- the endings the slot has reached, whether The Founder has fallen, and whether Endless is
  unlocked

Every run in the slot reads and writes these in place. They survive permadeath and every ending;
only `clearSlot` resets them. Chain escalation text reads the slot's totals, so a new party can
meet an altar already worn down by earlier runs. The text never tells a new party why.

Consequences, accepted:

- Leave is checked first. Once its triggers hold, every later checkpoint in that slot offers Leave
  only.
- Leave's second trigger needs `altarPaymentsCount` at 0, so one payment at `blood-altar` in any
  run closes it for the slot.
- Camp Reflection tiers rise across parties, not within one.

`runStardust`, `firedOnceEventIds` and everything else about a single run stay in `GameState`.

---

## 7. Removed

- `bossFloorInterval` (see §1).
- The floor-100 and floor-120 ending depths (moved to the new scale).
- The stage graph of `generateFloorLayout` and its branching fields (see §1.4).
- The per-rank `unlockLevel` of skills and class passives (see §4.2).

---

## 8. Testing

- Branching floors: a property test over many seeds covers one entrance and one guard room that
  every branch ends in, no dead ends, no crossing lanes, merges only between neighbouring lanes,
  no room that is both a merge and a split, `minBranchRooms` between splits and merges, at most
  `maxParallelBranches` side by side, no two identical branches out of a split, route lengths in range with
  the shortest and longest at least `minRouteLengthGap` apart, `minCombatRoomsPerRoute`, the event
  and rest bounds on every route, and `minEventRoomsPerFloor`.
- Floor 13: room count in range, no adjacent same-Stratum rooms, every Stratum at least twice, no
  repeated boss, The Founder alone in the last room, no rest or event rooms, and the M1a cap.
- Strata rules:
  - S2: erosion fires on the configured round interval; self-destruct primes below threshold
    (damage over time included), detonates on its own next turn, waits out a stun, never detonates
    if killed first, and pays out as a kill.
  - S3: `focused` target order (bleed stacks, then HP percentage), duration, overrides taunt and
    challenge, falls back under stealth, retargets on death; scent steps recomputed each round,
    with dead characters counted as 0.
  - S4: fear never below `minFear`; per-tier debuffs; monster fear scaling; `prescient` targeting
    through the `queued` factor.
- Skill points: every gate, the rank-4 limit, no point carried over, a budget at the cap equal to
  the full build, and a walk over every reachable build showing at least `minPointChoices` open
  purchases up to `minPointChoicesUntilLevel` and at least one at every level after.
- Passive pairs: each pair offered at its level, exactly one of the two taken, the other gone, no
  point spent.
- Level-up screen: one pass per level gained, closed only once every point is spent and every pair
  answered.
- Endings and Endless: checkpoint after the S4 boss, The Founder on floor 13, the run ending on
  his defeat, Endless skipping both, Endless bosses on the configured interval.
- Slot progress: counters, outcomes and the Endless unlock survive permadeath and every ending,
  `clearSlot` resets them, and two slots never share them.
- Save: `OLDEST_LOADABLE_SAVE_VERSION` at 2.0.0, a 1.x run rejected cleanly, the slot profile
  intact.
- UI: key hints for the split choice and level-up screens, the floor map drawn legibly at
  `maxParallelBranches` lanes, and `random-play` layout checks at 150×45 plus the per-Stratum and per-route report.
- Every plan ends green on `bun test`, `bun run typecheck` and `bun run docs:sync --check`.

## 9. Docs to update during implementation

- `design-doc.md`: run structure, Strata, branching floors.
- `developer-guide.md`: `strata.json` and its loader, the branching-floor builder, the floor-13 builder,
  the split choice and level-up screens, the new slot-profile fields.
- `technical-decisions.md` §1: the branching-floor builder in place of the stage graph.
- `gameplay-decisions/`: 01 (skill points, rank 4, passive pairs, build directions), 02 (roster by Stratum, self-destruct, `prescient`, new
  race), 03 and 04 (S4 fear), 06 (level cap, points), 07 (drops by Stratum), 08 and 10 (event
  gating, ending depths, slot-kept progress, Founder staging), 09 and 11-abilities (Stardust,
  `depthCap`), 12-world-bible (internal body-metaphor section).
- `README.md` and `CLAUDE.md`: the level range and the floor-generation description.
- Generated tables via `bun run docs:sync`.

## 10. Risks

1. Content volume. M1b and M1c are mostly writing: 59 monsters, 72 rank-4 skills and 96 passives.
2. Losing spirals. `focused` overriding taunt, scent steps and fear scaling all punish a party that
   is already losing. `random-play` measures each one separately.
3. Floor 13. Consecutive boss rooms with only items and Camp may be close to unwinnable; it is
   balanced on its own.
4. Short routes. A party that always takes the shortest route may fall too far behind the level curve.
5. In-progress 1.x runs stop loading on upgrade.

---

## Appendix: starting values (move into `data/*.json`, then delete)

- 4 Strata × 3 floors.
- Branching floors: at most 3 branches side by side, at least 2 rooms between a split and the next
  split or merge; routes run 6–9 rooms, the shortest and longest at least 2 rooms apart.
- Floor 13: 9–12 rooms, The Founder's included.
- Endless: a Boss every 3 floors (16, 19, ...).
- Level cap 25, about 2 levels per floor on the long routes.
- Skill rank-1 gates: slots 1–2 from level 2 (the first point), slot 3 at level 3, slot 4 at level
  5, slot 5 at level 7, the ultimate (slot 6) at level 12.
- Class passive rank 1 from level 2.
- Rank 4: from level 10, on at most 3 skills per character. The full build is 18 + 3 + 3 = 24
  points, the budget at the cap of 25.
- Passive pairs at levels 4, 9, 14 and 20.
- At least 3 open purchases up to level 19, at least 1 from level 20 to the cap.
- S2 erosion every 2 rounds; S3 `focused` lasts 2 rounds; S3 scent thresholds at 80, 60, 40 and
  20% of party HP; S4 `minFear` 30, below the first fear tier, so it raises the baseline without a
  penalty of its own.
