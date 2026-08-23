# §1. Class & Skill

*(section 1 of `00-index.md` — see that file for the full table of contents)*

Each class has a shared basic attack (slot 0) + several class-specific skills, plus 4 engine mechanics (percentage-based procs, self-buffs applied on a successful hit, stun that skips a turn, and skills whose effect differs depending on the target's side), and cooldowns measured in turns for some of the stronger skills.

**Source of truth for every number below**: `data/classes.json`. This document describes the *shape* of each class's kit (which stat/target/mechanic each skill uses) — not the actual MP costs, damage/heal amounts, proc chances, or cooldown lengths, which live only in the JSON and get tuned there without needing a doc update.

**Naming convention**: every `id`/`name` for classes, skills, and status effects is in **English**, matching `data/classes.json`/`data/status-effects.json`/`data/monsters.json`. The descriptive/explanatory text in this document follows suit in English.

### Stat shape (level 1)

Class stats: **attack** (`attack`), **magic power** (`magicPower` — see section 1.6 right below), **defense** (`defense`), **HP** (`maxHp`), **mana** (`maxMp`), **aggro** (`aggro` — the weight used when a monster picks its target, see `02-monster.md` section 2), **speed** (`speed` — priority for acting first, see `docs/technical-decisions.md` §2). Level-1 values for all 4 classes: `data/classes.json`.

- Vanguard has the highest `aggro` + `defense` + `maxHp`, and the lowest `speed` (a tank that acts late).
- Mage has the lowest stats across the board on defense/aggro but decent `speed`, and is the only class with low `attack` and the highest `magicPower` — Mage's damage carry comes from its spell skills (section 1.6), not its basic attack.
- Rogue has the highest `speed`/`attack`, low `defense`, and no `magicPower` (purely physical).
- Acolyte is balanced, with average `aggro` and decent `magicPower` (healing + secondary damage, lower than Mage's).

#### The `magicPower` stat and the `isMagic` flag

Any skill whose `damage`/`heal` is "magical" in nature (Mage's fire/lightning/ice elements, Acolyte's holy heal/purge) is flagged `isMagic: true` in `data/classes.json`. When the resolver computes damage/healing for an `isMagic` skill, it uses the caster's `source.magicPower` in place of `source.attack` — only the offense side of the formula changes; how defense is subtracted stays the same (full mitigation formula details: `docs/technical-decisions.md`, section "Handling by `effect.kind`"). Skills not flagged `isMagic` (every class's basic attack, all of Vanguard's/Rogue's skills, Purify's damage — enemy branch only) use `attack` as normal. Which skills carry `isMagic: true` for each class: `data/classes.json`.

`magicPower` grows by level along the same tapered curve shared with `attack`/`defense`/`maxHp`/`maxMp` (`06-level-system.md` §6.3), multiplied by a class-specific `growthWeights.magicPower` — see `06-level-system.md` §6.8.

The first class-specific skills are unlocked at level 1 (on top of the always-available basic attack), the rest unlock gradually via each skill's `unlockLevel` field. `slot`/`unlockLevel`/`cooldownTurns` match the field of the same name in `SkillDefinition` (see `docs/technical-decisions.md` §4) — `usesPerCombat` is not used for character skills (section 1.5, last bullet, "Design notes").

### 1.0 Basic attack (every class, slot 0)

Free (`mpCost 0`), always available from level 1, unlimited uses, no cooldown, `target: singleEnemy`, a flat `damage` effect with `amount: 0` → damage comes entirely from `mitigatedOffense(attack, defense)` (the mitigation formula, `docs/technical-decisions.md`), true "baseline damage" (identical to the monster basic-attack formula). Name/weapon depend on class, with no mechanical purpose beyond being a free fallback when out of MP:

| Class | Weapon | Skill id | Basic attack name |
|---|---|---|---|
| Vanguard | Sword | `vanguard-slash` | Slash |
| Rogue | Knife | `rogue-stab` | Stab |
| Mage | Staff | `mage-bludgeon` | Bludgeon |
| Acolyte | Bare hands | `acolyte-punch` | Punch |

### 1.1 Vanguard — tank, damage sponge, holds monster attention

| Slot | Skill id | Name | Target | Effect (shape) | Buff? |
|---|---|---|---|---|---|
| 1 | `vanguard-shield-guard` | Shield Guard | self | `applyStatusEffect "guard"` (temporary defense buff) **+** `applyStatusEffect "taunt"` (temporary aggro buff) — 2 independent statuses, applied together | ✅ |
| 2 | `vanguard-shield-throw` | Shield Throw | singleEnemy | `damage` | — |
| 3 | `vanguard-rally` | Rally | allAllies | `modifyStat fear` (instant, whole party) + `applyStatusEffect "rally"` (temporary attack buff, whole party) | ✅ |
| 4 | `vanguard-heavy-charge` | Heavy Charge | allEnemies | `damage`/enemy — accuracy rolled **separately per enemy** (`04-fear-combat.md` section 4) | — |
| 5 | `vanguard-sword-judgment` | Sword Judgment | singleEnemy | `damage` — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — |

*Shield Guard carries both the "aggro draw" role and the "defense" role, while Rally is a whole-party buff rather than just self-taunt. The "Buff?" column marks skills that receive `isBuff: true` — see the `durationTurns`/cooldown/speed rules specific to buffs in section 1.5 and `docs/technical-decisions.md` §4.7. MP costs, damage/heal amounts, and cooldown lengths: `data/classes.json`.*

### 1.2 Mage — ranged magic damage, fragile; fire/lightning/ice school

| Slot | Skill id | Name | Target | Effect (shape) | Buff? |
|---|---|---|---|---|---|
| 1 | `mage-fireball` | Fireball | singleEnemy | `damage` + chance to `applyStatusEffect "burning"` | — |
| 2 | `mage-lightning-bolt` | Lightning Bolt | singleEnemy | `damage` + chance to `applyStatusEffect "stunned"` | — |
| 3 | `mage-fire-pillar` | Fire Pillar | allEnemies | `damage`/enemy + chance to `applyStatusEffect "burning"` **per enemy** (rolled separately for each target, both accuracy and proc) | — |
| 4 | `mage-lightning-storm` | Lightning Storm | allEnemies | `damage`/enemy + chance to `applyStatusEffect "stunned"` **per enemy** | — |
| 5 | `mage-ice-age` | Ice Age | allEnemies | `damage`/enemy — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — |

*Mage is purely fire/lightning/ice, with a kit focused on damage plus burn/stun procs. Bludgeon (slot 0) covers the "free action when out of mana" role. MP costs, damage amounts, and proc chances: `data/classes.json`.*

### 1.3 Rogue — single-target burst, highest speed in the party

| Slot | Skill id | Name | Target | Effect (shape) | Buff? |
|---|---|---|---|---|---|
| 1 | `rogue-poison-coat` | Poison Coat | self | `applyStatusEffect "poison-coat"` (self-buff, **does not** deal damage itself — every `damage` effect this actor deals while the buff is active automatically carries `applyStatusEffect "poisoned"` onto the target hit; see "on-hit rider" in `docs/technical-decisions.md` §4.2) | ✅ |
| 2 | `rogue-knife-throw` | Knife Throw | singleEnemy | `damage` | — |
| 3 | `rogue-backstab` | Backstab | singleEnemy | `damage` | — |
| 4 | `rogue-poison-bomb` | Poison Bomb | allEnemies | `applyStatusEffect "poisoned"` per enemy — accuracy rolled separately per enemy | — |
| 5 | `rogue-flurry-assault` | Flurry Assault | singleEnemy | several consecutive `damage` hits — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — |

*Poison Coat is a self-buff that "coats the weapon in poison" — its value comes indirectly through subsequent hits. Rogue has no dedicated defensive skill — the kit is 100% offense/debuff. MP costs, damage amounts, and cooldowns: `data/classes.json`.*

**On Poison Coat and the "buffs are always 1 turn" rule**: `poison-coat` is **not** forced down to a 1-turn duration the way Shield Guard/Rally are, even though it is also a self-buff — see `data/status-effects.json` for its actual `durationTurns`. `poison-coat` carries no `modifyCombatStat` — it's a buff-rider (it toggles the "attacks auto-apply poison" mechanic). Its cooldown follows the shared "duration + 1" formula (§1.5, "Design notes").

### 1.4 Acolyte — healing + team-wide fear reduction

| Slot | Skill id | Name | Target | Effect (shape) | Buff? |
|---|---|---|---|---|---|
| 1 | `acolyte-prayer` | Prayer | singleAlly | `modifyStat fear` | — |
| 2 | `acolyte-heal` | Heal | singleAlly | `heal` | — |
| 3 | `acolyte-purify` | Purify | **singleAlly OR singleEnemy** (the player chooses the side when targeting) | targeting an ally → `removeStatusEffect` (strips 1 debuff); targeting an enemy → `damage` | — |
| 4 | `acolyte-mass-heal` | Mass Heal | allAllies | `heal` + `modifyStat fear` | — |
| 5 | `acolyte-divine-descent` | Divine Descent | **allAllies AND allEnemies at once** | allies → `heal` + `modifyStat fear`; enemies → `damage` — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — |

*None of Acolyte's skills are marked "Buff?" — `modifyStat fear` is an instant adjustment, not routed through `applyStatusEffect`/`durationTurns`.*

*Acolyte does have real damage options (Purify targeting an enemy, Divine Descent, and the Punch basic attack) alongside its primary healer role. MP costs, heal/damage amounts, and cooldowns: `data/classes.json`.*

### 1.5 Status Effects — summary table & full effects

The statuses currently used by the character skill kits in sections 1.1-1.4 (English id/name, matching `data/status-effects.json`):

| id | Name | Type | Effect (`perTurnEffects` / special field) | Curable via mini-game | Used by |
|---|---|---|---|---|---|
| `guard` | Guard | Buff | `modifyCombatStat defense` | — (buffs don't need "curing") | Shield Guard (Vanguard) |
| `taunt` | Taunt | Buff | `modifyCombatStat aggro` | — | Shield Guard (Vanguard) |
| `rally` | Rally | Buff | `modifyCombatStat attack` | — | Rally (Vanguard) |
| `poison-coat` | Poison Coat | Buff (rider, not a stat-buff) | no `perTurnEffects`; field `onHitStatusEffectId: "poisoned"` — see `docs/technical-decisions.md` §4.2 | — | Poison Coat (Rogue) |
| `poisoned` | Poisoned | Debuff | `damage`/turn | Snake mini-game | on-hit rider of Poison Coat; Poison Bomb (Rogue) |
| `burning` | Burning | Debuff | `damage`/turn | Not curable via mini-game (intentional — distinguishes it from Poisoned) | Fireball, Fire Pillar (Mage) |
| `stunned` | Stunned | Control (debuff) | no ordinary `perTurnEffects`; field `stuns: true` — see `docs/technical-decisions.md` §4.3 | Not curable via mini-game | Lightning Bolt, Lightning Storm (Mage) |

Exact magnitudes/durations/proc chances for every row above: `data/status-effects.json`.

**Default `durationTurns` convention**: `applyStatusEffectToActor` (`resolver.ts`) falls back to a default of 1 turn when a status doesn't declare `durationTurns` in `data/status-effects.json`.
- **Buffs (carrying `modifyCombatStat`, applied by the actor to itself/allies)**: default to that 1-turn fallback, matching the "buffs are always 1 turn" rule — no need to explicitly set `durationTurns` in JSON if it's 1, though it's still good practice to write it for clarity.
- **Debuffs/control effects (Poisoned, Burning, Stunned) and buff-riders that aren't stat-buffs (Poison Coat)**: **must always declare `durationTurns` explicitly**, never relying on the default.

Beyond these, `weakened` (`modifyCombatStat defense`, a debuff) is used exclusively by Elite/Boss skills (`06-level-system.md` §6.12) — it is not part of the character skill kits covered in this section.

### Design notes
- Each class has exactly 1 "ultimate" skill in slot 5 — it **always hits, with no accuracy roll**, but its effectiveness (damage/heal) scales down by fear tier via a dedicated formula, replacing the usual hit/miss roll + flat damage-reduction combo used by ordinary skills (`04-fear-combat.md` section 4). Ultimates use `isUltimate: true` and share a fixed `cooldownTurns` across every class (`data/classes.json`) — they do not use `usesPerCombat` (see the last bullet below).
- `modifyCombatStat` (attack/defense/aggro/speed buffs/debuffs) is always routed through `applyStatusEffect` — there is no effect that adjusts a combat stat instantly or permanently; all of them carry `durationTurns` on `StatusEffectDefinition`.
- `StatusEffectDefinition` is shared by both buffs (e.g. "guard") and debuffs (e.g. "poisoned"): buffs set `curableByMiniGame: []` and expire via `durationTurns`; true debuffs have a non-empty `curableByMiniGame`. Full table + default-duration convention: section 1.5.
- **Skills with a `chance` on 1 effect** (e.g. Fireball's burn proc) only roll for that specific effect, separate from the skill's overall accuracy roll — the main `damage` effect still always applies if the skill hits; only the secondary (proc) effect is probabilistic.
- **AoE skills** (`allEnemies`, or the "enemy" half of a two-sided skill): accuracy is rolled **separately for each target**, not once for the whole skill — one enemy dodging doesn't mean the whole group dodges.
- **Two-sided skills** (Purify, Divine Descent): the effect applied depends on whether the target is an ally or an enemy, rather than sharing one effect list — see `effectsByRelation` in `docs/technical-decisions.md` §4.
- **Cooldown** (`cooldownTurns`): every class-specific skill beyond the first two slots has a cooldown (slots 1-2 have none). 2 formulas:
  - **Buff skills** (`isBuff: true` — Shield Guard, Rally, Poison Coat): `cooldownTurns = the main status's durationTurns + 1`.
  - **Other damage/utility skills + ultimates**: assigned by hand based on power level, not a fixed formula (ultimates share one fixed value across classes — `data/classes.json`).
- `usesPerCombat` is not used by any character skill — every skill uses `cooldownTurns`, including ultimates. The field still exists on `SkillDefinition`/`ItemDefinition` for Items (`07-items-artifacts.md` §7).
- **Buff skills always grant a temporary speed bonus** for turn-order purposes in the round they're used (the bonus amount: `src/engine/combat.ts`). This applies only to the skills marked "Buff?" in each class's table (Shield Guard, Rally, Poison Coat) — not to support skills that don't carry a status (Prayer, Heal, Mass Heal for Acolyte adjust instantly, without going through `applyStatusEffect`). This is a temporary bonus only for ordering turns within the current round — it is not added to the character's base `speed` — technical design in `docs/technical-decisions.md` §4.7.
