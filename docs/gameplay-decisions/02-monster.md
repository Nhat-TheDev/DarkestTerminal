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
out, instead of still losing 1 HP/turn. Resist/weak never applies to a `Character` target, only a
`Monster`.

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

Every time the player clears the boss/guard room of a floor whose depth is a multiple of 10, a
dedicated screen (`src/ui/screens/floorMilestone.ts`) shows one line randomly picked from a
5-line atmospheric pool, dismissed with Enter — deliberately never stating "monsters got
stronger" outright, matching this game's flavor-text tone. `GameState.pendingFloorMilestoneMessage`
/ `Game.clearFinishedCombat()` / `Game.dismissFloorMilestoneMessage()` drive it; it takes priority
in `syncUiToGameState()` the same way `pendingReflection`/`pendingCampReflectionTier` do.

### Min-floor gate

Every archetype `floor.ts` can draw from at random (i.e. every archetype except the scripted
`finalBoss`) carries a `minFloor` — a floor below which it will never be picked, enforced
by `assertMonsterDataConsistent` (`src/data/monsters.ts`) at load time. `data/monsters.json` is the
source of truth for the actual values, not this doc.

This gates 2 things, both in `src/data/floor.ts`: which **archetype** fills a tier slot
(`ARCHETYPES_BY_TIER[tier].filter(a => (a.minFloor ?? 0) <= depth)`), and — more importantly —
which **`ROOM_COMPOSITION_TEMPLATES` entry is even selectable** at a given depth
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

### Targeting by `aggro`

Default rule (used by `aggressive` and `defensive`): **weighted random** over every living character in the party, weighted by the character's current `Character.aggro`. The higher a character's `aggro`, the more likely it is to be picked as the target. `opportunistic` mirrors this rule rather than ignoring it — see below.

Formula: `P(target = X) = X.aggro / total aggro of all living characters`.

### AI patterns (`MonsterAiPattern`)
- **`aggressive`**: uses the weighted-random-by-`aggro` rule above directly (`pickMonsterTarget`, `src/engine/monsterAI.ts`).
- **`defensive`**: `runMonsterTurn` (`src/engine/monsterAI.ts`) intercepts before the normal `actionWeights` roll: for an archetype with `aiPattern: "defensive"` and at least 1 entry in `skillIds`, once the actor's HP drops below the threshold defined in code, it uses that skill instead of rolling a normal action — see `src/engine/monsterAI.ts` for the exact HP threshold and skill-selection logic rather than trusting a hand-copied number here. Targeting for `defensive` archetypes remains unchanged (still weighted-by-`aggro`, same as `aggressive`) — only skill-choice priority was added.

  This only takes effect for archetypes that (a) are `aiPattern: "defensive"` and (b) have at least 1 entry in `skillIds` — that's Zombie and Skeleton Warrior (see "Regular monster skill kits" below). The branch looks for a skill whose `target` is `self`, not for the first entry in `skillIds` — since `skillIds` holds every skill an archetype can roll at any tier, a positional pick would have a normal-tier Skeleton Guard swinging its own Cleaving Strike at itself. The other `defensive` archetypes (Zombie Knight, Dark Knight, Skeleton Guard) own no self-targeted skill, so it's a no-op for them.
- **`opportunistic`**: the **mirror** of the default rule. Every living character's `aggro` is reflected across the party's own current range — `weight = max(1, (highest aggro + lowest aggro) - X.aggro)` — so the quietest character is picked as often as the loudest would otherwise have been. `pickInverseAggroWeighted`, `src/engine/monsterAI.ts`.

  Reflecting rather than inverting (`1/aggro`) keeps whatever spread the party actually has, instead of flattening it to a fixed ratio however hard anyone taunts.

  **This makes taunting the wrong move against these archetypes, on purpose.** Shield Guard adds a large `aggro` bonus to a Vanguard whose base is already high; against an `opportunistic` monster that pushes the Vanguard almost out of the target pool and pulls the rest of the party in. Reading which enemies are in the room before holding aggro is the intended skill.

  Same mechanism, opposite direction: `distracted` (a negative `aggro` modifier) is a debuff against everything else, but in front of an `opportunistic` archetype it *draws* attacks onto its bearer.

**Which pattern an archetype gets** (`data/monsters.json` field `aiPattern`) follows one rule, so the roster stays predictable as it grows:

