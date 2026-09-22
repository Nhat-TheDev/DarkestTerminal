# §1. Class & Skill

*(section 1 of `00-index.md` — see that file for the full table of contents)*

Each class has a shared basic attack (slot 0) + several class-specific skills, plus 4 engine mechanics (percentage-based procs, self-buffs applied on a successful hit, stun that skips a turn, and skills whose effect differs depending on the target's side), and cooldowns measured in turns for some of the stronger skills. The roster is 9 classes total: the original 4 (Vanguard, Mage, Rogue, Acolyte — sections 1.1-1.4) plus Viking and Plague Doctor (sections 1.5-1.6), added later alongside a 3-rank power-scaling system layered on every class-specific skill (section 1.8), plus Archer, Ninja, and Summoner (sections 1.9-1.11), added later still alongside 8 further engine mechanics (critical hits, an interrupt/overwatch reaction, untargetable stealth, a summoned-combatant primitive, an execute/low-HP damage bonus, stackable status effects, a per-skill offense multiplier, and a summon death-burst — section 1.12).

**Status of sections 1.9-1.11 (Archer/Ninja/Summoner): implemented.** All 9 classes now exist in `data/classes.json`, and the section 1.12 engine mechanics they depend on are all built. As with every other class in this document, treat the numbers in 1.9-1.11 as shape over magnitude — the JSON is the tuned source of truth (see below) — but the *shape* itself (skills, targets, mechanics) is real, shipped code.

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

**Writing `description` text for a skill**: see `02-monster.md`'s "Writing `description` text"
section — the same rule (flavor only; no mechanical notes, no cross-references to another skill by
name, no numbers/stat references) applies to every skill's `description` field, in
`data/classes.json` as much as `data/monster-skills.json`.

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

| Slot | Skill id | Name | Target | Effect (shape) | Buff? | % Scale + Bonus amount (R1/R2/R3) |
|---|---|---|---|---|---|---|
| 1 | `vanguard-shield-guard` | Shield Guard | self | `applyStatusEffect "guard"` (temporary defense buff) **+** `applyStatusEffect "taunt"` (temporary aggro buff) — 2 independent statuses, applied together | ✅ | — |
| 2 | `vanguard-shield-throw` | Shield Throw | singleEnemy | `damage` | — | 100 / 105 / 110% Base ATK + 10 / 13 / 16 ATK |
| 3 | `vanguard-rally` | Rally | allAllies | `modifyStat fear` (instant, whole party) + `applyStatusEffect "rally"` (temporary attack buff, whole party) | ✅ | — |
| 4 | `vanguard-heavy-charge` | Heavy Charge | allEnemies | `damage`/enemy — accuracy rolled **separately per enemy** (`04-fear-combat.md` section 4) | — | 70 / 80 / 90% Base ATK + 20 / 30 / 40 ATK |
| 5 | `vanguard-sword-judgment` | Sword Judgment | singleEnemy | `damage` — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — | 85 / 95 / 110% Base ATK + 30 / 40 / 50 ATK |

*Shield Guard carries both the "aggro draw" role and the "defense" role, while Rally is a whole-party buff rather than just self-taunt. The "Buff?" column marks skills that receive `isBuff: true` — see the `durationTurns`/cooldown/speed rules specific to buffs in section 1.7 and `docs/technical-decisions.md` §4.7. MP costs, damage/heal amounts, and cooldown lengths: `data/classes.json`.*

**"% Scale + Bonus amount" column**: per `src/engine/resolver.ts`'s `resolveSkillEffect` case `"damage"`, the engine computes `finalDamage = amount + mitigatedOffense(attack * offenseMultiplier, defense)`, where `offenseMultiplier = (effect.offenseMultiplierPercent ?? 100) / 100` — the caster's `attack` stat is mitigated by the target's `defense` same as always, but is scaled by this **per-skill, per-rank** multiplier *before* mitigation (see section 1.12.7). `amount` is a flat bonus added on top of the mitigated term, unaffected by defense mitigation. So every entry here reads `<percent>% Base ATK + <amount> ATK`, where `<percent>`/`<amount>` are the exact `SkillEffect.offenseMultiplierPercent` (100 when the field is absent) and `SkillEffect.amount` values per rank, straight from `data/classes.json` — most skills across the roster now carry a non-100% multiplier that also changes rank-to-rank, so both numbers are read directly from the JSON rather than assumed. `heal` works the same way (`<percent>% Base MagicPower + amount`, `case "heal"`: `amount + magicPower * offenseMultiplier`). Skills with no `damage`/`heal` effect (pure buffs/status/utility) show `—`. A multi-hit skill (e.g. Rogue's Flurry Assault) shows the **per-hit** amount.

### 1.2 Mage — ranged magic damage, fragile; fire/lightning/ice school

| Slot | Skill id | Name | Target | Effect (shape) | Buff? | % Scale + Bonus amount (R1/R2/R3) |
|---|---|---|---|---|---|---|
| 1 | `mage-fireball` | Fireball | singleEnemy | `damage` + chance to `applyStatusEffect "burning"` | — | 100 / 105 / 110% Base MagicPower + 10 / 13 / 16 MagicPower |
| 2 | `mage-lightning-bolt` | Lightning Bolt | singleEnemy | `damage` + chance to `applyStatusEffect "stunned"` | — | 100 / 110 / 115% Base MagicPower + 12 / 15 / 19 MagicPower |
| 3 | `mage-fire-pillar` | Fire Pillar | allEnemies | `damage`/enemy + chance to `applyStatusEffect "burning"` **per enemy** (rolled separately for each target, both accuracy and proc) | — | 80 / 85 / 90% Base MagicPower + 12 / 15 / 19 MagicPower |
| 4 | `mage-lightning-storm` | Lightning Storm | allEnemies | `damage`/enemy + chance to `applyStatusEffect "stunned"` **per enemy** | — | 80 / 90 / 100% Base MagicPower + 15 / 20 / 30 MagicPower |
| 5 | `mage-ice-age` | Ice Age | allEnemies | `damage`/enemy — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — | 110 / 120 / 130% Base MagicPower + 20 / 25 / 35 MagicPower |

*All of Mage's skills are `isMagic: true`, so the engine substitutes `magicPower` for `attack` in the same formula (`amount + mitigatedOffense(magicPower * offenseMultiplier, defense)`) — see the "% Scale + Bonus amount" column note under section 1.1 for how `offenseMultiplier` is read per skill/rank from `data/classes.json`.*

*Mage is purely fire/lightning/ice, with a kit focused on damage plus burn/stun procs. Bludgeon (slot 0) covers the "free action when out of mana" role. MP costs, damage amounts, and proc chances: `data/classes.json`.*

### 1.3 Rogue — single-target burst, highest speed in the party

| Slot | Skill id | Name | Target | Effect (shape) | Buff? | % Scale + Bonus amount (R1/R2/R3) |
|---|---|---|---|---|---|---|
| 1 | `rogue-poison-coat` | Poison Coat | self | `applyStatusEffect "poison-coat"` (self-buff, **does not** deal damage itself — every `damage` effect this actor deals while the buff is active automatically carries `applyStatusEffect "poisoned"` onto the target hit; see "on-hit rider" in `docs/technical-decisions.md` §4.2) | ✅ | — |
| 2 | `rogue-knife-throw` | Knife Throw | singleEnemy | `damage` | — | 90 / 100 / 110% Base ATK + 12 / 15 / 19 ATK |
| 3 | `rogue-backstab` | Backstab | singleEnemy | `damage` | — | 115 / 125 / 140% Base ATK + 15 / 20 / 25 ATK |
| 4 | `rogue-poison-bomb` | Poison Bomb | allEnemies | `damage`/enemy + `applyStatusEffect "poisoned"` per enemy — accuracy rolled separately per enemy | — | 50 / 55 / 60% Base ATK + 10 / 20 / 30 ATK |
| 5 | `rogue-flurry-assault` | Flurry Assault | singleEnemy | several consecutive `damage` hits — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — | 45 / 55 / 65% Base ATK + 12 / 15 / 20 ATK per hit (×3 hits) |

