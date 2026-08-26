# §2. Monster — stats, aggro-based targeting & AI patterns

*(section 2 of `00-index.md`)*

**Naming convention**: every monster `id`/`name` is in **English**, matching `data/monsters.json`.

**Source of truth for every number below**: `data/monsters.json` (base stats + `expReward` per archetype) and `data/level-growth.json` (scaling curve, elite/boss multipliers). This document describes the mechanics — not the actual base stat values, which live only in JSON.

### Scaling formula by floor depth (`floorDepth`, floor 1 = depth 1)

Current implementation: `growthBonus(stat, floorDepth)`, using the same tapered curve as characters — see `06-level-system.md` **§6.3/§6.6**. `speed = baseSpeed` (does not scale with floor).

This is the archetype → instance formula, used when spawning monsters into `Room.monsterIds`; the `attack/defense/hp/maxHp/speed` fields on a `Monster` are always the resolved values — the formula itself is never stored.

### Targeting by `aggro`

Default rule (used by every pattern unless stated otherwise below): **weighted random** over every living character in the party, weighted by the character's current `Character.aggro`. The higher a character's `aggro`, the more likely it is to be picked as the target.

Formula: `P(target = X) = X.aggro / total aggro of all living characters`.

### AI patterns (`MonsterAiPattern`)
- **`aggressive`**: uses the weighted-random-by-`aggro` rule above directly (`pickMonsterTarget`, `src/engine/combat.ts`).
- **`defensive`**: **Status: implemented.** `runMonsterTurn` (`src/engine/combat.ts`) intercepts before the normal `actionWeights` roll: for an archetype with `aiPattern: "defensive"` and at least 1 entry in `skillIds`, once the actor's HP drops below the threshold defined in code, it uses that skill instead of rolling a normal action — see `src/engine/combat.ts` for the exact HP threshold and skill-selection logic rather than trusting a hand-copied number here. Targeting for `defensive` archetypes remains unchanged (still weighted-by-`aggro`, same as `aggressive`) — only skill-choice priority was added.

  This only takes effect for archetypes that (a) are `aiPattern: "defensive"` and (b) have at least 1 entry in `skillIds` — that's Zombie and Skeleton Warrior (see "Regular monster skill kits" below). The other `defensive` archetypes (Zombie Knight, Dark Knight, Skeleton Guard) keep `skillIds: []` for this branch, so it's a no-op for them — their Elite/Boss kits (`eliteSkillIds`/`bossSkillIds`) are untouched by this.

  *Prior state, for context: before this was implemented, `pickMonsterTarget` only special-cased `"erratic"` — both `"aggressive"` and `"defensive"` fell through to the same weighted-random call, with no HP-check or skill-priority branch anywhere in `src/` for `"defensive"`, even though this section already documented it as the intended design.*
- **`erratic`**: **ignores** the `aggro` weighting entirely — picks a uniformly random target among living characters.

Which pattern each archetype uses: `data/monsters.json` field `aiPattern`. Action selection beyond plain targeting (basic attack vs. a skill vs., for guard-room archetypes, strike/cleave/debuff) is driven separately by each archetype's `actionWeights` — `pickMonsterAction` in `src/engine/combat.ts`.

### Two archetype groups — regular combat vs guard-room (elite/boss)

Every archetype in `data/monsters.json` is split into 2 groups by the `guardOnly?: boolean` field (`MonsterArchetype`, `src/types.ts`):

- **Regular combat** (`guardOnly` unset/`false`): appear randomly in ordinary combat rooms — `COMBAT_ROOM_ARCHETYPES` in `src/data/floor.ts`, filtering out any archetype with `guardOnly: true`.
- **Guard-room** (every archetype with both `eliteSkillIds` and `bossSkillIds` set — see `06-level-system.md` §6.12): guard the boss/elite room at the end of each floor — `GUARD_ROOM_ARCHETYPES` in `floor.ts`, filtered to archetypes that have both skill-kit fields, with 1 randomly chosen when building a `boss` room. **Skeleton Guard** is the only archetype that belongs to **both groups** (it still appears in regular combat as well as being eligible as a guard-room pick) — the rest of the guard-room archetypes are marked `guardOnly: true`, appearing **only** at the elite/boss tier and never as ordinary trash monsters (e.g. Dragon will never randomly show up as filler on the way to the boss).

Every guard-room randomly picks among the guard-room archetypes each time the room is built, using the same shared scaling formula (elite/boss still use the shared `eliteMultiplier`/`bossMultiplier`, §6.5/§6.11).

### Regular combat archetypes