- **`opportunistic`** — it has both a reason and a means to get past the front line: it flies, it is small and low enough to slip through, it is incorporeal, or it is intelligent enough to choose. Dungeon Rat, Black Bat, Goblin, Ghoulish Crawler, Vampire Bat, Snake, Ghost, Skeleton Archer, Wraith, Vampire Lord, Lich.
- **`aggressive`** — it goes at whatever is most in front of it: mindless, slow, or simply a straightforward brawler. A slime has no way to pick a target, and giving the Void Amalgamation one would be giving it intent.
- **`defensive`** — it owns a self-targeted skill and turtles with it (see the low-HP branch above).

 Action selection beyond plain targeting (basic attack vs. one of the archetype's skills) is driven separately by each archetype's `actionWeights` — `pickMonsterAction` in `src/engine/monsterAI.ts`. A weight key is either `"basicAttack"` or a skill id from that archetype's `skillIds`; there is no role name in between.

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
| `blood-drain` | Blood Drain | singleEnemy | damage 12 + 100% ATK (50% lifesteal) | Black Bat (opportunistic), Vampire Bat (opportunistic), Cultist Zealot (aggressive), Lesser Vampire (aggressive), Wraith (opportunistic) |
| `acid-spit` | Acid Spit | singleEnemy | damage 10 + 100% ATK; status acid-burn + corroded (2 turns, 50% chance) | Slime (aggressive), Goblin Shaman (defensive), Swamp Slime (aggressive) |
| `whispered-name` | Whispered Name | singleEnemy | damage 15 + 100% ATK | Cultist Initiate (aggressive) |
| `poison-bite` | Poison Bite | singleEnemy | damage 12 + 100% ATK; status poisoned (3 turns, 50% chance) | Toxic Toad (defensive), Snake (opportunistic) |
| `bone-throw` | Bone Throw | singleEnemy | damage 12 + 100% ATK | Skeleton (aggressive), Skeleton Mage (defensive) |
| `regeneration` | Regeneration | self | heal 15 + 100% MAG (20% max HP) | Zombie (defensive), Water Elemental (defensive) |
| `quick-bite` | Quick Bite | singleEnemy | damage 13 + 100% ATK | Lizard (aggressive), Dire Wolf (aggressive) |
| `web-spit` | Web Spit | singleEnemy | damage 13 + 100% ATK; status webbed (2 turns, 50% chance) | Spider (aggressive) |
| `grave-chill` | Grave Chill | singleEnemy | damage 13 + 100% ATK; status weakened (2 turns, 50% chance) | Ghost (opportunistic) |
| `ember-lash` | Ember Lash | singleEnemy | damage 15 + 100% ATK; status burning (2 turns, 50% chance) | Fire Elemental (aggressive) |
| `settle-into-stone` | Settle Into Stone | self | status guard (2 turns) | Gargoyle (defensive) |
| `arrow-shot` | Arrow Shot | singleEnemy | damage 15 + 100% ATK | Skeleton Archer (opportunistic) |
| `guard-stance` | Guard Stance | self | status guard (2 turns) | Skeleton Warrior (defensive), Armored Beetle (defensive), Lesser Golem (defensive) |
| `bone-breaker` | Bone Breaker | singleEnemy | damage 14 + 100% ATK; status weakened (2 turns, 50% chance) | Orc Brute (aggressive) |
| `maul` | Maul | singleEnemy | damage 13 + 100% ATK; status bleeding (3 turns, 50% chance) | Cave Bear (aggressive) |
| `elite-strike-skeleton-guard` | Cleaving Strike | singleEnemy | damage 26 + 100% ATK | Skeleton Guard (defensive) |
| `elite-cleave-skeleton-guard` | Sweeping Cleave | allEnemies | damage 13 + 100% ATK | Skeleton Guard (defensive) |
| `boss-debuff-skeleton-guard` | Crush | singleEnemy | damage 24 + 100% ATK; status weakened (2 turns) | Skeleton Guard (defensive) |
| `boss-execute-skeleton-guard` | Finishing Blow | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-giant-spider` | Venomous Bite | singleEnemy | damage 26 + 100% ATK | Giant Spider (aggressive) |
| `elite-cleave-giant-spider` | Web Barrage | allEnemies | damage 13 + 100% ATK | Giant Spider (aggressive) |
| `boss-debuff-giant-spider` | Web Trap | singleEnemy | damage 24 + 100% ATK; status poisoned (3 turns) | Giant Spider (aggressive) |
| `boss-execute-giant-spider` | Death Bite | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-dragon` | Claw Rake | singleEnemy | damage 26 + 100% ATK | Dragon (aggressive) |
| `elite-cleave-dragon` | Fire Breath | allEnemies | damage 13 + 100% ATK | Dragon (aggressive) |
| `boss-debuff-dragon` | Scorching Breath | singleEnemy | damage 24 + 100% ATK; status burning (2 turns) | Dragon (aggressive) |
| `boss-execute-dragon` | Inferno Bite | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-zombie-knight` | Rusted Blade | singleEnemy | damage 26 + 100% ATK | Zombie Knight (defensive) |
| `elite-cleave-zombie-knight` | Rotting Swing | allEnemies | damage 13 + 100% ATK | Zombie Knight (defensive) |
| `boss-debuff-zombie-knight` | Diseased Strike | singleEnemy | damage 24 + 100% ATK; status weakened (2 turns) | Zombie Knight (defensive) |
| `boss-execute-zombie-knight` | Grave Judgment | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-dark-knight` | Shadow Slash | singleEnemy | damage 26 + 100% ATK | Dark Knight (defensive) |
| `elite-cleave-dark-knight` | Dark Wave | allEnemies | damage 13 + 100% ATK | Dark Knight (defensive) |
| `boss-debuff-dark-knight` | Crushing Blow | singleEnemy | damage 24 + 100% ATK; status stunned (1 turn) | Dark Knight (defensive) |
| `boss-execute-dark-knight` | Abyssal Judgment | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-orc-chieftain` | Skullsplitter | singleEnemy | damage 26 + 100% ATK | Orc Chieftain (aggressive) |
| `elite-cleave-orc-chieftain` | Rout | allEnemies | damage 13 + 100% ATK | Orc Chieftain (aggressive) |
| `boss-debuff-orc-chieftain` | Helm Crusher | singleEnemy | damage 24 + 100% ATK; status stunned (1 turn) | Orc Chieftain (aggressive) |
| `boss-execute-orc-chieftain` | The Last Trophy | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-vampire-lord` | Crimson Talon | singleEnemy | damage 26 + 100% ATK | Vampire Lord (opportunistic) |
| `elite-cleave-vampire-lord` | Scarlet Mist | allEnemies | damage 13 + 100% ATK | Vampire Lord (opportunistic) |
| `boss-debuff-vampire-lord` | Opened Vein | singleEnemy | damage 24 + 100% ATK; status bleeding (3 turns) | Vampire Lord (opportunistic) |
| `boss-execute-vampire-lord` | Final Draught | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-void` | Grasping Remnant | singleEnemy | damage 26 + 100% ATK | Void Amalgamation (aggressive) |
| `elite-cleave-void` | Unravelling Tide | allEnemies | damage 13 + 100% ATK | Void Amalgamation (aggressive) |
| `boss-debuff-void` | Dissolution | singleEnemy | damage 24 + 100% ATK; status corroded (2 turns) | Void Amalgamation (aggressive) |
| `boss-execute-void` | Subsumed | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-ancient-golem` | Stoneshear | singleEnemy | damage 26 + 100% ATK | Ancient Golem (defensive) |
| `elite-cleave-ancient-golem` | Tremor | allEnemies | damage 13 + 100% ATK | Ancient Golem (defensive) |
| `boss-debuff-ancient-golem` | Grinding Weight | singleEnemy | damage 24 + 100% ATK; status weakened (2 turns) | Ancient Golem (defensive) |
| `boss-execute-ancient-golem` | Sealing Blow | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-lich` | Withering Touch | singleEnemy | damage 26 + 100% ATK | Lich (opportunistic) |
| `elite-cleave-lich` | Grave Wind | allEnemies | damage 13 + 100% ATK | Lich (opportunistic) |
| `boss-debuff-lich` | Hollow Sight | singleEnemy | damage 24 + 100% ATK; status blinded (2 turns) | Lich (opportunistic) |
| `boss-execute-lich` | Name Struck Out | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
| `elite-strike-the-founder` | Paid In Full | singleEnemy | damage 26 + 100% ATK | What's Left of Him (aggressive) |
| `elite-cleave-the-founder` | The Same Price | allEnemies | damage 13 + 100% ATK | What's Left of Him (aggressive) |
| `boss-debuff-the-founder` | What's Left Listening | singleEnemy | damage 24 + 100% ATK; status blinded (2 turns) | What's Left of Him (aggressive) |
| `boss-execute-the-founder` | Everything You Asked For | singleEnemy | damage 60 + 100% ATK (ignores 50% defense) | — |
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
  60% of the Vanguard's maxHp." Those belong in `effects`, in this document's prose, or in a code
  comment — never inside the JSON `description` string.

If a balance fact needs to be written down somewhere (e.g. "this execute hits for ~60% of a
Vanguard's maxHp"), put it in this doc or a code comment next to the JSON, not in the string a
player will actually read.

### Guard-room archetypes (elite/boss)

Skeleton Guard (triple-role, shared with regular combat) plus the archetypes with `roles: ["elite","boss"]` — currently 9: Giant Spider, Dragon, Zombie Knight, Dark Knight, Orc Chieftain, Vampire Lord, Void Amalgamation, Ancient Golem, and Lich — each with its own elite/boss skill kit (`skillIds` + `executeSkillId`, `data/monster-skills.json`) — full details, the Finishing Blow mechanic, and balance-verification approach are in `06-level-system.md` §6.12. Again, treat `data/monsters.json`/`data/monster-skills.json` as the authoritative list, not this doc.

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
