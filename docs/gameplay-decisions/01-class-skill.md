# §1. Class & Skill

*(section 1 of `00-index.md` — see that file for the full table of contents)*

Each class has a shared basic attack (slot 0) + several class-specific skills, plus 4 engine mechanics (percentage-based procs, self-buffs applied on a successful hit, stun that skips a turn, and skills whose effect differs depending on the target's side), and cooldowns measured in turns for some of the stronger skills. The roster is 6 classes total: the original 4 (Vanguard, Mage, Rogue, Acolyte — sections 1.1-1.4) plus Viking and Plague Doctor (sections 1.5-1.6), added later alongside a 3-rank power-scaling system layered on every class-specific skill (section 1.8).

**Source of truth for every number below**: `data/classes.json`. This document describes the *shape* of each class's kit (which stat/target/mechanic each skill uses) — not the actual MP costs, damage/heal amounts, proc chances, or cooldown lengths, which live only in the JSON and get tuned there without needing a doc update.

**Naming convention**: every `id`/`name` for classes, skills, and status effects is in **English**, matching `data/classes.json`/`data/status-effects.json`/`data/monsters.json`. The descriptive/explanatory text in this document follows suit in English.

### Stat shape (level 1)

Class stats: **attack** (`attack`), **magic power** (`magicPower` — see below), **defense** (`defense`), **HP** (`maxHp`), **mana** (`maxMp`), **aggro** (`aggro` — the weight used when a monster picks its target, see `02-monster.md` section 2), **speed** (`speed` — priority for acting first, see `docs/technical-decisions.md` §2). Level-1 values for all 6 classes: `data/classes.json`.

- Vanguard has the highest `aggro` + `defense` + `maxHp`, and the lowest `speed` (a tank that acts late).
- Mage has the lowest stats across the board on defense/aggro but decent `speed`, and is the only class with low `attack` and the highest `magicPower` — Mage's damage carry comes from its spell skills (section 1.2), not its basic attack.
- Rogue has the highest `speed`/`attack`, low `defense`, and no `magicPower` (purely physical).
- Acolyte is balanced, with average `aggro` and decent `magicPower` (healing + secondary damage, lower than Mage's).
- Viking is a hybrid physical/lightning berserker: high risk, extremely high damage, purely physical active skills — no skill scales off `magicPower` directly (section 1.5).
- Plague Doctor is an AoE debuffer/support, favoring status effects (burn/poison/blind/weaken) over raw damage, plus a single-target heal and a dual heal+debuff ultimate (section 1.6).

#### The `magicPower` stat and the `isMagic` flag

Any skill whose `damage`/`heal` is "magical" in nature (Mage's fire/lightning/ice elements, Acolyte's holy heal/purge, all of Plague Doctor's skills) is flagged `isMagic: true` in `data/classes.json`. When the resolver computes damage/healing for an `isMagic` skill, it uses the caster's `source.magicPower` in place of `source.attack` — only the offense side of the formula changes; how defense is subtracted stays the same (full mitigation formula details: `docs/technical-decisions.md`, section "Handling by `effect.kind`"). Skills not flagged `isMagic` (every class's basic attack except Plague Doctor's, all of Vanguard's/Rogue's/Viking's skills, Purify's damage — enemy branch only) use `attack` as normal. Which skills carry `isMagic: true` for each class: `data/classes.json`.

`magicPower` grows by level along the same tapered curve shared with `attack`/`defense`/`maxHp`/`maxMp` (`06-level-system.md` §6.3), multiplied by a class-specific `growthWeights.magicPower` — see `06-level-system.md` §6.8.

The first class-specific skills are unlocked at level 1 (on top of the always-available basic attack), the rest unlock gradually via each skill's `unlockLevel` field. `slot`/`unlockLevel`/`cooldownTurns` match the field of the same name in `SkillDefinition` (see `docs/technical-decisions.md` §4) — `usesPerCombat` is not used for character skills (section 1.7, last bullet, "Design notes").

### Base stats balancing formula (Balance Points)

Comparing "how much stronger/weaker is this class than that one" at base stats (level 1) can't just add up `attack + defense + maxHp + maxMp + magicPower` directly — 1 point in each stat isn't worth the same amount.

**Conversion source**: use the per-level-up growth rate of the first tier from the shared growth table (`06-level-system.md` §6.3, `data/level-growth.json` → `tiers[0]`). Since this is a shared curve across every class (before multiplying by `growthWeights`), treat it as though the original design already defines its own **conversion rate**: tier-1's `attack` rate ⇔ tier-1's `defense` rate ⇔ tier-1's `maxHp` rate ⇔ tier-1's `maxMp` rate ⇔ tier-1's `magicPower` rate, all equal to **1 "balance point"**. `speed` never scales with level, so it has no `tier1` rate to derive a conversion constant from — instead it uses the same hand-picked `speedRate = 12` constant that `MonsterBalancePoints` uses (`02-monster.md` "Monster Balance Points"), so char and monster BalancePoints stay on one consistent scale.

**Formula shape** (divide each stat by its tier-1 rate — or `speedRate` for `speed` — then sum):

```
BalancePoints = attack/tier1.attack + defense/tier1.defense + maxHp/tier1.maxHp + maxMp/tier1.maxMp + magicPower/tier1.magicPower + speed/speedRate
```

`aggro` is not part of the formula.

**How to use it**: compute `BalancePoints` for every class's base stats, compare against the group average — a class that deviates too far from the average (rule of thumb: roughly ±10%) is a sign that base stats are off-balance and need adjusting. Don't hand-maintain a comparison table here — recompute it against the current `data/classes.json` whenever this needs re-checking, since every class's stats can drift independently of this document.

This formula was used when Viking/Plague Doctor were added (sections 1.5/1.6) to keep the roster balanced — adding them also called for a small rebalance of Rogue's `maxHp`/`maxMp` (upward, to keep its `BalancePoints` in line with the other 5), while keeping `attack`/`defense`/`aggro`/`speed`/`magicPower` and `growthWeights` unchanged. Current values for all 6 classes: `data/classes.json`.

### 1.0 Basic attack (every class, slot 0)

Free (`mpCost 0`), always available from level 1, unlimited uses, no cooldown, `target: singleEnemy`, a flat `damage` effect with `amount: 0` → damage comes entirely from `mitigatedOffense(attack, defense)` (the mitigation formula, `docs/technical-decisions.md`), true "baseline damage" (identical to the monster basic-attack formula). Name/weapon depend on class, with no mechanical purpose beyond being a free fallback when out of MP:

| Class | Weapon | Skill id | Basic attack name |
|---|---|---|---|
| Vanguard | Sword | `vanguard-slash` | Slash |
| Rogue | Knife | `rogue-stab` | Stab |
| Mage | Staff | `mage-bludgeon` | Bludgeon |
| Acolyte | Bare hands | `acolyte-punch` | Punch |
| Viking | Axe | `viking-axe-slash` | Axe Slash |
| Plague Doctor | Vial | `plaguedoc-vial-toss` | Vial Toss |

*Every basic attack above is physical (damage comes from `attack`) **except Plague Doctor's Vial Toss, which is `isMagic: true`** — its baseline damage comes from `magicPower` instead, consistent with Plague Doctor's kit being entirely magical (section 1.6).*

### 1.1 Vanguard — tank, damage sponge, holds monster attention

| Slot | Skill id | Name | Target | Effect (shape) | Buff? |
|---|---|---|---|---|---|
| 1 | `vanguard-shield-guard` | Shield Guard | self | `applyStatusEffect "guard"` (temporary defense buff) **+** `applyStatusEffect "taunt"` (temporary aggro buff) — 2 independent statuses, applied together | ✅ |
| 2 | `vanguard-shield-throw` | Shield Throw | singleEnemy | `damage` | — |
| 3 | `vanguard-rally` | Rally | allAllies | `modifyStat fear` (instant, whole party) + `applyStatusEffect "rally"` (temporary attack buff, whole party) | ✅ |
| 4 | `vanguard-heavy-charge` | Heavy Charge | allEnemies | `damage`/enemy — accuracy rolled **separately per enemy** (`04-fear-combat.md` section 4) | — |
| 5 | `vanguard-sword-judgment` | Sword Judgment | singleEnemy | `damage` — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — |

*Shield Guard carries both the "aggro draw" role and the "defense" role, while Rally is a whole-party buff rather than just self-taunt. The "Buff?" column marks skills that receive `isBuff: true` — see the `durationTurns`/cooldown/speed rules specific to buffs in section 1.7 and `docs/technical-decisions.md` §4.7. MP costs, damage/heal amounts, and cooldown lengths: `data/classes.json`.*

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

**On Poison Coat and the "buffs are always 1 turn" rule**: `poison-coat` is **not** forced down to a 1-turn duration the way Shield Guard/Rally are, even though it is also a self-buff — see `data/status-effects.json` for its actual `durationTurns`. `poison-coat` carries no `modifyCombatStat` — it's a buff-rider (it toggles the "attacks auto-apply poison" mechanic). Its cooldown follows the shared "duration + 1" formula (§1.7, "Design notes").

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

### 1.5 Viking — hybrid physical/lightning berserker, high risk/extremely high damage

**Status: implemented.** Viking is a real class in `data/classes.json`, alongside the 4 original classes above. The 2 schema fields this class needed (`onHitAoeDamage` on `StatusEffectDefinition`, `conditionalBonus` on `SkillDefinition` — see section 1.5.2) exist in `src/types.ts`. Base stats (attack/magicPower/defense/maxHp/maxMp/aggro/speed) and `growthWeights`: `data/classes.json` — this section describes shape only, not current tuning (same caveat as the rest of this document).

`magicPower` feeds the damage portion of the passive proc `storm-empowered` (section 1.5.2); it is not used to scale active skills — all of the Viking's active skills are physical.

#### 1.5.1 Skill table (shape only — mp/damage/cooldown live in `data/classes.json`)

Basic attack (slot 0, same as every class — section 1.0): **Axe Slash** (`viking-axe-slash`), physical.

| Slot | Skill id | Name | Target | Effect (shape) | Buff? |
|---|---|---|---|---|---|
| 1 | `viking-lightning-axe` | Lightning Axe | self | `applyStatusEffect "storm-empowered"` + temporary defense debuff + temporary aggro buff | ✅ |
| 2 | `viking-frenzied-slash` | Frenzied Slash | singleEnemy | `damage` (physical) + chance to `applyStatusEffect "bleeding"` — **conditionalBonus**: extra `ignoreDefensePercent` if currently carrying `storm-empowered` | — |
| 3 | `viking-throw-axe` | Throw Axe | singleEnemy | `damage` (physical) — same `storm-empowered` conditionalBonus | — |
| 4 | `viking-spin-axe` | Spinning Axe | allEnemies | `damage`/enemy + chance to `applyStatusEffect "bleeding"` — same `storm-empowered` conditionalBonus | — |
| 5 | `viking-thunder-god-fury` | Thunder God's Fury | allEnemies | `damage`/enemy — **always hits** (isUltimate), a bigger `storm-empowered` conditionalBonus, **and consumes `storm-empowered`** after use | — |

*Skills 2-5 are all purely physical (not `isMagic`) — the Viking's magic damage only comes indirectly through the `storm-empowered` proc (1.5.2), not directly through the skill formula the way Mage/Acolyte work.*

#### 1.5.2 Engine mechanics the Viking needed

The Viking needed **2 fields not present** in the schema before it (`src/types.ts`) — this was the part that went beyond "just adding data", both now implemented:

**a) `onHitAoeDamage` on `StatusEffectDefinition`** — a buff that deals its own AoE damage every time the bearer lands a hit (basic attack or skill), similar to the existing on-hit rider mechanic (`onHitStatusEffectId`, used by `poison-coat` — section 1.3, `docs/technical-decisions.md` §4.2) but dealing AoE damage instead of applying a status to a single target:

```ts
onHitAoeDamage?: { amount: number; isMagic?: boolean; ignoreDefensePercent?: number };
```

New status effect `storm-empowered` (shape — actual `durationTurns`/`amount`/`ignoreDefensePercent` live in `data/status-effects.json`; row also included in the summary table, section 1.7):

```json
{
  "id": "storm-empowered",
  "name": "Storm-Empowered",
  "durationTurns": "<see data/status-effects.json>",
  "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "ignoreDefensePercent": "<see data/status-effects.json>" }
}
```

**b) `conditionalBonus` on `SkillDefinition`** — adds extra `ignoreDefensePercent` to a skill's `damage` effects *only when* the caster is currently carrying a specified status, optionally consuming that status after use (used for the slot-5 ultimate):

```ts
conditionalBonus?: {
  requiresStatusId: Id;
  ignoreDefensePercentBonus: number;
  consumesStatus?: boolean;
};
```

Placed at the `SkillDefinition` level (not `SkillEffect`) — it only triggers when the condition is met.

New status `bleeding` (physical DoT, structured like `poisoned`) — shape only, magnitude/duration in `data/status-effects.json`:

```json
{
  "id": "bleeding",
  "name": "Bleeding",
  "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }],
  "durationTurns": "<see data/status-effects.json>"
}
```

### 1.6 Plague Doctor — debuffer/support, favors effects over raw damage

**Status: implemented.** Plague Doctor is a real class in `data/classes.json`. Base stats and `growthWeights`: `data/classes.json`, same caveat as section 1.5.

Role: an AoE debuffer (burn/poison/blind/weaken), with 1 single-target heal skill and 1 dual-purpose heal+debuff ultimate.

#### Skill table (shape only)

Basic attack (slot 0): **Vial Toss** (`plaguedoc-vial-toss`), `isMagic: true` (see the footnote under section 1.0).

| Slot | Skill id | Name | Target | Effect (shape) | Buff? |
|---|---|---|---|---|---|
| 1 | `plaguedoc-fire-vial` | Fire Vial | singleEnemy | `damage` + chance to `applyStatusEffect "burning"` | — |
| 2 | `plaguedoc-healing-draught` | Healing Draught | singleAlly | `heal` | — |
| 3 | `plaguedoc-blinding-vial` | Blinding Vial | singleEnemy | `damage` + chance to `applyStatusEffect "blinded"` | — |
| 4 | `plaguedoc-toxic-fog` | Spreading Toxic Fog | allEnemies | `damage`/enemy + chance to `applyStatusEffect "poisoned"` + chance to `applyStatusEffect "weakened"` | — |
| 5 | `plaguedoc-total-plague` | Total Plague | allAllies **and** allEnemies at once | allies → `heal` + `removeStatusEffect`; enemies → `damage` + chance to `applyStatusEffect "poisoned"` + chance to `applyStatusEffect "burning"` — **always hits** (isUltimate) | — |

*All skills are `isMagic: true`. Skill 5 uses `effectsByRelation` (2 sides) — the same mechanic as `acolyte-divine-descent` (section 1.4).*

#### `blinded` — a new status, and the `rollHits()` change it needed

`burning`, `poisoned`, `weakened` already exist (section 1.7), reused as-is. `blinded` is new (shape below; current `durationTurns`/`accuracyPenaltyPercent` live in `data/status-effects.json`):

```json
{
  "id": "blinded",
  "name": "Blinded",
  "durationTurns": "<see data/status-effects.json>",
  "accuracyPenaltyPercent": "<see data/status-effects.json>",
  "perTurnEffects": []
}
```

`blinded` reduces the bearer's own chance to land its attacks/skills by a flat percentage for the duration, rather than weakening its `attack` stat — thematically "can't see" means "misses more", not "hits softer". This needed a new `StatusEffectDefinition` field, `accuracyPenaltyPercent?: number`, and a change to `rollHits()` (`src/engine/resolver.ts`): previously `rollHits` returned `true` unconditionally for any non-`Character` source (`if (!isCharacter(source)) return true`), meaning monsters always hit with no accuracy roll. Applying `blinded` to a monster (the only target `plaguedoc-blinding-vial` can hit) required `rollHits` to also check the source's active statuses for `accuracyPenaltyPercent` regardless of whether the source is a character or a monster, combining it with the existing fear-based penalty when both apply, clamped to 100%. This was the first status effect that gives a *monster* a chance to miss.

This also required a fix to `isHelpfulStatusEffect()` (`src/engine/resolver.ts`, used only for combat-log "buff"/"debuff" coloring): it previously inferred "helpful" from `stuns`/`vulnerableTo`, a `damage` `perTurnEffect`, or a negative `modifyCombatStat` — `blinded` has none of those (`perTurnEffects: []`, only `accuracyPenaltyPercent`), so without this fix it would log as a buff despite being a debuff. A 4th check was added: any status with `accuracyPenaltyPercent` set is not helpful.

#### Engine/data summary for Viking + Plague Doctor

- **Data**: the 2 classes in `data/classes.json`, Rogue's rebalanced base stats (see "Base stats balancing formula" above), the `storm-empowered`/`bleeding`/`blinded` statuses in `data/status-effects.json`.
- **Code** (`src/types.ts` + `src/engine/resolver.ts`): `onHitAoeDamage` (StatusEffectDefinition) and `conditionalBonus` (SkillDefinition) exist solely to support the Viking (1.5.2). `accuracyPenaltyPercent` (StatusEffectDefinition) + the `rollHits()`/`isHelpfulStatusEffect()` changes above support the Plague Doctor's `blinded`.
- MP/damage/cooldown figures: `data/classes.json`/`data/status-effects.json` are the source of truth — this document does not hand-maintain them.

### 1.7 Status Effects — summary table & full effects

The statuses used by the character skill kits in sections 1.1-1.6 (English id/name, matching `data/status-effects.json`):

| id | Name | Type | Effect (`perTurnEffects` / special field) | Used by |
|---|---|---|---|---|
| `guard` | Guard | Buff | `modifyCombatStat defense` | Shield Guard (Vanguard) |
| `taunt` | Taunt | Buff | `modifyCombatStat aggro` | Shield Guard (Vanguard) |
| `rally` | Rally | Buff | `modifyCombatStat attack` | Rally (Vanguard) |
| `poison-coat` | Poison Coat | Buff (rider, not a stat-buff) | no `perTurnEffects`; field `onHitStatusEffectId: "poisoned"` — see `docs/technical-decisions.md` §4.2 | Poison Coat (Rogue) |
| `poisoned` | Poisoned | Debuff | `damage`/turn | on-hit rider of Poison Coat; Poison Bomb (Rogue); Toxic Fog, Total Plague (Plague Doctor) |
| `burning` | Burning | Debuff | `damage`/turn | Fireball, Fire Pillar (Mage); Fire Vial, Total Plague (Plague Doctor) |
| `stunned` | Stunned | Control (debuff) | no ordinary `perTurnEffects`; field `stuns: true` — see `docs/technical-decisions.md` §4.3 | Lightning Bolt, Lightning Storm (Mage) |
| `weakened` | Weakened | Debuff | `modifyCombatStat defense` | Toxic Fog (Plague Doctor); also used by Elite/Boss-exclusive skills (`06-level-system.md` §6.12) |
| `bleeding` | Bleeding | Debuff (physical DoT) | `damage`/turn | Frenzied Slash, Spinning Axe (Viking) |
| `storm-empowered` | Storm-Empowered | Buff (rider, AoE-on-hit) | no ordinary `perTurnEffects`; field `onHitAoeDamage` — see section 1.5.2 | Lightning Axe (Viking) |
| `blinded` | Blinded | Debuff | no `perTurnEffects`; field `accuracyPenaltyPercent` — see section 1.6 | Blinding Vial (Plague Doctor) |

Exact magnitudes/durations/proc chances for every row above: `data/status-effects.json`.

**Design idea, not implemented**: Poisoned (and its stronger Poison Bomb variants below) was conceived as being cure-able early by playing a mini-game — a concept only, no field or mechanic for it exists in the current code. See `minigame-decisions.md` if this direction is ever picked up.

**Default `durationTurns` convention**: `applyStatusEffectToActor` (`resolver.ts`) falls back to a default of 1 turn when a status doesn't declare `durationTurns` in `data/status-effects.json`.
- **Buffs (carrying `modifyCombatStat`, applied by the actor to itself/allies)**: default to that 1-turn fallback, matching the "buffs are always 1 turn" rule — no need to explicitly set `durationTurns` in JSON if it's 1, though it's still good practice to write it for clarity.
- **Debuffs/control effects (Poisoned, Burning, Stunned) and buff-riders that aren't stat-buffs (Poison Coat, Storm-Empowered)**: **must always declare `durationTurns` explicitly**, never relying on the default.

### 1.8 Skill Rank system — 3 ranks per skill, unlocked by character level

**Status: implemented.** `SkillDefinition.ranks` exists in `data/classes.json` for every class-specific skill across all 6 classes (Viking/Plague Doctor included).

#### Concept

Each of the 30 class-specific skills (5 per class × 6 classes; the shared basic attack in slot 0 is excluded — it stays a single fixed version) has **3 ranks**. Rank 1 is the skill's original (already-documented) numbers, unlocked at the skill's existing `unlockLevel` (sections 1.1-1.6). Ranks 2 and 3 unlock automatically at higher character levels — no separate "learn"/"choose" action, consistent with the game's existing "leveling up just makes you stronger" design (`05-character-stats.md`: level-up already fully restores HP/MP with no player choice involved).

**Rank-up does not change `cooldownTurns`** — cooldowns stay identical across every rank of a skill, to avoid disturbing combat pacing. Where a rank has more effect, `mpCost` is allowed to increase slightly to keep the mana economy proportional to the stronger output. Effect magnitudes (damage/heal/proc chance) are **hand-tuned per skill** for rank 2/3, matching the project's existing philosophy of assigning skill numbers "by hand based on power level, not a fixed formula" (see "Design notes" below) — there is no global "+X% per rank" formula applied uniformly.

#### Rank-up level thresholds

Spread across the full level range; later-unlocking skills (higher slot) have a longer gap between ranks, and the last skill (slot 5, the class ultimate) reaches rank 3 exactly at the level cap. Slots 1 and 2 share the same thresholds (both unlock at the same starting level, treated as equally "starting kit"); every other slot uses its own thresholds derived from its unlock level. **Current thresholds**: `SkillRankDefinition.unlockLevel` per rank, `data/classes.json` — this document does not hand-maintain a copy of the table, since it drifts the moment ranks are retuned.

#### Data model

`SkillDefinition` (`docs/technical-decisions.md` §4) gains an optional field:

```
SkillDefinition {
  ...existing fields (id, name, mpCost, target, effects, slot, unlockLevel, cooldownTurns, isBuff?, isUltimate?, isMagic?)
  ranks?: SkillRankDefinition[]   // absent = the skill has no rank system (all monster skills, items)
}

SkillRankDefinition {
  rank: 1 | 2 | 3
  unlockLevel: number
  mpCost: number
  effects: SkillEffect[]
}
```

At cast time, the game resolves the character's current rank for a skill as the highest `rank` whose `unlockLevel <= Character.level`, then uses that rank entry's `mpCost`/`effects` instead of the skill's top-level `mpCost`/`effects` (which mirror rank 1, kept for backward compatibility with any code that doesn't yet know about `ranks`). This is done via a lookup helper (`getEffectiveSkill(skill, characterLevel)`) used wherever a character's skill is cast or displayed (skill list UI, resolver).

