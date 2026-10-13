# §6. Level system & damage balance

*(section 6 of `00-index.md` — every reference to "section 6.X"/"§6.X" in this file points internally, within the same file)*

**Source of truth for every number below**: `data/level-growth.json` (growth tiers, EXP tiers, elite/boss multipliers, `expRewardDepthRate`, `bossFloorInterval`), loaded via `src/data/levelGrowth.ts`. The character level cap is `maxLevel` in that same JSON, exposed as `MAX_LEVEL`. This document describes the formulas — not the current tuning values, which change independently of this doc.

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

**Shared by both characters and monsters, weighted the same way**: characters multiply this curve by `growthWeights` per class (§6.8); monsters multiply it by `monsterType`'s per-stat weight (§6.6) — in both cases the weighting scales only the growth curve itself, never the flat `base`/class-base stat, which is added back in afterward unscaled.

This is exactly the cumulative-sum curve from §6.3, sampled at any level — **not a separately maintained table**. The real bonus per class = `round(growthBonus(stat, level) × growthWeights[class][stat])` (§6.8, `classGrowthBonus`). Monster stats (§6.6) use the same shape — `round(growthBonusForDepth(stat, floorDepth) × monsterType's weight)` (`monsterGrowthBonus`, `src/data/levelGrowth.ts`) — before `baseX` is added back in. Read current values by calling `growthBonus(stat, level)` (`src/data/levelGrowth.ts`) rather than a hand-copied table, since it drifts the moment `tiers[]` is retuned.

### 6.5 Elite/boss multipliers are split per-stat, not applied uniformly

Elite/boss multipliers are split per individual stat, skewed toward HP — see `data/level-growth.json` fields `eliteMultiplier`/`bossMultiplier`, and §6.11 for how the 2 tiers compare.

### 6.6 Monsters share the same formula (using `floorDepth` instead of `level`)

Monsters have no separate `level` concept — monster stats scale with `floorDepth` using the exact same tier table as §6.3 (`growthBonusForDepth`, `src/data/monsters.ts`), preserving character/monster symmetry: both sides grow at the same rate, so the deeper the floor, the stronger the monster, proportionally.

On top of this, every archetype has a fixed `monsterType` (see `02-monster.md` for the full list) whose per-stat weight (`data/growth-weights.json` → `monsterGrowthWeights`, loaded as `MONSTER_TYPE_MULTIPLIER`) scales **only the depth-growth curve** in `spawnMonster()` — mirroring how a class's `growthWeights` scale only `growthBonus`, never `baseX`/class-base stats (§6.4). `eliteMultiplier`/`bossMultiplier` (§6.5) and the depth-buff/race statBuff, by contrast, scale the *whole* `base + weighted growth` total, and stack with each other and with `monsterType`'s weighting. This reshapes an archetype's stat *spread* without changing its base-stat Balance Points (`02-monster.md` "Monster type" / "Monster Balance Points"). Full details: `02-monster.md`.

### 6.7 Balance verification (time-to-kill, TTK)

**Method**: simulate a party walking one path per floor continuously from floor 1 to a target floor (using the real `createFloor(rng, depth)` for each floor, starting at the entry room and moving to a random connected room in the next stage until the boss/guard room, accumulating the `expReward` of every monster in the visited rooms into `partyExp`, then looking up `levelForTotalExp` to get the level at each floor milestone), repeated across multiple different seeds and averaged. A floor's branch rooms off that path never count — the player passes exactly one room per stage (`generateFloorLayout`, `technical-decisions.md` §1). The game editor's level-by-depth panel (`simulateLevelByDepth`, `tools/game-editor/calc.ts`) runs this simulation.

This document intentionally does **not** hand-maintain the resulting character-level-by-floor-depth table, hits-to-kill tables, or damage-taken tables — they're a direct function of `data/classes.json`/`data/monsters.json`/`data/level-growth.json` and go stale the moment any of those are retuned. To (re-)verify balance, run the simulation described above (a script, or an addition to `test/`) against the current data rather than trusting a number written in this doc.

