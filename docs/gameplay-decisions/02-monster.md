# §2. Monster — stats, aggro-based targeting & AI patterns

*(section 2 of `00-index.md`)*

**Naming convention**: every monster `id`/`name` is in **English**, matching `data/monsters.json`.

**Source of truth for every number below**: `data/monsters.json` (base stats + `expReward` per archetype) and `data/level-growth.json` (scaling curve, elite/boss multipliers). This document describes the mechanics — not the actual base stat values, which live only in JSON.

### Scaling formula by floor depth (`floorDepth`, floor 1 = depth 1)

Current implementation: `growthBonus(stat, floorDepth)`, using the same tapered curve as characters — see `06-level-system.md` **§6.3/§6.6**. `speed = baseSpeed` (does not scale with floor).

This is the archetype → instance formula, used when spawning monsters into `Room.monsterIds`; the `attack/defense/hp/maxHp/speed` fields on a `Monster` are always the resolved values — the formula itself is never stored.

### Monster type (`MonsterType`) — stat-budget archetype

Every `MonsterArchetype` carries a fixed `monsterType`, mirroring how a character class's `growthWeights` (§6.8) reshapes its stat budget. Each type has a per-stat weight `{ attack, defense, maxHp }` in `data/growth-weights.json` → `monsterGrowthWeights` (loaded as `MONSTER_TYPE_MULTIPLIER`, `src/data/monsters.ts`), summing to **3** — the 3-stat equivalent of a class's budget summing to 5 across its 5 weighted stats. Check the JSON directly for the current type list and values rather than trusting a hand-copied table here — it drifts the moment `monsterGrowthWeights` is retuned.

<!-- docs:begin monsterTypeWeights -->
*Generated from `data/growth-weights.json` (`monsterGrowthWeights`) by `bun run docs:sync`. Do not edit.*

| Type | attack | defense | maxHp |
|---|---|---|---|
| `balanced` | 1 | 1 | 1 |
| `tanky` | 0.7 | 0.9 | 1.4 |
| `armored` | 0.8 | 1.2 | 1 |
| `striker` | 1.2 | 0.9 | 0.9 |
| `glass` | 1.4 | 0.7 | 0.9 |
| `bruiser` | 1.1 | 0.7 | 1.2 |
| `sentinel` | 0.7 | 1.1 | 1.2 |
<!-- docs:end -->

What each type is for:

- `tanky` — high HP
- `armored` — high defense
- `striker` — high attack, glass-lite
- `glass` — high attack, fragile
- `bruiser` — attack + HP, low defense
- `sentinel` — defense + HP, low attack

Same rule as `growthWeights` for characters (§6.4/§6.8): the type weight scales **only the per-depth growth increment**, never `baseX` — `round(growthBonusForDepth(stat, floorDepth) × monsterType's weight)` (`monsterGrowthBonus`, `src/data/levelGrowth.ts`), added back onto `baseX` afterward. `eliteMultiplier`/`bossMultiplier` (§6.5), the depth-buff, and race/subRace/traits `statBuff` are the ones that scale the *entire* `base + weighted growth` total in `spawnMonster()`, and they stack multiplicatively with each other. `speed` and `expReward` are unaffected by `monsterType`.

Current per-archetype assignment: `data/monsters.json` field `monsterType` — check the JSON directly rather than trusting an enumeration here.

### Race, subRace & traits

Orthogonal to `monsterType` above — `monsterType` is *how* an archetype's stat budget is split;
`race`/`subRace`/`traitIds` are *what it is and what hurts it*. Every archetype carries a `race`
(one of 8: `undead`, `beast`, `shadow-creature`, `demi-human`, `human-like`, `slime`, `elemental`,
`golem`), an optional `subRace` (1-3 per race), and optional `traitIds` (cross-cutting, stack
additively across races: `flying`, `plated`, `venomous`, `swift`, `massive`) — `data/monster-races.json`
and `data/monster-traits.json` are the source of truth, not this doc.

Each race/subRace/trait carries a `RaceProfile`: `resistPercent`/`weakPercent` per `DamageType`
(`physical`/`magic`/`fire`/`ice`/`lightning`/`poison`/`bleed`/`holy`) and a `statBuff`
(`maxHpPercent`/`attackPercent`/`defensePercent`/`speedFlat`). Merge order:
race → subRace **overrides** matching `resistPercent`/`weakPercent` keys per-key (unmentioned keys
stay inherited) and **adds** to `statBuff`; every trait's whole profile then **adds** on top
(sum, not override) — `src/data/monsterRaces.ts`'s `resolveRaceProfile`. Resolved `resistPercent`/
`weakPercent` are clamped to `[0, 100]`.

`statBuff` applies once, at spawn (`spawnMonster`, `src/data/monsters.ts`), alongside the existing
`monsterType`/tier multipliers — `speed` is a flat add rather than a percent (nothing else in this
game percent-scales speed), clamped to a minimum of 1 so a heavily-`speedFlat`-stacked archetype
(e.g. Ancient Golem: Golem race `-5` + `massive` trait `-4`) never goes to 0 or negative.