#### Buff-status rank scaling — 4 new statuses (Vanguard)

2 of the class-specific skills carry a `modifyCombatStat` status whose magnitude scales with rank (Vanguard's Shield Guard → `guard`, Vanguard's Rally → `rally`). Since `guard`/`rally` are shared `StatusEffectDefinition`s with a fixed magnitude, scaling them per-rank meant adding rank-specific variants rather than mutating the shared status (avoids changing the base `guard`/`rally` magnitude for any other skill/rank that might reuse them). Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "guard-ii", "name": "Guard II", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }] },
  { "id": "guard-iii", "name": "Guard III", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }] },
  { "id": "rally-ii", "name": "Rally II", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] },
  { "id": "rally-iii", "name": "Rally III", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] }
]
```

`taunt` and `poison-coat` are **not** given rank variants: `taunt`'s aggro bonus already dominates target selection at rank 1 (diminishing returns from going higher), and `poison-coat` is a binary on-hit rider, not a magnitude stat.

#### Poison Coat — rank-up adds an attack buff (Rogue)

**Poison Coat** (Rogue, slot 1) scales by adding a `modifyCombatStat attack` bonus to the buff at rank 2/3, on top of the existing on-hit poison rider (unchanged at every rank — it's still a binary toggle, not something that scales). `durationTurns` stays identical across every rank (only the status *id* changes, not its duration), so the existing `cooldownTurns = durationTurns + 1` formula still resolves to the same value at every rank — no conflict with the "cooldown never changes across ranks" rule. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "poison-coat-ii", "name": "Poison Coat II", "durationTurns": "<see data/status-effects.json>", "onHitStatusEffectId": "poisoned", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] },
  { "id": "poison-coat-iii", "name": "Poison Coat III", "durationTurns": "<see data/status-effects.json>", "onHitStatusEffectId": "poisoned", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] }
]
```