**Known limitations** (independent of the current numbers):
- Any such simulation uses average values (number of combat rooms, monsters per room, random archetype among the regular combat archetypes) — it does not account for variance between specific seeds.
- Guard-room archetypes other than the one used as a reference in a given simulation run don't automatically get their own table — their numbers vary proportionally to each archetype's different `baseAttack`/`baseHp`/`baseDefense` (`02-monster.md` section 2).
- Skill-unlock milestones (`unlockLevel` per skill, `01-class-skill.md` section 1) are spread across the level range rather than being front-loaded into the first few levels — check `data/classes.json` for the current spacing. The 1 passive skill per class (§1.5) is the exception: its 5/20/35 rank schedule is fixed and identical across every class, not spread per-skill like the active-skill table.

### 6.8 Class-dependent growth (`growthWeights`)

Each class additionally has `growthWeights: { attack, defense, maxHp, maxMp, magicPower }` in `data/classes.json` — a separate multiplier per stat, applied on top of the **same `growthBonus()` curve** from §6.3:

```
classGrowthBonus(stat, level, weights) = round(growthBonus(stat, level) × weights[stat])
```

`magicPower` is a separate offensive stat for skills flagged `isMagic` (Mage's fire/lightning/ice, Acolyte's holy heal/purge — see `01-class-skill.md` §1.1) — the resolver uses `magicPower` instead of `attack` for exactly those skills; `attack` keeps its usual role for all physical skills. The basic attacks of Mage, Acolyte, Plague Doctor and Summoner are flagged `isMagic` and use `magicPower` (`data/classes.json`). Design intent: no class should get more total growth than another — compare the sum of all 5 weights across classes in `data/classes.json` directly rather than trusting a hand-copied total here.

`growthWeights` applies only to characters (`party.ts`); monsters use the unweighted `growthBonus()` for the floor-depth curve itself, weighted separately afterward by `monsterType` (§6.6).

### 6.9 Decoupling character level from dungeon-floor level — the EXP system

Character level and dungeon floor depth are **2 independent progression axes**, with no 1-1 coupling:

| Axis | Grows when | Grows via | Cap |
|---|---|---|---|
| **Character level** (`Character.level`, shared across the whole party — no per-member XP tracking) | Killing any monster (any monster at all, including bosses) | Accumulated EXP (`GameState.partyExp`), looked up against `expTiers[]` — formula below | `MAX_LEVEL` (`src/data/levelGrowth.ts`) |
| **Dungeon floor level** (`Floor.depth`) | Defeating the guardian monster of the floor's final room (Elite or Boss — see §6.11) | `depth` increases by 1 once that room is cleared, generating a new floor | Unlimited — see §6.10 |

`Game.resolve()` (`src/engine/game.ts`) calls `applyPartyExp(state, expGained)` (`src/engine/party.ts`) the moment a battle is won, adding EXP and leveling up the whole party at once if the threshold is met; `Game.clearFinishedCombat()` calls `advanceToNextFloor()` when the just-won room was the guard-room (`type === "boss"`), generating the next floor via `createFloor(ctx.rng, nextDepth)`.

Monsters scale with `floorDepth` (§6.6); characters scale with the player's actual combat progress, not with how many floors they've passed through.

**Monster EXP formula (added to `partyExp` on kill)**: a **simple linear** formula:

```
expReward(archetype, floorDepth) = archetype.expReward + floor(floorDepth × expRewardDepthRate)
```

`archetype.expReward` lives per-archetype in `data/monsters.json`; `expRewardDepthRate` is a standalone field in `data/level-growth.json`, alongside `eliteMultiplier`/`bossMultiplier`. The guardian monster of a floor's final room multiplies EXP by a different factor depending on type (§6.11) — Elite (most floors) multiplies by `eliteMultiplier.exp`, a real Boss (found every `bossFloorInterval` floors) multiplies by `bossMultiplier.exp` — both fields in `data/level-growth.json`.

**Character level-up thresholds — `expTiers[]`**, a separate table from the stat table, bucketed in fixed-size level ranges (`data/level-growth.json` field `expTiers[]`, each entry declaring its own `maxLevel` and `expCost`).

