# §9. New classes: Viking & Plague Doctor — base stats balancing formula

*(item 9 of `00-index.md`)*

**This is a design proposal for a future expansion direction — not yet built into the game.** There is no Viking or Plague Doctor in the current `data/classes.json` (only 4 classes exist: Vanguard, Mage, Rogue, Acolyte — `01-class-skill.md` item 1), and the current schema in `src/types.ts` doesn't yet have 2 fields this design needs (`onHitAoeDamage`, `conditionalBonus` — see §9.3.2). All the figures below (base stats, growthWeights, skills) are an initial proposal, not yet playtested, to be tuned when (and if) it's actually implemented.

## 9.1 Base stats balancing formula (`Balance Points`)

Comparing "how much stronger/weaker is this class than that one" at base stats (level 1) can't just add up `attack + defense + maxHp + maxMp + magicPower` directly — 1 point in each stat isn't worth the same amount.

**Conversion source**: use the exact per-level-up growth rate of **tier 1** from the shared growth table (`06-level-system.md` §6.3): `attack 3, defense 2, maxHp 14, maxMp 6, magicPower 3` (per level up). Since this is a shared curve across every class (before multiplying by `growthWeights`), treat it as though the original design already defines its own **conversion rate**: 3 points of `attack` ⇔ 2 points of `defense` ⇔ 14 points of `maxHp` ⇔ 6 points of `maxMp` ⇔ 3 points of `magicPower`, all equal to **1 "balance point"**.

**Formula** (divide — not multiply):

```
BalancePoints = attack/3 + defense/2 + maxHp/14 + maxMp/6 + magicPower/3
```

`aggro`/`speed` are not part of the formula.

**How to use it**: compute `BalancePoints` for every class's base stats, compare against the group average — a class that deviates too far (the working experience applied in items 9.2/9.3 below: a warning threshold of roughly ±10%) is a sign that base stats are off-balance and need adjusting before moving into the skill-numbers playtest stage.

### Comparison table across 6 classes (base stats, level 1)

| Class | attack | magicPower | defense | maxHp | maxMp | BalancePoints | Deviation from average |
|---|---|---|---|---|---|---|---|
| Vanguard | 14 | 0 | 10 | 140 | 20 | 23.00 | +0.4% |
| Mage | 6 | 14 | 4 | 70 | 60 | 23.67 | +3.3% |
| Rogue *(rebalanced — 9.2)* | 16 | 0 | 6 | 109 | 40 | 22.79 | −0.4% |
| Acolyte | 6 | 10 | 8 | 100 | 50 | 24.81 | +8.4% |
| Viking *(new — 9.3)* | 18 | 6 | 6 | 105 | 30 | 23.50 | +2.7% |
| Plague Doctor *(new — 9.4)* | 4 | 13 | 6 | 85 | 60 | 24.74 | +8.1% |
| **Average of 6 classes** | | | | | | **≈ 23.59** | |

## 9.2 Rogue rebalance (base stats)

Rogue's original base stats: `attack 16, defense 6, maxHp 90, maxMp 30, magicPower 0` (`BalancePoints = 19.76`).

**Adjustment**: `maxHp` 90→**109**, `maxMp` 30→**40**, keeping `attack`/`defense`/`aggro`/`speed`/`magicPower` unchanged.

Rogue's `growthWeights` (`attack 1.7, magicPower 0.3, defense 0.9, maxHp 1.3, maxMp 0.8`, total 5.0 — `06-level-system.md` §6.8) **stay unchanged** — only base stats change.

## 9.3 Viking — hybrid physical/lightning berserker, high risk/extremely high damage

### Base stats

| Class | attack | magicPower | defense | maxHp | maxMp | aggro | speed |
|---|---|---|---|---|---|---|---|
| Viking | 18 | 6 | 6 | 105 | 30 | 16 | 11 |

`magicPower` feeds the damage portion of the passive proc `storm-empowered` (§9.3.2); it is not used to scale active skills — all of the Viking's active skills are physical.

### growthWeights (total 5.0)

| Class | attack | magicPower | defense | maxHp | maxMp | Total | Role |
|---|---|---|---|---|---|---|---|
| Viking | 1.5 | 0.9 | 0.7 | 1.2 | 0.7 | 5.0 | Hybrid berserker |

### 9.3.1 Skill table

Basic attack (slot 0, same as every class — `01-class-skill.md` item 1.0): **Axe Slash** (`viking-axe-slash`), physical, `damage 0`.

| Slot | Lvl | Skill id | Name | MP | Target | Effect | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `viking-lightning-axe` | Lightning Axe | 8 | self | `applyStatusEffect "storm-empowered"` + `modifyCombatStat defense -4` + `modifyCombatStat aggro +8` | ✅ | 4 turns |
| 2 | 1 | `viking-frenzied-slash` | Frenzied Slash | 5 | singleEnemy | `damage 9` (physical) + 50% `applyStatusEffect "bleeding"` — **conditionalBonus**: if currently carrying `storm-empowered`, `ignoreDefensePercent +30` | — | — |
| 3 | 10 | `viking-throw-axe` | Throw Axe | 9 | singleEnemy | `damage 16` (physical) — **conditionalBonus**: `ignoreDefensePercent +30` if `storm-empowered` is active | — | 2 turns |
| 4 | 20 | `viking-spin-axe` | Spinning Axe | 14 | allEnemies | `damage 14`/enemy + 30% `applyStatusEffect "bleeding"` — **conditionalBonus**: `ignoreDefensePercent +30` if `storm-empowered` is active | — | 3 turns |
| 5 | 35 | `viking-thunder-god-fury` | Thunder God's Fury | 20 | allEnemies | `damage 32`/enemy — **always hits** (isUltimate), **conditionalBonus**: `ignoreDefensePercent +60` if `storm-empowered` is active, **and consumes `storm-empowered`** after use | — | 5 turns |