The attack-bonus progression matches the step size used for `rally-ii`/`rally-iii` above, for consistency across all attack-buff statuses in this system. The on-hit poison rider itself (`onHitStatusEffectId: "poisoned"`) is carried over unchanged on every rank — rank-up only adds the attack buff, it does not touch the "poison level" applied on hit (that stays base `poisoned`, level 1, same as every other non-Poison-Bomb source per the note below).

#### Poison Bomb — poison potency scales via leveled `poisoned` variants (exclusive to this skill)

Unlike Poison Coat, **Poison Bomb's rank-up does scale its poison** — this is the one skill in the whole system where the applied status itself gets stronger per rank, via 2 rank-exclusive variants of `poisoned`. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "poisoned-ii", "name": "Poisoned II", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }] },
  { "id": "poisoned-iii", "name": "Poisoned III", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }] }
]
```

**This scaling is exclusive to Poison Bomb.** Every other source of poison in the game — Poison Coat's on-hit rider, Snake's regular-monster skill (`02-monster.md`), and any future item/skill — keeps applying the plain, un-leveled `poisoned` ("poison level 1") regardless of the caster's rank in anything. There is no shared "global poison level"; `poisoned-ii`/`poisoned-iii` only ever come from Poison Bomb ranks 2/3.

#### Storm-Empowered — rank scaling (Viking)

`storm-empowered` (Lightning Axe's self-buff, section 1.5.2) is the Viking's signature rider — its `onHitAoeDamage.amount` **is** the skill's core value, the same situation as Poison Bomb's `poisoned` above and Poison Coat's attack buff. It has 2 rank-exclusive variants scaling that amount up; `ignoreDefensePercent`/`durationTurns` stay fixed so the existing `cooldownTurns = durationTurns + 1` formula still holds at every rank. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "storm-empowered-ii", "name": "Storm-Empowered II", "durationTurns": "<see data/status-effects.json>", "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "ignoreDefensePercent": "<see data/status-effects.json>" } },
  { "id": "storm-empowered-iii", "name": "Storm-Empowered III", "durationTurns": "<see data/status-effects.json>", "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "ignoreDefensePercent": "<see data/status-effects.json>" } }
]
```

