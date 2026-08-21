# §6. Level 1-100 system & damage balance

*(section 6 of `00-index.md` — every reference to "section 6.X"/"§6.X" in this file points internally, within the same file)*

### 6.1 Growth formula

The system uses **tapered growth across 5 tiers**, not a flat linear formula per level.

### 6.2 Damage formula

Shape resolver: `damage = amount + mitigatedOffense(offense, defense)` (full mitigation formula in §6.7), combined with **tapered growth across 5 tiers** (§6.3) and character/monster symmetry (§6.6).

### 6.3 Tier growth table

**Shared by both characters and monsters**: characters use the `level` variable, further multiplied by `growthWeights` per class (§6.8); monsters use `floorDepth` in place of `level`, with no weighting applied (§6.6).

5 tiers, each with its own per-level growth rate (decreasing — each later tier is always ≤ the previous one), defined in `data/level-growth.json` field `tiers[]`:

| Tier | Level range | Level-ups in tier | attack/lvl | defense/lvl | maxHp/lvl | maxMp/lvl |
|---|---|---|---|---|---|---|
| 1 | 1–10 | 9 | 3 | 2 | 14 | 6 |
| 2 | 11–25 | 15 | 2 | 1 | 10 | 4 |
| 3 | 26–50 | 25 | 1 | 0.5 | 7 | 3 |
| 4 | 51–75 | 25 | 0.5 | 1/3 | 5 | 2 |
| 5 | 76–100 | 25 | 1/3 | 0.25 | 3 | 1 |

`magicPower` (§6.8) uses the exact same rate as `attack` on this same tier table.

**Formula**: `bonus(stat, level) = floor(Σ rate(stat, tier(l)) for l running from 2 to level)` — accumulating the rate of the tier containing the level being "reached", rounded down. `tier(l)` = the tier containing level `l` (e.g. level 11 uses tier-2 rate, level 50 still uses tier-3 rate, level 51 switches to tier 4).

