# §1. Class & Skill

*(section 1 of `00-index.md` — see that file for the full table of contents)*

Each class has **6 skills = 1 shared basic attack (slot 0) + 5 class-specific skills**, plus 4 engine mechanics (percentage-based procs, self-buffs applied on a successful hit, stun that skips a turn, and skills whose effect differs depending on the target's side), and cooldowns measured in turns for some of the stronger skills.

**Naming convention**: every `id`/`name` for classes, skills, and status effects is in **English**, matching `data/classes.json`/`data/status-effects.json`/`data/monsters.json`. The descriptive/explanatory text in this document follows suit in English.

### Stat table (level 1)

7 class stats: **attack** (`attack`), **magic power** (`magicPower` — see section 1.6 right below), **defense** (`defense`), **HP** (`maxHp`), **mana** (`maxMp`), **aggro** (`aggro` — the weight used when a monster picks its target, see `02-monster.md` section 2), **speed** (`speed` — priority for acting first, see `docs/technical-decisions.md` §2).

| Class | attack | magicPower | defense | maxHp | maxMp | aggro | speed |
|---|---|---|---|---|---|---|---|
| Vanguard | 14 | 0 | 10 | 140 | 20 | 20 | 8 |
| Mage | 6 | 14 | 4 | 70 | 60 | 8 | 10 |
| Rogue | 16 | 0 | 6 | 90 | 30 | 10 | 16 |
| Acolyte | 6 | 10 | 8 | 100 | 50 | 12 | 9 |

- Vanguard has the highest `aggro` + `defense` + `maxHp`, and the lowest `speed` (a tank that acts late).
- Mage has the lowest stats across the board on defense/aggro but decent `speed`, and is the only class with low `attack` and the highest `magicPower` — Mage's damage carry comes from its spell skills (section 1.6), not its basic attack.
- Rogue has the highest `speed`/`attack`, low `defense`, and `magicPower` of 0 (purely physical).
- Acolyte is balanced, with average `aggro` and decent `magicPower` (healing + secondary damage, lower than Mage's).

#### The `magicPower` stat and the `isMagic` flag

Any skill whose `damage`/`heal` is "magical" in nature (Mage's fire/lightning/ice elements, Acolyte's holy heal/purge) is flagged `isMagic: true` in `data/classes.json`. When the resolver computes damage/healing for an `isMagic` skill, it uses the caster's `source.magicPower` in place of `source.attack` — only the offense side of the formula changes; how defense is subtracted stays the same (full mitigation formula details: `docs/technical-decisions.md`, section "Handling by `effect.kind`"). Skills not flagged `isMagic` (every class's basic attack, all of Vanguard's/Rogue's skills, Purify's damage — enemy branch only) use `attack` as normal.

List of skills flagged `isMagic: true`:

| Class | Skill |
|---|---|
| Mage | Fireball, Lightning Bolt, Fire Pillar, Lightning Storm, Ice Age (all 5 class-specific skills — excluding only the basic attack Bludgeon) |
| Acolyte | Heal, Purify, Mass Heal, Divine Descent (all 4 class-specific skills that deal heal/damage — excluding the basic attack Punch and Prayer, which have no `damage`/`heal` effect) |

`magicPower` grows by level along the same tapered 5-tier curve shared with `attack`/`defense`/`maxHp`/`maxMp` (`06-level-system.md` §6.3), multiplied by a class-specific `growthWeights.magicPower` — see the full weight budget table in `06-level-system.md` §6.8.

The first 2 class-specific skills are unlocked at level 1 (on top of the always-available basic attack), and the remaining 3 unlock gradually at levels **10/20/35**. `slot`/`unlockLevel`/`cooldownTurns` match the field of the same name in `SkillDefinition` (see `docs/technical-decisions.md` §4) — `usesPerCombat` is not used for character skills (section 1.5, last bullet, "Design notes").

### 1.0 Basic attack (every class, slot 0)

Free (`mpCost 0`), always available from level 1, unlimited uses, no cooldown, `target: singleEnemy`, `effects: [{ kind: "damage", amount: 0 }]` → damage = `max(1, round(mitigatedOffense(attack, defense)))` (the mitigation formula, `docs/technical-decisions.md`), true "baseline damage" (identical to the monster basic-attack formula). Name/weapon depend on class, with no mechanical purpose beyond being a free fallback when out of MP:

| Class | Weapon | Skill id | Basic attack name |
|---|---|---|---|
| Vanguard | Sword | `vanguard-slash` | Slash |
| Rogue | Knife | `rogue-stab` | Stab |
| Mage | Staff | `mage-bludgeon` | Bludgeon |
| Acolyte | Bare hands | `acolyte-punch` | Punch |

### 1.1 Vanguard — tank, damage sponge, holds monster attention

| Slot | Lvl | Skill id | Name | MP | Target | Effect | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `vanguard-shield-guard` | Shield Guard | 8 | self | `applyStatusEffect "guard"` (+6 def, 1 turn) **+** `applyStatusEffect "taunt"` (+40 aggro, 1 turn) — 2 independent statuses, applied together | ✅ | 2 turns |
| 2 | 1 | `vanguard-shield-throw` | Shield Throw | 5 | singleEnemy | `damage 10` | — | — |
| 3 | 10 | `vanguard-rally` | Rally | 12 | allAllies | `modifyStat fear -8` (instant, whole party) + `applyStatusEffect "rally"` (+4 attack, 1 turn, whole party) | ✅ | 2 turns |
| 4 | 20 | `vanguard-heavy-charge` | Heavy Charge | 14 | allEnemies | `damage 12`/enemy — accuracy rolled **separately per enemy** (`04-fear-combat.md` section 4) | — | 3 turns |
| 5 | 35 | `vanguard-sword-judgment` | Sword Judgment | 14 | singleEnemy | `damage 30` — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — | 5 turns |

*Shield Guard carries both the "aggro draw" role and the "defense" role, while Rally is a whole-party buff rather than just self-taunt. The "Buff?" column marks skills that receive `isBuff: true` — see the `durationTurns`/cooldown/speed rules specific to buffs in section 1.5 and `docs/technical-decisions.md` §4.7.*

### 1.2 Mage — ranged magic damage, fragile; fire/lightning/ice school

| Slot | Lvl | Skill id | Name | MP | Target | Effect | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `mage-fireball` | Fireball | 5 | singleEnemy | `damage 10` + 30% `applyStatusEffect "burning"` (2 turns) | — | — |
| 2 | 1 | `mage-lightning-bolt` | Lightning Bolt | 6 | singleEnemy | `damage 12` + 20% `applyStatusEffect "stunned"` (1 turn) | — | — |
| 3 | 10 | `mage-fire-pillar` | Fire Pillar | 14 | allEnemies | `damage 12`/enemy + 50% `applyStatusEffect "burning"` (2 turns) **per enemy** (rolled separately for each target, both accuracy and proc) | — | 2 turns |
| 4 | 20 | `mage-lightning-storm` | Lightning Storm | 16 | allEnemies | `damage 13`/enemy + 30% `applyStatusEffect "stunned"` (1 turn) **per enemy** | — | 3 turns |
| 5 | 35 | `mage-ice-age` | Ice Age | 20 | allEnemies | `damage 22`/enemy — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — | 5 turns |

*Mage is purely fire/lightning/ice, with a kit focused on damage plus burn/stun procs. Bludgeon (slot 0) covers the "free action when out of mana" role.*

### 1.3 Rogue — single-target burst, highest speed in the party

| Slot | Lvl | Skill id | Name | MP | Target | Effect | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `rogue-poison-coat` | Poison Coat | 3 | self | `applyStatusEffect "poison-coat"` (self-buff, 3 turns, **does not** deal damage itself — every `damage` effect this actor deals while the buff is active automatically carries `applyStatusEffect "poisoned"` onto the target hit; see "on-hit rider" in `docs/technical-decisions.md` §4) | ✅ | 4 turns |
| 2 | 1 | `rogue-knife-throw` | Knife Throw | 4 | singleEnemy | `damage 12` | — | — |
| 3 | 10 | `rogue-backstab` | Backstab | 8 | singleEnemy | `damage 20` | — | 1 turn |
| 4 | 20 | `rogue-poison-bomb` | Poison Bomb | 10 | allEnemies | `applyStatusEffect "poisoned"` per enemy — accuracy rolled separately per enemy | — | 3 turns |
| 5 | 35 | `rogue-flurry-assault` | Flurry Assault | 16 | singleEnemy | `damage 12` × 3 (consecutive) — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — | 5 turns |

*Poison Coat is a self-buff that "coats the weapon in poison" — its value comes indirectly through subsequent hits, at an mp cost of 3. Rogue has no dedicated defensive skill — the kit is 100% offense/debuff.*

**On Poison Coat and the "buffs are always 1 turn" rule**: `poison-coat` is **not** forced down to 1 turn the way Shield Guard/Rally are, even though it is also a self-buff. `poison-coat` carries no `modifyCombatStat` — it's a buff-rider (it toggles the "attacks auto-apply poison" mechanic). Its 4-turn cooldown follows the shared "duration + 1" formula (3+1).

### 1.4 Acolyte — healing + team-wide fear reduction

| Slot | Lvl | Skill id | Name | MP | Target | Effect | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `acolyte-prayer` | Prayer | 4 | singleAlly | `modifyStat fear -10` | — | — |
| 2 | 1 | `acolyte-heal` | Heal | 6 | singleAlly | `heal 16` | — | — |
| 3 | 10 | `acolyte-purify` | Purify | 9 | **singleAlly OR singleEnemy** (the player chooses the side when targeting) | targeting an ally → `removeStatusEffect` (strips 1 debuff); targeting an enemy → `damage 15` | — | 1 turn |
| 4 | 20 | `acolyte-mass-heal` | Mass Heal | 10 | allAllies | `heal 10` + `modifyStat fear -6` | — | 2 turns |
| 5 | 35 | `acolyte-divine-descent` | Divine Descent | 20 | **allAllies AND allEnemies at once** | allies → `heal 25` + `modifyStat fear -15`; enemies → `damage 20` — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — | 5 turns |

*None of Acolyte's skills are marked "Buff?" — `modifyStat fear` is an instant adjustment, not routed through `applyStatusEffect`/`durationTurns`.*

*Acolyte does have real damage options (Purify targeting an enemy, Divine Descent, and the Punch basic attack) alongside its primary healer role.*

### 1.5 Status Effects — summary table & full effects

7 statuses currently used by the 6-skill-per-class kits in sections 1.1-1.4 (English id/name, matching `data/status-effects.json`):

| id | Name | Type | Effect (`perTurnEffects` / special field) | Duration | Curable via mini-game | Used by |
|---|---|---|---|---|---|---|
| `guard` | Guard | Buff | `modifyCombatStat defense +6` | 1 turn | — (buffs don't need "curing") | Shield Guard (Vanguard) |
| `taunt` | Taunt | Buff | `modifyCombatStat aggro +40` | 1 turn | — | Shield Guard (Vanguard) |
| `rally` | Rally | Buff | `modifyCombatStat attack +4` | 1 turn | — | Rally (Vanguard) |
| `poison-coat` | Poison Coat | Buff (rider, not a stat-buff) | no `perTurnEffects`; field `onHitStatusEffectId: "poisoned"` — see `docs/technical-decisions.md` §4.2 | 3 turns (exception, see note in section 1.3) | — | Poison Coat (Rogue) |
| `poisoned` | Poisoned | Debuff | `damage 4`/turn | 3 turns | Snake, `clearScore 8` | on-hit rider of Poison Coat; Poison Bomb (Rogue) |
| `burning` | Burning | Debuff | `damage 5`/turn | 2 turns | Not curable via mini-game (intentional — distinguishes it from Poisoned) | Fireball 30%, Fire Pillar 50% (Mage) |
| `stunned` | Stunned | Control (debuff) | no ordinary `perTurnEffects`; field `stuns: true` — see `docs/technical-decisions.md` §4.3 | 1 turn | Not curable via mini-game | Lightning Bolt 20%, Lightning Storm 30% (Mage) |

**Default `durationTurns` convention**: `applyStatusEffectToActor` (`resolver.ts`) uses `def.durationTurns ?? 1`, meaning any status that doesn't declare `durationTurns` is implicitly **1 turn**.
- **Buffs (carrying `modifyCombatStat`, applied by the actor to itself/allies)**: **default 1 turn**, matching the "buffs are always 1 turn" rule — no need to explicitly set `durationTurns` in JSON if it's 1, though it's still good practice to write it for clarity.
- **Debuffs/control effects (Poisoned, Burning, Stunned) and buff-riders that aren't stat-buffs (Poison Coat)**: **must always declare `durationTurns` explicitly**, never relying on the default.

Beyond these 7 statuses, `weakened` (`modifyCombatStat defense -6`, 2 turns) is used exclusively by Elite/Boss skills (`06-level-system.md` §6.12) — it is not part of the character skill kits covered in this section.

### Design notes
- Each class has exactly 1 "ultimate" skill in slot 5 — it **always hits, with no accuracy roll**, but its effectiveness (damage/heal) scales down by fear tier via a dedicated formula, replacing the usual hit/miss roll + 15% damage reduction combo used by ordinary skills (`04-fear-combat.md` section 4). Ultimates use `isUltimate: true` + `cooldownTurns: 5` — they do not use `usesPerCombat` (see the last bullet below).
- `modifyCombatStat` (attack/defense/aggro/speed buffs/debuffs) is always routed through `applyStatusEffect` — there is no effect that adjusts a combat stat instantly or permanently; all of them carry `durationTurns` on `StatusEffectDefinition`.
- `StatusEffectDefinition` is shared by both buffs (e.g. "guard") and debuffs (e.g. "poisoned"): buffs set `curableByMiniGame: []` and expire via `durationTurns`; true debuffs have a non-empty `curableByMiniGame`. Full table + default-duration convention: section 1.5.
- **Skills with a `chance` on 1 effect** (e.g. Fireball's 30% burn) only roll for that specific effect, separate from the skill's overall accuracy roll — the main `damage` effect still always applies if the skill hits; only the secondary (proc) effect is probabilistic.
- **AoE skills** (`allEnemies`, or the "enemy" half of a two-sided skill): accuracy is rolled **separately for each target**, not once for the whole skill — one enemy dodging doesn't mean the whole group dodges.
- **Two-sided skills** (Purify, Divine Descent): the effect applied depends on whether the target is an ally or an enemy, rather than sharing one effect list — see `effectsByRelation` in `docs/technical-decisions.md` §4.
- **Cooldown** (`cooldownTurns`): every class-specific skill in slots 3-5 has a cooldown (slots 1-2 have none). 2 formulas:
  - **Buff skills** (`isBuff: true` — Shield Guard, Rally, Poison Coat): `cooldownTurns = the main status's durationTurns + 1`.
  - **Other damage/utility skills + ultimates**: assigned by hand based on power level, not a fixed formula (ultimates are fixed at `5 turns`).
- `usesPerCombat` is not used by any character skill (all 24 skills use `cooldownTurns`, including the 4 ultimates fixed at `5 turns`). The field still exists on `SkillDefinition`/`ItemDefinition` for Items (`07-items-artifacts.md` §7).
- **Buff skills always grant +20 speed** for turn-order purposes in the round they're used. This applies only to the 3 skills marked "Buff?" in each class's table (Shield Guard, Rally, Poison Coat) — not to support skills that don't carry a status (Prayer, Heal, Mass Heal for Acolyte adjust instantly, without going through `applyStatusEffect`). This is a temporary bonus only for ordering turns within the current round — it is not added to the character's base `speed` — technical design in `docs/technical-decisions.md` §4.7.