`expCostForLevel(level)` = the cumulative sum of the `expCost` of the bucket containing each level, from level 2 up to the level in question (the exact same cumulative-sum formula as `growthBonus` in §6.3, but reading from `expTiers[]` through a separate `expTierFor()` function, not sharing the stat table's `tierFor()` — `src/data/levelGrowth.ts`) — clamped at `MAX_LEVEL` (characters still have a cap, unlike monsters/floors).

**Leveling up**: whenever `partyExp` exceeds the `expCostForLevel(nextLevel)` threshold, the whole party levels up together (sharing a single level) — `hp`/`mp` fully restore, skills unlock if `unlockLevel` matches, keeping the "leveling up = full recovery" rule from `05-character-stats.md` section 5.

**Passive skill unlock schedule** (`01-class-skill.md` §1.5): every class's single passive skill unlocks its 3 ranks at a fixed **5 / 20 / 35**, the same for all 9 classes — a separate, uniform schedule from each class's own per-skill `unlockLevel` spacing above. Unlike an active skill, a passive's current rank is read directly off `Character.level` whenever it's needed (`getUnlockedPassiveRank`, `src/data/classes.ts`) rather than being unlocked once and cached — there's no `unlockedSkillIds`-style bookkeeping for it, since it's derived, not "learned."

The number of monsters killable per floor is fixed by the generated layout (`technical-decisions.md` §1) — there's no mechanism to farm extra kills within a single floor. An event room (`08-events.md` §8) on a branch point is an optional detour for Item/Artifact rewards, or the player can take the combat room beside it. A standalone event room takes the whole stage, so every path walks into it and that stage has no combat.

### 6.10 Infinite dungeon-floor level — monsters/bosses have no scaling ceiling

The monster-scaling formula in §6.6 does not apply a level-cap clamp to `floorDepth` (§6.9).

`growthBonusForDepth(stat, floorDepth)` — uses the same cumulative-sum-by-tier formula as `growthBonus`, but drops the ceiling clamp (keeping only the floor clamp at level 1), relying on `tierFor()` falling back to the last tier when no tier matches. Once `floorDepth` exceeds the last tier's `maxLevel`, monsters keep growing their stats at that last tier's rate.

**Consequence**: character level caps at `MAX_LEVEL` (§6.9); floor level is unlimited. Once the party hits max level, character power plateaus while monsters/bosses keep getting stronger indefinitely. Damage over time is what keeps pace: a DoT tick grows with the monster's max HP and skips its defense, so on deep floors the classes that keep a DoT up carry the party, and the Rogue is its main damage source by design (`01-class-skill.md` §1.3.3, §1.6). Nothing sets `gameOver` to `"victory"` — defeating a boss always leads on through `advanceToNextFloor()`. The one stop is the ending checkpoint at depth `endings.checkpointFloorDepth` (100) (`10-event-narrative.md` Part F.1): there `advanceToNextFloor()` offers the ending choice instead, and Stay, Let Go or Leave end the run.

### 6.11 Elite vs real Boss — Boss is stronger, demands more tactics

The final room of each floor (tagged `boss` in the pattern) splits into 2 monster tiers:
- **Elite**: the default, appearing on most floors — multiplier: `data/level-growth.json` field `eliteMultiplier` (`maxHp`/`attack`/`defense`/`exp`).
- **Real Boss**: appears every `bossFloorInterval` floors (`floorDepth % bossFloorInterval === 0`, both from `data/level-growth.json`), **replacing** the Elite for that floor (mutually exclusive — no floor has both). Uses its own multiplier, `bossMultiplier`, clearly stronger than Elite across all 3 axes.

DoT (Poisoned/Burning — `effect.amount` fixed, not reduced by defense, `src/engine/resolver.ts`) can't be dodged via high defense. **Stunned** (`data/status-effects.json`, from Lightning Bolt/Lightning Storm) completely skips 1 of the Boss's turns, independent of defense.

See §6.12 for Elite/Boss's own skillset. As with §6.7, a TTK comparison between Elite and Boss on the same floor is something to (re-)run against current data rather than read off a static table here.

### 6.12 Elite/Boss kits — one kit per guard-room archetype

Elite and real Boss monsters (not regular monsters, including a guard-room archetype when it spawns in an ordinary combat room) fight with a **kit** declared in data: a handful of skills in `data/monster-skills.json`, listed in the archetype's `skillIds`, with per-tier weights in `data/monsters.json` (`actionWeights.elite` / `actionWeights.boss`). Every guard-room archetype — Skeleton Guard, the nine guard-only archetypes and The Founder — has its own kit built around what its `description` says it does; there is no shared strike/cleave/debuff/finisher template any more. Monsters do not go through `queueAction`/MP/cooldowns like the player (they are always "free" and always hit — the invariant in `resolver.ts`); a kit is resolved on the monster's own turn by `runMonsterTurn` (`src/engine/monsterAI.ts`).

Design rules the data keeps (the kit data test under `test/` enforces them):

- **Behaviour first.** An archetype differs from the others in what it does, not only in which status its hit applies.
- **The elite tier is a reduced subset of its own boss kit.** Meeting the elite teaches the party how the monster fights; the boss adds its signature — a telegraph, one or more phases, extra skills. Every skill named at elite tier is also named at boss tier, and no telegraph or phase is reachable at elite tier.
- **No status effect or damage mechanic appears in more than two archetypes' kits.** Monster summoning is the one deliberate exception (three archetypes use it, each differently). Turn structure — telegraphs, phases, cooldowns, AI rules — and target shape (`targetCount`) are the frame the kits are built in and do not count.
- **No two telegraphs share a cadence** (`cooldownTurns` together with `initialCooldownTurns`), and two archetypes (Orc Chieftain, Void Amalgamation) have no telegraph at all.
- **Everything is data.** The engine names no archetype and no skill; a new kit is an edit to `data/*.json`.

#### The kits

| Archetype | How it fights |
|---|---|
| Skeleton Guard | Holds its ground and answers what hits it: a guard stance it recasts when it lapses, a shield bash that can enfeeble, and — boss only — a riposte stance (an attacker takes part of its own hit back) and a telegraphed overhead cut that ignores part of the target's defense. |
| Giant Spider | Binds first, feeds later: multi-target web barrages that prefer targets not yet webbed, venom that prefers a webbed target, and — boss — a telegraphed cocoon on a webbed target and a feed that punishes the poisoned and the weak. Below a share of its HP it goes into the rafters (smoke cover) and leans on its bites. |
| Dragon | Fire that wears the party down, then takes to the air: claws, a cooling-down breath that burns everyone (more likely when several are low), a brand that prefers a burning target, and — boss — a telegraphed inferno whose charge turn makes the Dragon untargetable. Its second phase empowers it. |
| Zombie Knight | Works through its guards, gets back up once: a diseased blade, a guard position on a cooldown for a near-regular rhythm, and — boss — one heal of a large share of its HP below a threshold, and a telegraphed embrace. |
| Dark Knight | Complete in attack and defence, picks one opponent: a salute that challenges a target (aggro up, fear up), cuts that strongly prefer the challenged target, a parry stance, a fear-raising presence, and a telegraph that is only available once someone is challenged and is aimed at them. Its second phase challenges a new opponent. |
| Orc Chieftain | A warband leader, no patience, no telegraph: skullsplitter that punishes the weakened, a call that keeps at most one Goblin up, a war cry for the whole warband, a rout across several targets, and — in its second phase — it gets up, enraged, with an Orc Brute. |
| Vampire Lord | Opens wounds, drinks from them, calls the flock when pressed: bleeding talons, a drink that scales with the target's bleeding stacks, a bat swarm weighted up when low on HP, and a telegraphed lifesteal draught on a bleeding target. |
| Void Amalgamation | No intent: picks targets uniformly (`targeting: "random"`), reaches for several at once, spills across everyone, mends itself, and subsumes one target for a lifesteal hit. No telegraph, no phase. |
| Ancient Golem | Cannot be broken quickly: a breakable shell (below), heavy single hits, a slowing tremor, and — boss — a telegraphed sealing blow; its second phase empowers it. |
| Lich | Arranged the room, raises the dead, strikes a name: withering touch (max HP down), raising skeletons gated on its ally count, a ledger mark that tags a target, and a telegraph that is only available while someone is marked and is aimed at them (and removes the mark on hit). Its second phase marks everyone and raises to the cap. |
| The Founder | Boss only, two phases, fear that climbs: ropes that reach several targets, one that strikes everyone through defense, a gaze that blinds and raises fear, a telegraphed heavy hit; it knits itself together for a few turns in the first phase and, last, lets the ropes go slack and raises fear across the party. |

The generated skill table in `02-monster.md` lists every skill, its effects and its owners.

#### How an elite or boss turn is chosen

Each turn runs in this order (`takeMonsterTurn`, `src/engine/monsterAI.ts`). Stun handling stays first, unchanged: a stunned monster loses the turn.

1. **Release.** If a telegraphed skill is charging, release it: on the target(s) it locked (any that died are re-picked by the skill's target rules), or on everyone alive for an area telegraph. The turn ends there.
2. **Phase entry.** If HP has crossed below the threshold of a phase not yet entered, enter it. If that phase names an `onEnterSkillId`, that skill is cast this turn and the turn ends.
3. **Filter.** Build the candidates from the current weights (`"basicAttack"` plus skill ids). Drop a skill that is on cooldown, out of `usesPerCombat`, or whose `aiCondition` fails.
4. **Score.** Multiply each candidate's weight by every matching `aiRules` entry's `weightMultiplier`.
5. **Pick** by weighted random over the scored weights; with no candidate left the monster basic-attacks.
6. **Target.** A single-target skill (and each pick of a `targetCount` skill) draws from the party weighted by the archetype's `aiPattern` aggro rule, multiplied by every matching `targetRules` entry. An archetype with `targeting: "random"` skips both and picks uniformly.
7. **Act.** A `telegraph` skill locks its target(s), resolves its `chargeEffects`, logs the warning and deals nothing this turn. Any other skill resolves at once. Using a skill starts its cooldown and spends one of its uses.

Cooldowns count down at the end of each of the monster's own turns, stunned or not — the same once-per-round pace a character's cooldowns run at. `initialCooldownTurns` is the cooldown a skill starts the fight on, so a telegraph cannot open the fight.

**Predicates.** `aiCondition`, `aiRules[].if` and `targetRules[].if` share one vocabulary, and an entry passes only when every field in it holds:

| Field | Evaluated against |
|---|---|
| `selfHpBelowPercent` | the acting monster |
| `selfHasStatusId` / `selfLacksStatusId` | the acting monster |
| `targetHpBelowPercent` | `targetRules` only: the candidate target |
| `targetHasStatusId` / `targetLacksStatusId` | in `targetRules`: the candidate target. In `aiCondition`/`aiRules`: true if any living enemy matches |
| `targetsBelowHpPercent` + `atLeast` | how many living enemies are under the HP percentage |
| `alliesFewerThan` | how many living monster-side allies (the acting monster excluded) there are — used to gate summoning |

A status check matches the status's rank family (a `poisoned` check matches `poisoned-iii`), the same way `conditionalBonus` does. The ids `guard-ii`/`guard-iii` carry no rank family, so a rule on `guard` matches only `guard` itself.

#### The normal tier is untouched

A normal-tier monster behaves exactly as it always did, down to the order of its RNG draws: it rolls only `actionWeights.normal`, and no cooldown, phase, charge or shell state is created for it. The `defensive` low-HP branch only considers a self-targeted skill that the current tier's weights name. This matters for Skeleton Guard, the one triple-role archetype: its `skillIds` hold self-targeted guard-room skills, its normal weights name only the basic attack, so the normal-tier Skeleton Guard never reaches them. `test/normal-skeleton-guard.test.ts` pins this (behaviour at full and low HP, no guard-room state, base stats and normal weights).

#### Mechanics the kits are built on

Each is generic: any archetype could declare it in JSON.

- **`summonMonster`** (a `SkillEffect.kind`). Spawns monsters of the named normal-role archetype into the running combat, scaled to the current floor depth. They join the turn order next round, carry the id of their summoner, give no EXP and no loot, do not count as room monsters, and **fall when their summoner does** — killing the summoner always ends the fight. A summoner can have at most `combat.maxSummonedMonsters` (2) adds alive; re-raising after an add dies is just another cast.
- **`reflectDamagePercent` on a status** (Skeleton Guard's `riposte`). When the bearer takes direct damage it deals that share back to the attacker, for any actor. Status ticks are never reflected, and a reflect is never itself reflected.
- **`shell` on an archetype** (Ancient Golem, at elite and boss tier alike). Intact: every direct hit is capped at a share of the bearer's max HP and counts toward breaking it (a multi-hit counts each hit, an area hit counts once), and status ticks deal nothing. Breaking: the last counted hit stuns the bearer for a turn and lifts both rules. Re-forming: at the end of the configured own turn after breaking (the stunned turn counts as the first), every debuff on the bearer is removed — buffs stay — and the hit count is re-rolled. A telegraph being charged is delayed by the stun, not cancelled. The intact shell and the broken state show in the monster's status row; breaking and re-forming each write a log line. An artifact's reflect is capped by an intact shell but is not a counted hit.
- **`untargetable` on the monster side** (Dragon `airborne`). The party's target pool, its `allEnemies` and every automatic party-side attack (summons, artifact auto-damage, on-hit area damage, Overwatch) exclude an untargetable monster. A queued single-target attack on it redirects to a targetable monster, or fizzles if there is none; Overwatch holds its shot and stays primed. Self and ally actions still work.
- **`targeting: "random"`** (Void Amalgamation). Picks targets uniformly and ignores aggro.
- **`targetCount: { min, max }`** on a `singleEnemy` monster skill. Each cast hits that many distinct targets (capped at the living, targetable ones), picked one at a time from the weighted pool; each rolls accuracy on its own, and the log names every target. A telegraph with `targetCount` locks all of them on its charge turn.
- **`harmful: true` on a status.** A status with no stat change, tick, stun or blind would otherwise count as a buff and be skipped by cleanses; `marked` and `challenged` set it so they read as debuffs and a cleanse can remove them. A cleanse with no named status removes the first debuff it finds, so a party member carrying several may need more than one to clear a specific mark.

#### Difficulty by `minFloor`

Measured on the old shared kit, difficulty did not follow `minFloor`: a floor-80 archetype hit hardest, a floor-90 one hit softest, and the two earliest guards died in about two rounds — too short for a telegraph, a phase or a summon to show. Difficulty is now balanced on two axes — damage and durability — against a curve of four bands plus the final boss, by `minFloor`:

- **Band I** — Skeleton Guard, Giant Spider. Teaches reading a telegraph and a status. Lowest damage, shortest fights, but long enough for the boss to telegraph at least once.
- **Band II** — Zombie Knight, Orc Chieftain, Vampire Lord. Summons and self-healing appear.
- **Band III** — Dark Knight, Void Amalgamation, Lich. Mechanics combine; phases matter.
- **Band IV** — Ancient Golem, Dragon. The full test.
- **The Founder** — the top of the curve.

Each band rises over the previous one in average damage taken per round (as a share of the party's total HP), in rounds the party needs to win, and in the cap on one telegraph's single-target damage (as a share of the lowest-HP class's max HP). Fought at the same floor, the boss tier lasts longer than the elite tier, and its damage per round stays close to the elite's rather than above it (a boss spends turns charging telegraphs, buffing and summoning). No action from any archetype reaches the lowest-HP class's max HP. The levers are the kit — skill amounts, the share of the monster's attack a hit uses (`offenseMultiplierPercent`), weights and cooldowns — plus, for guard-only archetypes, `baseHp`/`baseAttack`/`baseDefense` reshaped with Monster Balance Points kept inside the Elite/Boss band. Skeleton Guard is triple-role, so its base stats never change (the normal-tier version shares them); its guard-room durability comes from its defensive kit.

`test/elite-boss-balance.test.ts` simulates real engine fights at each archetype's first elite floor and first boss floor, over several seeds and three party compositions (class stats at the average level for that depth, no artifacts or abilities). Every round starts from the same wounded spread across the party, so damage taken in a round and the length of the fight are measured apart while a monster's rules for wounded targets still fire. The tier comparison fights the elite at the boss's floor too, since Skeleton Guard's first elite floor is several floors above its first boss floor. Fights run to a round cap well past the longest one, so a long fight is measured rather than cut short, and the party has to win every one. The test pins the ordering above; its target ranges are constants of that test, not of this document. One thing it makes visible: monster HP and defense at depth outgrow a level-capped party (§6.10), so the deepest archetypes (Ancient Golem, The Founder, the Dragon boss) run far longer than every other archetype, and base-stat reshaping cannot change that, because depth growth dominates a monster's stats there. The length is uneven across parties, as designed: the composition without a Rogue takes several times as many rounds against those three as the two that have one, because DoT carries the deep floors (`01-class-skill.md` §1.7.1).

`weakened` (`data/status-effects.json`) can be cleared by the Acolyte's Purify (ally branch = `removeStatusEffect`).

**Numeric verification**: re-run `bun test test/elite-boss-balance.test.ts` with `BALANCE_REPORT=1` for a table of damage taken per round and rounds to win for every archetype and tier — this document intentionally does not hand-maintain those numbers.

