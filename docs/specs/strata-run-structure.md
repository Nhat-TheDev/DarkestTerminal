# Spec: Strata run structure (M1)

Not yet implemented. This spec is transient: once M1 ships, fold what still holds into
`docs/developer-guide.md` and `docs/gameplay-decisions/*`, then delete this file.

## Goal

Turn the open-ended descent into a run with a shape and a reachable end: four Strata of three
floors each, a final floor, endings that most competent players can reach, and an Endless mode
after that. The aim is an engaging run, high replay value, and a story the player experiences
instead of one hidden behind floor 100. The TUI build is the design prototype. The later Unity
build ports this design and does not extend it.

The body of this spec names data fields, not values. Values already fixed are listed once in the
appendix; they move into `data/*.json` during implementation and are then deleted from here.

## Delivery

One spec, three implementation plans, built in order:

- M1a, structure: Strata, the 1–13 depth scale, the four Strata rules, floor 13, endings, Endless,
  skill points (using existing skills and passives), progression compression.
- M1b, monsters and atmosphere: monster rework and new monsters, sprites, Stratum entry text,
  omens, room names.
- M1c, class content: one new skill per class, six optional passives per class.

M1a must be playable and balanceable with the existing monster roster assigned to Strata
provisionally, before any M1b content lands.

---

## 1. Run structure

| Stratum | Floors | Last floor ends with |
|---|---|---|
| S1, abandoned dungeon | 1–3 | S1 Stratum boss |
| S2, sewer | 4–6 | S2 Stratum boss |
| S3, roots and breathing stone | 7–9 | S3 Stratum boss |
| S4, repeating rooms under stars | 10–12 | S4 Stratum boss, then the ending checkpoint |
| Final floor | 13 | The Founder (only after choosing Continue) |
| Endless | 14+ | — |

- Normal floors keep the stage-graph generator (`generateFloorLayout`) unchanged in shape. Only
  `floorGeneration.minPathRooms`/`maxPathRooms` change, and the generator's property test must keep
  passing.
- Floors 1 and 2 of a Stratum end in a guard room (Elite), as every floor does today. Floor 3 of a
  Stratum ends in that Stratum's boss (`bossArchetypeId`).
- `level-growth.json`'s `bossFloorInterval` is removed. The only true Bosses in a normal run are
  the four Stratum bosses and The Founder.
- Mid-run saves stay. `GameState` changes shape, so the save version is bumped. Because
  `ALLOWED_LEGACY_SAVE_VERSIONS` is empty, in-progress runs from older versions stop loading.
  `profile.json` (abilities, retirement record) is unaffected.

### 1.1 Depth scale

`floor.depth` remains the single coordinate for everything depth-driven, now on a 1–13 scale and
continuing upward in Endless. Every depth-keyed threshold in `data/*.json` is rewritten onto this
scale (see §5).

On top of that shared curve, a Stratum may declare an optional `tuning` block that multiplies the
curve while the party is inside that Stratum: monster stats, artifact rarity, EXP, shop tiers. This
makes entering a new Stratum a step up in difficulty and reward rather than a smooth ramp. A
Stratum without `tuning` uses the shared curve as is. Endless floors belong to no Stratum and use
only the shared curve.

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
- `events.json`: `minFloorDepth` is replaced by `strata`, the list of Strata the event can roll in.
- `floor-milestones.json`: omens are grouped by Stratum instead of `maxFloor`, and `interval` is
  removed (see §2.5).
- `balance-config.json` `endings`: the checkpoint depth and the Founder depth move to the new scale
  and stay in data.

---

## 2. Strata rules and atmosphere

Each Stratum carries exactly one `rule`. The engine supports a small, fixed set of rule kinds, and
each kind's parameters are data. Behavior that belongs to a specific monster (acid, bleed,
targeting style, self-destruct) lives in that monster's kit or traits, not in the rule.

Rules describe reflexes, never intent (`11-world-bible.md` §11.4). Player-facing text shows what
happens (acid eats, blood draws blows, fear feeds something), never that the dungeon or its
creatures choose or hunt.

### 2.1 S1: no rule

The baseline Stratum, where the player learns the game.