*Poison Coat is a self-buff that "coats the weapon in poison" — its value comes indirectly through subsequent hits. Rogue has no dedicated defensive skill — the kit is 100% offense/debuff. MP costs, damage amounts, and cooldowns: `data/classes.json`.*

**On Poison Coat and the "buffs are always 1 turn" rule**: `poison-coat` is **not** forced down to a 1-turn duration the way Shield Guard/Rally are, even though it is also a self-buff — see `rogue-poison-coat`'s `applyStatusEffect` effect in `data/classes.json` for its actual `durationTurns`. `poison-coat` carries no `modifyCombatStat` — it's a buff-rider (it toggles the "attacks auto-apply poison" mechanic). Its cooldown follows the shared "duration + 1" formula (§1.7, "Design notes").

### 1.4 Acolyte — healing + team-wide fear reduction

| Slot | Skill id | Name | Target | Effect (shape) | Buff? | % Scale + Bonus amount (R1/R2/R3) |
|---|---|---|---|---|---|---|
| 1 | `acolyte-prayer` | Prayer | singleAlly | `modifyStat fear` | — | — |
| 2 | `acolyte-heal` | Heal | singleAlly | `heal` | — | 90 / 100 / 110% Base MagicPower + 16 / 22 / 30 MagicPower |
| 3 | `acolyte-purify` | Purify | **singleAlly OR singleEnemy** (the player chooses the side when targeting) | targeting an ally → `removeStatusEffect` (strips 1 debuff); targeting an enemy → `damage` | — | ally: — · enemy: 100 / 110 / 120% Base MagicPower + 15 / 20 / 27 MagicPower |
| 4 | `acolyte-mass-heal` | Mass Heal | allAllies | `heal` + `modifyStat fear` | — | 60 / 70 / 80% Base MagicPower + 15 / 20 / 25 MagicPower |
| 5 | `acolyte-divine-descent` | Divine Descent | **allAllies AND allEnemies at once** | allies → `heal` + `modifyStat fear`; enemies → `damage` — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4) | — | heal allAllies : 70 / 75 / 80% Base MagicPower + 25/30/40 · dmg allEnemies : 80 / 85 / 90% Base MagicPower + 20/25/30 MagicPower |

*None of Acolyte's skills are marked "Buff?" — `modifyStat fear` is an instant adjustment, not routed through `applyStatusEffect`/`durationTurns`.*

*Acolyte does have real damage options (Purify targeting an enemy, Divine Descent, and the Punch basic attack) alongside its primary healer role. MP costs, heal/damage amounts, and cooldowns: `data/classes.json`.*

### 1.5 Viking — hybrid physical/lightning berserker, high risk/extremely high damage

**Status: implemented.** Viking is a real class in `data/classes.json`, alongside the 4 original classes above. The 2 schema fields this class needed (`onHitAoeDamage` on `StatusEffectDefinition`, `conditionalBonus` on `SkillDefinition` — see section 1.5.2) exist in `src/types.ts`. Base stats (attack/magicPower/defense/maxHp/maxMp/aggro/speed) and `growthWeights`: `data/classes.json` — this section describes shape only, not current tuning (same caveat as the rest of this document).

`magicPower` feeds the damage portion of the passive proc `storm-empowered` (section 1.5.2); it is not used to scale active skills — all of the Viking's active skills are physical.

#### 1.5.1 Skill table (shape only — mp/damage/cooldown live in `data/classes.json`)

Basic attack (slot 0, same as every class — section 1.0): **Axe Slash** (`viking-axe-slash`), physical.

| Slot | Skill id | Name | Target | Effect (shape) | Buff? | % Scale + Bonus amount (R1/R2/R3) |
|---|---|---|---|---|---|---|
| 1 | `viking-lightning-axe` | Lightning Axe | self | `applyStatusEffect "storm-empowered"` + temporary defense debuff + temporary aggro buff | ✅ | — |
| 2 | `viking-frenzied-slash` | Frenzied Slash | singleEnemy | `damage` (physical) + chance to `applyStatusEffect "bleeding"` — **conditionalBonus**: extra `ignoreDefensePercent` if currently carrying `storm-empowered` | — | 95 / 100 / 105% Base ATK + 9 / 12 / 15 ATK |
| 3 | `viking-throw-axe` | Throw Axe | singleEnemy | `damage` (physical) — same `storm-empowered` conditionalBonus | — | 100 / 107 / 115% Base ATK + 16 / 20 / 25 ATK |
| 4 | `viking-spin-axe` | Spinning Axe | allEnemies | `damage`/enemy + chance to `applyStatusEffect "bleeding"` — same `storm-empowered` conditionalBonus | — | 70 / 77 / 85% Base ATK + 15 / 20 / 30 ATK |
| 5 | `viking-thunder-god-fury` | Thunder God's Fury | allEnemies | `damage`/enemy — **always hits** (isUltimate), a bigger `storm-empowered` conditionalBonus, **and consumes `storm-empowered`** after use | — | 80 / 100 / 120% Base ATK + 30 / 40 / 50 ATK |

*Skills 2-5 are all purely physical (not `isMagic`) — the Viking's magic damage only comes indirectly through the `storm-empowered` proc (1.5.2), not directly through the skill formula the way Mage/Acolyte work.*

#### 1.5.2 Engine mechanics the Viking needed

The Viking needed **2 fields not present** in the schema before it (`src/types.ts`) — this was the part that went beyond "just adding data", both now implemented:

**a) `onHitAoeDamage` on `StatusEffectDefinition`** — a buff that deals its own AoE damage every time the bearer lands a hit (basic attack or skill), similar to the existing on-hit rider mechanic (`onHitStatusEffectId`, used by `poison-coat` — section 1.3, `docs/technical-decisions.md` §4.2) but dealing AoE damage instead of applying a status to a single target:

```ts
onHitAoeDamage?: { amount: number; isMagic?: boolean; ignoreDefensePercent?: number };
```

