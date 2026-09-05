# §6. Level system & damage balance

*(section 6 of `00-index.md` — every reference to "section 6.X"/"§6.X" in this file points internally, within the same file)*

**Source of truth for every number below**: `data/level-growth.json` (growth tiers, EXP tiers, elite/boss multipliers, `expRewardDepthRate`, `bossFloorInterval`), loaded via `src/data/levelGrowth.ts`. `MAX_LEVEL` is a separate hardcoded constant in that same file (not part of the JSON). This document describes the formulas — not the current tuning values, which change independently of this doc.

### 6.1 Growth formula

The system uses **tapered growth across multiple tiers** (`data/level-growth.json` field `tiers[]`), not a flat linear formula per level.

### 6.2 Damage formula

Shape resolver: `damage = amount + mitigatedOffense(offense, defense)` (full mitigation formula in `docs/technical-decisions.md` §3), combined with the tapered tier growth (§6.3) and character/monster symmetry (§6.6).

### 6.3 Tier growth table

**Shared by both characters and monsters**: characters use the `level` variable, further multiplied by `growthWeights` per class (§6.8); monsters use `floorDepth` in place of `level` — the curve itself (`growthBonusForDepth`) applies no per-stat weighting, but the resulting scaled stat is then multiplied by the archetype's `monsterType` weighting in `spawnMonster()`, analogous in spirit but not in mechanism to `growthWeights` (§6.6, `02-monster.md` "Monster type").

Each tier in `data/level-growth.json` → `tiers[]` declares its own upper `maxLevel` bound and a per-level growth rate for `attack`/`defense`/`maxHp`/`maxMp`/`magicPower` — later tiers taper off (each is never a faster rate than the one before it). `magicPower` uses the exact same rate as `attack` on this same tier table.

**Formula**: `bonus(stat, level) = floor(Σ rate(stat, tier(l)) for l running from 2 to level)` — accumulating the rate of the tier containing the level being "reached", rounded down. `tier(l)` = the tier whose `maxLevel` first covers level `l` (`tierFor()`, `src/data/levelGrowth.ts`).

Final value: `stat(level) = base<stat> + bonus(stat, level)`. `base<stat>` comes from the stat table in `01-class-skill.md` section 1 (`data/classes.json`).

EXP cost to level up is a separate table from the tier-growth table above — a finer bucket, placed in `expTiers[]` in the same file, see §6.9.

### 6.4 Milestone bonus (additive, applies the same to every class before weighting)

**Shared by both characters and monsters**: characters use this curve then multiply by `growthWeights` per class (§6.8); monsters use it directly, unweighted at the curve level (§6.6) — the `monsterType` weighting is applied afterward, to the scaled stat, not to this curve.

This is exactly the cumulative-sum curve from §6.3, sampled at any level — **not a separately maintained table**. The real bonus per class = `round(growthBonus(stat, level) × growthWeights[class][stat])` (§6.8). Monster stats (§6.6) still use `growthBonus()` directly, unweighted, before the `monsterType` multiplier is layered on. Read current values by calling `growthBonus(stat, level)` (`src/data/levelGrowth.ts`) rather than a hand-copied table, since it drifts the moment `tiers[]` is retuned.

### 6.5 Elite/boss multipliers are split per-stat, not applied uniformly

Elite/boss multipliers are split per individual stat, skewed toward HP — see `data/level-growth.json` fields `eliteMultiplier`/`bossMultiplier`, and §6.11 for how the 2 tiers compare.

### 6.6 Monsters share the same formula (using `floorDepth` instead of `level`)

Monsters have no separate `level` concept — monster stats scale with `floorDepth` using the exact same tier table as §6.3 (`growthBonusForDepth`, `src/data/monsters.ts`), preserving character/monster symmetry: both sides grow at the same rate, so the deeper the floor, the stronger the monster, proportionally.

On top of this, every archetype has a fixed `monsterType` (`"balanced" | "tanky" | "armored" | "damage"`) whose per-stat multiplier (`data/balance-config.json` → `monsterTypes`) is applied to the fully-scaled `attack`/`defense`/`maxHp` in `spawnMonster()`, the same way `eliteMultiplier`/`bossMultiplier` are (§6.5) — and it stacks with them. This reshapes an archetype's stat *spread* without changing its base-stat Balance Points (`02-monster.md` "Monster type" / "Monster Balance Points"). Full details: `02-monster.md`.