`resistPercent`/`weakPercent` apply per-hit, in `resolveSkillEffect`'s `"damage"` case
(`src/engine/resolver.ts`): `finalMultiplier = (1 - resist/100) * (1 + weak/100)` for the
effect's `damageType` (defaults to `"physical"` when the effect doesn't declare one). A 100%
resist yields **exactly 0 damage** — not the usual floor-of-1 every other damage instance gets —
this is what makes an undead Skeletal archetype (full bleed resist) genuinely immune to bleeding
out, instead of still losing 1 HP/turn. A damage-over-time status whose every tick the target
fully resists (Bleeding on a Skeletal monster) is not applied at all: the log says
`resolver.statusImmune` ("Skeleton is immune to Bleeding.") and the hit wears no ⁂. A status that
does anything besides that damage (Agony also cuts a stat) still lands. Resist/weak never applies
to a `Character` target, only a `Monster`.

### Floor-depth buff

A universal, race-independent multiplier on top of the existing floor-depth growth curve
(`growthBonusForDepth`) — fixed-size brackets of floors, each adding a front-loaded then tapering increment
on top of the running total. `data/level-growth.json`'s
`monsterDepthBuffBracketIncrements` (paired with `monsterDepthBuffBracketFloors`, the bracket size)
is the source of truth for those increments; `monsterDepthBuffPercent` (`src/data/levelGrowth.ts`)
sums them cumulatively as a **step function, not interpolated** — a monster spawned right after
crossing a bracket boundary gets the full new bracket's bonus immediately, no gradual ramp.
Depth is uncapped: once the configured increments run out, the last one keeps
being added every subsequent bracket forever, so the bonus never plateaus — matching the game's
infinite-floor roguelike design instead of stopping at a fixed cap.

That base percent is scaled per-stat before being applied in `spawnMonster`
(`monsterDepthBuffStatCoefficients`, same file): one coefficient each for HP, attack and defense — monsters
get tankier faster than they hit harder or armor up as floors get deeper, widening the late-game's
"HP sponge" shape rather than scaling all 3 stats uniformly. `speed` is untouched by floor depth,
same as it always has been.

Every time the player clears the boss/guard room of a floor whose depth is a multiple of
`data/floor-milestones.json`'s `interval`, a dedicated screen (`src/ui/screens/floorMilestone.ts`)
shows one atmospheric line, dismissed with Enter — deliberately never stating "monsters got
stronger" outright, matching this game's flavor-text tone. `GameState.pendingFloorMilestoneOmenId`
/ `Game.clearFinishedCombat()` / `Game.dismissFloorMilestoneMessage()` drive it; it takes priority
in `syncUiToGameState()` the same way `pendingReflection`/`pendingCampReflectionTier` do.

The lines live in `data/floor-milestones.json`, each with an `id`, a `maxFloor` and its `text`, and are
banded by depth (each band shares one `maxFloor`, in order: mild physical oddities first, then
repetition and space, then body and time). `pickFloorMilestoneOmen` (`src/data/floorMilestones.ts`)
takes the lines not yet shown this run (`GameState.shownFloorMilestoneIds`) whose `maxFloor` has not
passed, finds the lowest `maxFloor` among them (the current band) and picks one at random inside it.
A line still unshown at its own `maxFloor` is the only one left in its band, so it always comes up at
that floor. The loader refuses data where that could fail (more lines due by a floor than milestone
floors up to it). Past the last `maxFloor` any line but the one shown last is picked, so repeats happen
only there. A milestone whose boss room is never cleared is not made up later.

### Min-floor gate

Every archetype `floor.ts` can draw from at random (i.e. every archetype except the scripted
`finalBoss`) carries a `minFloor` — a floor below which it will never be picked, enforced
by `assertMonsterDataConsistent` (`src/data/monsters.ts`) at load time. `data/monsters.json` is the
source of truth for the actual values, not this doc.

This gates 2 things, both in `src/data/floor.ts`: which **archetype** fills a tier slot
(`ARCHETYPES_BY_TIER[tier].filter(a => (a.minFloor ?? 0) <= depth)`), and — more importantly —
which **`floorGeneration.roomCompositionTemplates` entry** (`data/balance-config.json`) **is even selectable** at a given depth
(`eligibleTemplatesAtDepth`: a template is only eligible if *every* tier it lists has at least 1
archetype available at that depth). This is deliberately not "fall back to the one low-`minFloor`
archetype in that tier" — a template needing "strong" tier simply isn't rolled at all below
whatever floor the earliest strong-tier archetype unlocks at, so early floors stop rolling
strong-tier encounters entirely instead of always resolving to one repetitive stand-in.