New status effect `storm-empowered` (shape — actual `amount`/`ignoreDefensePercent` live in `data/status-effects.json`, `durationTurns` on `viking-lightning-axe`'s applying effect in `data/classes.json`; row also included in the summary table, section 1.7):

```json
{
  "id": "storm-empowered",
  "name": "Storm-Empowered",
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
  "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }]
}
```

### 1.6 Plague Doctor — debuffer/support, favors effects over raw damage

**Status: implemented.** Plague Doctor is a real class in `data/classes.json`. Base stats and `growthWeights`: `data/classes.json`, same caveat as section 1.5.

Role: an AoE debuffer (burn/poison/blind/weaken), with 1 single-target heal skill and 1 dual-purpose heal+debuff ultimate.

#### Skill table (shape only)

Basic attack (slot 0): **Vial Toss** (`plaguedoc-vial-toss`), `isMagic: true` (see the footnote under section 1.0).

| Slot | Skill id | Name | Target | Effect (shape) | Buff? | % Scale + Bonus amount (R1/R2/R3) |
|---|---|---|---|---|---|---|
| 1 | `plaguedoc-fire-vial` | Fire Vial | singleEnemy | `damage` + chance to `applyStatusEffect "burning"` | — | 90 / 95 / 105% Base MagicPower + 10 / 12 / 16 MagicPower |
| 2 | `plaguedoc-healing-draught` | Healing Draught | singleAlly | `heal` | — | 90 / 95 / 100% Base MagicPower + 15 / 20 / 25 MagicPower |
| 3 | `plaguedoc-blinding-vial` | Blinding Vial | singleEnemy | `damage` + chance to `applyStatusEffect "blinded"` | — | 80 / 85 / 90% Base MagicPower + 10 / 13 / 18 MagicPower |
| 4 | `plaguedoc-toxic-fog` | Spreading Toxic Fog | allEnemies | `damage`/enemy + chance to `applyStatusEffect "poisoned"` + chance to `applyStatusEffect "weakened"` | — | 50 / 60 / 70% Base MagicPower + 15 / 25 / 40 MagicPower |
| 5 | `plaguedoc-total-plague` | Total Plague | allAllies **and** allEnemies at once | allies → `heal` + `removeStatusEffect`; enemies → `damage` + chance to `applyStatusEffect "poisoned"` + chance to `applyStatusEffect "burning"` — **always hits** (isUltimate) | — | heal allAllies : 60 / 65 / 70% Base MagicPower + 20/25/31 · dmg allEnemies: 70 / 75 / 85% Base MagicPower + 10/13/16 MagicPower |

*All skills are `isMagic: true`. Skill 5 splits its effects by `appliesToRelation: "ally" | "enemy"` (2 sides) — the same mechanic as `acolyte-divine-descent` (section 1.4).*

#### `blinded` — a new status, and the `rollHits()` change it needed

`burning`, `poisoned`, `weakened` already exist (section 1.7), reused as-is. `blinded` is new (shape below; current `accuracyPenaltyPercent` lives in `data/status-effects.json`, `durationTurns` on each applying effect in `data/classes.json`):

```json
{
  "id": "blinded",
  "name": "Blinded",
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

**Default `durationTurns` convention**: `durationTurns` is not a field of `StatusEffectDefinition` — it lives on the `applyStatusEffect` `SkillEffect` that applies the status (`docs/technical-decisions.md` §4), since the same status can be granted for a different number of turns by different sources. `applyStatusEffectToActor` (`resolver.ts`) falls back to a default of 1 turn when the applying effect doesn't set `durationTurns`.
- **Buffs (carrying `modifyCombatStat`, applied by the actor to itself/allies)**: default to that 1-turn fallback, matching the "buffs are always 1 turn" rule — no need to explicitly set `durationTurns` on the effect if it's 1, though it's still good practice to write it for clarity.
- **Debuffs/control effects (Poisoned, Burning, Stunned) and buff-riders that aren't stat-buffs (Poison Coat, Storm-Empowered)**: **must always declare `durationTurns` explicitly** on the applying effect, never relying on the default.

**Combat-stat buff/debuff floor (`minPercent`)**: a flat `modifyCombatStat` amount has the same problem a flat DoT tick had (§1.7.1) — it's a lot at level 1, negligible at level 100. Guard/-ii/-iii, Rally/-ii/-iii, Venom Edge/-ii, Overwatch/-ii/-iii, Weakened, Corroded, Agony, and Storm Recoil's defense debuff all carry a `minPercent` on their `modifyCombatStat` entry in `data/status-effects.json`, so the applied delta is whichever of the flat amount or a percent of the actor's own stat is larger in magnitude — see `docs/technical-decisions.md` §4.8. `aggro`-only buffs (Taunt, Storm Recoil's aggro line) deliberately have none: `aggro` doesn't grow with character level, so a flat aggro bonus never becomes relatively negligible.

### 1.7.1 DoT rework — `maxHpPercent`, Elite/Boss dampening, and "weak against X" vulnerability

**Status: implemented.** Every DoT (`perTurnEffects` with `kind: "damage"`) used to tick for a flat `amount` only, which became negligible late-run as character/monster `maxHp` keeps growing with level across the game's infinite dungeon floors (`06-level-system.md`). Fixed via a new optional field on `SkillEffect`, `maxHpPercent?: number`, added to the DoT's `perTurnEffects` damage entry — the tick formula in `tickCategoryUnconditionally` (`src/engine/combat.ts`) now folds `target.maxHp * (effect.maxHpPercent ?? 0) / 100` into the flat `amount` before the Elite/Boss dampening and vulnerability multiplier below are applied.

**All 6 existing DoTs (`data/status-effects.json`)**:

| id | `amount` (current → new) | `maxHpPercent` (new) | Duration | Source |
|---|---|---|---|---|
| `poisoned` | 4 | 2.5% | 3 turns | Poison Coat, Poison Bomb (Rogue) |
| `poisoned-ii` | 6 | 3% | 3 turns | Poison Bomb rank 2 |
| `poisoned-iii` | 8 | 4% | 3 turns | Poison Bomb rank 3 |
| `burning` | 6 | 3% | 2 turns | Fireball/Fire Pillar (Mage); Fire Vial/Total Plague (Plague Doctor) |
| `bleeding` | 6, **stacks up to 5×** | 2%, **stacks up to 5×** | 3 turns | Frenzied Slash/Spinning Axe (Viking) — see 1.12.6 for the stacking mechanic |
| `acid-burn` | 5 | 2.5% | 2 turns | Acid Spit (Slime) |

**Elite/Boss dampening — every DoT's total tick (flat + `maxHpPercent`) is reduced 20% when the target's `tier` is `"elite"` or `"boss"`** (`Monster.tier`, `02-monster.md` §2's tier system): `finalTick = Math.max(1, Math.round(rawTick * (isEliteOrBoss ? 0.8 : 1)))`. Exists specifically to keep `maxHpPercent` from becoming disproportionately strong against Elite/Boss's much larger HP pools — a flat-rate `%maxHp` tick would otherwise scale up faster on high-HP targets than intended.

**"Weak against X" vulnerability — generalizes the existing `poison-vulnerable` status to every DoT, standardized at +60%**: reuses the existing `StatusEffectDefinition.vulnerableTo: { statusEffectId: Id; multiplier: number }` field (already implemented — see `poison-vulnerable` above, and `vulnerabilityMultiplier()` in `src/engine/resolver.ts`), all at multiplier **1.6** (a target carrying "Weak Against Poison" takes its `poisoned` ticks ×1.6) applied **after** the Elite/Boss dampening above. **`poison-vulnerable`'s existing multiplier changes from 2× to 1.6×** (confirmed — a real balance change to an already-implemented status, not just new design), plus 3 new statuses following the identical shape: `burning-vulnerable`, `bleeding-vulnerable`, `acid-burn-vulnerable`, all at 1.6×.

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
  { "id": "guard-ii", "name": "Guard II", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }] },
  { "id": "guard-iii", "name": "Guard III", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }] },
  { "id": "rally-ii", "name": "Rally II", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] },
  { "id": "rally-iii", "name": "Rally III", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] }
]
```

`taunt` and `poison-coat` are **not** given rank variants: `taunt`'s aggro bonus already dominates target selection at rank 1 (diminishing returns from going higher), and `poison-coat` is a binary on-hit rider, not a magnitude stat.

#### Poison Coat — rank-up adds a separate attack-buff status (Rogue)

**Poison Coat** (Rogue, slot 1) scales by applying a *second*, independent status alongside the base `poison-coat` at rank 2/3, rather than by growing `poison-coat` itself: `poison-coat` (the on-hit poison rider, `onHitStatusEffectId: "poisoned"`, no `perTurnEffects` of its own) is cast unchanged at every rank, and `rogue-poison-coat`'s rank 2/3 `effects` additionally apply `venom-edge`/`venom-edge-ii` — a pure `modifyCombatStat attack` status with no on-hit rider. They're two distinct status ids (not one combined `poison-coat-ii`/`poison-coat-iii` status) so each can be categorized cleanly by the turn-countdown system (`src/engine/resolver.ts`'s `statusCategory`): `poison-coat` has no per-turn effect and is "special" by shape, while `venom-edge` is a stat modifier and would be "statMod" by shape — but a stat-mod status ticks down unconditionally at round-end with no free round, while a "special" status doesn't tick until the bearer's own next turn, so left to shape-inference alone the two would drift out of sync despite always being cast together. `venom-edge`/`venom-edge-ii` instead set `"tickCategory": "special"` (a StatusEffectDefinition field that overrides the shape-inferred category) so both statuses always tick — and expire — on the same turn. `rogue-poison-coat`'s `applyStatusEffect` effects declare the same `durationTurns` at every rank, so the existing `cooldownTurns = durationTurns + 1` formula still resolves to the same value at every rank — no conflict with the "cooldown never changes across ranks" rule. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "poison-coat", "name": "Poison Coat", "onHitStatusEffectId": "poisoned", "perTurnEffects": [] },
  { "id": "venom-edge", "name": "Venom Edge", "tickCategory": "special", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] },
  { "id": "venom-edge-ii", "name": "Venom Edge II", "tickCategory": "special", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] }
]
```

`rogue-poison-coat`'s rank 2 `effects` apply `["poison-coat", "venom-edge"]`; rank 3 applies `["poison-coat", "venom-edge-ii"]`. The attack-bonus progression matches the step size used for `rally-ii`/`rally-iii` above, for consistency across all attack-buff statuses in this system. The on-hit poison rider itself (`poison-coat`'s `onHitStatusEffectId: "poisoned"`) is carried over unchanged on every rank — rank-up only adds the attack buff, it does not touch the "poison level" applied on hit (that stays base `poisoned`, level 1, same as every other non-Poison-Bomb source per the note below).

#### Poison Bomb — poison potency scales via leveled `poisoned` variants (exclusive to this skill)

Unlike Poison Coat, **Poison Bomb's rank-up does scale its poison** — this is the one skill in the whole system where the applied status itself gets stronger per rank, via 2 rank-exclusive variants of `poisoned`. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "poisoned-ii", "name": "Poisoned II", "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }] },
  { "id": "poisoned-iii", "name": "Poisoned III", "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }] }
]
```

