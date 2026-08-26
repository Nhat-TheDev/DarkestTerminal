# Technical — Decisions

**Related**: `./design-doc.md` §3; `../dungeon-crawler-data-model.ts`

**Note on numbers**: this document describes mechanics and formulas, not
specific tuning values — every constant/threshold is named after the field
that holds it, with a pointer to where the actual number lives
(`data/balance-config.json` for tunable constants, or a named constant/function
in a `src/**/*.ts` file for anything not exposed as data). Don't hand-copy the
current values in here; read them from the source instead, since editing docs
every time balance is retuned is exactly what this convention avoids.

---

## 1. Room/floor generation: a rule-fixed runtime generator

Floor structure is generated directly by a runtime algorithm
(`generateFloorLayout(rng)`, `src/data/floorPatterns.ts`) — it does not read
from a hand-written pattern file. Core invariant: **no dead ends, every
branch converges on the boss**, guaranteed by exactly one connection rule
(below), with no need for a separate validation algorithm.

### Internal representation
The structure uses the concept of a **stage** (column) — `RoomToken[][]` —
each room has `{ stage, roomId, tag }`, where `tag` is one of:
- `""` — a normal combat room
- `"free"` — a rest room
- `"event"` — an event room (`gameplay-decisions/08-events.md` §8)
- `"boss"` — the boss room, required to be the sole room of the final stage

### Connection rule
**Every room in stage N connects to ALL rooms in stage N+1**, with no other
edges allowed — no connecting backward, no shortcutting across stages. This
automatically implies: dead ends are impossible, and every branch naturally
converges once the next stage has only 1 room; going back to a previous room
is never allowed.

### Generation rules (`generateFloorLayout`)
Every bound below is measured **along a single path** from start to boss —
since every stage connects fully to the next, path length = number of stages,
fixed regardless of which branch is chosen. All bounds are read from
`data/balance-config.json` field `floorGeneration`, re-exported as named
constants in `src/data/floorPatterns.ts`:
- Stage 0 (start) is exactly 1 room, tag `""` (normal room).
- The final stage is exactly 1 room, tag `boss`.
- Path length (total rooms, including start + boss): bounded by `MIN_PATH_ROOMS`/`MAX_PATH_ROOMS` (`floorGeneration.minPathRooms`/`maxPathRooms`), randomized on each generation.
- **Branch points** (branch = a stage with >1 room) can only be placed starting from `MIN_BRANCH_START_STAGE` (`floorGeneration.minBranchStartStage`, 0-indexed).
- At most `MAX_BRANCHES` branch points (`floorGeneration.maxBranches`); 2 consecutive branch points must be at least `MIN_BRANCH_SPACING` rooms apart (`floorGeneration.minBranchSpacing`) — so a short path can only fit a couple of branch points at most.
- Each branch point = exactly 2 rooms: 1 normal room + 1 event room (the player picks one of the two when passing through that stage).
- Because branch points are spaced apart by at least `MIN_BRANCH_SPACING`, no 2 event rooms are ever adjacent on the same path.
- At most `MAX_EVENT_ROOMS_PER_PATH` event rooms per path (`floorGeneration.maxEventRoomsPerPath`).
- `MIN_REST_ROOMS_PER_PATH`–`MAX_REST_ROOMS_PER_PATH` rest rooms per path (`floorGeneration.minRestRoomsPerPath`/`maxRestRoomsPerPath`) — chosen randomly among stages that aren't start/boss/branch points.
- `roomId` is unique across the whole layout.