Final value: `stat(level) = base<stat> + bonus(stat, level)`. `base<stat>` comes from the 6-stat table in `01-class-skill.md` section 1 (e.g. Vanguard's `baseAttack` = 14).

EXP cost to level up is a separate table from the 5-tier stat table above — a finer bucket (every 5 levels), placed in `expTiers[]` in the same file, see §6.9.

### 6.4 Milestone table (additive bonus, applies the same to every class)

**Shared by both characters and monsters**: characters use this table then multiply by `growthWeights` per class (§6.8); monsters use this table directly, with no weighting (§6.6).

| Level | +attack | +defense | +maxHp | +maxMp |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | 0 |
| 10 | 27 | 18 | 126 | 54 |
| 25 | 57 | 33 | 276 | 114 |
| 50 | 82 | 45 | 451 | 189 |
| 75 | 94 | 53 | 576 | 239 |
| 100 | 102 | 60 | 651 | 264 |

**This is the shared underlying curve, not the actual bonus received**: the real bonus per class = `round(bonus_in_table_above × growthWeights[class][stat])` (§6.8). Monster stats (§6.6) still use this table directly, unweighted.

### 6.5 Elite/boss multipliers are split per-stat, not applied uniformly

Elite/boss multipliers are split per individual stat, skewed toward HP — see the actual numbers in §6.11.

### 6.6 Monsters share the same formula (using `floorDepth` instead of `level`)

Monsters have no separate `level` concept — monster stats scale with `floorDepth` using the exact same tier table as §6.3 (`growthBonusForDepth`, `src/data/monsters.ts`), preserving character/monster symmetry: both sides grow at the same rate, so the deeper the floor, the stronger the monster, proportionally.

### 6.7 Balance verification (time-to-kill, TTK)

**Method**: simulate a party clearing every combat room and guard-room continuously from floor 1 to the target floor (using the real `createFloor(rng, depth)` for each floor, accumulating the `expReward` of every monster encountered into `partyExp`, then looking up `levelForTotalExp` to get the level at each floor milestone), repeated across multiple different seeds and averaged. Each floor spawns an average of **~7-8 combat/guard rooms** (`generateFloorLayout`, `technical-decisions.md` §1).

**Character level by floor depth** (average across multiple simulation runs, rounded):

| Floor depth | 1 | 10 | 25 | 50 | 75 | 100 | 150 | 200 | 250 |
|---|---|---|---|---|---|---|---|---|---|
| Character level | 2 | 18 | 35 | 54 | 68 | 80 | 99 | 100 | 100 |

The party hits the level-100 ceiling around **floor ~152** on average (e.g. floor 50 → level 54, floor 100 → level 80).

**Regular monster** (Dungeon Rat, basic attack from a **Vanguard** — no `isMagic` skill, and still the slowest of the 4 classes since its `attack` growth weight is the lowest in the group, 1.0 versus Rogue's 1.7):

The table below uses the current Dungeon Rat stats from `02-monster.md` section 2 (`baseDefense 1`, `baseHp 45`, `baseAttack 17`), with character level taken from the table above.

| Floor depth | Character level | dmg (Vanguard) | Monster HP | TTK Vanguard (hits) |
|---|---|---|---|---|
| 1 | 2 | 17 | 45 | 3 |
| 10 | 18 | 43 | 171 | 4 |
| 25 | 35 | 51 | 321 | 7 |
| 50 | 54 | 54 | 496 | 10 |
| 75 | 68 | 53 | 621 | 12 |
| 100 | 80 | 53 | 696 | 14 |
| 150 | 99 | 50 | 846 | 17 |
| 200 | 100 | 45 | 996 | 23 |
| 250 | 100 | 41 | 1146 | 28 |

**Elite guard-room** (using **Skeleton Guard** as the reference archetype — 1 of the 5 guard-room archetypes, see `02-monster.md` section 2; the other 4 archetypes follow the same multiplier formula but with different base stats):

The table below uses Skeleton Guard's current base stats (`baseHp 55`, `baseAttack 23`, `baseDefense 7`), the elite multiplier (§6.11), and each class's tier-1 skill (Vanguard: Shield Throw `amount 10`, uses `attack`; Mage: Fireball `amount 10`, uses `magicPower`; Rogue: Knife Throw `amount 12`, uses `attack`; Acolyte: Purify `amount 15` from level 10 onward, uses `magicPower`):

| Floor depth | Level | HP | Def | Vanguard (hits) | Mage (hits) | Rogue (hits) | Acolyte (hits) |
|---|---|---|---|---|---|---|---|
| 1 | 2 | 121 | 8 | 5 | 5 | 5 | — (Purify not yet unlocked) |
| 10 | 18 | 398 | 28 | 9 | 6 | 6 | 8 |
| 25 | 35 | 728 | 44 | 14 | 9 | 9 | 12 |
| 50 | 54 | 1113 | 57 | 20 | 13 | 13 | 18 |
| 75 | 68 | 1388 | 66 | 24 | 16 | 16 | 22 |
| 100 | 80 | 1553 | 74 | 28 | 18 | 18 | 25 |
| 150 | 99 | 1883 | 87 | 35 | 23 | 22 | 31 |
| 200 | 100 | 2213 | 101 | 45 | 30 | 29 | 39 |
| 250 | 100 | 2543 | 114 | 56 | 36 | 35 | 48 |

**Damage TAKEN ("mon → char")** uses the mitigation formula `finalDamage = max(1, round(amount + off − off·(def/(60+def)) − def/30))` (`mitigatedOffense` in `resolver.ts`). This formula applies uniformly in **both directions** (character hitting monster, and monster hitting character both go through the same `mitigatedOffense` function, with no directional distinction). The 2 constants used in the formula: `x=60, y=30` (`data/balance-config.json` field `combat.defenseMitigationX`/`Y`).

Average hits-to-die from an **Elite** Skeleton Guard attacking each class (basic attack, `amount 0`), aggregated across the whole floor range in the level-by-depth table above:

| Class | min – max (whole game) | avg |
|---|---|---|
| Vanguard | 6.2 – 15.6 | 13.1 |
| Rogue | 3.9 – 9.6 | 8.1 |
| Acolyte | 4.3 – 9.0 | 7.7 |
| Mage | 2.9 – 6.0 | 5.1 |

**Known limitations**:
- The TTK table above uses average values (number of combat rooms, monsters per room, random archetype among the 11 regular combat archetypes) — it does not account for variance between specific seeds.
- 4 of the 5 guard-room archetypes (Giant Spider, Dragon, Zombie Knight, Dark Knight) don't yet have their own TTK table like Skeleton Guard does — their numbers vary around the table above proportionally to each archetype's different `baseAttack`/`baseHp`/`baseDefense` (`02-monster.md` section 2).
- Skill-unlock milestones (slots 2-4) sit at levels 10/20/35 (`01-class-skill.md` section 1, all classes), spread evenly across the 1-100 range instead of being front-loaded into the first 7 levels.

### 6.8 Class-dependent growth (`growthWeights`)

Each class additionally has `growthWeights: { attack, defense, maxHp, maxMp, magicPower }` — a separate multiplier per stat, applied on top of the **same `growthBonus()` curve** from §6.3:

```
classGrowthBonus(stat, level, weights) = round(growthBonus(stat, level) × weights[stat])
```

`magicPower` is a separate offensive stat for skills flagged `isMagic` (Mage's fire/lightning/ice, Acolyte's holy heal/purge — see `01-class-skill.md` section 1.6) — the resolver uses `magicPower` instead of `attack` for exactly those skills; `attack` keeps its usual role for all physical skills (including the basic attacks of Mage/Acolyte). The "no class gets more total growth than another" budget is computed across all 5 weights — the current total is **5.0** for every class:

| Class | attack | magicPower | defense | maxHp | maxMp | Total | Role |
|---|---|---|---|---|---|---|---|
| Vanguard | 1.0 | 0.4 | 1.5 | 1.5 | 0.6 | 5.0 | Tank |
| Mage | 0.1 | 1.7 | 0.7 | 0.9 | 1.6 | 5.0 | Magic glass cannon |
| Rogue | 1.7 | 0.3 | 0.9 | 1.3 | 0.8 | 5.0 | Melee glass cannon |
| Acolyte | 0.5 | 1.1 | 1.0 | 1.1 | 1.3 | 5.0 | Pure support |

**Result by level 100** (`createCharacter`, base + `classGrowthBonus`):

| Class | attack | magicPower | defense | maxHp | maxMp |
|---|---|---|---|---|---|
| Vanguard | 116 | 41 | 100 | 1117 | 178 |
| Mage | 16 | 187 | 46 | 656 | 482 |
| Rogue | 189 | 31 | 60 | 936 | 241 |
| Acolyte | 57 | 122 | 68 | 816 | 393 |

`growthWeights` applies only to characters (`party.ts`); monsters still use the unweighted `growthBonus()` (§6.6).

### 6.9 Decoupling character level from dungeon-floor level — the EXP system

Character level and dungeon floor depth are **2 independent progression axes**, with no 1-1 coupling:

| Axis | Grows when | Grows via | Cap |
|---|---|---|---|
| **Character level** (`Character.level`, shared across the whole party — no per-member XP tracking) | Killing any monster (any monster at all, including bosses) | Accumulated EXP (`GameState.partyExp`), looked up against a per-tier threshold table — formula below | **100** |
| **Dungeon floor level** (`Floor.depth`) | Defeating the guardian monster of the floor's final room (Elite or Boss — see §6.11) | `depth` increases by 1 once that room is cleared, generating a new floor | **Unlimited** — see §6.10 |

`Game.resolve()` (`src/engine/game.ts`) calls `applyPartyExp(state, expGained)` (`src/engine/party.ts`) the moment a battle is won, adding EXP and leveling up the whole party at once if the threshold is met; `Game.clearFinishedCombat()` calls `advanceToNextFloor()` when the just-won room was the guard-room (`type === "boss"`), generating the next floor via `createFloor(ctx.rng, nextDepth)`.

Monsters scale with `floorDepth` (unchanged, §6.6); characters scale with the player's actual combat progress, not with how many floors they've passed through.

**Monster EXP formula (added to `partyExp` on kill)**: uses a **simple linear** formula:

```
expReward(archetype, floorDepth) = archetype.expReward + floor(floorDepth × 0.1)
```

The `0.1` coefficient (EXP bonus/floor) is a standalone constant, placed alongside `eliteMultiplier`/`bossMultiplier` in `data/level-growth.json` (not a column in `tiers[]`). The guardian monster of a floor's final room multiplies EXP by a different factor depending on type (§6.11) — Elite (most floors) multiplies by `eliteMultiplier.exp` (**x3**), a real Boss (every 5 floors) multiplies by `bossMultiplier.exp` (**x6**).

**Character level-up thresholds — `expTiers[]`**, a separate table from the stat table, bucketed **every 5 levels** (1-5, 6-10, ..., 96-100 — 20 buckets):

| Level | expCost per level-up | Level | expCost per level-up |
|---|---|---|---|
| 1-5 | 115 | 51-55 | 490 |
| 6-10 | 135 | 56-60 | 555 |
| 11-15 | 150 | 61-65 | 640 |
| 16-20 | 165 | 66-70 | 730 |
| 21-25 | 195 | 71-75 | 825 |
| 26-30 | 255 | 76-80 | 945 |
| 31-35 | 285 | 81-85 | 1080 |
| 36-40 | 330 | 86-90 | 1230 |
| 41-45 | 375 | 91-95 | 1410 |
| 46-50 | 430 | 96-100 | 1605 |

Total EXP needed to reach level 100: **59,610**.

`expCostForLevel(level)` = the cumulative sum of the `expCost` of the 5-level bucket containing each level, from level 2 up to the level in question (the exact same cumulative-sum formula as `growthBonus` in §6.3, but reading from `expTiers[]` through a separate `expTierFor()` function, not sharing the stat table's `tierFor()` — `src/data/levelGrowth.ts`) — clamped at level 100 (characters still have a cap, unlike monsters/floors).

**Leveling up**: whenever `partyExp` exceeds the `expCostForLevel(nextLevel)` threshold, the whole party levels up together (still sharing a single level, only the trigger source differs) — `hp`/`mp` fully restore, skills unlock if `unlockLevel` matches, keeping the "leveling up = full recovery" rule from `05-character-stats.md` section 5.

The number of monsters killable per floor is fixed by the generated layout (`technical-decisions.md` §1) — there's no mechanism to farm extra kills within a single floor. The event room (`08-events.md` §8) is an optional detour for Item/Artifact rewards, or the player can go straight through.

### 6.10 Infinite dungeon-floor level — monsters/bosses have no scaling ceiling

The monster-scaling formula in §6.6 does not apply a 100-cap clamp to `floorDepth` (§6.9).

`growthBonusForDepth(stat, floorDepth)` — uses the same cumulative-sum-by-tier formula as `growthBonus`, but drops the ceiling clamp (keeping only the floor clamp at level 1), relying on the existing fallback mechanism (`tierFor()` naturally falls back to tier 5 when no tier matches `maxLevel`). From floor 101 onward, monsters keep growing their stats at tier 5's rate.

**Consequence**: character level caps at 100 (§6.9, actually reached around floor ~152 per the simulation in §6.7); floor level is unlimited. Once the party hits max level, character power plateaus while monsters/bosses keep getting stronger indefinitely. There is no `gameOver: "victory"` state — defeating a boss always leads to the next floor via `advanceToNextFloor()`.

### 6.11 Elite vs real Boss — Boss is stronger, demands more tactics

The final room of each floor (tagged `boss` in the pattern) splits into 2 monster tiers:
- **Elite**: the default, appearing on most floors — `eliteMultiplier` (`data/level-growth.json`): `maxHp×2.2, attack×1.4, defense×1.1`.
- **Real Boss**: appears **every 5 floors** (`floorDepth % 5 === 0`, `bossFloorInterval`), **replacing** the Elite for that floor (mutually exclusive — no floor has both). Uses its own multiplier, clearly stronger than Elite across all 3 axes — `bossMultiplier`: `maxHp×2.7, attack×1.8, defense×1.2`.

| Multiplier | Elite | Real Boss |
|---|---|---|
| maxHp | ×2.2 | ×2.7 |
| attack | ×1.4 | ×1.8 |
| defense | ×1.1 | ×1.2 |

DoT (Poisoned/Burning — `effect.amount` fixed, not reduced by defense, `src/engine/resolver.ts`) can't be dodged via high defense. **Stunned** (`data/status-effects.json`, from Lightning Bolt/Lightning Storm) completely skips 1 of the Boss's turns, independent of defense.

The table below uses **Skeleton Guard**'s base stats (`baseHp 55`, `baseAttack 23`, `baseDefense 7` — `02-monster.md` section 2); level by floor depth uses the simulation table from §6.7.

**TTK: real Boss vs Elite on the same floor** (Rogue/Mage's tier-1 skill, party at the corresponding level per §6.7 — using Rogue/Mage since Vanguard/Acolyte become "unkillable" fairly early, see §6.7):

| Floor | Level | Type | HP | Def | Rogue (hits) | Mage (hits) |
|---|---|---|---|---|---|---|
| 10 | 18 | Elite | 398 | 28 | 6 | 6 |
| 10 | 18 | **Boss** | 489 | 30 | 7 | 8 |
| 25 | 35 | Elite | 728 | 44 | 9 | 9 |
| 25 | 35 | **Boss** | 894 | 48 | 11 | 12 |
| 50 | 54 | Elite | 1113 | 57 | 13 | 13 |
| 50 | 54 | **Boss** | 1366 | 62 | 16 | 17 |
| 100 | 80 | Elite | 1553 | 74 | 18 | 18 |
| 100 | 80 | **Boss** | 1906 | 80 | 23 | 23 |

There's no boss-phase mini-game. See §6.12 for Elite/Boss's own skillset.

### 6.12 Elite/Boss have their own skills — AoE, finishers, random debuffs

Elite and real Boss (not applicable to regular monsters, including a guard-room archetype when it spawns in a regular combat room) have a skillset that activates automatically on their own turn (not through `queueAction`/MP/cooldown like the player — monsters are always "free" and always hit, preserving the existing invariant in `resolver.ts`). The skill table applies to all 5 guard-room archetypes (`data/monster-skills.json`), each archetype having its own name per its flavor but sharing the same set of `amount` values and trigger mechanics — only the debuff status differs, to give each archetype its own identity (Skeleton Guard → `weakened`; Giant Spider → `poisoned`; Dragon → `burning`; Zombie Knight → `weakened`; Dark Knight → `stunned`):

| Skill (generic name) | Tier | Target | Effect | When used |
|---|---|---|---|---|
| **Strike** (e.g. Cleaving Strike — Skeleton Guard) | Elite + Boss | 1 enemy | `damage amount 3` | Default action, target chosen via `aiPattern` like a regular monster (`02-monster.md` section 2) |
| **Cleave** (e.g. Sweeping Cleave) | Elite + Boss | Whole party | `damage amount 2` | 30%/turn, replaces Strike |
| **Execute/Finishing Blow** | Boss only | 1 enemy | `damage amount 71`, `ignoreDefensePercent 50` (only 50% of the target's defense counts) | See the separate charge-up mechanic below — **not** based on the target's %HP |
| **Debuff** (e.g. Crush — Skeleton Guard) | Boss only | 1 enemy | `damage amount 4` + applies 1 archetype-specific debuff status (`weakened`/`poisoned`/`burning`/`stunned`) | 30%/turn when the Boss isn't charging up or unleashing Execute, replacing a Cleave/Strike roll |

The Boss's per-turn priority order: **currently charging?** → unleash Execute → otherwise, **Execute off cooldown?** → start charging (skipping every other action that turn) → otherwise, roll **Debuff** (30%) → roll **Cleave** (30%) → **Strike**. Elite (no Execute/Debuff): roll **Cleave** (30%) → **Strike**.

**Execute — the "charge up, then unleash 1 massive blow" mechanic** (not triggered by target %HP):

- **Its own dedicated trigger mechanism, not a `chance()` roll like Debuff/Cleave**: the Boss tracks `executeCooldownTurns` (initialized to `EXECUTE_COOLDOWN_TURNS = 3` on spawn, `src/data/monsters.ts`). When the cooldown hits 0, that turn the Boss **charges up** instead of attacking — it picks 1 target right then (still following `aggro` as normal, via `pickAggroWeighted`) and **locks it in** (`Monster.executeTargetId`), logging a warning naming the target, dealing no damage that turn. On the Boss's next turn, regardless of any other cooldown/roll, it **always** unleashes Execute on exactly the locked-in target (read back from `executeTargetId`, not recalculated), then resets the cooldown to `EXECUTE_COOLDOWN_TURNS`.
- **Damage is nearly fixed, only halved by the target's defense**: `amount 71` plus the Boss's `attack`, minus the target's `defense` reduced by 50% (`ignoreDefensePercent 50`) — see the verification table below for the actual %maxHp ratio per class.
- **Target locked at the moment of charging**: the target is chosen based on `aggro` at the moment of charging — a Taunt used before the Boss's charge-up turn in the same round (+40 aggro from the `taunt` status, `01-class-skill.md` section 1) can affect who gets locked in. Once locked, changing aggro/taunt on the following round doesn't affect the already-chosen target. A warning log naming the target appears the instant it's locked in.

`weakened` (`data/status-effects.json`) can be cleared by the Acolyte's Purify (ally branch = `removeStatusEffect`). The 3 remaining guard-room archetypes use `poisoned`/`burning`/`stunned` for their own debuffs instead of `weakened`.

**Numeric verification (party at level 1, `createCharacter(..., level = 1)`)**, using **Skeleton Guard** at floor 1 as reference:

| Type | Atk | Def | HP | Class | maxHp | Strike (%maxHp) | Cleave (%maxHp) | Execute (%maxHp) |
|---|---|---|---|---|---|---|---|---|
| Elite | 32 | 8 | 121 | Vanguard | 140 | 30 (21%) | 29 (21%) | — |
| Elite | 32 | 8 | 121 | Mage | 70 | 33 (47%) | 32 (46%) | — |
| Elite | 32 | 8 | 121 | Rogue | 90 | 32 (36%) | 31 (34%) | — |
| Elite | 32 | 8 | 121 | Acolyte | 100 | 31 (31%) | 30 (30%) | — |
| Boss | 41 | 8 | 149 | Vanguard | 140 | 38 (27%) | 37 (26%) | 109 (**78%**) |
| Boss | 41 | 8 | 149 | Mage | 70 | 41 (59%) | 40 (57%) | 111 (**159%, kill**) |
| Boss | 41 | 8 | 149 | Rogue | 90 | 40 (44%) | 39 (43%) | 110 (**122%, kill**) |
| Boss | 41 | 8 | 149 | Acolyte | 100 | 39 (39%) | 38 (38%) | 109 (**109%, kill**) |