The self-debuff piece of Lightning Axe (`defense`/`aggro`) and every skill's `conditionalBonus.ignoreDefensePercentBonus` stay **identical at every rank** — same reasoning as `taunt` above: these are enabling/auxiliary mechanics, not the thing being power-scaled. `bleeding`'s proc-chance scales per rank the same way Fireball/Lightning Bolt's burn/stun chances do — its own magnitude stays the shared, un-leveled version, consistent with the "poison/burn/stun magnitude doesn't scale, only its odds do" pattern already used for the 4 original classes.

#### Blinded — rank scaling (Plague Doctor)

No new statuses needed. `blinded` (Blinding Vial's debuff, section 1.6) follows the same pattern as Fireball/Lightning Bolt: only its proc-chance scales per rank, its magnitude (miss-chance percentage) stays fixed — it's an enemy-facing proc, not the caster's own signature buff, so it's treated like `burning`/`stunned`/`poisoned`, not like `guard`/`rally`/`storm-empowered`. `poisoned`/`burning`/`weakened` procced by Toxic Fog/Total Plague stay the plain, un-leveled versions, consistent with the rule above that only Poison Bomb ever applies a leveled `poisoned` variant. Total Plague's `removeStatusEffect` (ally branch) is binary and unchanged at every rank, same treatment as Purify's ally branch.

Neither Viking nor Plague Doctor needed new rank thresholds — both reuse the same threshold table as the 4 original classes (`data/classes.json`), same level-threshold shape and the same "cooldown never changes / mpCost rises slightly / effects hand-tuned per skill" rules.

#### Rank tables — all 30 skills

Per-rank `mpCost`/`effects`/`unlockLevel` for every skill of every class (all 6): `data/classes.json`, under each skill's `ranks` array. This document does not hand-maintain a copy of those tables — read `data/classes.json` directly for current numbers, since rank tuning changes independently of this doc.

#### Engine/data summary

- **Data**: `data/classes.json` — `ranks` on all 30 class-specific skills; `data/status-effects.json` — the 12 rank-variant statuses (`guard-ii/iii`, `rally-ii/iii`, `poison-coat-ii/iii`, `poisoned-ii/iii`, `storm-empowered-ii/iii`).
- **Code**: `SkillDefinition.ranks` + the `getEffectiveSkill` lookup helper, used wherever a character skill is cast/displayed.

### Design notes
- Each class has exactly 1 "ultimate" skill in slot 5 — it **always hits, with no accuracy roll**, but its effectiveness (damage/heal) scales down by fear tier via a dedicated formula, replacing the usual hit/miss roll + flat damage-reduction combo used by ordinary skills (`04-fear-combat.md` section 4). Ultimates use `isUltimate: true` and share a fixed `cooldownTurns` across every class (`data/classes.json`) — they do not use `usesPerCombat` (see the last bullet below).
- `modifyCombatStat` (attack/defense/aggro/speed buffs/debuffs) is always routed through `applyStatusEffect` — there is no effect that adjusts a combat stat instantly or permanently; all of them carry `durationTurns` on `StatusEffectDefinition`.
- `StatusEffectDefinition` is shared by both buffs (e.g. "guard") and debuffs (e.g. "poisoned") — both expire via `durationTurns`. Full table + default-duration convention: section 1.7.
- **Skills with a `chance` on 1 effect** (e.g. Fireball's burn proc) only roll for that specific effect, separate from the skill's overall accuracy roll — the main `damage` effect still always applies if the skill hits; only the secondary (proc) effect is probabilistic.
- **AoE skills** (`allEnemies`, or the "enemy" half of a two-sided skill): accuracy is rolled **separately for each target**, not once for the whole skill — one enemy dodging doesn't mean the whole group dodges.
- **Two-sided skills** (Purify, Divine Descent, Total Plague): the effect applied depends on whether the target is an ally or an enemy, rather than sharing one effect list — see `effectsByRelation` in `docs/technical-decisions.md` §4.
- **Cooldown** (`cooldownTurns`): every class-specific skill beyond the first two slots has a cooldown (slots 1-2 have none). 2 formulas:
  - **Buff skills** (`isBuff: true` — Shield Guard, Rally, Poison Coat, Lightning Axe): `cooldownTurns = the main status's durationTurns + 1`.
  - **Other damage/utility skills + ultimates**: assigned by hand based on power level, not a fixed formula (ultimates share one fixed value across classes — `data/classes.json`).
- `usesPerCombat` is not used by any character skill — every skill uses `cooldownTurns`, including ultimates. The field still exists on `SkillDefinition`/`ItemDefinition` for Items (`07-items-artifacts.md` §7).
- **Buff skills always grant a temporary speed bonus** for turn-order purposes in the round they're used (the bonus amount: `src/engine/combat.ts`). This applies only to the skills marked "Buff?" in each class's table (Shield Guard, Rally, Poison Coat, Lightning Axe) — not to support skills that don't carry a status (Prayer, Heal, Mass Heal for Acolyte adjust instantly, without going through `applyStatusEffect`). This is a temporary bonus only for ordering turns within the current round — it is not added to the character's base `speed` — technical design in `docs/technical-decisions.md` §4.7.
- Every class-specific skill (all 6 classes, 30 skills total) carries a 3-rank power curve — see section 1.8 for the mechanism.