**Crash-safety invariant**, also enforced by the same validator: the weak tier, the medium tier,
and the guard-room pool (`roles` including both `"elite"` and `"boss"`) must each have at least 1
archetype at `minFloor: 0` — otherwise a room at floor 1 could have nothing eligible to spawn.
Skeleton Guard (the roster's one triple-role archetype, in both the regular-combat and guard-room
pools) is the one strong-tier/guard-eligible archetype that has to stay at `minFloor: 0` to satisfy
the guard-room side of this invariant.

### Targeting

A monster picks its target by **weighted random** over every living, targetable member of the party side (characters and summons). The weight comes from five factors, mixed by the archetype's `aiPattern` (`targetingWeight`, `src/engine/monsterAI.ts`):

| Factor | Score per candidate |
|---|---|
| `aggro` | the candidate's current `aggro` (at least 1) |
| `lowHp` | by rank of `hp / maxHp`, lowest first |
| `fear` | by rank of `survival.fear`, highest first; a summon has no fear and ranks as fearless |
| `damage` | not tracked yet: every candidate scores the same |
| `range` | not tracked yet: every candidate scores the same |

Each factor turns its scores into shares of 1 across the pool, and the pattern's weights, which sum to 1, mix those shares:

```
P(target = X) = Σ over factors of  weight(factor) × score(factor, X) / Σ score(factor, every candidate)
```

A factor that scores everyone the same spreads its weight evenly, so a party at full HP and no fear is picked by `aggro` and chance alone. The loader rejects a profile whose weights are negative or do not sum to 1, and an archetype whose `aiPattern` has no profile.

**Rank scores.** Candidates that tie share a rank, and the next rank follows on without a gap (two candidates tied for lowest HP both take the first `lowHp` score, and the next take the second). Every rank past the end of the list takes its last score, which matters once summons push the pool past four.

<!-- docs:begin targetingRankScores -->
*Generated from `data/balance-config.json` (`targeting.lowHpRankScores`, `targeting.fearRankScores`) by `bun run docs:sync`. Do not edit.*

| Rank | lowHp (lowest HP share first) | fear (highest fear first) |
|---|---|---|
| 1 | 5 | 6 |
| 2 | 3 | 4 |
| 3 | 2 | 3 |
| 4 and below | 1 | 2 |
<!-- docs:end -->

Ranking reads only the order, not the distance: a character at 99% HP among three at full ranks first exactly as one at 10% would. A monster that hunts the wounded is pulled toward whoever is hurt, without locking onto them.

A skill's own `targetRules` multiply the pattern's weight (`06-level-system.md` §6.12). A `forcesTargetOnSource` status on the monster takes its first pick before any weighting, and an archetype with `targeting: "random"` picks the rest uniformly, ignoring both the pattern and the rules.

### AI patterns (`MonsterAiPattern`)

A pattern is a key of `targeting.profiles` in `data/balance-config.json`; adding one is a data change.

<!-- docs:begin targetingProfiles -->
*Generated from `data/balance-config.json` (`targeting.profiles`) and `data/monsters.json` by `bun run docs:sync`. Do not edit.*

| Pattern | aggro | lowHp | damage | range | fear | Archetypes |
|---|---|---|---|---|---|---|
| `aggressive` | 0.6 | 0.1 | 0.1 | 0.1 | 0.1 | Slime, Cultist Initiate, Skeleton, Lizard, Spider, Cultist Zealot, Swamp Slime, Fire Elemental, Orc Brute, Cave Bear, Mimic, Giant Spider, Dragon, Orc Chieftain, Void Amalgamation |
| `defensive` | 0.3 | 0 | 0.6 | 0.1 | 0 | Toxic Toad, Zombie, Goblin Shaman, Skeleton Mage, Lava Slime, Water Elemental, Gargoyle, Skeleton Warrior, Armored Beetle, Lesser Golem, Skeleton Guard, Zombie Knight, Dark Knight, Ancient Golem |
| `opportunistic` | 0 | 0.6 | 0.1 | 0.1 | 0.2 | Dungeon Rat, Black Bat, Goblin, Ghoulish Crawler, Snake, Skeleton Archer |
| `dread` | 0.1 | 0.1 | 0 | 0.1 | 0.7 | Ghost, Wraith, Lich, What's Left of Him |
| `bloodthirsty` | 0.3 | 0.6 | 0 | 0.1 | 0 | Vampire Bat, Dire Wolf, Lesser Vampire, Vampire Lord |
<!-- docs:end -->