### 2.2 S2: Erosion (`rule.kind: "erosion"`)

Every `intervalRounds` rounds of combat, every living party member receives the configured status
effects (`acid-burn` and `corroded`, both existing).

Most S2 monsters carry a self-destruct trait, declared per archetype in data, and have low base
stats to compensate:

- When the monster's HP falls below its trait threshold, it is primed and the log says so at once
  (it swells, it boils; the text is per monster).
- On its next own turn, a primed monster detonates instead of acting, damages the whole party, and
  dies.
- If it is killed before that turn, it does not detonate.

The player can finish it first or guard against the blast.

### 2.3 S3: Bloodthirst (`rule.kind: "bloodthirst"`)

One party member at a time carries the `focused` debuff, for `focusDurationRounds` rounds. While it
is active, every monster attack that picks a target picks the focused character.

- Target choice: the living party member with the most `bleeding` stacks. If nobody is bleeding,
  or on a tie, the one with the lowest current HP as a percentage of max HP.
- `focused` overrides taunt. If the focused character is untargetable (stealth), monsters use
  normal targeting for that round and the focus stays where it is.
- When the duration ends or the focused character dies, a new target is chosen at once by the same
  rule.

Blood scent: party HP is summed as a percentage of the party's total max HP, with dead characters
counting as 0 HP. For each threshold in `bloodScentThresholds` the sum falls below, every monster
gains one more step of the configured stat buff.

### 2.4 S4: Dread (`rule.kind: "dread"`)

- `minFear`: no character's fear can drop below this value while in S4. On entering S4, any
  character below it is raised to it.
- Fear-tier debuff: on top of the existing fear-tier penalties (`04-fear-combat.md`), each fear
  tier above Calm adds a stat-reduction debuff, stronger per tier (values per tier in data).
- S4 monsters gain stats in proportion to the party's total fear.

Two further S4 traits are not part of the rule:

- `prescient`, a new `aiPattern` given to some S4 monsters. When choosing a target, it sees the
  party's queued actions for the round and prefers the character who queued a support action
  (heal, guard) or the highest-MP-cost skill. No text explains this.
- Identical rooms, a presentation change: every S4 room uses the same name, and the room-choice
  screen does not reveal a room's type (combat, event, rest) until the party enters it. To verify
  during planning: what the room-choice screen currently shows.

### 2.5 Showing rules and atmosphere to the player

- Rules appear as a short HUD tag next to the stat they affect, and their effects land visibly in
  the log. No screen explains the mechanism.
- Entry text is one line on first entering a Stratum, following §11.11's one-observable-change
  rule. Drafts, to be finalized in M1b:
  - S1: *"The stairs give out onto stonework someone meant to keep. Nobody kept it."*
  - S2: *"The passage narrows and runs wet. Every surface down here slopes the same way."*
  - S3: *"The roots in the walls are warm. Some of them draw back from your hands."*
  - S4: *"Where the ceiling should be, there are stars — clearer than any you remember from above."*
- One omen is shown per floor, after the floor's final room is cleared, so three per Stratum. The
  existing 12 omens fall into four bands; the first and last already fit S1 and S4, and the middle
  two are rewritten for S2 and S3 in M1b.

### 2.6 Internal only: the body metaphor

The four Strata follow the anatomy of a body from the outside in: outer layer, gullet, nerve and
flesh, mind. As the dream nears its core it takes on the shape of the one dreaming it
(`11-world-bible.md` §11.1). These labels never appear in player-facing text; the player sees only
concrete images and draws the conclusion. M1a adds this as an internal section of
`11-world-bible.md`.

---

## 3. Monsters (M1b)

### 3.1 Roster by Stratum

Each Stratum has about 10 normal monsters, 3 Elites (which can also appear at Boss tier) and 1
Stratum boss: 59 archetypes plus The Founder, made of the 42 existing ones reworked and 17 new.