### 6.7 Balance verification (time-to-kill, TTK)

**Method**: simulate a party clearing every combat room and guard-room continuously from floor 1 to a target floor (using the real `createFloor(rng, depth)` for each floor, accumulating the `expReward` of every monster encountered into `partyExp`, then looking up `levelForTotalExp` to get the level at each floor milestone), repeated across multiple different seeds and averaged. Each floor spawns a floor-generator-dependent number of combat/guard rooms (`generateFloorLayout`, `technical-decisions.md` §1).

This document intentionally does **not** hand-maintain the resulting character-level-by-floor-depth table, hits-to-kill tables, or damage-taken tables that used to live here — they're a direct function of `data/classes.json`/`data/monsters.json`/`data/level-growth.json` and go stale the moment any of those are retuned. To (re-)verify balance, run the simulation described above (a script, or an addition to `test/`) against the current data rather than trusting a number written in this doc.

**Known limitations** (still true regardless of the current numbers):
- Any such simulation uses average values (number of combat rooms, monsters per room, random archetype among the regular combat archetypes) — it does not account for variance between specific seeds.
- Guard-room archetypes other than the one used as a reference in a given simulation run don't automatically get their own table — their numbers vary proportionally to each archetype's different `baseAttack`/`baseHp`/`baseDefense` (`02-monster.md` section 2).
- Skill-unlock milestones (`unlockLevel` per skill, `01-class-skill.md` section 1) are spread across the level range rather than being front-loaded into the first few levels — check `data/classes.json` for the current spacing.

### 6.8 Class-dependent growth (`growthWeights`)

Each class additionally has `growthWeights: { attack, defense, maxHp, maxMp, magicPower }` in `data/classes.json` — a separate multiplier per stat, applied on top of the **same `growthBonus()` curve** from §6.3:

```
classGrowthBonus(stat, level, weights) = round(growthBonus(stat, level) × weights[stat])
```

`magicPower` is a separate offensive stat for skills flagged `isMagic` (Mage's fire/lightning/ice, Acolyte's holy heal/purge — see `01-class-skill.md` section 1.6) — the resolver uses `magicPower` instead of `attack` for exactly those skills; `attack` keeps its usual role for all physical skills (including the basic attacks of Mage/Acolyte). Design intent: no class should get more total growth than another — compare the sum of all 5 weights across classes in `data/classes.json` directly rather than trusting a hand-copied total here.

`growthWeights` applies only to characters (`party.ts`); monsters still use the unweighted `growthBonus()` for the floor-depth curve itself, weighted separately afterward by `monsterType` (§6.6).

### 6.9 Decoupling character level from dungeon-floor level — the EXP system

Character level and dungeon floor depth are **2 independent progression axes**, with no 1-1 coupling:

| Axis | Grows when | Grows via | Cap |
|---|---|---|---|
| **Character level** (`Character.level`, shared across the whole party — no per-member XP tracking) | Killing any monster (any monster at all, including bosses) | Accumulated EXP (`GameState.partyExp`), looked up against `expTiers[]` — formula below | `MAX_LEVEL` (`src/data/levelGrowth.ts`) |
| **Dungeon floor level** (`Floor.depth`) | Defeating the guardian monster of the floor's final room (Elite or Boss — see §6.11) | `depth` increases by 1 once that room is cleared, generating a new floor | Unlimited — see §6.10 |

`Game.resolve()` (`src/engine/game.ts`) calls `applyPartyExp(state, expGained)` (`src/engine/party.ts`) the moment a battle is won, adding EXP and leveling up the whole party at once if the threshold is met; `Game.clearFinishedCombat()` calls `advanceToNextFloor()` when the just-won room was the guard-room (`type === "boss"`), generating the next floor via `createFloor(ctx.rng, nextDepth)`.

Monsters scale with `floorDepth` (unchanged, §6.6); characters scale with the player's actual combat progress, not with how many floors they've passed through.

**Monster EXP formula (added to `partyExp` on kill)**: a **simple linear** formula:

```
expReward(archetype, floorDepth) = archetype.expReward + floor(floorDepth × expRewardDepthRate)
```