`validateGeneratedStages(stages)` re-checks all of the rules above — used as
a safety net for tests and for future changes to the generator (the generator
is correct by construction and doesn't rely on validation to be correct).

### Storage & runtime
`createFloor(rng, depth)` (`src/data/floor.ts`) calls `generateFloorLayout(rng)`
then `buildFloorFromStages(stages, rng, depth)`: it builds `Room[]` with
`connectedRoomIds` = every room in the next stage; assigns random room names
(a pool per room type, avoiding duplicate names within the same floor) and
randomly places a small number of monsters per combat room (the regular
combat archetypes from `data/monsters.json`, `gameplay-decisions/02-monster.md`
§2), 1 elite or boss monster (a guard-room archetype, randomly picked —
`gameplay-decisions/02-monster.md` §2, `gameplay-decisions/06-level-system.md` §6.11)
for the `boss` room. `Game.advanceToNextFloor()` (`src/engine/game.ts`) calls
`createFloor` again with `depth + 1` every time the guard-room is cleared
(`gameplay-decisions/06-level-system.md` §6.9).

`test/floorPatterns.test.ts`: a property-based test that runs `generateFloorLayout`
across many random seeds, verifying all the rules above plus reachability/no-dead-end (BFS),
plus a separate test for `validateGeneratedStages` (invalid input must throw).

---

## 2. Turn cycle: command phase + speed-ordered execution phase

Each round splits into 2 distinct phases, matching `CombatState.phase` (`"command" | "resolution"`).

### Phase 1 — Command (`phase: "command"`)
- The player picks an action (skill or item) + target for every living character up front, without seeing what the monsters will do this round. Monsters do **not** act in this phase.
- Each valid choice is recorded as a `QueuedAction` in `CombatState.queuedActions` (1 entry per living character).
- Validated right at queue time: enough MP for `mpCost`, remaining `usesPerCombat` if the skill has a limit, not currently on `cooldownsRemaining`. An invalid skill simply can't be selected.
- **MP is deducted / items are consumed immediately on queueing**, not at execution time — the decision is treated as locked in and isn't undone even if the target's state changes before execution.
- Once every living character has a `QueuedAction` → `phase` moves to `"resolution"`.

### Phase 2 — Execution (`phase: "resolution"`)
- Build a `turnQueue` = every living combatant (characters + all monsters), taking a `speed` snapshot at exactly this moment (not recalculated mid-round even if `speed` buffs/debuffs occur during execution). Sort descending by `speed`; ties → characters before monsters, then original order within `combatants`.
- Walk `turnQueue` from the start using `activeTurnIndex`, at each step:
  1. If the combatant is already dead (killed by someone who acted earlier in the same round) → skip, even if it's a character with a pending `QueuedAction` (that action is fully cancelled).
  2. If it's a **character**: fetch its `QueuedAction`, apply the dead-before-turn targeting rule (below), then call the resolver (§3).
  3. If it's a **monster**: AI picks an action + target right at this moment (no pre-commit) based on the current state — targeting by `aggro` (`gameplay-decisions/02-monster.md` §2).
- **Dead-before-turn targeting**: if a `QueuedAction`'s original target has died by the time the actor's turn comes up:
  - `target: "singleEnemy"` → redirect randomly to any living monster; if none are left → the action fizzles (MP/item is still lost from the command phase).
  - `target: "singleAlly"` → **no** redirect, the action just fizzles (redirecting to someone else would go against the player's original choice).
- When `turnQueue` is exhausted → `roundNumber += 1`, `queuedActions` resets empty, `phase` goes back to `"command"` for the next round.
- Combat ends when all `monster`s in `combatants` are dead (victory) or all `character`s are dead (full-party permadeath).

`speed` has no random component (no extra roll) — turn order is determined
purely deterministically; variation between battles comes from `speed`
buffs/debuffs via skills (`modifyCombatStat`), not from underlying RNG.

---

## 3. Resolver function for SkillEffect

A single pure function, shared by both skills and items:

```
resolveSkillEffect(effect: SkillEffect, source: Combatant, targets: Combatant[], ctx: GameState): void
```

`source`/`target` are either `Character` or `Monster` — both types share flat
fields `attack`/`defense`/`hp`/`maxHp` under the same names, so most effects
share the same code path regardless of whether the source/target is which;
`mp`/`maxMp`/`aggro`/`survival` only exist on `Character`.

### Handling by `effect.kind`
- **`damage`**: for each target, `finalDamage = max(1, round((effect.amount + mitigatedOffense(offensiveStat, target.defense)) * damageMultiplier))`, where `offensiveStat = source.attack` by default, or `source.magicPower` if the skill has `isMagic: true` **and** `source` is a `Character` (monsters always use `attack`). The `isMagic` flag is passed down via `ResolveContext.isMagic` from `combat.ts`'s `applySkillEffects`.
  `mitigatedOffense(off, def) = off − off·(def/(X+def)) − def/Y`, where `X`/`Y` are `data/balance-config.json` fields `combat.defenseMitigationX`/`combat.defenseMitigationY` (`src/engine/resolver.ts`).
  If `source` is a character, its current fear tier (`getFearTier`, `src/engine/resolver.ts`) can add an accuracy roll and a damage multiplier before HP is deducted (see `getFearAccuracyPenalty`/`getFearDamagePenalty` in the same file), and the top fear tier additionally has a chance to skip the turn entirely, rolled at the action-selection step (command phase, `rollLosesControl`) before the resolver is ever called — details + the fear-tier table: `gameplay-decisions/04-fear-combat.md` §4. **Exception when `source === target`** (a status effect's own periodic tick on the actor carrying it, e.g. the "Poisoned" DoT — `tickStatusEffects` calls `resolveSkillEffect` again with `source`/`target` being the same actor): this isn't "an attack", so attack (or magicPower)/defense are **not** added/subtracted and the fear multiplier isn't applied — the damage is a fixed `effect.amount`.
- **`heal`**: `target.hp = min(target.maxHp, target.hp + effect.amount + healPower)`, where `healPower = source.magicPower` if the skill has `isMagic: true` and `source` is a `Character`, otherwise `healPower = 0`.
- **`restoreMp`**: same as `heal` but on `target.mp`/`target.maxMp` (only applies to `Character`).
- **`applyStatusEffect`** / **`removeStatusEffect`**: adds/removes an entry `{ statusEffectId, turnsRemaining }` from `target.activeStatusEffects` (a list unique by `statusEffectId` — reapplying an already-active status just refreshes `turnsRemaining` back to `durationTurns`, it doesn't stack).
- **`modifyStat`**: for `effect.stat === "fear"`, `target.survival.fear += effect.amount` (`Character` only); for `effect.stat === "satiety"`, `ctx.gameState.satiety += effect.amount` instead — satiety is party-wide (`GameState`, not `Character`), so this branch needs a `gameState` reference in `ResolveContext` (only set by call sites that have one, e.g. `Game.useItemOutOfCombat`). Either way, clamped to the survival-stat range (`gameplay-decisions/03-survival-stats.md` §3).
- **`modifyCombatStat`**: `target[effect.combatStat] += effect.amount` (`attack`/`defense`/`aggro`/`speed`; `aggro` only exists on `Character`). This effect kind only ever appears inside `StatusEffectDefinition.perTurnEffects`, so a buff/debuff's lifetime is tied to the status effect that contains it; when the status expires, the resolver applies the effect with an inverted sign once to undo it (ensuring buffs never leak permanently).

### Ordering & responsibility boundaries
- A `SkillDefinition`/`ItemDefinition` can have multiple `effects`; the resolver applies them **sequentially in array order**, with each later effect seeing state already changed by earlier ones (e.g. Rogue's Flurry Assault = several consecutive `damage` effects, where a later effect is computed on HP already reduced by an earlier one).
- MP deduction (for skills) or item consumption (for items) happens **in the command phase, at the moment the `QueuedAction` is created** (§2) — not when the resolver runs. The resolver only handles the effect itself, not the cost of activating it.
- `usesPerCombat` is also checked & decremented right in the command phase, alongside MP.

---

## 4. Skill mechanics for the shared skill-kit shape

Applies to `gameplay-decisions/01-class-skill.md` §1 / `gameplay-decisions/04-fear-combat.md` §4.1. All 4 mechanics below live entirely inside `src/engine/combat.ts` (`applySkillEffects`, `autoResolveTargets`, `resolveExecutionTargets`, `runCharacterTurn`, `queueAction`, `resolveRound`/`finalizeRound`) — `resolveSkillEffect` in `resolver.ts` doesn't need to know anything about proc rolls/cooldowns/side relationships, since it remains just a function that applies a single effect to a single target.

### 4.1 Chance-based procs (`SkillEffect.chance`)
- An optional field on `SkillEffect`: `chance?: number` (0-1, set per skill in `data/classes.json`). Not having this field means it always applies.
- Rolled inside `applySkillEffects`, in the per-target loop, right before calling `resolveSkillEffect` for that effect: `if (effect.chance !== undefined && ctx.rng.next() >= effect.chance) continue;` — skips just that effect for just that target, without affecting other effects in the same skill.
- AoE: each target in the list rolls `chance` independently.

### 4.2 On-hit rider buffs (`StatusEffectDefinition.onHitStatusEffectId`)
Used for Poison Coat (Rogue): a self-buff that doesn't deal damage on its own, but causes the actor's subsequent `damage` hits to automatically apply poison to whatever they hit.
- An optional field on `StatusEffectDefinition`: `onHitStatusEffectId?: Id`.
- Inside `applySkillEffects`, after a `kind: "damage"` effect is successfully resolved against a target (the target still exists, not necessarily still alive): check `source.activeStatusEffects` (only when `isCharacter(source)`) for any status with `onHitStatusEffectId` set → if found, additionally call `resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: def.onHitStatusEffectId }, source, target, ctx)`.
- No limit on how many statuses with this field an actor can carry at once (loops over all `activeStatusEffects`).
- Doesn't interact with the §4.1 `chance` proc — the rider always applies if the original `damage` effect applied successfully (no second roll).

### 4.3 Stun — skipping a turn (`StatusEffectDefinition.stuns`)
Used for the "stunned" effect (Mage's Lightning Bolt/Lightning Storm).
- An optional field on `StatusEffectDefinition`: `stuns?: boolean`.
- At the start of `runCharacterTurn` and `runMonsterTurn`, before fetching the `QueuedAction`/picking an AI action: if `actor.activeStatusEffects` has any status with `stuns: true` currently active → log a skipped turn, `return`, without executing any action — this applies to **monsters too**.
- The status isn't automatically removed just because it caused a skipped turn — `tickStatusEffects` at the end of the round still processes `turnsRemaining` as normal.

### 4.4 Dual-side skills — different effects for ally/enemy (`SkillDefinition.effectsByRelation` + 2 new `SkillTarget` values)
Used for Acolyte's Purify (choose one of two sides) and Divine Descent (both sides at once).
- 2 `SkillTarget` values cover this: `"singleAllyOrEnemy"` (Purify — the player picks a single target, which can be an ally or an enemy) and `"allAlliesAndEnemies"` (Divine Descent — automatically targets everyone on both sides).
- `SkillDefinition.effects` is optional; `effectsByRelation?: { ally: SkillEffect[]; enemy: SkillEffect[] }` replaces it when present — a skill with `effectsByRelation` ignores `effects`.
- `autoResolveTargets`: for `"allAlliesAndEnemies"` → returns the union of all living characters + monsters; for `"singleAllyOrEnemy"` → returns `null` just like `singleEnemy`/`singleAlly` (forcing the UI to prompt).
- `resolveExecutionTargets`: for `"singleAllyOrEnemy"` — if the original target died, redirect according to the original target's type (if it was a monster → redirect like `singleEnemy`; if it was a character → fizzle like `singleAlly`). For `"allAlliesAndEnemies"` — filter dead entries out of the combined list.
- `applySkillEffects`: if `skill.effectsByRelation` exists, the effect list for each target = `isCharacter(target) ? effectsByRelation.ally : effectsByRelation.enemy`.
- The AoE accuracy roll (`gameplay-decisions/04-fear-combat.md` §4.1) applies to the `enemy` half of both skills; the `ally` half doesn't roll.

### 4.5 Ultimate: always hits + its own fear-based effectiveness multiplier (`SkillDefinition.isUltimate`)
- An optional field on `SkillDefinition`: `isUltimate?: boolean` — completely separate from `usesPerCombat`; ultimates use `cooldownTurns` (§4.6) instead of a use-count limit.
- `runCharacterTurn`: if `skill.isUltimate`, skips the `rollHits`/`getFearAccuracyPenalty` branch entirely.
- `applySkillEffects`: if `skill.isUltimate` and `isCharacter(source)`, multiplies every `damage`/`heal` effect's `effect.amount` by a coefficient looked up from `ultimateEffectivenessMultiplier(fear)` (`src/engine/combat.ts`, keyed off the caster's fear tier) before passing it to `resolveSkillEffect` — 2 separate fear-based weakening mechanisms run in parallel for 2 different skill groups: ultimates use their own multiplier function here, regular skills use `getFearDamagePenalty` (`gameplay-decisions/04-fear-combat.md` §4).

### 4.6 Per-turn cooldown (`SkillDefinition.cooldownTurns` + `Character.cooldownsRemaining`)
`usesPerCombat` isn't used by any skill in the current `data/classes.json` — every skill (including ultimates) uses `cooldownTurns` instead. `usesPerCombat`/`Character.usesRemainingThisCombat` still exist in the type/code, reserved for consumable items (`gameplay-decisions/07-items-artifacts.md` §7).
- An optional field on `SkillDefinition`: `cooldownTurns?: number`.
- A field on `Character` (mirroring `usesRemainingThisCombat`): `cooldownsRemaining: Record<Id, number>` — initialized to `{}` in `createCharacter`, reset to `{}` in `startCombat` — doesn't carry over between combats.
- `queueAction`: blocks if `(actor.cooldownsRemaining[skillId] ?? 0) > 0`. When queueing succeeds and `skill.cooldownTurns` has a value, sets `actor.cooldownsRemaining[skillId] = skill.cooldownTurns` (at the same time MP is deducted, in the command phase).
- Decrementing: at the end of every round, every entry `> 0` in `cooldownsRemaining` for every living actor → subtract 1 (floored at 0).
- Convention for assigning `cooldownTurns` (`gameplay-decisions/01-class-skill.md` §1.5): for skills with `isBuff: true` (Shield Guard, Rally, Poison Coat) → `cooldownTurns = the main status's durationTurns + 1`; damage/utility skills are assigned by hand; ultimates share a fixed value across every class (see `data/classes.json`).

### 4.7 Buffs always act first in the round — `SkillDefinition.isBuff` + a temporary speed bonus for turn-order calculation
Used for Shield Guard, Rally (Vanguard), Poison Coat (Rogue) — the skills marked `isBuff: true`.

- An optional field on `SkillDefinition`: `isBuff?: boolean`.
- `buildTurnQueue`: when computing the sort key for a character combatant (`turnOrderSortKey`, `src/engine/combat.ts`), checks `combat.queuedActions` to see if that actor has a `QueuedAction` pointing at a skill with `isBuff: true` → if so, uses a boosted sort key instead of `actor.speed` (the bonus is a bare inline literal added to `speed` in `turnOrderSortKey`, not extracted to a named constant). This does **not** overwrite the actor's real `speed` — it's only a temporary value used for sorting, discarded as soon as `turnQueue` is built.
- Has no effect on monsters (monsters don't pre-queue).
- If several characters use an `isBuff: true` skill in the same round, all get the same boost — ties are still broken by the old rule (equal `speed` → characters before monsters, then original order within `combatants`).

---

## 5. Elite/Boss skill kit (`gameplay-decisions/06-level-system.md` §6.12)

- **`applySkillEffects` is reused as-is** (written for characters) directly for monsters — this function is generic over `Actor` (`isCharacter(source)` branches internally), and `rollHits` always returns `true` when the source isn't a character, so monsters using skills still preserve the "monsters always hit" invariant with no changes needed in the resolver.
- **Monster skills don't go through `queueAction`** — no MP cost, no `cooldownsRemaining` tracking, no "commit first, resolve by speed later" like characters. `runMonsterTurn` calls `applySkillEffects` directly at the monster's exact turn in `turnQueue`.
- **Data**: `data/monster-skills.json` (parallel to `data/classes.json`, but flat — not grouped by class) + `getMonsterSkill(id)` in `src/data/monsters.ts`. Reuses the `SkillDefinition` type as-is — `mpCost`/`slot`/`unlockLevel` are ignored when resolving, keeping placeholder values. Every guard-room archetype gets its own strike/cleave/execute/debuff set (`data/monster-skills.json`).
- **`MonsterArchetype.eliteSkillIds`/`bossSkillIds`** (optional): for any archetype that doesn't set these, its elite/boss tier falls back to a basic attack. `MonsterArchetype.guardOnly?: boolean` marks an archetype as only eligible to be picked as a guard-room monster, never appearing in normal combat rooms (`src/data/floor.ts`, `GUARD_ROOM_ARCHETYPES`/`COMBAT_ROOM_ARCHETYPES`) — a guard room does `rng.pick(GUARD_ROOM_ARCHETYPES)`, randomly picking one of the guard-room archetypes each time it's built.
- **`runMonsterTurn`** branches by `actor.tier` before reaching the old targeting logic (`pickMonsterTarget`, shared by both regular monsters and the Elite/Boss Strike skill). If it's not a charge/release turn: decrement `executeCooldownTurns`, then the actual action (Debuff/Cleave/Strike, or a regular monster's own skill/basic attack) is picked in one shot by `pickMonsterAction` — a single weighted random choice over whichever candidates are currently eligible (filtered by tier and by which archetype fields are set), not a sequence of independent per-action rolls with a fallback. Debuff uses a different status depending on archetype — see `data/monster-skills.json`. No skill/archetype names are hardcoded in `combat.ts`. The weights themselves are **not** in `combat.ts` — they're per-archetype data, field `actionWeights` in `data/monsters.json`.
- **Execute — a 2-turn charge instead of an %HP trigger**: state on `Monster` — `executeCooldownTurns` (initialized to `EXECUTE_COOLDOWN_TURNS` on spawn — `data/balance-config.json` field `combat.executeCooldownTurns`, re-exported in `src/data/monsters.ts`, boss tier only), `isChargingExecute`, `executeTargetId`. Every boss turn (at the very start of `runMonsterTurn`, before even the Debuff/Cleave branch):
  1. If `isChargingExecute === true` → read `executeTargetId` (falling back to `pickAggroWeighted` if the target died in between the two turns), call `applySkillEffects` with the correct archetype's execute skill (`data/monster-skills.json`), reset `isChargingExecute = false`, `executeTargetId = undefined`, `executeCooldownTurns = EXECUTE_COOLDOWN_TURNS`, then `return`.
  2. Otherwise, if `executeCooldownTurns <= 0` → call `pickAggroWeighted` to lock in a target right away (writing to `executeTargetId`, setting `isChargingExecute = true`), log a warning, `return` **without dealing damage** — that whole turn is just spent charging.
  3. Otherwise → decrement `executeCooldownTurns`, continue on to the Debuff/Cleave/Strike branch as before.
  - The target is chosen once during the charging step (step 2) and read back unchanged when the attack lands (step 1) — changing `aggro` after it's locked in has no effect, unless it's done before the charging turn in the same round (thanks to the buff speed-boost rule, §4.7).
  - The `hasStunningStatus` check at the start of `runMonsterTurn` still runs before all of the above — if the boss is stunned on the very turn it would have unleashed Execute, `isChargingExecute` stays `true` (the turn is skipped entirely), and the attack still lands on the following turn if it isn't stunned then — a stun delays the attack rather than cancelling an already-charged one.