| Stratum | Normal | Elite | Stratum boss |
|---|---|---|---|
| S1 | dungeon-rat, black-bat, vampire-bat, snake, spider, skeleton, skeleton-archer, skeleton-mage, skeleton-warrior, zombie, ghost, goblin, goblin-shaman (13) | skeleton-guard, zombie-knight, giant-spider | lich |
| S2 | slime, swamp-slime, toxic-toad, lava-slime, lizard, armored-beetle, water-elemental, fire-elemental, orc-brute, ghoulish-crawler (10) | orc-chieftain, 2 new | void-amalgamation |
| S3 | cultist-initiate, cultist-zealot, lesser-vampire, 7 new (10) | dark-knight, vampire-lord, 1 new | new |
| S4 | wraith, mimic, gargoyle, lesser-golem, cave-bear, dire-wolf, 4 new (10) | ancient-golem, 2 new | dragon |

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
  or `demi-human`. Many kits apply `bleeding`. This Stratum needs the most new monsters (9) and is
  written first in M1b.
- S4, the mind: nightmares, the shapes the worst fears take, fused and wrong. The dragon sets the
  model. From a distance it is called a dragon because that is the nearest word; up close it is
  several nightmares joined into one, malformed, more frightening than any real dragon. Some carry
  `prescient`.

### 3.3 Rework scope per archetype

- Name and `id` change together, with every reference updated in the same change (data, engine,
  UI, tests, docs), per the repo convention. The list of names is approved before any data is
  written, then goes through a craft review (`narrative-craft-panel`).
- Descriptions are rewritten in the existing voice, with one wrong detail each.
- Sprites: S1 mostly kept, S2–S4 redrawn in `game-editor`.
- Kits: S2 adds the self-destruct trait, S3 adds bleed, some S4 monsters get `prescient`. Elites
  and Bosses keep the shared archetype kit shape (strike, cleave and their own debuff, plus
  Finishing Blow for Bosses).
- Race changes where the creature's nature changed. S4 gets a new race (working id `nightmare`)
  with its own resistances and weaknesses, so S4 creatures don't fight like ordinary undead or
  beasts. This is data only.
- Each monster's M1b entry also carries a fuller visual brief for future Unity art. In-game text
  stays spare; the brief does not.

---

## 4. Class progression

### 4.1 Skills

Each class gains one new skill (M1c), inserted before the ultimate: the new skill takes slot 5 and
the ultimate moves to slot 6. The engine identifies the ultimate by `isUltimate`, not by slot, so
this is a data change. The combat skill menu grows to `[1-7]`.

Each new skill gives its class a tool against at least one Stratum rule: clearing or resisting
erosion (S2), moving or breaking `focused` or stopping bleed (S3), lowering fear or resisting the
fear-tier debuffs (S4). Different classes cover different Strata, so choosing a party also means
choosing which Strata it handles well. Each class's current kit is audited for gaps first, and the
concepts are approved per class before any data is written.

### 4.2 Skill points

Skill points replace automatic rank unlocks entirely.

- At level 1 there are no points; every character starts with only the basic attack.
- Every level-up gives 1 point per character. The party shares a level, so each level-up asks the
  player to spend one point for each character.
- Points buy:
  - skill ranks: 6 skills × 3 ranks, where rank 1 unlocks the skill
  - class passive ranks: the existing `passiveSkill`, 3 ranks
  - optional passives (M1c): 6 per class, class-specific; a character takes 3 of the 6, one point
    each, no ranks, no duplicates
- The point budget at the level cap exactly covers the full build, so every character finishes the
  run fully built. Builds differ in the order of investment across the run and in which 3 optional
  passives were taken.
- Gates are minimum levels stored in `classes.json`, never hardcoded:
  - rank 1 of each skill has a minimum level per slot, with the ultimate's notably later
  - class passive rank 1 has a minimum level
  - the 1st, 2nd and 3rd optional-passive picks each have their own minimum level
  - ranks 2 and 3 of anything require only the previous rank
- A gate opens an option, it does not force a pick. At a level where both a skill and an optional
  passive open, the player decides which to buy first.
- Spent points are permanent for the run (no respec), matching the Artifact design.
- A new point-allocation screen appears after a combat that levels the party up, one character at
  a time. Its footer follows the key-hint grammar (`src/ui/keyHints.ts`, enforced by
  `test/keyHints.test.ts`).
- Abilities (`11-abilities.md`) are untouched and stay a separate, pre-run system. Optional
  passives must not duplicate ability effects.