- **`aggressive`** — goes at whatever is most in front of it: mindless, slow, or a straightforward brawler. Mostly `aggro`, so taunting works on it. A slime has no way to pick a target, and giving the Void Amalgamation one would be giving it intent.
- **`defensive`** — owns a self-targeted skill and turtles with it, and turns on whoever has been hurting it (`damage`, once tracked). `aggro` still counts.

  `runMonsterTurn` (`src/engine/monsterAI.ts`) also intercepts before the normal `actionWeights` roll: for a **normal-tier** monster whose archetype has `aiPattern: "defensive"`, once its HP drops below the threshold defined in code, it uses a self-targeted skill instead of rolling a normal action — see `src/engine/monsterAI.ts` for the exact HP threshold and chance rather than trusting a hand-copied number here. No other pattern has this branch.

  The branch looks for a skill whose `target` is `self` **and whose id is a key of the tier's own `actionWeights`** (a weight of 0 still counts: Zombie and Skeleton Warrior keep their skill at weight 0, so it fires only from this branch). It does not take the first entry of `skillIds`: that list holds every skill an archetype can roll at any tier, so a positional pick would reach into the guard-room kit. Skeleton Guard is the case that matters — its `skillIds` hold self-targeted guard-room skills (a guard stance, a riposte stance), but its normal weights name only the basic attack, so a normal-tier Skeleton Guard never reaches them. In practice the branch is live for Zombie and Skeleton Warrior (see "Regular monster skill kits" below). The guard-room `defensive` archetypes (Skeleton Guard, Zombie Knight, Dark Knight, Ancient Golem) use their self-targeted skills through their elite/boss weights and AI rules instead (`06-level-system.md` §6.12).