`archetype.expReward` lives per-archetype in `data/monsters.json`; `expRewardDepthRate` is a standalone field in `data/level-growth.json`, alongside `eliteMultiplier`/`bossMultiplier`. The guardian monster of a floor's final room multiplies EXP by a different factor depending on type (§6.11) — Elite (most floors) multiplies by `eliteMultiplier.exp`, a real Boss (found every `bossFloorInterval` floors) multiplies by `bossMultiplier.exp` — both fields in `data/level-growth.json`.

**Character level-up thresholds — `expTiers[]`**, a separate table from the stat table, bucketed in fixed-size level ranges (`data/level-growth.json` field `expTiers[]`, each entry declaring its own `maxLevel` and `expCost`).

`expCostForLevel(level)` = the cumulative sum of the `expCost` of the bucket containing each level, from level 2 up to the level in question (the exact same cumulative-sum formula as `growthBonus` in §6.3, but reading from `expTiers[]` through a separate `expTierFor()` function, not sharing the stat table's `tierFor()` — `src/data/levelGrowth.ts`) — clamped at `MAX_LEVEL` (characters still have a cap, unlike monsters/floors).

**Leveling up**: whenever `partyExp` exceeds the `expCostForLevel(nextLevel)` threshold, the whole party levels up together (still sharing a single level, only the trigger source differs) — `hp`/`mp` fully restore, skills unlock if `unlockLevel` matches, keeping the "leveling up = full recovery" rule from `05-character-stats.md` section 5.

The number of monsters killable per floor is fixed by the generated layout (`technical-decisions.md` §1) — there's no mechanism to farm extra kills within a single floor. The event room (`08-events.md` §8) is an optional detour for Item/Artifact rewards, or the player can go straight through.

### 6.10 Infinite dungeon-floor level — monsters/bosses have no scaling ceiling

The monster-scaling formula in §6.6 does not apply a level-cap clamp to `floorDepth` (§6.9).

`growthBonusForDepth(stat, floorDepth)` — uses the same cumulative-sum-by-tier formula as `growthBonus`, but drops the ceiling clamp (keeping only the floor clamp at level 1), relying on the existing fallback mechanism (`tierFor()` naturally falls back to the last tier when no tier matches). Once `floorDepth` exceeds the last tier's `maxLevel`, monsters keep growing their stats at that last tier's rate.

**Consequence**: character level caps at `MAX_LEVEL` (§6.9); floor level is unlimited. Once the party hits max level, character power plateaus while monsters/bosses keep getting stronger indefinitely. There is no `gameOver: "victory"` state — defeating a boss always leads to the next floor via `advanceToNextFloor()`.

### 6.11 Elite vs real Boss — Boss is stronger, demands more tactics

The final room of each floor (tagged `boss` in the pattern) splits into 2 monster tiers:
- **Elite**: the default, appearing on most floors — multiplier: `data/level-growth.json` field `eliteMultiplier` (`maxHp`/`attack`/`defense`/`exp`).
- **Real Boss**: appears every `bossFloorInterval` floors (`floorDepth % bossFloorInterval === 0`, both from `data/level-growth.json`), **replacing** the Elite for that floor (mutually exclusive — no floor has both). Uses its own multiplier, `bossMultiplier`, clearly stronger than Elite across all 3 axes.

DoT (Poisoned/Burning — `effect.amount` fixed, not reduced by defense, `src/engine/resolver.ts`) can't be dodged via high defense. **Stunned** (`data/status-effects.json`, from Lightning Bolt/Lightning Storm) completely skips 1 of the Boss's turns, independent of defense.

There's no boss-phase mini-game. See §6.12 for Elite/Boss's own skillset. As with §6.7, a TTK comparison between Elite and Boss on the same floor is something to (re-)run against current data rather than read off a static table here.

### 6.12 Elite/Boss have their own skills — AoE, finishers, random debuffs

Elite and real Boss (not applicable to regular monsters, including a guard-room archetype when it spawns in a regular combat room) have a skillset that activates automatically on their own turn (not through `queueAction`/MP/cooldown like the player — monsters are always "free" and always hit, preserving the existing invariant in `resolver.ts`). The skill table applies to every guard-room archetype (`data/monster-skills.json`), each archetype having its own name per its flavor but sharing the same set of trigger mechanics — only the debuff status differs, to give each archetype its own identity (the exact archetype → debuff-status mapping: `data/monster-skills.json`):

| Skill (generic name) | Tier | Target | Effect (shape) | Weight |
|---|---|---|---|---|
| **Basic Attack** (unscaled) | Elite + Boss | 1 enemy, target chosen via `aiPattern` like a regular monster (`02-monster.md` section 2) | ordinary attack, no elite/boss bonus | `actionWeights.elite.basicAttack` / `actionWeights.boss.basicAttack` |
| **Strike** (e.g. Cleaving Strike — Skeleton Guard) | Elite + Boss | 1 enemy | `damage`, magnitude per `data/monster-skills.json` | `actionWeights.elite.strike` / `actionWeights.boss.strike` |
| **Cleave** (e.g. Sweeping Cleave) | Elite + Boss | Whole party | `damage`, magnitude per `data/monster-skills.json` | `actionWeights.elite.cleave` / `actionWeights.boss.cleave` |
| **Execute/Finishing Blow** | Boss only | 1 enemy | Large `damage` + partial defense-ignore (`ignoreDefensePercent`), both fields on the execute entry in `data/monster-skills.json` | See the separate charge-up mechanic below — **not** based on the target's %HP, and not part of the weighted roll |
| **Debuff** (e.g. Crush — Skeleton Guard) | Boss only | 1 enemy | `damage` + applies 1 archetype-specific debuff status (`weakened`/`poisoned`/`burning`/`stunned`) | `actionWeights.boss.debuff`, only rolled on turns the Boss isn't charging up or unleashing Execute |

**Weights are data-driven, not hardcoded**: each archetype's `actionWeights.elite`/`actionWeights.boss` in `data/monsters.json` lists the weight per action, resolved by weighted-random pick in `pickMonsterAction` (`src/engine/combat.ts`) — read the current weights there rather than trusting a hand-copied percentage here, since the field allows per-archetype tuning. Note that **Basic Attack is always a real, non-trivial possibility on both Elite and Boss turns** (it carries its own weight, not merely a rare fallback) — any damage-verification table covering only Strike/Cleave/Execute understates the actual average damage variance per turn.

The Boss's per-turn priority order: **currently charging?** → unleash Execute → otherwise, **Execute off cooldown?** → start charging (skipping every other action that turn) → otherwise, weighted-random pick among Basic Attack / Strike / Cleave / Debuff per `actionWeights.boss`. Elite (no Execute/Debuff): weighted-random pick among Basic Attack / Strike / Cleave per `actionWeights.elite`.

**Execute — the "charge up, then unleash 1 massive blow" mechanic** (not triggered by target %HP):

- **Its own dedicated trigger mechanism, not a `chance()` roll like Debuff/Cleave**: the Boss tracks `executeCooldownTurns` (initialized to `EXECUTE_COOLDOWN_TURNS` on spawn — `data/balance-config.json` field `combat.executeCooldownTurns`, `src/data/monsters.ts`). When the cooldown hits 0, that turn the Boss **charges up** instead of attacking — it picks 1 target right then (still following `aggro` as normal, via `pickAggroWeighted`) and **locks it in** (`Monster.executeTargetId`), logging a warning naming the target, dealing no damage that turn. On the Boss's next turn, regardless of any other cooldown/roll, it **always** unleashes Execute on exactly the locked-in target (read back from `executeTargetId`, not recalculated), then resets the cooldown.
- **Damage is nearly fixed, only partially reduced by the target's defense**: the execute skill's base `amount` plus the Boss's `attack`, minus the target's `defense` reduced by its `ignoreDefensePercent` — both fields live on the execute entry in `data/monster-skills.json`.
- **Target locked at the moment of charging**: the target is chosen based on `aggro` at the moment of charging — a Taunt used before the Boss's charge-up turn in the same round (the `taunt` status's aggro buff, `01-class-skill.md` section 1) can affect who gets locked in. Once locked, changing aggro/taunt on the following round doesn't affect the already-chosen target. A warning log naming the target appears the instant it's locked in.

`weakened` (`data/status-effects.json`) can be cleared by the Acolyte's Purify (ally branch = `removeStatusEffect`). The remaining guard-room archetypes use their own debuff statuses instead of `weakened` — see `data/monster-skills.json`.

**Numeric verification**: re-run the resolver's formula against the current `data/monsters.json`/`data/monster-skills.json`/`data/level-growth.json`/`data/classes.json` (a script, or a balance-oriented test) to see Strike/Cleave/Execute as a % of a given class's `maxHp` at any floor depth — this document intentionally no longer hand-maintains that table.