---

## 5. Progression compression

This section gives method and targets only; values are tuned with `random-play` during balancing.

- Level cap (`maxLevel`) is lowered. The party should reach it at about the S4 boss, at roughly two
  levels per floor, with the first level-up right after the first combat.
- Level-keyed data (`level-growth.json` growth tiers and EXP tiers, every gate in §4.2) is rescaled
  to the new cap, keeping relative order. Thresholds that would collapse onto the same level are
  spread apart.
- Monster scaling: `monsterDepthBuffBracketFloors` becomes one floor per bracket on the new scale,
  plus each Stratum's `tuning` multiplier. Endless continues the shared curve.
- Artifact rarity and shop tiers: `floorsPerStep` becomes one Stratum per step, and each source's
  anchors move to the new scale.
- Abilities: `abilities.depthCap` moves to the new scale. Elite and Boss kills still unlock
  abilities instantly.
- Stardust is earned per Stratum boss and from The Founder, instead of every `bossFloorInterval`
  floors. The amount is retuned so a run's total supports a sensible buyback.
- `expRewardDepthRate` is retuned to the level-cap target.
- Event gating maps the discovery curve onto Strata: events gated at depth 15 open from S2, 35 from
  S3, 70 in S4 only. Early gates (2, 3, 10) move inside S1.
- `chainTier2MinFloorDepth` and `chainTier3MinFloorDepth` become the first floor of S2 and S3.
- `fearPerRoundDepthGrowth` is retuned for 12 floors. Satiety, Camp and rest rooms keep their
  mechanics; balancing checks that satiety still matters on shorter floors.
- `random-play` reports per Stratum: survival rate through each Stratum boss, average level at each
  Stratum boss, rooms and rounds per run, Stardust earned and buybacks made. Target rates are set
  during balancing, outside this spec.

---

## 6. Floor 13, endings, The Founder

### 6.1 The ending checkpoint

The logic of Part F.1 (`10-event-narrative.md`) is unchanged: Leave (when its triggers fire),
otherwise Stay, Let Go or Continue. It fires after the S4 boss. Any checkpoint condition that
counts floors is remapped to the new scale.

### 6.2 Floor 13, the last floor

Floor 13 has its own builder, not `generateFloorLayout`:

- A single straight line of rooms (count from data), with no branches, rest rooms or events.
- Every room is a boss room: one Elite/Boss archetype from one Stratum at Boss tier, plus a number
  of that Stratum's normal monsters set in data. That Stratum's rule and atmosphere apply inside
  the room, so the floor moves between ordinary, damp, crawling and crushing from room to room.
- Stratum order is shuffled with two constraints: no two adjacent rooms from the same Stratum, and
  every Stratum appears at least twice.
- No boss repeats. The 16 Elite/Boss archetypes across the four Strata (The Founder excluded) cover
  the room count.
- Between rooms the party can use items and Camp (paid with an Exploration Kit, as today), nothing
  else.
- The last room is The Founder's.

### 6.3 The Founder's room

This staging script is shared by the TUI and Unity builds.

1. Arrival: a library. Ritual circles are drawn densely across the floor and walls, the spiral mark
   turning both inward (sealing) and outward (inviting), overlapping. This is the room where the
   schism began, and it does not say which side was right (§11.9). Books lie scattered across the
   floor and the shelves. In the middle stands a low dais, and The Founder stands on it in human
   form.
2. Dialogue: the six lines and two interleaved beats from Part F.5, unchanged. Only the arrival
   description is rewritten, since the current one ("no face left to speak from") contradicts the
   human form.
3. Transformation: the circles light, the books rise and burn, and the burning sounds like the
   things the party fought on the way down, layered over each other. The scene says only that it
   sounds like them. It never states the books made the monsters, which would make The Founder the
   dungeon's architect and contradict §11.6 and §11.4. The Founder becomes the final form: more
   brain than body, nerve-thick ropes trailing where legs should be. This is the existing
   description, kept because it already combines S3's nerve and flesh with S4's mind.
4. The fight is against the final form only. The existing kit stays; stats come from floor 13 on
   the new scale plus any tuning.

