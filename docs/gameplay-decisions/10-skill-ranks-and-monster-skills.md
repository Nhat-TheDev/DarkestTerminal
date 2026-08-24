# §10. Skill Rank system (character skills) & Regular Monster skill kits

*(section 10 of `00-index.md`)*

**Status: implemented.** All 4 pieces of work below are live: `SkillDefinition.ranks` exists in `data/classes.json` for every class-specific skill (Viking/Plague Doctor included), regular monster archetypes have `skillIds` populated in `data/monsters.json`/`data/monster-skills.json`, and the `aiPattern: "defensive"` fix is in `src/engine/combat.ts`. This document describes the mechanics/shape — **not the current tuning numbers** (mp cost, damage/heal amounts, proc chances, unlock levels, weights), which live in `data/classes.json`/`data/status-effects.json`/`data/monster-skills.json`/`data/monsters.json` and drift independently of this doc as balance changes; read those files directly rather than trusting a hand-copied value here.

**Naming convention**: every `id`/`name` below (skills, statuses) is in **English**, matching the existing convention documented in `01-class-skill.md` section 1 ("every `id`/`name` for classes, skills, and status effects is in English").

This section covers 4 independent pieces of work:
- **§10.1** — a 3-rank power-scaling system layered on top of the 20 class-specific skills (`01-class-skill.md`).
- **§10.2** — first-ever skills for the 11 regular-combat monster archetypes (`02-monster.md`); previously every regular archetype had `skillIds: []` and only attacked with a plain basic attack.
- **§10.3** — a code fix this required: `aiPattern: "defensive"` is documented (`02-monster.md` section 2) as "prioritize a heal/defensive skill when HP is low", but no such logic existed in `src/engine/combat.ts` before this work — `defensive` previously behaved identically to `aggressive` (both just target via weighted-`aggro`). §10.2's Zombie/Skeleton Warrior skills depend on this logic existing.
- **§10.4** — extends §10.1's rank system to the 2 classes from `09-new-classes-viking-plaguedoctor.md` (Viking, Plague Doctor).

---

## §10.1 Skill Rank system — 3 ranks per skill, unlocked by character level

### Concept

Each of the 20 class-specific skills (5 per class × 4 classes; the shared basic attack in slot 0 is excluded — it stays a single fixed version) has **3 ranks**. Rank 1 is the skill's original (already-documented) numbers, unlocked at the skill's existing `unlockLevel` (`01-class-skill.md`). Ranks 2 and 3 unlock automatically at higher character levels — no separate "learn"/"choose" action, consistent with the game's existing "leveling up just makes you stronger" design (`05-character-stats.md`: level-up already fully restores HP/MP with no player choice involved).

**Rank-up does not change `cooldownTurns`** — cooldowns stay identical across every rank of a skill, to avoid disturbing combat pacing. Where a rank has more effect, `mpCost` is allowed to increase slightly to keep the mana economy proportional to the stronger output. Effect magnitudes (damage/heal/proc chance) are **hand-tuned per skill** for rank 2/3, matching the project's existing philosophy of assigning skill numbers "by hand based on power level, not a fixed formula" (`01-class-skill.md`, Design notes) — there is no global "+X% per rank" formula applied uniformly.

### Rank-up level thresholds

Spread across the full level range; later-unlocking skills (higher slot) have a longer gap between ranks, and the last skill (slot 5, the class ultimate) reaches rank 3 exactly at the level cap. Slots 1 and 2 share the same thresholds (both unlock at the same starting level, treated as equally "starting kit"); every other slot uses its own thresholds derived from its unlock level. **Current thresholds**: `SkillRankDefinition.unlockLevel` per rank, `data/classes.json` — this document does not hand-maintain a copy of the table, since it drifts the moment ranks are retuned.

### Data model

`SkillDefinition` (`docs/technical-decisions.md` §4) gains an optional field:

```
SkillDefinition {
  ...existing fields (id, name, mpCost, target, effects, slot, unlockLevel, cooldownTurns, isBuff?, isUltimate?, isMagic?)
  ranks?: SkillRankDefinition[]   // NEW — absent = the skill has no rank system (all monster skills, items)
}

SkillRankDefinition {
  rank: 1 | 2 | 3
  unlockLevel: number
  mpCost: number
  effects: SkillEffect[]
}
```

