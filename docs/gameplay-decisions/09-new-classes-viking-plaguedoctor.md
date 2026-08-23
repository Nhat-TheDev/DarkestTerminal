# §9. New classes: Viking & Plague Doctor — base stats balancing formula

*(item 9 of `00-index.md`)*

**Status: implemented.** Viking and Plague Doctor are now real classes in `data/classes.json`, alongside the classes in `01-class-skill.md` item 1. The 2 schema fields this design needed (`onHitAoeDamage` on `StatusEffectDefinition`, `conditionalBonus` on `SkillDefinition` — see §9.3.2) exist in `src/types.ts`. This document describes the mechanics/shape of these 2 classes — **not the current tuning numbers**, which live in `data/classes.json`/`data/status-effects.json` and drift independently of this doc as balance changes; read those files directly rather than trusting a hand-copied value here.

## 9.1 Base stats balancing formula (`Balance Points`)

Comparing "how much stronger/weaker is this class than that one" at base stats (level 1) can't just add up `attack + defense + maxHp + maxMp + magicPower` directly — 1 point in each stat isn't worth the same amount.

**Conversion source**: use the per-level-up growth rate of the first tier from the shared growth table (`06-level-system.md` §6.3, `data/level-growth.json` → `tiers[0]`). Since this is a shared curve across every class (before multiplying by `growthWeights`), treat it as though the original design already defines its own **conversion rate**: tier-1's `attack` rate ⇔ tier-1's `defense` rate ⇔ tier-1's `maxHp` rate ⇔ tier-1's `maxMp` rate ⇔ tier-1's `magicPower` rate, all equal to **1 "balance point"**.

**Formula shape** (divide each stat by its tier-1 rate, then sum):

```
BalancePoints = attack/tier1.attack + defense/tier1.defense + maxHp/tier1.maxHp + maxMp/tier1.maxMp + magicPower/tier1.magicPower
```

`aggro`/`speed` are not part of the formula.

**How to use it**: compute `BalancePoints` for every class's base stats, compare against the group average — a class that deviates too far from the average (rule of thumb: roughly ±10%) is a sign that base stats are off-balance and need adjusting. Don't hand-maintain a comparison table here — recompute it against the current `data/classes.json` whenever this needs re-checking, since every class's stats can drift independently of this document.

## 9.2 Rogue rebalance (base stats)

Adding Viking/Plague Doctor to the roster also called for a small rebalance of Rogue's `maxHp`/`maxMp` (upward, to keep its `BalancePoints` in line with the other 5), while keeping `attack`/`defense`/`aggro`/`speed`/`magicPower` and `growthWeights` unchanged. Current values: `data/classes.json`.

## 9.3 Viking — hybrid physical/lightning berserker, high risk/extremely high damage

Base stats (attack/magicPower/defense/maxHp/maxMp/aggro/speed) and `growthWeights`: `data/classes.json`.

`magicPower` feeds the damage portion of the passive proc `storm-empowered` (§9.3.2); it is not used to scale active skills — all of the Viking's active skills are physical.

### 9.3.1 Skill table (shape only — mp/damage/cooldown live in `data/classes.json`)

Basic attack (slot 0, same as every class — `01-class-skill.md` item 1.0): **Axe Slash** (`viking-axe-slash`), physical.

| Slot | Skill id | Name | Target | Effect (shape) | Buff? |
|---|---|---|---|---|---|
| 1 | `viking-lightning-axe` | Lightning Axe | self | `applyStatusEffect "storm-empowered"` + temporary defense debuff + temporary aggro buff | ✅ |
| 2 | `viking-frenzied-slash` | Frenzied Slash | singleEnemy | `damage` (physical) + chance to `applyStatusEffect "bleeding"` — **conditionalBonus**: extra `ignoreDefensePercent` if currently carrying `storm-empowered` | — |
| 3 | `viking-throw-axe` | Throw Axe | singleEnemy | `damage` (physical) — same `storm-empowered` conditionalBonus | — |
| 4 | `viking-spin-axe` | Spinning Axe | allEnemies | `damage`/enemy + chance to `applyStatusEffect "bleeding"` — same `storm-empowered` conditionalBonus | — |
| 5 | `viking-thunder-god-fury` | Thunder God's Fury | allEnemies | `damage`/enemy — **always hits** (isUltimate), a bigger `storm-empowered` conditionalBonus, **and consumes `storm-empowered`** after use | — |

*Skills 2-5 are all purely physical (not `isMagic`) — the Viking's magic damage only comes indirectly through the `storm-empowered` proc (9.3.2), not directly through the skill formula the way Mage/Acolyte work.*

### 9.3.2 New mechanics needed in the engine

The Viking needs **2 new fields not present** in the current schema (`src/types.ts`) — this is the part that goes beyond "just adding data":

**a) `onHitAoeDamage` on `StatusEffectDefinition`** — a buff that deals its own AoE damage every time the bearer lands a hit (basic attack or skill), similar to the existing on-hit rider mechanic (`onHitStatusEffectId`, used by `poison-coat` — `docs/technical-decisions.md` §4.2) but dealing AoE damage instead of applying a status to a single target:

```ts
onHitAoeDamage?: { amount: number; isMagic?: boolean; ignoreDefensePercent?: number };
```

New status effect `storm-empowered` (shape — actual `durationTurns`/`amount`/`ignoreDefensePercent` live in `data/status-effects.json`):
```json
{
  "id": "storm-empowered",
  "name": "Storm-Empowered",
  "durationTurns": "<tbd>",
  "onHitAoeDamage": { "amount": "<tbd>", "isMagic": true, "ignoreDefensePercent": "<tbd>" },
  "curableByMiniGame": []
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
  "perTurnEffects": [{ "kind": "damage", "amount": "<tbd>" }],
  "durationTurns": "<tbd>",
  "curableByMiniGame": []
}
```

## 9.4 Plague Doctor — debuffer/support, favors effects over raw damage

Base stats and `growthWeights`: `data/classes.json`, same caveat as §9.3.

Role: an AoE debuffer (burn/poison/blind/weaken), with 1 single-target heal skill and 1 dual-purpose heal+debuff ultimate.

### Skill table (shape only)

Basic attack (slot 0): **Vial Toss** (`plaguedoc-vial-toss`), `isMagic: true`.

| Slot | Skill id | Name | Target | Effect (shape) | Buff? |
|---|---|---|---|---|---|
| 1 | `plaguedoc-fire-vial` | Fire Vial | singleEnemy | `damage` + chance to `applyStatusEffect "burning"` | — |
| 2 | `plaguedoc-healing-draught` | Healing Draught | singleAlly | `heal` | — |
| 3 | `plaguedoc-blinding-vial` | Blinding Vial | singleEnemy | `damage` + chance to `applyStatusEffect "blinded"` | — |
| 4 | `plaguedoc-toxic-fog` | Spreading Toxic Fog | allEnemies | `damage`/enemy + chance to `applyStatusEffect "poisoned"` + chance to `applyStatusEffect "weakened"` | — |
| 5 | `plaguedoc-total-plague` | Total Plague | allAllies **and** allEnemies at once | allies → `heal` + `removeStatusEffect`; enemies → `damage` + chance to `applyStatusEffect "poisoned"` + chance to `applyStatusEffect "burning"` — **always hits** (isUltimate) | — |

*All skills are `isMagic: true`. Skill 5 uses `effectsByRelation` (2 sides) — an existing mechanic, similar to `acolyte-divine-descent` (`01-class-skill.md` item 1.4).*

### New status effects needed

`burning`, `poisoned`, `weakened` already exist (`01-class-skill.md` item 1.5), reused as-is. `blinded` is new (shape below; current `durationTurns`/`accuracyPenaltyPercent` live in `data/status-effects.json`):

```json
{
  "id": "blinded",
  "name": "Blinded",
  "durationTurns": "<see data/status-effects.json>",
  "accuracyPenaltyPercent": "<see data/status-effects.json>",
  "perTurnEffects": [],
  "curableByMiniGame": []
}
```

`blinded` reduces the bearer's own chance to land its attacks/skills by a flat percentage for the duration, rather than weakening its `attack` stat — thematically "can't see" means "misses more", not "hits softer". This needed a new `StatusEffectDefinition` field, `accuracyPenaltyPercent?: number`, and a change to `rollHits()` (`src/engine/resolver.ts`): previously `rollHits` returned `true` unconditionally for any non-`Character` source (`if (!isCharacter(source)) return true`), meaning monsters always hit with no accuracy roll. Applying `blinded` to a monster (the only target `plaguedoc-blinding-vial` can hit) required `rollHits` to also check the source's active statuses for `accuracyPenaltyPercent` regardless of whether the source is a character or a monster, combining it with the existing fear-based penalty when both apply, clamped to 100%. This was the first status effect that gives a *monster* a chance to miss.

## General notes — what this required

- **Data**: the 2 classes in `data/classes.json`, Rogue's rebalanced base stats, the `storm-empowered`/`bleeding`/`blinded` statuses in `data/status-effects.json`.
- **Code changes** (`src/types.ts` + combat resolver): the fields `onHitAoeDamage` (StatusEffectDefinition) and `conditionalBonus` (SkillDefinition) exist solely to support the Viking. `accuracyPenaltyPercent` (StatusEffectDefinition) + the `rollHits()` change in `src/engine/resolver.ts` described above support the Plague Doctor's `blinded`.
- **Also required a fix to `isHelpfulStatusEffect()`** (`src/engine/resolver.ts`, used only for combat-log "buff"/"debuff" coloring): it previously inferred "helpful" from `stuns`/`vulnerableTo`, a `damage` `perTurnEffect`, or a negative `modifyCombatStat` — `blinded` has none of those (`perTurnEffects: []`, only `accuracyPenaltyPercent`), so without this fix it would log as a buff despite being a debuff. A 4th check was added: any status with `accuracyPenaltyPercent` set is not helpful.
- MP/damage/cooldown figures: `data/classes.json`/`data/status-effects.json` are the source of truth — this document does not hand-maintain them.