*Skills 2-5 are all purely physical (not `isMagic`) — the Viking's magic damage only comes indirectly through the `storm-empowered` proc (9.3.2), not directly through the skill formula the way Mage/Acolyte work.*

### 9.3.2 New mechanics needed in the engine

The Viking needs **2 new fields not present** in the current schema (`src/types.ts`) — this is the part that goes beyond "just adding data":

**a) `onHitAoeDamage` on `StatusEffectDefinition`** — a buff that deals its own AoE damage every time the bearer lands a hit (basic attack or skill), similar to the existing on-hit rider mechanic (`onHitStatusEffectId`, used by `poison-coat` — `docs/technical-decisions.md` §4.2) but dealing AoE damage instead of applying a status to a single target:

```ts
onHitAoeDamage?: { amount: number; isMagic?: boolean; ignoreDefensePercent?: number };
```

New status effect `storm-empowered`:
```json
{
  "id": "storm-empowered",
  "name": "Storm-Empowered",
  "durationTurns": 3,
  "onHitAoeDamage": { "amount": 6, "isMagic": true, "ignoreDefensePercent": 30 },
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

New status `bleeding` (physical DoT, structured like `poisoned`):
```json
{
  "id": "bleeding",
  "name": "Bleeding",
  "perTurnEffects": [{ "kind": "damage", "amount": 5 }],
  "durationTurns": 3,
  "curableByMiniGame": []
}
```

## 9.4 Plague Doctor — debuffer/support, favors effects over raw damage

### Base stats

| Class | attack | magicPower | defense | maxHp | maxMp | aggro | speed |
|---|---|---|---|---|---|---|---|
| Plague Doctor | 4 | 13 | 6 | 85 | 60 | 8 | 11 |

Role: an AoE debuffer (burn/poison/blind/weaken), with 1 single-target heal skill and 1 dual-purpose heal+debuff ultimate.

### growthWeights (total 5.0)

| Class | attack | magicPower | defense | maxHp | maxMp | Total | Role |
|---|---|---|---|---|---|---|---|
| Plague Doctor | 0.2 | 1.5 | 0.9 | 1.1 | 1.3 | 5.0 | Debuffer/support |

### Skill table

Basic attack (slot 0): **Vial Toss** (`plaguedoc-vial-toss`), `isMagic: true`, `damage 0`.

| Slot | Lvl | Skill id | Name | MP | Target | Effect | Buff? | Cooldown |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `plaguedoc-fire-vial` | Fire Vial | 4 | singleEnemy | `damage 5` + 60% `applyStatusEffect "burning"` | — | — |
| 2 | 1 | `plaguedoc-healing-draught` | Healing Draught | 6 | singleAlly | `heal 15` | — | — |
| 3 | 10 | `plaguedoc-blinding-vial` | Blinding Vial | 7 | singleEnemy | `damage 4` + 70% `applyStatusEffect "blinded"` | — | 2 turns |
| 4 | 20 | `plaguedoc-toxic-fog` | Spreading Toxic Fog | 12 | allEnemies | `damage 5`/enemy + 60% `applyStatusEffect "poisoned"` + 40% `applyStatusEffect "weakened"` | — | 3 turns |
| 5 | 35 | `plaguedoc-total-plague` | Total Plague | 22 | allAllies **and** allEnemies at once | allies → `heal 20` + `removeStatusEffect`; enemies → `damage 10` + 80% `applyStatusEffect "poisoned"` + 80% `applyStatusEffect "burning"` — **always hits** (isUltimate) | — | 5 turns |

*All skills are `isMagic: true`. Skill 5 uses `effectsByRelation` (2 sides) — an existing mechanic, similar to `acolyte-divine-descent` (`01-class-skill.md` item 1.4).*

### New status effects needed

`burning`, `poisoned`, `weakened` already exist (`01-class-skill.md` item 1.5), reused as-is. Only `blinded` is new:

```json
{
  "id": "blinded",
  "name": "Blinded",
  "durationTurns": 2,
  "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": -4 }],
  "curableByMiniGame": []
}
```

## General notes — remaining work before implementation

- **Data-only**: add the 2 classes to `data/classes.json`, update Rogue's base stats, add the `bleeding`/`blinded` statuses to `data/status-effects.json`.
- **Requires code changes** (`src/types.ts` + combat resolver): the fields `onHitAoeDamage` (StatusEffectDefinition) and `conditionalBonus` (SkillDefinition) — these 2 fields exist solely to support the Viking.
- MP/damage/cooldown figures need playtesting before being finalized.