At cast time, the game resolves the character's current rank for a skill as the highest `rank` whose `unlockLevel <= Character.level`, then uses that rank entry's `mpCost`/`effects` instead of the skill's top-level `mpCost`/`effects` (which mirror rank 1, kept for backward compatibility with any code that doesn't yet know about `ranks`). This requires a new lookup helper (e.g. `getEffectiveSkill(skill, characterLevel)`) used wherever a character's skill is cast or displayed (skill list UI, resolver) — **requires code changes**, not data-only.

### Buff-status rank scaling — 4 new statuses

2 of the 20 skills carry a `modifyCombatStat` status whose magnitude scales with rank (Vanguard's Shield Guard → `guard`, Vanguard's Rally → `rally`). Since `guard`/`rally` are shared `StatusEffectDefinition`s with a fixed magnitude, scaling them per-rank meant adding rank-specific variants rather than mutating the shared status (avoids changing the base `guard`/`rally` magnitude for any other skill/rank that might reuse them). Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "guard-ii", "name": "Guard II", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }], "curableByMiniGame": [] },
  { "id": "guard-iii", "name": "Guard III", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }], "curableByMiniGame": [] },
  { "id": "rally-ii", "name": "Rally II", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }], "curableByMiniGame": [] },
  { "id": "rally-iii", "name": "Rally III", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }], "curableByMiniGame": [] }
]
```

`taunt` and `poison-coat` are **not** given rank variants: `taunt`'s aggro bonus already dominates target selection at rank 1 (diminishing returns from going higher), and `poison-coat` is a binary on-hit rider, not a magnitude stat.

### Poison Coat — rank-up adds an attack buff, via leveled `poison-coat` variants

**Poison Coat** (Rogue, slot 1) scales by adding a `modifyCombatStat attack` bonus to the buff at rank 2/3, on top of the existing on-hit poison rider (unchanged at every rank — it's still a binary toggle, not something that scales). `durationTurns` stays identical across every rank (only the status *id* changes, not its duration), so the existing `cooldownTurns = durationTurns + 1` formula still resolves to the same value at every rank — no conflict with the "cooldown never changes across ranks" rule. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "poison-coat-ii", "name": "Poison Coat II", "durationTurns": "<see data/status-effects.json>", "onHitStatusEffectId": "poisoned", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }], "curableByMiniGame": [] },
  { "id": "poison-coat-iii", "name": "Poison Coat III", "durationTurns": "<see data/status-effects.json>", "onHitStatusEffectId": "poisoned", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }], "curableByMiniGame": [] }
]
```

The attack-bonus progression matches the step size used for `rally-ii`/`rally-iii` above, for consistency across all attack-buff statuses in this system. The on-hit poison rider itself (`onHitStatusEffectId: "poisoned"`) is carried over unchanged on every rank — rank-up only adds the attack buff, it does not touch the "poison level" applied on hit (that stays base `poisoned`, level 1, same as every other non-Poison-Bomb source per the note above).

### Poison Bomb — poison potency scales via leveled `poisoned` variants (exclusive to this skill)