On the TUI, steps 1–3 are paced text beats plus a sprite swap (human form to final form), on the
existing founder dialogue screen. The Unity build stages it in full.

### 6.4 After an ending

- True ending (The Founder defeated): the Covenant-tied events leave the pool, as Part F.5 already
  specifies.
- Endless mode unlocks once any ending is reached (Stay, Let Go, Leave or the true ending) and is
  recorded in `profile.json`. It is chosen when starting a run. Floors 1–12 play exactly as in a
  normal run, Strata and their rules included. After floor 12 there is no checkpoint and no floor
  13: the run continues at floor 14 with branching floors, monster and event pools from all four
  Strata, no Stratum rule, and a Boss drawn from the four Stratum bosses every three floors. Death
  in Endless is ordinary permadeath (abilities lost, Stardust buyback).

---

## 7. Removed

- Mini-games. Delete `docs/minigame-decisions.md` and the mini-game bullet in `design-doc.md`'s
  "Future direction". No mini-game code exists.
- `bossFloorInterval` (see §1).
- The floor-100 and floor-120 ending depths (moved to the new scale).

---

## 8. Testing

- Floor generation: the existing property test passes at the new room counts. New tests for the
  floor-13 builder cover room count in range, no adjacent same-Stratum rooms, every Stratum at
  least twice, no repeated boss, The Founder in the last room, and no rest or event rooms.
- Strata rules:
  - S2: erosion fires on the configured round interval; self-destruct primes below threshold,
    detonates on its own next turn, never detonates if killed first.
  - S3: `focused` target order (bleed stacks, then HP percentage), duration, overrides taunt,
    falls back under stealth, retargets on death; blood-scent steps, with dead characters counted
    as 0.
  - S4: fear never below `minFear`; per-tier debuffs; monster fear scaling; `prescient` targeting.
- Skill points: every gate, the rank cap of 3, no duplicate optional passive, and a budget at the
  cap equal to the full build.
- Endings and Endless: checkpoint after the S4 boss, The Founder on floor 13, Endless skipping both.
- Save: version bump, older saves rejected cleanly, `profile.json` intact.
- UI: key hints for the point-allocation screen, the seven-skill combat menu, and `random-play`
  layout checks at 120×40 plus the per-Stratum report.
- Every plan ends green on `bun test`, `bun run typecheck` and `bun run docs:sync --check`.

## 9. Docs to update during implementation

- `design-doc.md`: run structure, Strata, remove mini-games.
- `developer-guide.md`: `strata.json` and its loader, the floor-13 builder, the point-allocation
  screen.
- `gameplay-decisions/`: 01 (skill points, new slot), 02 (roster by Stratum, self-destruct,
  `prescient`, new race), 03 and 04 (S4 fear), 06 (level cap, points), 07 (drops by Stratum), 08
  and 10 (event gating, ending depths, Founder staging), 11-world-bible (internal body-metaphor
  section).
- Generated tables via `bun run docs:sync`.

## 10. Risks

1. Content volume. M1b and M1c are mostly writing: 59 monsters, 9 skills, 54 passives.
2. Losing spirals. `focused` overriding taunt, blood scent and fear scaling all punish a party that
   is already losing. `random-play` measures each one separately.
3. Floor 13. Consecutive boss rooms with only items and Camp may be close to unwinnable; it is
   balanced on its own.
4. In-progress saves stop loading on upgrade.

---

## Appendix: starting values (move into `data/*.json`, then delete)

- 4 Strata × 3 floors; normal floors have 6–9 rooms on the path; floor 13 has 9–12 rooms.
- Level cap 25, about 2 levels per floor.
- Skill rank-1 gates: slots 1–2 from level 2 (the first point), slot 3 at level 3, slot 4 at level
  5, slot 5 at level 7, the ultimate (slot 6) at level 12.
- Class passive rank 1 from level 2.
- Optional passive picks: the 1st from level 3, the 2nd from level 8, the 3rd from level 12.
- S2 erosion every 2 rounds; S3 `focused` lasts 2 rounds; S3 blood-scent thresholds at 80, 60, 40
  and 20% of party HP; S4 `minFear` 30.