- **`opportunistic`** — has both a reason and a means to get past the front line: it flies, it is small and low enough to slip through, or it is clever enough to choose. It ignores `aggro` entirely, so taunting does nothing against it, and goes for the wounded and the frightened.
- **`dread`** — feeds on fear. It finds whoever is shaking and stays on them; calming the party is the counter.
- **`bloodthirsty`** — follows the smell of blood, but is still an animal or a hunger in front of a shield: `aggro` keeps a real share, so a taunt can still pull it off a bleeding ally.

 Action selection beyond plain targeting (basic attack vs. one of the archetype's skills) is driven separately by each archetype's `actionWeights` — `pickMonsterAction` in `src/engine/monsterAI.ts`. A weight key is either `"basicAttack"` or a skill id from that archetype's `skillIds`; there is no role name in between. An elite or boss adds cooldowns, conditions, per-skill rules, phases and telegraphs on top of the weights — `06-level-system.md` §6.12.

### Archetype roles — normal / guard / triple / final boss

Every archetype in `data/monsters.json` declares `roles: MonsterTier[]` (`MonsterArchetype`, `src/types.ts`), the single source of truth for where it can spawn:

- **Trash** (`roles: ["normal"]` + `powerTier`): appear randomly in ordinary combat rooms — `COMBAT_ROOM_ARCHETYPES` in `src/data/monsters.ts`.
- **Guard-only** (`roles: ["elite","boss"]`, no `powerTier`): guard the boss/elite room at the end of each floor — `GUARD_ROOM_ARCHETYPES`, 1 randomly chosen when building a `boss` room. Never appear as ordinary trash (e.g. Dragon never shows up as filler).
- **Triple-role** (`roles: ["normal","elite","boss"]`): both. **Skeleton Guard** is currently the only one.
- **Final boss** (`roles: ["boss"]` + `finalBoss: true`): exactly 1 (`the-founder`), spawned by name from `Game.enterFounderFight()`, never rolled.

`roles` must match `actionWeights` keys exactly, and sprite coverage in `data/sprites.json` must match `roles` exactly (normal→`monsters`, elite→`elites`, boss→`bosses`). Both are validated at load (`assertMonsterDataConsistent`, `assertMonsterSpritesConsistent`).

Every guard-room randomly picks among the guard-room archetypes each time the room is built, using the same shared scaling formula (elite/boss still use the shared `eliteMultiplier`/`bossMultiplier`, §6.5/§6.11).

### Regular combat archetypes

The full roster (id, name, base stats, AI pattern, `expReward`) lives in `data/monsters.json`; the loader is `src/data/monsters.ts`. `COMBAT_ROOM_ARCHETYPES` (`src/data/monsters.ts`) is every archetype with `"normal"` in `roles` — currently **33 total**: 32 `roles: ["normal"]`-only archetypes plus Skeleton Guard, the roster's one triple-role archetype (also a guard-room archetype — see below). Check the JSON directly for the current list rather than trusting an enumeration here, since new archetypes can be added without a doc update.

Every one of the 32 `roles: ["normal"]`-only archetypes carries a `skillIds` entry (see "Regular monster skill kits" below). Skeleton Guard is the one exception, since it already has a full Elite/Boss kit for its guard-room role and doesn't need a separate normal-tier skill.

### Regular monster skill kits

Every regular-combat archetype (except Skeleton Guard, see above) carries at least **1 flavor skill**, each thematically distinct, reusing existing status effects where the theme matches and introducing new ones where it doesn't (`corroded`, `webbed` — see below).

**Usage rate**: for most archetypes, `actionWeights.normal` (`data/monsters.json`) gives the flavor skill a real per-turn chance alongside the basic attack. A handful (e.g. Zombie, Skeleton Warrior) keep their skill listed at weight 0 — present so it can still be tuned in the rebalance editor, which only accepts keys an archetype already has, but never rolled by the normal weighted roll; their skill is exclusively triggered by the `aiPattern: "defensive"` low-HP logic above (a Zombie randomly self-healing at full HP would waste turns; a self-heal should only ever fire when it's actually needed). Current weights: `data/monsters.json`.

#### Skill table

Every monster skill in `data/monster-skills.json`, with the archetypes that carry it and their AI pattern (generated):

<!-- docs:begin monsterSkills -->
*Generated from `data/monster-skills.json` and `data/monsters.json` by `bun run docs:sync`. Do not edit.*

| Skill id | Name | Target | Effects | Used by |
|---|---|---|---|---|
| `bite` | Bite | singleEnemy | damage 14 + 100% ATK | Dungeon Rat (opportunistic), Goblin (opportunistic), Ghoulish Crawler (opportunistic), Mimic (aggressive) |
| `blood-drain` | Blood Drain | singleEnemy | damage 12 + 100% ATK (50% lifesteal) | Black Bat (opportunistic), Vampire Bat (bloodthirsty), Cultist Zealot (aggressive), Lesser Vampire (bloodthirsty), Wraith (dread) |
| `acid-spit` | Acid Spit | singleEnemy | damage 10 + 100% ATK; status acid-burn + corroded (2 turns, 50% chance) | Slime (aggressive), Goblin Shaman (defensive), Swamp Slime (aggressive) |
| `whispered-name` | Whispered Name | singleEnemy | damage 15 + 100% ATK | Cultist Initiate (aggressive) |
| `poison-bite` | Poison Bite | singleEnemy | damage 12 + 100% ATK; status poisoned (3 turns, 50% chance) | Toxic Toad (defensive), Snake (opportunistic) |
| `bone-throw` | Bone Throw | singleEnemy | damage 12 + 100% ATK | Skeleton (aggressive), Skeleton Mage (defensive) |
| `regeneration` | Regeneration | self | heal 15 (20% max HP) | Zombie (defensive), Water Elemental (defensive) |
| `quick-bite` | Quick Bite | singleEnemy | damage 13 + 100% ATK | Lizard (aggressive), Dire Wolf (bloodthirsty) |
| `web-spit` | Web Spit | singleEnemy | damage 13 + 100% ATK; status webbed (2 turns, 50% chance) | Spider (aggressive) |
| `grave-chill` | Grave Chill | singleEnemy | damage 13 + 100% ATK; status weakened (2 turns, 50% chance) | Ghost (dread) |
| `ember-lash` | Ember Lash | singleEnemy | damage 15 + 100% ATK; status burning (2 turns, 50% chance) | Fire Elemental (aggressive) |
| `settle-into-stone` | Settle Into Stone | self | status guard (2 turns) | Gargoyle (defensive) |
| `arrow-shot` | Arrow Shot | singleEnemy | damage 15 + 100% ATK | Skeleton Archer (opportunistic) |
| `guard-stance` | Guard Stance | self | status guard (2 turns) | Skeleton Warrior (defensive), Armored Beetle (defensive), Lesser Golem (defensive) |
| `bone-breaker` | Bone Breaker | singleEnemy | damage 14 + 100% ATK; status weakened (2 turns, 50% chance) | Orc Brute (aggressive) |
| `maul` | Maul | singleEnemy | damage 13 + 100% ATK; status bleeding (3 turns, 50% chance) | Cave Bear (aggressive) |
| `hold-the-line` | Hold the Line | self | status held-ground (3 turns) | Skeleton Guard (defensive) |
| `shield-bash` | Shield Bash | singleEnemy | damage 18 + 170% ATK; status enfeebled (2 turns, 50% chance) | Skeleton Guard (defensive) |
| `riposte-stance` | Riposte Stance | self | status riposte (1 turn) | Skeleton Guard (defensive) |
| `overhead-cut` | Overhead Cut | singleEnemy | damage 55 + 90% ATK (ignores 40% defense) | Skeleton Guard (defensive) |
| `web-barrage` | Web Barrage | singleEnemy | damage 10 + 40% ATK; status webbed (2 turns, 60% chance) | Giant Spider (aggressive) |
| `venom-bite` | Venom Bite | singleEnemy | damage 22 + 60% ATK; status poisoned-ii (3 turns) | Giant Spider (aggressive) |
| `cocoon` | Cocoon | singleEnemy | damage 30 + 150% ATK; status stunned (1 turn); status poisoned-iii (3 turns) | Giant Spider (aggressive) |
| `feed` | Feed | singleEnemy | damage 24 + 110% ATK | Giant Spider (aggressive) |
| `into-the-rafters` | Into the Rafters | self | status airborne (1 turn) | Giant Spider (aggressive) |
| `claw-rake` | Claw Rake | singleEnemy | damage 14 + 65% ATK (1–2 hits) | Dragon (aggressive) |
| `dragon-fire-breath` | Fire Breath | allEnemies | damage 10 + 55% ATK; status burning (2 turns, 50% chance) | Dragon (aggressive) |
| `brand` | Brand | singleEnemy | damage 12 + 90% ATK; status burning-vulnerable (3 turns) | Dragon (aggressive) |
| `inferno` | Inferno | allEnemies | damage 34 + 130% ATK | Dragon (aggressive) |
| `old-fire-wakes` | Old Fire Wakes | self | status empower (99 turns) | Dragon (aggressive) |
| `diseased-blade` | Diseased Blade | singleEnemy | damage 24 + 285% ATK; status enfeebled (2 turns) | Zombie Knight (defensive) |
| `guard-position` | Guard Position | self | status guard-ii (2 turns) | Zombie Knight (defensive) |
| `undying` | Undying | self | heal 0 (35% max HP) | Zombie Knight (defensive) |
| `rotting-embrace` | Rotting Embrace | singleEnemy | damage 50 + 225% ATK; status agony (3 turns) | Zombie Knight (defensive) |
| `salute` | Salute | singleEnemy | status challenged (3 turns); fear 8 | Dark Knight (defensive) |
| `measured-cut` | Measured Cut | singleEnemy | damage 26 + 230% ATK (crit 25%) | Dark Knight (defensive) |
| `parry-stance` | Parry Stance | self | status fortify (2 turns) | Dark Knight (defensive) |
| `dread-presence` | Dread Presence | allEnemies | fear 6 | Dark Knight (defensive) |
| `abyssal-judgment` | Abyssal Judgment | singleEnemy | damage 60 + 235% ATK; status stunned (1 turn) | Dark Knight (defensive) |
| `second-salute` | Second Salute | singleEnemy | status challenged (3 turns); fear 8 | Dark Knight (defensive) |
| `skullsplitter` | Skullsplitter | singleEnemy | damage 28 + 120% ATK | Orc Chieftain (aggressive) |
| `call-the-warband` | Call the Warband | self | summonMonster (monsterArchetypeId goblin, count 1) | Orc Chieftain (aggressive) |
| `war-cry` | War Cry | allAllies | status rallied-ii (2 turns) | Orc Chieftain (aggressive) |
| `rout` | Rout | singleEnemy | damage 16 + 70% ATK; status weakened (2 turns) | Orc Chieftain (aggressive) |
| `gets-up` | Gets Up | self | status bloodrage (99 turns); summonMonster (monsterArchetypeId orc-brute, count 1) | Orc Chieftain (aggressive) |
| `crimson-talon` | Crimson Talon | singleEnemy | damage 20 + 80% ATK; status bleeding (3 turns) | Vampire Lord (bloodthirsty) |
| `drink` | Drink | singleEnemy | damage 16 + 85% ATK (+20% per bleeding stack, 60% lifesteal) | Vampire Lord (bloodthirsty) |
| `bat-swarm` | Bat Swarm | self | summonMonster (monsterArchetypeId vampire-bat, count 2) | Vampire Lord (bloodthirsty) |
| `final-draught` | Final Draught | singleEnemy | damage 45 + 140% ATK (100% lifesteal) | Vampire Lord (bloodthirsty) |
| `grasping-remnants` | Grasping Remnants | singleEnemy | damage 14 + 70% ATK; status shredded (3 turns) | Void Amalgamation (aggressive) |
| `unravelling-tide` | Unravelling Tide | allEnemies | damage 12 + 65% ATK; status corroded (2 turns, 50% chance) | Void Amalgamation (aggressive) |
| `old-work` | Old Work | self | status regeneration (3 turns) | Void Amalgamation (aggressive) |
| `subsume` | Subsume | singleEnemy | damage 40 + 145% ATK (50% lifesteal) | Void Amalgamation (aggressive) |
| `stoneshear` | Stoneshear | singleEnemy | damage 34 + 315% ATK | Ancient Golem (defensive) |
| `tremor` | Tremor | allEnemies | damage 12 + 155% ATK; status slowed (2 turns) | Ancient Golem (defensive) |
| `sealing-blow` | Sealing Blow | singleEnemy | damage 75 + 310% ATK | Ancient Golem (defensive) |
| `crumbling-shell` | Crumbling Shell | self | status empower (99 turns) | Ancient Golem (defensive) |
| `withering-touch` | Withering Touch | singleEnemy | damage 22 + 135% ATK; status withered (3 turns) | Lich (dread) |
| `raise-the-dead` | Raise the Dead | self | summonMonster (monsterArchetypeId skeleton-mage, count 1); summonMonster (monsterArchetypeId skeleton, count 1) | Lich (dread) |
| `ledger-mark` | Ledger Mark | singleEnemy | status marked (4 turns) | Lich (dread) |
| `name-struck-out` | Name Struck Out | singleEnemy | damage 65 + 140% ATK; remove marked | Lich (dread) |
| `unhurried` | Unhurried | allEnemies | status marked (4 turns); summonMonster (monsterArchetypeId skeleton, count 2) | Lich (dread) |
| `paid-in-full` | Paid In Full | singleEnemy | damage 20 + 115% ATK | What's Left of Him (dread) |
| `the-same-price` | The Same Price | allEnemies | damage 16 + 100% ATK (ignores 100% defense) | What's Left of Him (dread) |
| `whats-left-listening` | What's Left Listening | singleEnemy | damage 22 + 155% ATK; status blinded (2 turns); fear 8 | What's Left of Him (dread) |
| `everything-you-asked-for` | Everything You Asked For | singleEnemy | damage 70 + 235% ATK (ignores 40% defense) | What's Left of Him (dread) |
| `hung-lower` | Hung Lower | self | status knitting-ii (6 turns) | What's Left of Him (dread) |
| `the-last-of-it` | The Last of It | allEnemies | fear 12 | What's Left of Him (dread) |
| `self-destruct` | Self-Destruct | allEnemies | damage 30 + 200% ATK (ignores 30% defense); damage 99999 + 100% ATK (target self) | Lava Slime (defensive) |
<!-- docs:end -->

Notes on some of them:

- `blood-drain` (Black Bat) — `damage` + `lifestealPercent` (see below).
- `acid-spit` (Slime) — `damage` + chance to `applyStatusEffect "corroded"`.
- `regeneration` (Zombie) — `heal`. Trigger: **only** via the `defensive` low-HP logic above.
- `poison-bite` (Snake) — `damage` + chance to `applyStatusEffect "poisoned"` (existing — `01-class-skill.md` §1.7).
- `web-spit` (Spider) — `damage` + chance to `applyStatusEffect "webbed"`.
- `guard-stance` (Skeleton Warrior) — `applyStatusEffect "guard"` (existing — `01-class-skill.md` §1.7). Trigger: **only** via the `defensive` low-HP logic above.

*Snake keeps plain `poisoned` (already its established theme) while Spider gets `webbed` instead of also using `poisoned` — this deliberately differentiates the 2 poison-adjacent archetypes rather than having them share an identical proc.*

#### New status effects — 2

**`corroded`** (Slime's Acid Spit) — deliberately reserved for reuse by Plague Doctor's kit (`01-class-skill.md` §1.6 lists `burning`/`poisoned`/`weakened`/`blinded`; an acid/corrosion debuff was not among them and fits the "debuffer" theme, though Plague Doctor doesn't currently use it):

```json
{
  "id": "corroded",
  "name": "Corroded",
  "perTurnEffects": [
    { "kind": "damage", "amount": "<see data/status-effects.json>" },
    { "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }
  ]
}
```

Distinct from both `weakened` (`01-class-skill.md` §1.7 — pure defense reduction, no DoT) and `poisoned` (pure DoT, no defense change) — acid does both at once, at a lighter magnitude than either alone.

**`webbed`** (Spider's Web Spit):

```json
{
  "id": "webbed",
  "name": "Webbed",
  "perTurnEffects": [
    { "kind": "modifyCombatStat", "combatStat": "speed", "amount": "<see data/status-effects.json>" }
  ]
}
```

#### New `SkillEffect` field — `lifestealPercent`

Black Bat's Blood Drain needs the caster to heal off its own damage — no existing effect kind supports this. Adds an optional field to the `damage` effect kind:

```
SkillEffect (kind: "damage") {
  ...existing fields (amount, chance?, ignoreDefensePercent?, ...)
  lifestealPercent?: number   // heals the source actor by this % of the damage actually dealt, capped at maxHp
}
```

This required a resolver change (`resolver.ts`): after computing final mitigated damage for a `damage` effect that carries `lifestealPercent`, apply a `heal` to the source actor for `round(finalDamage * lifestealPercent / 100)`, clamped to `maxHp`. Monster skill kits live in `data/monsters.json` (`skillIds`, `actionWeights.normal`) and `data/monster-skills.json` (skill entries, same file/shape already used for Elite/Boss skills), with the 2 new status effects in `data/status-effects.json`; on the code side, `SkillEffect.lifestealPercent` (`src/types.ts` + `src/engine/resolver.ts`) and the `aiPattern: "defensive"` branch in `runMonsterTurn` (`src/engine/monsterAI.ts`, see "AI patterns" above) are the only additions.

### Writing `description` text (monster archetypes, monster skills, class skills)

The `description` field on any monster archetype (`data/monsters.json`), monster skill
(`data/monster-skills.json`), or class skill (`data/classes.json`) is player-facing flavor text
only — what the thing looks or feels like. It must never contain:

- **Mechanical/system notes** — e.g. "replaces the basic attack," "not based on the target's
  current HP%." A player reading this shouldn't need dev knowledge of the action-selection system
  to parse it.
- **A cross-reference to another skill by name** — e.g. "lighter per target than Cleaving Strike."
  Every description must stand alone; the reader shouldn't need another skill's card in front of
  them to understand this one.
- **Numbers, percentages, or a reference to another class/archetype's stat field** — e.g. "roughly
  60% of the Knight's maxHp." Those belong in `effects`, in this document's prose, or in a code
  comment — never inside the JSON `description` string.

If a balance fact needs to be written down somewhere (e.g. "this execute hits for ~60% of a
Knight's maxHp"), put it in this doc or a code comment next to the JSON, not in the string a
player will actually read.

### Guard-room archetypes (elite/boss)

Skeleton Guard (triple-role, shared with regular combat) plus the archetypes with `roles: ["elite","boss"]` — currently 9: Giant Spider, Dragon, Zombie Knight, Dark Knight, Orc Chieftain, Vampire Lord, Void Amalgamation, Ancient Golem, and Lich — each with its own elite/boss kit (`skillIds` + `actionWeights.elite`/`actionWeights.boss`, optional `phases`, `targeting`, `shell`; skills in `data/monster-skills.json`). The kit is built around what the archetype's `description` says it does, and the elite tier runs a reduced subset of its boss kit. The kits, the AI turn flow, the mechanics they use (telegraphs, phases, summoning, riposte, the breakable shell) and the difficulty curve by `minFloor` are in `06-level-system.md` §6.12. Again, treat `data/monsters.json`/`data/monster-skills.json` as the authoritative list, not this doc.

### Monster Balance Points

Extends the char "Base stats balancing formula (Balance Points)" (`01-class-skill.md`) to monster archetypes, using the same `speed` term the char formula now has — neither char nor monster `speed` scales with level/floor depth (see "Scaling formula by floor depth" above), so there's no `tier1` growth rate to derive a conversion constant from the way `attack`/`defense`/`maxHp` do; both use the same hand-picked `speedRate` instead.

**Formula**:

```
MonsterBalancePoints = baseAttack/tier1.attack + baseDefense/tier1.defense + baseHp/tier1.maxHp + baseSpeed/speedRate
```

using the same `tier1` rates as the char formula (`data/level-growth.json` → `tiers[0]`), plus `speedRate`, a hand-picked constant in `tools/game-editor/calc.ts` (not derived from any growth table; there isn't a `tier1`-equivalent for speed to derive one from). Starting point was the pooled average `baseSpeed` across every monster archetype and character class (~10.4), nudged up during tuning. `maxMp`/`magicPower` terms from the char formula are dropped entirely (not set to 0) since monster archetypes don't carry those stats.

This formula is computed off raw `baseAttack`/`baseDefense`/`baseHp` and deliberately ignores `monsterType` — the type multiplier only reshapes the *scaled instance* (see "Monster type" above), so it doesn't shift an archetype's base-stat BalancePoints or its tier band.

**Target ranges** (rule-of-thumb bands per tier, checked against `data/monsters.json`'s base stats before any `eliteMultiplier`/`bossMultiplier` or floor-depth scaling is applied):

| Tier | Target BalancePoints | Tolerance |
|---|---|---|
| weak | 14 | ±0.3 <!-- docs:intent --> |
| medium | 17 | ±0.4 <!-- docs:intent --> |
| strong | 20 | ±0.5 <!-- docs:intent --> |
| Elite/Boss (archetypes with no `normal` role) | 24 | ±1 <!-- docs:intent --> |

An archetype with the `normal` role is judged against its own `powerTier` band, so Skeleton Guard — the triple-role archetype shared with regular combat — sits in the strong band, not the Elite/Boss one; the game editor's Rebalance tab groups its tier averages the same way. The final boss (`finalBoss: true`) is outside the Elite/Boss band: its base stats sit well above it.

Same caveat as "Balance verification" below: don't hand-maintain a per-archetype BalancePoints table here — `baseAttack`/`baseDefense`/`baseHp`/`baseSpeed` drift independently as tuning continues. Recompute `MonsterBalancePoints` against the current `data/monsters.json` whenever this needs re-checking (the game-editor tool, `tools/game-editor` — Rebalance tab — surfaces this number directly for both classes and monster archetypes).

### Balance verification

Damage is computed via the percentage-based mitigation formula (`mitigatedOffense`, `docs/technical-decisions.md`): `off − off × (def / (X + def)) − def / Y`, where `off` is the `attack` (or `magicPower` for `isMagic` skills) of the damage source, and `X`/`Y` are `data/balance-config.json` fields `combat.defenseMitigationX`/`combat.defenseMitigationY`.

Per-archetype damage-against-a-reference-class numbers, and elite/boss strike/cleave/execute comparisons, are **not** hand-maintained in this document — they drift the moment any base stat or multiplier is retuned. Verify them by running the actual formula against the current `data/monsters.json`/`data/classes.json`/`data/level-growth.json` values (a short script, or the balance-oriented tests alongside `test/`) rather than reading stale numbers here.