Unlike Poison Coat, **Poison Bomb's rank-up does scale its poison** — this is the one skill in the whole system where the applied status itself gets stronger per rank, via 2 rank-exclusive variants of `poisoned`. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "poisoned-ii", "name": "Poisoned II", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }], "curableByMiniGame": ["snake"] },
  { "id": "poisoned-iii", "name": "Poisoned III", "durationTurns": "<see data/status-effects.json>", "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }], "curableByMiniGame": ["snake"] }
]
```

(Same `curableByMiniGame` mechanic as base `poisoned` — Snake minigame — just carried over to the stronger variants.)

**This scaling is exclusive to Poison Bomb.** Every other source of poison in the game — Poison Coat's on-hit rider, Snake's regular-monster skill (§10.2), and any future item/skill — keeps applying the plain, un-leveled `poisoned` ("poison level 1") regardless of the caster's rank in anything. There is no shared "global poison level"; `poisoned-ii`/`poisoned-iii` only ever come from Poison Bomb ranks 2/3.

### Rank tables — all 20 skills

Per-rank `mpCost`/`effects`/`unlockLevel` for every skill of every class (Vanguard, Mage, Rogue, Acolyte) live in `data/classes.json`, under each skill's `ranks` array. This document does not hand-maintain a copy of those tables — read `data/classes.json` directly for current numbers, since rank tuning changes independently of this doc.

---

## §10.2 Regular Monster skill kits — 1 skill per archetype

### Concept

Previously all 11 regular-combat archetypes (`02-monster.md`) had `skillIds: []` and never used anything but a plain basic attack. This adds exactly **1 flavor skill per archetype** (10 skills total — Skeleton Guard is deliberately excluded, see note below), each thematically distinct, reusing existing status effects where the theme matches and introducing 2 new ones where it doesn't.

**Usage rate**: for 8 of the 10 archetypes, `actionWeights.normal` (`data/monsters.json`) gives the flavor skill a real per-turn chance alongside the basic attack. The other 2 (Zombie, Skeleton Warrior) keep `actionWeights.normal` at basic-attack-only — their skill is exclusively triggered by the `aiPattern: "defensive"` low-HP logic in §10.3, not by the normal weighted roll (a Zombie randomly self-healing at full HP would waste turns; a self-heal should only ever fire when it's actually needed). Current weights: `data/monsters.json`.

**Skeleton Guard is excluded**: it already has a full Elite/Boss kit (`data/monster-skills.json`) for when it appears as a guard-room monster; adding a 3rd "normal-tier" skill risks overlapping with Skeleton Warrior's flavor (both are melee skeleton archetypes) and isn't needed for this proposal's goal of giving every *skill-less* archetype an identity.

### Skill table

| Archetype | Skill id | Name | Target | Effect (shape) | AI pattern | Trigger |
|---|---|---|---|---|---|---|
| Dungeon Rat | `bite` | Bite | singleEnemy | `damage` | erratic | `actionWeights.normal.skill` |
| Black Bat | `blood-drain` | Blood Drain | singleEnemy | `damage` + `lifestealPercent` (new field, see below) | aggressive | `actionWeights.normal.skill` |
| Slime | `acid-spit` | Acid Spit | singleEnemy | `damage` + chance to `applyStatusEffect "corroded"` (new status) | erratic | `actionWeights.normal.skill` |
| Skeleton | `bone-throw` | Bone Throw | singleEnemy | `damage` | aggressive | `actionWeights.normal.skill` |
| **Zombie** | `regeneration` | Regeneration | self | `heal` | defensive | **only** via §10.3 low-HP logic |
| Snake | `poison-bite` | Poison Bite | singleEnemy | `damage` + chance to `applyStatusEffect "poisoned"` (existing) | erratic | `actionWeights.normal.skill` |
| Lizard | `quick-bite` | Quick Bite | singleEnemy | `damage` | aggressive | `actionWeights.normal.skill` |
| Spider | `web-spit` | Web Spit | singleEnemy | `damage` + chance to `applyStatusEffect "webbed"` (new status) | aggressive | `actionWeights.normal.skill` |
| Skeleton Archer | `arrow-shot` | Arrow Shot | singleEnemy | `damage` | erratic | `actionWeights.normal.skill` |
| **Skeleton Warrior** | `guard-stance` | Guard Stance | self | `applyStatusEffect "guard"` (existing) | defensive | **only** via §10.3 low-HP logic |

Current damage/heal amounts and proc chances: `data/monster-skills.json`. *Snake keeps plain `poisoned` (already its established theme) while Spider gets the new `webbed` instead of also using `poisoned` — this deliberately differentiates the 2 "erratic/aggressive poison-flavored" archetypes rather than having them share an identical proc.*

### New status effects — 2

**`corroded`** (Slime's Acid Spit) — deliberately reserved for reuse by the future Plague Doctor class (`09-new-classes-viking-plaguedoctor.md` §9.4 lists `burning`/`poisoned`/`weakened`/`blinded` for its kit; an acid/corrosion debuff was not among them and fits the "debuffer" theme):

```json
{
  "id": "corroded",
  "name": "Corroded",
  "durationTurns": "<see data/status-effects.json>",
  "perTurnEffects": [
    { "kind": "damage", "amount": "<see data/status-effects.json>" },
    { "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }
  ],
  "curableByMiniGame": []
}
```

Distinct from both `weakened` (`01-class-skill.md` §1.5 — pure `-6 defense`, no DoT, currently Elite/Boss-exclusive) and `poisoned` (pure DoT, no defense change) — acid does both at once, at a lighter magnitude than either alone.

**`webbed`** (Spider's Web Spit):

```json
{
  "id": "webbed",
  "name": "Webbed",
  "durationTurns": "<see data/status-effects.json>",
  "perTurnEffects": [
    { "kind": "modifyCombatStat", "combatStat": "speed", "amount": "<see data/status-effects.json>" }
  ],
  "curableByMiniGame": []
}
```

### New `SkillEffect` field — `lifestealPercent`

Black Bat's Blood Drain needs the caster to heal off its own damage — no existing effect kind supports this. Adds an optional field to the `damage` effect kind:

```
SkillEffect (kind: "damage") {
  ...existing fields (amount, chance?, ignoreDefensePercent?, ...)
  lifestealPercent?: number   // NEW — heals the source actor by this % of the damage actually dealt, capped at maxHp
}
```

**Required a resolver change** (`resolver.ts`): after computing final mitigated damage for a `damage` effect that carries `lifestealPercent`, apply a `heal` to the source actor for `round(finalDamage * lifestealPercent / 100)`, clamped to `maxHp`. This is the only new resolver mechanic this system introduced besides the rank-lookup in §10.1 and the AI fix in §10.3.

---

## §10.3 Fix — `aiPattern: "defensive"` now does what it says

### Prior state

Before this work, `pickMonsterTarget` (`src/engine/combat.ts`) only special-cased `"erratic"` (uniform-random target, ignoring `aggro`). Both `"aggressive"` and `"defensive"` fell through to the same `pickAggroWeighted` call — there was no HP-check, no skill-priority branch, anywhere in `src/` for `"defensive"`. `02-monster.md` section 2's description of `defensive` ("prioritize a heal/defensive skill when HP is low, using a skill from `skillIds`; otherwise fall back to weighted-random-by-aggro") was accurate as *design intent* but didn't match the implementation at the time.

### Fix

`runMonsterTurn` (`src/engine/combat.ts`) now intercepts before the normal `actionWeights` roll: for an archetype with `aiPattern: "defensive"` and at least 1 entry in `skillIds`, once the actor's HP drops below the threshold defined in code, it uses that skill instead of rolling a normal action — matching the documented "prioritize the defensive skill" behavior. See `src/engine/combat.ts` for the exact HP threshold and skill-selection logic rather than trusting a hand-copied number here.

This only takes effect for archetypes that (a) are `aiPattern: "defensive"` and (b) have at least 1 entry in `skillIds` — that's Zombie and Skeleton Warrior (§10.2). The other `defensive` archetypes (Zombie Knight, Dark Knight, Skeleton Guard) keep `skillIds: []`, so this branch is a no-op for them — their Elite/Boss kits (`eliteSkillIds`/`bossSkillIds`) are untouched by this change.

Targeting for `defensive` archetypes remains unchanged (still weighted-by-`aggro`, same as `aggressive`) — only skill-choice priority was added. `02-monster.md` already describes the intended behavior correctly; this section just closed the code gap.

---

## §10.4 Skill Rank system extended to Viking & Plague Doctor (future classes)

### Concept

`09-new-classes-viking-plaguedoctor.md` adds 2 more classes, each with the same 5-slot skill layout and unlock levels as the 4 original classes. This section applies §10.1's exact same rank mechanism to their 10 skills — **same level-threshold shape, same "cooldown never changes / mpCost rises slightly / effects hand-tuned per skill" rules**. No new thresholds are introduced; both classes reuse §10.1's threshold table (`data/classes.json`).

### Viking

`storm-empowered` (Lightning Axe's self-buff, `09-new-classes...md` §9.3.2) is the Viking's signature rider — its `onHitAoeDamage.amount` **is** the skill's core value, the same situation as Poison Bomb's `poisoned` (§10.1) and Poison Coat's attack buff. It has 2 rank-exclusive variants scaling that amount up; `ignoreDefensePercent`/`durationTurns` stay fixed so the existing `cooldownTurns = durationTurns + 1` formula still holds at every rank. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "storm-empowered-ii", "name": "Storm-Empowered II", "durationTurns": "<see data/status-effects.json>", "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "ignoreDefensePercent": "<see data/status-effects.json>" }, "curableByMiniGame": [] },
  { "id": "storm-empowered-iii", "name": "Storm-Empowered III", "durationTurns": "<see data/status-effects.json>", "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "ignoreDefensePercent": "<see data/status-effects.json>" }, "curableByMiniGame": [] }
]
```

The self-debuff piece of Lightning Axe (`defense`/`aggro`) and every skill's `conditionalBonus.ignoreDefensePercentBonus` stay **identical at every rank** — same reasoning as `taunt` in §10.1: these are enabling/auxiliary mechanics, not the thing being power-scaled. `bleeding`'s proc-chance scales per rank the same way Fireball/Lightning Bolt's burn/stun chances do (§10.1) — its own magnitude stays the shared, un-leveled version, consistent with the "poison/burn/stun magnitude doesn't scale, only its odds do" pattern already used for the 4 original classes. Per-rank `mpCost`/`effects` for all 5 Viking skills: `data/classes.json`.

### Plague Doctor

No new statuses needed. `blinded` (Blinding Vial's debuff — a flat `accuracyPenaltyPercent` rather than a stat penalty, see the updated §9.4 definition and its `rollHits()` code-change note) follows the same pattern as Fireball/Lightning Bolt: only its proc-chance scales per rank, its magnitude (miss-chance percentage) stays fixed — it's an enemy-facing proc, not the caster's own signature buff, so it's treated like `burning`/`stunned`/`poisoned`, not like `guard`/`rally`/`storm-empowered`. `poisoned`/`burning`/`weakened` procced by Toxic Fog/Total Plague stay the plain, un-leveled versions, consistent with §10.1's rule that only Poison Bomb ever applies a leveled `poisoned` variant. Total Plague's `removeStatusEffect` (ally branch) is binary and unchanged at every rank, same treatment as Purify's ally branch in §10.1. Per-rank `mpCost`/`effects` for all 5 Plague Doctor skills: `data/classes.json`.

---

## General notes — what this required

- **Data**:
  - `data/classes.json` — `ranks` on all 20 original class-specific skills (§10.1) plus the Viking/Plague Doctor entries (§10.4).
  - `data/status-effects.json` — the 10 new statuses from §10.1 (`guard-ii`, `guard-iii`, `rally-ii`, `rally-iii`, `poison-coat-ii`, `poison-coat-iii`, `poisoned-ii`, `poisoned-iii`, `corroded`, `webbed`) + 2 from §10.4 (`storm-empowered-ii`, `storm-empowered-iii`).
  - `data/monsters.json` — `skillIds` populated for 10 archetypes; `actionWeights.normal` updated for 8 of them (Zombie/Skeleton Warrior unchanged, per §10.2).
  - `data/monster-skills.json` — the 10 new monster skill entries (same file/shape already used for Elite/Boss skills).
- **Code changes** (`src/types.ts` + `src/engine/combat.ts`/`resolver.ts`):
  - `SkillDefinition.ranks` + a rank-lookup helper used wherever a character skill is cast/displayed (§10.1, also used by §10.4).
  - `SkillEffect.lifestealPercent` + resolver handling (§10.2).
  - The `aiPattern: "defensive"` branch in `runMonsterTurn` (§10.3).
  - §10.4 had no code needs of its own beyond what `09-new-classes-viking-plaguedoctor.md` lists (`onHitAoeDamage`, `conditionalBonus`, `accuracyPenaltyPercent` + the `rollHits()` change for `blinded`, and the `isHelpfulStatusEffect()` fix) plus the rank-lookup helper above — ranks alone didn't require new engine mechanics for these 2 classes.
- MP/damage/heal figures throughout: `data/classes.json`/`data/status-effects.json`/`data/monster-skills.json` are the source of truth — this document does not hand-maintain them.