The full roster (id, name, base stats, AI pattern, `expReward`) lives in `data/monsters.json`; the loader is `src/data/monsters.ts`. As of writing this covers a set of low/mid-tier archetypes including Dungeon Rat, Black Bat, Slime, Skeleton, Zombie, Snake, Lizard, Spider, Skeleton Archer, Skeleton Warrior, and Skeleton Guard (also a guard-room archetype — see below) — check the JSON directly for the current list rather than trusting an enumeration here, since new archetypes can be added without a doc update.

10 of these 11 archetypes now carry a `skillIds` entry (see "Regular monster skill kits" below) — Skeleton Guard is the deliberate exception, since it already has a full Elite/Boss kit for its guard-room role.

### Regular monster skill kits

**Status: implemented.** Previously all 11 regular-combat archetypes had `skillIds: []` and never used anything but a plain basic attack. This adds exactly **1 flavor skill per archetype** for 10 of the 11 (Skeleton Guard deliberately excluded — see above, since a 3rd "normal-tier" skill on top of its existing Elite/Boss kit risks overlapping with Skeleton Warrior's flavor, both being melee skeleton archetypes, and isn't needed for the goal of giving every *skill-less* archetype an identity), each thematically distinct, reusing existing status effects where the theme matches and introducing 2 new ones where it doesn't.