**This scaling is exclusive to Poison Bomb.** Every other source of poison in the game — Poison Coat's on-hit rider, Snake's regular-monster skill (`02-monster.md`), and any future item/skill — keeps applying the plain, un-leveled `poisoned` ("poison level 1") regardless of the caster's rank in anything. There is no shared "global poison level"; `poisoned-ii`/`poisoned-iii` only ever come from Poison Bomb ranks 2/3.

#### Storm-Empowered — rank scaling (Viking)

`storm-empowered` (Lightning Axe's self-buff, section 1.5.2) is the Viking's signature rider — its `onHitAoeDamage.amount` **is** the skill's core value, the same situation as Poison Bomb's `poisoned` above and Poison Coat's attack buff. It has 2 rank-exclusive variants scaling that amount up; `ignoreDefensePercent` stays fixed and `viking-lightning-axe`'s applying effect declares the same `durationTurns` at every rank, so the existing `cooldownTurns = durationTurns + 1` formula still holds at every rank. The splash's `magicPower` contribution is also scaled by `onHitAoeDamage.offenseMultiplierPercent` (80/90/100 at rank 1/2/3, `docs/technical-decisions.md` §4.8) — previously every rank used the caster's full, unscaled `magicPower` on every hit, which made the proc's per-hit output outsized relative to a dedicated damage skill. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "storm-empowered-ii", "name": "Storm-Empowered II", "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "offenseMultiplierPercent": "<see data/status-effects.json>", "ignoreDefensePercent": "<see data/status-effects.json>" } },
  { "id": "storm-empowered-iii", "name": "Storm-Empowered III", "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "offenseMultiplierPercent": "<see data/status-effects.json>", "ignoreDefensePercent": "<see data/status-effects.json>" } }
]
```

The self-debuff piece of Lightning Axe (`defense`/`aggro`) and every skill's `conditionalBonus.ignoreDefensePercentBonus` stay **identical at every rank** — same reasoning as `taunt` above: these are enabling/auxiliary mechanics, not the thing being power-scaled. `bleeding`'s proc-chance scales per rank the same way Fireball/Lightning Bolt's burn/stun chances do — its own magnitude stays the shared, un-leveled version, consistent with the "poison/burn/stun magnitude doesn't scale, only its odds do" pattern already used for the 4 original classes.

#### Blinded — rank scaling (Plague Doctor)

No new statuses needed. `blinded` (Blinding Vial's debuff, section 1.6) follows the same pattern as Fireball/Lightning Bolt: only its proc-chance scales per rank, its magnitude (miss-chance percentage) stays fixed — it's an enemy-facing proc, not the caster's own signature buff, so it's treated like `burning`/`stunned`/`poisoned`, not like `guard`/`rally`/`storm-empowered`. `poisoned`/`burning`/`weakened` procced by Toxic Fog/Total Plague stay the plain, un-leveled versions, consistent with the rule above that only Poison Bomb ever applies a leveled `poisoned` variant. Total Plague's `removeStatusEffect` (ally branch) is binary and unchanged at every rank, same treatment as Purify's ally branch.

Neither Viking nor Plague Doctor needed new rank thresholds — both reuse the same threshold table as the 4 original classes (`data/classes.json`), same level-threshold shape and the same "cooldown never changes / mpCost rises slightly / effects hand-tuned per skill" rules.

#### Rank tables — all 30 skills

Per-rank `mpCost`/`effects`/`unlockLevel` for every skill of every class (all 6): `data/classes.json`, under each skill's `ranks` array. This document does not hand-maintain a copy of those tables — read `data/classes.json` directly for current numbers, since rank tuning changes independently of this doc.

#### Engine/data summary

- **Data**: `data/classes.json` — `ranks` on all 30 class-specific skills; `data/status-effects.json` — the 12 rank-variant statuses (`guard-ii/iii`, `rally-ii/iii`, `venom-edge/venom-edge-ii`, `poisoned-ii/iii`, `storm-empowered-ii/iii`).
- **Code**: `SkillDefinition.ranks` + the `getEffectiveSkill` lookup helper, used wherever a character skill is cast/displayed.

### 1.9 Archer — single-target damage, CC, critical hits, stat debuffs

**Status: implemented.**

**Base stats (`data/classes.json`)**: `baseAttack: 16`, `baseDefense: 8`, `baseMaxHp: 110`, `baseMaxMp: 40`, `baseMagicPower: 0`, `baseAggro: 9`, `baseSpeed: 13` — between Vanguard (14) and Rogue (17), reflecting a single-target physical striker. Confirmed against the roster's `BalancePoints` formula (section 1's "Base stats balancing formula").

Basic attack (slot 0): **Quick Shot** (`archer-quick-shot`), physical, bow.

| Slot | Skill id | Name | Target | Effect (shape) | Buff? | % Scale + Bonus amount (flat) |
|---|---|---|---|---|---|---|
| 1 | `archer-aimed-shot` | Aimed Shot | singleEnemy | `damage` + high `critChance` (signature crit skill) | — | 90% Base ATK + 16 ATK |
| 2 | `archer-overwatch` | Overwatch | self | `applyStatusEffect "overwatched"` — see section 1.12.2 for the interrupt mechanic | ✅ | — |
| 3 | `archer-volley-shot` | Volley Shot | allEnemies | `damage`/enemy — **needs the new 60% offense multiplier**, see below | — | 60% Base ATK + 10 ATK |
| 4 | `archer-crippling-shot` | Crippling Shot | singleEnemy | `damage` + chance to `applyStatusEffect "stagger"` (skips the target's next turn) + chance to `applyStatusEffect "weakened"` (defense debuff, reused from section 1.7) | — | 80% Base ATK + 16 ATK |
| 5 | `archer-deadeye-shot` | Deadeye Shot | singleEnemy | `damage` — **always hits**, `critChance` 100%, effectiveness scales down with fear via the ultimate formula (`04-fear-combat.md` §4) | — | 90% Base ATK + 20 ATK |

**"Bonus amount" column**: same meaning as the 6 original classes (1.1-1.6) — the percent/flat numbers come from that skill's rank-1 `SkillEffect.offenseMultiplierPercent`/`amount` in `data/classes.json`, shown here at rank 1; every skill has all 3 ranks implemented, and the percent climbs at rank 2/3 the same way the flat amount does (see `data/classes.json` for the exact per-rank figures). Skills with no `damage` effect show `—`.

**Volley Shot** hits for **60%** of the caster's `attack`, weaker than a skill that uses `attack` at its full, un-scaled value — introduced via the new `offenseMultiplierPercent?: number` `SkillEffect` field (absent/100 = full, un-scaled `attack`/`magicPower`), applied as `(attack * offenseMultiplierPercent/100) + amount` before defense mitigation. The field was added for Archer/Ninja (this class and 1.10) but has since been retuned onto most damage/heal skills across every class, not just these — see section 1.12.7.

*No self-buff beyond Overwatch — Archer is close to 100% offense/control, matching the brief ("single-target damage, CC, crit, stat debuff"). Arrow Rain (an earlier AoE draft) was dropped in favor of Volley Shot.*

#### 1.9.1 Overwatch — the interrupt mechanic

`archer-overwatch` is `isBuff: true`, so it already receives the existing "buff skills get a temporary speed bonus for turn-order purposes" rule (Design notes, below) — in practice this means it resolves before monster turns in the round it's cast, without needing any new "carry the buff into next round" fallback.

Mechanic: while the caster carries `overwatched`, the moment resolution reaches **the next monster's queued turn** (i.e. the first monster in `turnQueue` that hasn't acted yet this round), the Archer reactively fires at that monster **before** the monster's action resolves:
- Roll accuracy as normal.
- **Hit** → deals `damage` to that monster, **and the monster's queued action for this round is discarded** (the monster's turn is skipped entirely — no damage/effect from it this round).
- **Miss** → the monster's queued action resolves normally; `overwatched` is still consumed (1 shot per cast, win or lose).

This needs a new hook in the round-resolution loop (`src/engine/combat.ts`'s `resolveRound`), not just a status effect — it is the first *reactive* character mechanic in the game (every other skill only ever resolves on the caster's own turn).

### 1.10 Ninja — weaker raw damage than Archer/Rogue, stealth, a real decoy clone, bleeding, and finishing low-HP targets

**Status: implemented.**

**Base stats (`data/classes.json`)**: `baseAttack: 14`, `baseDefense: 7`, `baseMaxHp: 115`, `baseMaxMp: 42`, `baseMagicPower: 0`, `baseAggro: 8`, `baseSpeed: 16` — deliberately below both Archer (16) and Rogue (17), matching the brief ("weaker than Archer and Rogue"). Confirmed against `BalancePoints`, same as Archer above.

Basic attack (slot 0): **Kunai Strike** (`ninja-kunai-strike`), physical, kunai.

| Slot | Skill id | Name | Target | Effect (shape) | Buff? | % Scale + Bonus amount (flat) |
|---|---|---|---|---|---|---|
| 1 | `ninja-smoke-bomb` | Smoke Bomb | self | `applyStatusEffect "stealthed"` — untargetable, breaks on the Ninja's next attack; see 1.10.1 | ✅ | — |
| 2 | `ninja-shadow-clone` | Shadow Clone | self | summons combatant `ninja-clone` (flat, level/stat-independent `maxHp` — does **not** scale with the Ninja's own `maxHp`; high `aggro` — weighted only, not a forced taunt) — vanishes after **2** actions taken. Whenever it's removed by dying or running out of actions (not by being dismissed/recast), it detonates: AoE `damage` to every enemy + a chance to apply `bleeding`. See section 1.12.4 and 1.12.8 | ✅ | detonation: 30 / 40 / 50% Base ATK + 10 / 15 / 22 ATK, 30 / 33 / 37% chance to apply 1 `bleeding` stack |
| 3 | `ninja-throwing-knives` | Throwing Knives | singleEnemy | `damage` + chance to `applyStatusEffect "bleeding"` (60%, stacking — 1.12.6) + **40% chance to throw a 2nd knife** (independent damage + bleeding roll) — no `executeBonus`; Death Mark alone carries the ninja's execute mechanic | — | 80% Base ATK + 10 ATK |
| 4 | `ninja-shuriken-storm` | Shuriken Storm | allEnemies | `damage`/enemy, each enemy struck **1-2× (rank 1) / 1-3× (rank 2) / 2-3× (rank 3)** — hit count rolled per enemy — each individual hit has 60% chance to `applyStatusEffect "bleeding"` | — | 55% Base ATK + 8 ATK per hit |
| 5 | `ninja-death-mark` | Death Mark | singleEnemy | `damage`, scaling `+5%` per existing `bleeding` stack on the target (via `scalesWithStatusStacks`, 1.12.6), plus a flat `executeBonus` if the target is below 30% HP — **always hits**, effectiveness scales down with fear via the ultimate formula, applies/refreshes 1 `bleeding` stack | — | (100 + 5×stacks)% Base ATK + 14 ATK |

**"% Scale + Bonus amount" column**: same meaning as Archer's table above — the numbers are from `baseAttack: 14`, shown at rank 1; every skill has all 3 ranks implemented, and both the percent and the flat amount climb at rank 2/3 (`data/classes.json`). Throwing Knives (80%) and Shuriken Storm (55%) both use `offenseMultiplierPercent` (1.12.7); Death Mark's base% is dynamic — `100% + 5%` per existing `bleeding` stack on the target, read via `scalesWithStatusStacks` (1.12.6), on top of its own rank-scaled base (100/115/135%), not a fixed multiplier.

*Base damage on skills 3-5 is intentionally tuned lower than Archer/Rogue's equivalents (per the brief, "weaker than Archer and Rogue") — Ninja's value comes from stealth, drawing hits off the team via Shadow Clone, and execute burst, not raw per-hit damage.*

#### 1.10.1 Stealth (untargetable) and the stealth-break bonus

New status `stealthed`: carries a new `StatusEffectDefinition` field `untargetable: true` — while active, the bearer is excluded from every enemy skill's target resolution (`singleEnemy`/`allEnemies` target-picking skips it entirely, same as a dead combatant). Breaks automatically the instant the Ninja lands an attack (basic attack or skill).

The breaking attack itself carries a bonus, via a new `StatusEffectDefinition` field on `stealthed`, e.g. `breakBonus: { basicAttackGuaranteedCrit: true; skillDamageBonusPercent: 10 }`:
- If the breaking attack is the **basic attack** → guaranteed critical hit (100% `critChance` for that hit only).
- If the breaking attack is a **skill** → that skill's damage is increased by **+10%**.

### 1.11 Summoner — minions that heal, tank, and deal damage, scaled off the caster's own stats

**Status: implemented.**

**Base stats (`data/classes.json`)**: `baseAttack: 4`, `baseDefense: 7`, `baseMaxHp: 90`, `baseMaxMp: 55`, `baseMagicPower: 12`, `baseAggro: 7`, `baseSpeed: 10` — low attack/high magicPower like Acolyte/Plague Doctor, since Summoner's own combat output is secondary to its minions; low `aggro` since its minions (especially Stone Golem, `aggro: 15`) are meant to draw enemy attacks instead. BalancePoints ≈25.3, within ±10% of the ~24.7 roster average. Minion stat-derivation ratios off these numbers: `base + (percent/100) * owner[sourceStat]` per stat at cast time (`SkillEffect.summonCastId` → `data/summons.json`'s `casts`), the same mechanism Ninja's clone uses — see the implementation note at the end of 1.11.1 for how the table below maps onto that.

Basic attack (slot 0): **Totem Strike** (`summoner-totem-strike`), physical, weak — Summoner leans on its minions, not its own combat.

| Slot | Skill id | Name | Target | Effect (shape) | Buff? | % Scale + Bonus amount (Summoner's own cast) |
|---|---|---|---|---|---|---|
| 1 | `summoner-summon-goblin` | Summon Goblin | self | summons `goblin-thrower` — low HP, low `aggro`, moderate `attack` (all scaled off the Summoner's own stats, 1.12.4). Each of its own turns: 40% Rock Throw (ranged `damage`, singleEnemy) / 60% basic attack. Vanishes after 3 actions taken. | ✅ | — (the cast itself deals no damage; see minion stats below) |
| 2 | `summoner-summon-spirit` | Summon Spirit | self | summons `healer-spirit` — low HP/`aggro`. Each turn: by default heals the ally with the lowest %HP; 40% chance to instead cast a party-wide heal (`allAllies`) that turn. Vanishes after 3 actions taken. | ✅ | — |
| 3 | `summoner-summon-golem` | Summon Golem | self **+** singleEnemy | summons `stone-golem` — high HP, moderate `attack`, **high `aggro` (15)**. Each turn: 40% Stomp (`damage`, allEnemies) / 60% basic attack. Vanishes after 3 actions taken. **On cast, also deals `damage` directly to the chosen enemy** | ✅ | 90% Base ATK + 12 ATK |
| 4 | `summoner-mastery` | Mastery Summoner | self | **Rank 1**: `applyStatusEffect "minion-empowerment"` — buffs HP/`attack` of every minion currently active plus any summoned later this combat. **Rank 2/3**: a stronger `minion-empowerment-ii/iii` **+ passively raises `maxActiveMinions` to 2/3** — the cap increase applies purely from reaching that rank's `unlockLevel` (character level), independent of whether Mastery has actually been cast this combat; only the HP/attack buff itself needs casting. See 1.12.4. | ✅ | — |
| 5 (ultimate) | `summoner-summon-imp` | Summon Hellfire Imp | self **+** allEnemies | summons `hellfire-imp` — moderate HP, high `attack`, low `aggro`; every attack it lands (basic or skill) has 60% chance to `applyStatusEffect "burning"`. Each turn: 40% Hellfire Strike (high single-target `damage` + new status "agony" = DoT + `attack` debuff) / 60% basic attack. Vanishes after 3 actions taken. **On cast, also deals `damage` to allEnemies directly** — **always hits** (isUltimate), effectiveness scales down with fear via the ultimate formula | — | 80% Base MagicPower + 8 MagicPower (`isMagic`, the on-cast AoE burst only — the Imp's own later turns use its own stats, see below) |

- Default cap (Mastery not yet at rank 2/3): **1 minion** active at a time — casting a new summon skill dismisses whichever minion is currently active. Rank 2 → up to **2** minions of **different types** simultaneously; rank 3 → up to **3**.
- All 4 summon skills (slots 1, 2, 3, 5) cost a large amount of MP.
- Every minion's stats scale off the Summoner's own stats at the moment of casting (1.12.4) — a minion does not grow further as the Summoner grows mid-combat.
- Slot 5 is Summoner's only `isUltimate: true` skill, satisfying the "every class has exactly 1 ultimate in slot 5" rule (Design notes, below) even though its main payload (Summon Hellfire Imp) is also a minion-summon skill like slots 1-3 — the AoE `damage` component is what makes it a proper ultimate.

#### 1.11.1 Minion stats and their own signature-skill scale

**Original design proposal** (fraction of the Summoner's own `baseAttack: 4` / `baseMagicPower: 12`, per the minion's own role) — see the implementation notes below the table for how this maps onto the shipped `data/summons.json`/`data/classes.json`, and where the shipped shape differs:

| Minion | `maxHp` | `defense` | `aggro` | `attack` | `magicPower` | Signature skill | % Scale + Bonus amount (minion's own) |
|---|---|---|---|---|---|---|
| `goblin-thrower` | 30% base HP | 80% base DEF | 5 | 50% Base magicPower + 5/15/25 | 0 | Rock Throw (singleEnemy) | 100% minion ATK + 8 |
| `stone-golem` | 120% base HP | 80% base DEF | 15 | 60% Base magicPower + 10/25/40 | 0 | Stomp (allEnemies) | 90% minion ATK + 10 |
| `hellfire-imp` | 80% base HP | 80% base DEF | 5 | 0 | 80% Base magicPower + 15/30/50 | Hellfire Strike (singleEnemy) | 120% minion magicPower + 10 |
| `healer-spirit` | 50% base HP | 80% base DEF | 5 | 0 | 50% Base magicPower + 5/10/15 | Heal (default, singleAlly — lowest %HP) / party heal (40% proc, allAllies) | 100% minion MagicPower + 6 (single) / 80% minion MagicPower + 4 (party, per target) |

*Every minion's basic attack (the other 60% of its action-weight roll) uses the same `attack`/`magicPower` value above with `amount: 0`, the same "100% base, no bonus" shape as every character's own basic attack (section 1.0).*

**The 3 numbers in the `attack`/`magicPower` columns (e.g. `5/15/25`) are R1/R2/R3**: the minion's own stat grows with the **rank of the summon skill that called it out** (`summoner-summon-goblin`, etc.), the same 3-rank mechanism already used by every other class-specific skill (section 1.8) — e.g. `goblin-thrower`'s `magicPower` (derived from the Summoner's own `magicPower`) is `50% Base magicPower + 5` while `summoner-summon-goblin` is rank 1, `+15` once it reaches rank 2, `+25` at rank 3. This is **not** a per-action-within-combat progression (the minion doesn't get stronger across its own 3 turns before vanishing) — it only changes across combats/levels, as the summon skill itself ranks up.

*Resolved on implementation*: `hellfire-imp`'s signature-skill scale (`120% minion magicPower + 10 ATK`) turned out not to need a decision either way — `SkillEffect.amount` (the flat term) is stat-agnostic in the actual damage formula (`finalDamage = amount + mitigatedOffense(offensiveStat * offenseMultiplier, ...)`), so a flat `+10` reads the same regardless of which offensive stat the skill's `isMagic` flag routes through. No hybrid-stat mechanic was needed.

*Confirmed on implementation, not a typo*: `goblin-thrower` and `stone-golem` really do have their `attack` column formula read off the Summoner's own `magicPower` (their own `magicPower` column is separately `0`, since neither uses magic damage itself) — the class is magic-leaning (`baseAttack: 4` vs `baseMagicPower: 12`), so a physically-attacking minion's power is deliberately funded by the Summoner's magic investment rather than its near-nonexistent own attack. Implemented via `sourceStat: "magicPower"` on the cast profile's `attack` formula (see the implementation note below the table) — set on `goblin-thrower`/`stone-golem` only; every other minion (and Ninja's clone) keeps `sourceStat: "attack"`.

*Implementation note*: each minion's cast configuration (`SummonCast`: `archetypeId`, `maxActions`, `aggro`, and a `stat` formula per `maxHp`/`attack`/`defense`/`magicPower`) lives in `data/summons.json`'s `casts` array, not inline in `data/classes.json` — the summoning skill's `SkillEffect` just carries a `summonCastId` (by convention, the same id as the skill itself) pointing at it. 1 cast profile is shared across all 3 of the skill's ranks; `SummonStatFormula.percent` is a plain number when it's the same at every rank, or a `[rank1, rank2, rank3]` tuple when it isn't (the engine resolves which rank is active from the caster's level via `effectiveSkillRank`). Each formula computes as `base + (percent / 100) * owner[sourceStat]` — a direct match for the table's `X% Base stat + N` shape (`percent` = the `%`, `base` = the flat `+N`, `sourceStat` = which of the Summoner's own stats it reads). Every shipped minion currently uses `base: 0` (the numbers above were re-expressed as pure percentages when this was first implemented, before the flat term existed) — the flat `+5/15/25`-style bonuses from the original proposal above haven't been restored as real `base` values; the schema now supports it if that's wanted. Concrete values are in `data/summons.json`.

*Also implemented differently*: Healer Spirit's "default heal / 40% proc party heal" was shipped as 2 separate signature skills (`spirit-heal-single` targeting the lowest-%HP ally, `spirit-heal-party` targeting `allAllies`), chosen via the archetype's `actionWeights` (60/40) — the same weighted-random-pick mechanism a minion already uses to choose between its signature skill and a basic attack, rather than a `chance`-gated proc nested inside 1 skill. Functionally equivalent to the proposal; just reuses an existing mechanism instead of adding a new one.

### 1.12 New engine mechanics needed for Archer/Ninja/Summoner

All 7 mechanics below are implemented.

#### 1.12.1 Critical hits (`critChance` / `critMultiplierPercent`)

New optional fields on `SkillEffect`: `critChance?: number` (0-1, rolled independently of the accuracy roll, same pattern as an `applyStatusEffect` proc `chance`) and `critMultiplierPercent?: number` (shared default multiplier across every crit-capable skill unless a skill overrides it). Used by Archer's Aimed Shot, Arrow-adjacent AoE (Volley Shot does not itself crit per-skill in the current draft — only Aimed Shot/Deadeye Shot/Arrow-rain-style AoE crit), Deadeye Shot (100% `critChance`), and Ninja's stealth-break basic-attack guarantee (1.10.1).

*Alternative considered*: simulate "crit" by giving a skill a high `ignoreDefensePercent` instead of a true random crit roll — rejected because it produces a flat, predictable damage number every time rather than a genuine variance/gambling feeling, and it cannot be logged as a distinct "Critical Hit!" combat-log event the way a real crit roll can.

#### 1.12.2 Overwatch / interrupt — see 1.9.1 for the full mechanic

The first reactive (non-caster-turn) character mechanic in the game. Requires a hook in `resolveRound` (`src/engine/combat.ts`) that checks, before each monster's queued action resolves, whether any living character currently carries `overwatched`.

#### 1.12.3 Stealth / untargetable — see 1.10.1

New `StatusEffectDefinition` field `untargetable?: boolean`. Every place the engine builds a list of valid enemy targets for a `singleEnemy`/`allEnemies` skill must exclude any combatant currently carrying an `untargetable` status, the same way it already excludes dead combatants.

#### 1.12.4 Summoned combatant — shared by Ninja's clone and all 4 of Summoner's minions

New `CombatantRef` kind: `{ kind: "summon"; id: Id; ownerId: Id }`. A summon has its own HP/`aggro`/turn and takes a real slot in `turnQueue`, but is displayed **nested under its owner's own portrait** (e.g. a small "🐺 Clone: 12/12 HP" badge under the Ninja's/Summoner's HP bar) rather than occupying a new party-formation slot — this was chosen specifically so the summon is a "real combatant" (has HP, can be targeted and killed, acts on its own turn) without requiring a rework of the fixed party-formation UI.

- **Stats**: derived from the owner's own stats at the moment of summoning, via the cast profile named by `SkillEffect.summonCastId` (`data/summons.json`'s `casts`, 1 profile shared by a skill's 3 ranks — `base + (percent/100) * owner[sourceStat]` per stat, `sourceStat` normally the same-named owner stat but can cross over, e.g. a minion's `attack` sourced from the owner's `magicPower`; see 1.11.1 for concrete ratios) — a summon does not grow further as its owner grows mid-combat.
- **AI**: each summon type gets its own small action-weight table (`"basicAttack"` vs its 1 signature skill), the same shape as a monster archetype's `actionWeights` (`data/monsters.json`) — not a copy of monster AI, just the same weighted-random-pick pattern.
- **Lifespan**: a summon vanishes after it has **taken its turn N times** (N = 2 for Ninja's clone, 3 for all 4 of Summoner's minion types) — a skipped/stunned turn does **not** count toward N. It also vanishes immediately if its HP reaches 0. Either way of vanishing fires the summon's `deathBurst` if its cast profile has one (currently only Ninja's clone) — see 1.12.8.
- **Aggro**: summons participate in the existing aggro-weighted targeting formula like any other combatant — a high-`aggro` summon (Ninja's clone, Summoner's Golem) draws enemy attacks more often by weight, but this is **not** a forced/absolute redirect (no new targeting-override mechanic was added — see the Ninja aggro question in the design discussion).
- **Cap**: how many summons 1 owner may have active at once defaults to 1; Summoner's Mastery skill (1.11, slot 4) is the only way to raise it, up to 3.

*Alternative considered*: a lighter "pet-as-buff" model (no separate combatant, just an on-owner-action trigger, like Viking's `storm-empowered`) — rejected per the explicit choice to make both Ninja's clone and Summoner's minions real, individually-targetable combatants.

#### 1.12.5 Execute bonus (`executeBonus`)

New optional field on `SkillDefinition`: `executeBonus?: { hpPercentThreshold: number; bonusDamagePercent?: number; bonusDamageFlat?: number }` — if the target's current HP is below `hpPercentThreshold` (as a % of its own `maxHp`) when the skill resolves, the skill's damage gets an extra bonus (percentage-of-base and/or a flat add, per skill). Used by Ninja's Death Mark. **Distinct from** the existing Boss "Execute" charge-up mechanic (`06-level-system.md` §6.12, `Monster.executeCooldownTurns`/`isChargingExecute`/`executeTargetId`) — same word, unrelated mechanic; that one is a monster-side charge-then-unleash finisher untied to the target's HP%, this one is a character-side conditional damage bonus keyed directly to the target's HP%.

#### 1.12.6 Stackable status effects — `bleeding` becomes stackable, game-wide

New optional fields on `StatusEffectDefinition`: `stackable?: boolean`, `maxStacks?: number`, `perStackBonusPercent?: number` — when a stackable status is re-applied to a target that already carries it, instead of only refreshing `durationTurns` it also adds 1 stack (up to `maxStacks`), and its `perTurnEffects` damage is multiplied by `1 + (stacks - 1) × perStackBonusPercent/100` (`stacks` = current stack count, 1 on first application).

**`bleeding`'s concrete values**: `maxStacks: 5`, `perStackBonusPercent: 100` — i.e. **plain linear/additive stacking**, each additional stack is worth one more full base tick (not a softened diminishing bonus). With the new base tick from 1.7.1 (`6 + 2% maxHp`, before Elite/Boss dampening and "weak against" vulnerability), the cap at 5 stacks is exactly `5 × (6 + 2% maxHp) = 30 + 10% maxHp` per turn — confirmed against the design target.

This applies to the **shared** `bleeding` status (used by Viking since section 1.5, now also by Ninja) rather than a Ninja-exclusive copy — chosen explicitly over a separate status id, so Viking's Frenzied Slash/Spinning Axe also benefit from consecutive bleed procs stacking. This is an intentional, if secondary, buff to Viking's existing kit as a side effect of this change, not an oversight.

A new field is also needed to let a skill **read** a target's current stack count to scale its own damage — Ninja's Death Mark needs this (1.10 table, "+5% per existing bleeding stack"). Shape: a new optional `SkillEffect`/`SkillDefinition` field, e.g. `scalesWithStatusStacks?: { statusEffectId: Id; percentPerStack: number }`. No other skill in the game currently reads a status's stack count to scale itself — every existing conditional mechanic (`conditionalBonus`, Viking) only checks presence/absence of a status, not a magnitude.

#### 1.12.7 Offense multiplier (`offenseMultiplierPercent`) — needed for any skill whose base scaling isn't 100% of attack

Before Archer/Ninja, every skill in the game used the caster's `attack`/`magicPower` **at full, un-scaled value** in `mitigatedOffense` — there was no way to make a skill weaker (or stronger) than "100% of attack" on the base term, only `ignoreDefensePercent` (scales the *target's* defense down) and the flat `amount` (added after mitigation) existed.

Archer's Volley Shot (60%) and Ninja's Throwing Knives (80%)/Shuriken Storm (60%) needed their base offense scaled **down** — a deliberate weaker-per-hit tradeoff for Volley Shot's AoE reach and Throwing Knives/Shuriken Storm's extra-hit-chance/hit-count upside — which is what motivated the new optional `SkillEffect` field: `offenseMultiplierPercent?: number` (absent/`100` = the pre-Archer/Ninja unscaled behavior). Applied as `finalDamage = amount + mitigatedOffense(offensiveStat * (offenseMultiplierPercent ?? 100) / 100, effectiveDefense)`; `case "heal"` reads the same field the same way (`amount + magicPower * (offenseMultiplierPercent ?? 100) / 100`).

**Current status — no longer limited to those 3 skills.** The Archer/Ninja/Summoner pass that added this field was followed by a full retune of the 6 original classes' skills onto the same mechanism, so `offenseMultiplierPercent` now appears on almost every `damage`/`heal` effect across all 9 classes, with a value that typically **also climbs rank-to-rank** rather than staying fixed (e.g. Rogue's Backstab: 115% at rank 1 → 140% at rank 3). The "100% Base ATK"-style figures written into the per-class tables above (sections 1.1-1.6, 1.9-1.11) reflect each skill's actual current rank-1 percent, not a universal default — always check `data/classes.json` for the current per-rank value rather than assuming 100%.

#### 1.12.8 Summon death burst (`SummonCast.onDeath`) — Ninja's Shadow Clone

**Status: implemented.** Shadow Clone previously did nothing across its 3 ranks beyond the flat cast-profile numbers every rank shared — no rank progression at all. It now detonates once, dealing AoE `damage` to every living enemy plus a chance to apply 1 `bleeding` stack, whenever the clone leaves combat by **dying (a hit or a DoT tick) or running out of its 2 actions** — the rank progression that was missing lives entirely in this burst's numbers.

New optional field on `SummonCast` (`data/summons.json`): `onDeath?: { offenseMultiplierPercent, amount, sourceStat, statusEffectId?, statusEffectChance, durationTurns? }`, where `offenseMultiplierPercent`/`amount`/`statusEffectChance` follow the same scalar-or-`[r1, r2, r3]`-tuple convention as `SummonStatFormula.percent` (1.12.4) — resolved against the casting skill's active rank and frozen onto the summon at spawn time as `Summon.deathBurst`, the same "derived once, doesn't regrow with the owner" rule every other summon stat already follows (1.12.4's first bullet). `sourceStat` is the **owner's** stat the burst's offense scales off (`"attack"` for Shadow Clone, since the clone's own `attack` is always 0 — it deals no damage on its own turns, only through this burst) — not the summon's own stat, since most summons (Ninja's clone especially) don't carry a meaningful one.

At trigger time, the burst is applied as an ordinary `damage` effect against every living enemy (`amount + mitigatedOffense(sourceStat * offenseMultiplierPercent/100, targetDefense)`), reusing `offensiveStatOverride` (`ResolveContext`, added for Ability auto-damage — see the commit adding `offensiveStatOverride` to `resolveSkillEffect`) to substitute the frozen owner-stat snapshot in place of whatever the clone's own (always-0) `attack` would otherwise contribute, then a `statusEffectChance` roll per enemy for `statusEffectId`.

**Shadow Clone's concrete `onDeath`** (`data/summons.json`): `offenseMultiplierPercent: [30, 40, 50]`, `amount: [10, 15, 22]`, `sourceStat: "attack"`, `statusEffectId: "bleeding"`, `statusEffectChance: [0.3, 0.33, 0.37]`, `durationTurns: 3`.

**Triggering it reliably**: a summon can die on *any* actor's turn (an enemy's attack, another combatant's DoT tick), not just its own — `expireSummonIfDone` (the function that finalizes a done summon and fires its burst) is therefore called from more than one place in `resolveRound` (`src/engine/combat.ts`): once after the round's DoT-tick pass, and once after every combatant's turn, via a small sweep (`pruneDeadSummons`) over every summon still in `combat.combatants`. Once a summon is finalized it's removed from `combat.combatants`, so a later sweep call simply won't find it again — safe to call from multiple checkpoints without double-firing the burst.

**Deliberately excluded**: a manual dismiss (`dismissSummon` — recasting the same archetype to replace it, or eviction at the owner's minion cap) does **not** fire the burst. The detonation is meant to be the cost of the clone actually falling in battle, not a free repeatable AoE nuke from recasting Shadow Clone on demand.

### Design notes
- Each class has exactly 1 "ultimate" skill in slot 5 — it **always hits, with no accuracy roll**, but its effectiveness (damage/heal) scales down by fear tier via a dedicated formula, replacing the usual hit/miss roll + flat damage-reduction combo used by ordinary skills (`04-fear-combat.md` section 4). Ultimates use `isUltimate: true` and share a fixed `cooldownTurns` across every class (`data/classes.json`) — they do not use `usesPerCombat` (see the last bullet below).
- `modifyCombatStat` (attack/defense/aggro/speed buffs/debuffs) is always routed through `applyStatusEffect` — there is no effect that adjusts a combat stat instantly or permanently; every application carries a `durationTurns` on the applying `SkillEffect` (not on `StatusEffectDefinition` — see the "Default `durationTurns` convention" note below).
- `StatusEffectDefinition` is shared by both buffs (e.g. "guard") and debuffs (e.g. "poisoned") — both expire via the `durationTurns` set by whichever effect applied them. Full table + default-duration convention: section 1.7.
- **Skills with a `chance` on 1 effect** (e.g. Fireball's burn proc) only roll for that specific effect, separate from the skill's overall accuracy roll — the main `damage` effect still always applies if the skill hits; only the secondary (proc) effect is probabilistic.
- **AoE skills** (`allEnemies`, or the "enemy" half of a two-sided skill): accuracy is rolled **separately for each target**, not once for the whole skill — one enemy dodging doesn't mean the whole group dodges.
- **Two-sided skills** (Purify, Divine Descent, Total Plague): the effect applied depends on whether the target is an ally or an enemy, via each effect's own `appliesToRelation: "ally" | "enemy"` filter, rather than sharing one effect list — see `docs/technical-decisions.md` §4.4.
- **Cooldown** (`cooldownTurns`): every class-specific skill beyond the first two slots has a cooldown (slots 1-2 have none). 2 formulas:
  - **Buff skills** (`isBuff: true` — Shield Guard, Rally, Poison Coat, Lightning Axe): `cooldownTurns = the skill's own applyStatusEffect effect's durationTurns + 1`.
  - **Other damage/utility skills + ultimates**: assigned by hand based on power level, not a fixed formula (ultimates share one fixed value across classes — `data/classes.json`).
- `usesPerCombat` is not used by any character skill — every skill uses `cooldownTurns`, including ultimates. The field still exists on `SkillDefinition`/`ItemDefinition` for Items (`07-items-artifacts.md` §7).
- **Buff skills always grant a temporary speed bonus** for turn-order purposes in the round they're used (the bonus amount: `src/engine/combat.ts`). This applies only to the skills marked "Buff?" in each class's table (Shield Guard, Rally, Poison Coat, Lightning Axe) — not to support skills that don't carry a status (Prayer, Heal, Mass Heal for Acolyte adjust instantly, without going through `applyStatusEffect`). This is a temporary bonus only for ordering turns within the current round — it is not added to the character's base `speed` — technical design in `docs/technical-decisions.md` §4.7.
- Every class-specific skill (all 6 classes, 30 skills total) carries a 3-rank power curve — see section 1.8 for the mechanism.