**Usage rate**: for 8 of the 10 archetypes, `actionWeights.normal` (`data/monsters.json`) gives the flavor skill a real per-turn chance alongside the basic attack. The other 2 (Zombie, Skeleton Warrior) keep `actionWeights.normal` at basic-attack-only — their skill is exclusively triggered by the `aiPattern: "defensive"` low-HP logic above, not by the normal weighted roll (a Zombie randomly self-healing at full HP would waste turns; a self-heal should only ever fire when it's actually needed). Current weights: `data/monsters.json`.

#### Skill table

| Archetype | Skill id | Name | Target | Effect (shape) | AI pattern | Trigger |
|---|---|---|---|---|---|---|
| Dungeon Rat | `bite` | Bite | singleEnemy | `damage` | erratic | `actionWeights.normal.skill` |
| Black Bat | `blood-drain` | Blood Drain | singleEnemy | `damage` + `lifestealPercent` (new field, see below) | aggressive | `actionWeights.normal.skill` |
| Slime | `acid-spit` | Acid Spit | singleEnemy | `damage` + chance to `applyStatusEffect "corroded"` (new status) | erratic | `actionWeights.normal.skill` |
| Skeleton | `bone-throw` | Bone Throw | singleEnemy | `damage` | aggressive | `actionWeights.normal.skill` |
| **Zombie** | `regeneration` | Regeneration | self | `heal` | defensive | **only** via the `defensive` low-HP logic above |
| Snake | `poison-bite` | Poison Bite | singleEnemy | `damage` + chance to `applyStatusEffect "poisoned"` (existing — `01-class-skill.md` §1.7) | erratic | `actionWeights.normal.skill` |
| Lizard | `quick-bite` | Quick Bite | singleEnemy | `damage` | aggressive | `actionWeights.normal.skill` |
| Spider | `web-spit` | Web Spit | singleEnemy | `damage` + chance to `applyStatusEffect "webbed"` (new status) | aggressive | `actionWeights.normal.skill` |
| Skeleton Archer | `arrow-shot` | Arrow Shot | singleEnemy | `damage` | erratic | `actionWeights.normal.skill` |
| **Skeleton Warrior** | `guard-stance` | Guard Stance | self | `applyStatusEffect "guard"` (existing — `01-class-skill.md` §1.7) | defensive | **only** via the `defensive` low-HP logic above |

Current damage/heal amounts and proc chances: `data/monster-skills.json`. *Snake keeps plain `poisoned` (already its established theme) while Spider gets the new `webbed` instead of also using `poisoned` — this deliberately differentiates the 2 "erratic/aggressive poison-flavored" archetypes rather than having them share an identical proc.*

#### New status effects — 2

**`corroded`** (Slime's Acid Spit) — deliberately reserved for reuse by Plague Doctor's kit (`01-class-skill.md` §1.6 lists `burning`/`poisoned`/`weakened`/`blinded`; an acid/corrosion debuff was not among them and fits the "debuffer" theme, though Plague Doctor doesn't currently use it):

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

Distinct from both `weakened` (`01-class-skill.md` §1.7 — pure defense reduction, no DoT) and `poisoned` (pure DoT, no defense change) — acid does both at once, at a lighter magnitude than either alone.

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

#### New `SkillEffect` field — `lifestealPercent`

Black Bat's Blood Drain needs the caster to heal off its own damage — no existing effect kind supports this. Adds an optional field to the `damage` effect kind:

```
SkillEffect (kind: "damage") {
  ...existing fields (amount, chance?, ignoreDefensePercent?, ...)
  lifestealPercent?: number   // heals the source actor by this % of the damage actually dealt, capped at maxHp
}
```

This required a resolver change (`resolver.ts`): after computing final mitigated damage for a `damage` effect that carries `lifestealPercent`, apply a `heal` to the source actor for `round(finalDamage * lifestealPercent / 100)`, clamped to `maxHp`. This is the only new resolver mechanic the monster skill kits introduced, besides the `aiPattern: "defensive"` fix above.

#### Engine/data summary

- **Data**: `data/monsters.json` — `skillIds` populated for 10 archetypes, `actionWeights.normal` updated for 8 of them (Zombie/Skeleton Warrior unchanged, per "Usage rate" above); `data/monster-skills.json` — the 10 new monster skill entries (same file/shape already used for Elite/Boss skills); `data/status-effects.json` — `corroded`, `webbed`.
- **Code** (`src/types.ts` + `src/engine/resolver.ts`/`combat.ts`): `SkillEffect.lifestealPercent` + resolver handling; the `aiPattern: "defensive"` branch in `runMonsterTurn` (see "AI patterns" above).

### Guard-room archetypes (elite/boss)

Skeleton Guard (shared with regular combat) plus the archetypes marked `guardOnly: true` — as of writing this includes Giant Spider, Dragon, Zombie Knight, and Dark Knight, each with its own elite/boss skill kit (`eliteSkillIds`/`bossSkillIds`, `data/monster-skills.json`) — full details, the Finishing Blow mechanic, and balance-verification approach are in `06-level-system.md` §6.12. Again, treat `data/monsters.json`/`data/monster-skills.json` as the authoritative list, not this doc.

### Monster Balance Points

Extends the char "Base stats balancing formula (Balance Points)" (`01-class-skill.md`) to monster archetypes, adding a `speed` term that the char formula doesn't have — `speed` isn't part of the char formula because it never scales with level (`01-class-skill.md` §"aggro/speed are not part of the formula"); monster `speed` doesn't scale with floor depth either (see "Scaling formula by floor depth" above), so there's no `tier1` growth rate to derive a conversion constant from the way `attack`/`defense`/`maxHp` do.

**Formula**:

```
MonsterBalancePoints = baseAttack/tier1.attack + baseDefense/tier1.defense + baseHp/tier1.maxHp + baseSpeed/speedRate
```

using the same `tier1` rates as the char formula (`data/level-growth.json` → `tiers[0]`: `attack=3, defense=2, maxHp=14`), plus `speedRate = 12` — a hand-picked constant (not derived from any growth table; there isn't a `tier1`-equivalent for speed to derive one from). Starting point was the pooled average `baseSpeed` across every monster archetype and character class (~10.4), nudged up during tuning. `maxMp`/`magicPower` terms from the char formula are dropped entirely (not set to 0) since monster archetypes don't carry those stats.

**Target ranges** (rule-of-thumb bands per tier, checked against `data/monsters.json`'s base stats before any `eliteMultiplier`/`bossMultiplier` or floor-depth scaling is applied):

| Tier | Target BalancePoints | Tolerance |
|---|---|---|
| weak | 10 | ±0.3 |
| medium | 12 | ±0.4 |
| strong | 14 | ±0.5 |
| Elite/Boss (guard-room archetypes — `eliteSkillIds` + `bossSkillIds` both set) | 17 | ±1 |

Same caveat as "Balance verification" below: don't hand-maintain a per-archetype BalancePoints table here — `baseAttack`/`baseDefense`/`baseHp`/`baseSpeed` drift independently as tuning continues. Recompute `MonsterBalancePoints` against the current `data/monsters.json` whenever this needs re-checking (the rebalance-editor tool, `tools/rebalance-editor`, surfaces this number directly for both classes and monster archetypes).

### Balance verification

Damage is computed via the percentage-based mitigation formula (`mitigatedOffense`, `docs/technical-decisions.md`): `off − off × (def / (X + def)) − def / Y`, where `off` is the `attack` (or `magicPower` for `isMagic` skills) of the damage source, and `X`/`Y` are `data/balance-config.json` fields `combat.defenseMitigationX`/`combat.defenseMitigationY`.

Per-archetype damage-against-a-reference-class numbers, and elite/boss strike/cleave/execute comparisons, are **not** hand-maintained in this document — they drift the moment any base stat or multiplier is retuned. Verify them by running the actual formula against the current `data/monsters.json`/`data/classes.json`/`data/level-growth.json` values (a short script, or the balance-oriented tests alongside `test/`) rather than reading stale numbers here.
