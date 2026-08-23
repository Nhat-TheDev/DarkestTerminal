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
- **`defensive`**: currently resolves through the exact same code path as `aggressive` (`pickMonsterTarget` only special-cases `erratic`) — reserved for a self-preserving behavior (e.g. preferring a heal skill at low HP) once regular archetypes actually carry combat `skillIds` in `data/monsters.json`, which none currently do.
- **`erratic`**: **ignores** the `aggro` weighting entirely — picks a uniformly random target among living characters.

Which pattern each archetype uses: `data/monsters.json` field `aiPattern`. Action selection beyond plain targeting (basic attack vs. a skill vs., for guard-room archetypes, strike/cleave/debuff) is driven separately by each archetype's `actionWeights` — `pickMonsterAction` in `src/engine/combat.ts`.

### Two archetype groups — regular combat vs guard-room (elite/boss)

Every archetype in `data/monsters.json` is split into 2 groups by the `guardOnly?: boolean` field (`MonsterArchetype`, `src/types.ts`):

- **Regular combat** (`guardOnly` unset/`false`): appear randomly in ordinary combat rooms — `COMBAT_ROOM_ARCHETYPES` in `src/data/floor.ts`, filtering out any archetype with `guardOnly: true`.
- **Guard-room** (every archetype with both `eliteSkillIds` and `bossSkillIds` set — see `06-level-system.md` §6.12): guard the boss/elite room at the end of each floor — `GUARD_ROOM_ARCHETYPES` in `floor.ts`, filtered to archetypes that have both skill-kit fields, with 1 randomly chosen when building a `boss` room. **Skeleton Guard** is the only archetype that belongs to **both groups** (it still appears in regular combat as well as being eligible as a guard-room pick) — the rest of the guard-room archetypes are marked `guardOnly: true`, appearing **only** at the elite/boss tier and never as ordinary trash monsters (e.g. Dragon will never randomly show up as filler on the way to the boss).

Every guard-room randomly picks among the guard-room archetypes each time the room is built, using the same shared scaling formula (elite/boss still use the shared `eliteMultiplier`/`bossMultiplier`, §6.5/§6.11).

### Regular combat archetypes

The full roster (id, name, base stats, AI pattern, `expReward`) lives in `data/monsters.json`; the loader is `src/data/monsters.ts`. As of writing this covers a set of low/mid-tier archetypes including Dungeon Rat, Black Bat, Slime, Skeleton, Zombie, Snake, Lizard, Spider, Skeleton Archer, Skeleton Warrior, and Skeleton Guard (also a guard-room archetype — see below) — check the JSON directly for the current list rather than trusting an enumeration here, since new archetypes can be added without a doc update.

### Guard-room archetypes (elite/boss)

Skeleton Guard (shared with regular combat) plus the archetypes marked `guardOnly: true` — as of writing this includes Giant Spider, Dragon, Zombie Knight, and Dark Knight, each with its own elite/boss skill kit (`eliteSkillIds`/`bossSkillIds`, `data/monster-skills.json`) — full details, the Finishing Blow mechanic, and balance-verification approach are in `06-level-system.md` §6.12. Again, treat `data/monsters.json`/`data/monster-skills.json` as the authoritative list, not this doc.

### Balance verification

Damage is computed via the percentage-based mitigation formula (`mitigatedOffense`, `docs/technical-decisions.md`): `off − off × (def / (X + def)) − def / Y`, where `off` is the `attack` (or `magicPower` for `isMagic` skills) of the damage source, and `X`/`Y` are `data/balance-config.json` fields `combat.defenseMitigationX`/`combat.defenseMitigationY`.

Per-archetype damage-against-a-reference-class numbers, and elite/boss strike/cleave/execute comparisons, are **not** hand-maintained in this document — they drift the moment any base stat or multiplier is retuned. Verify them by running the actual formula against the current `data/monsters.json`/`data/classes.json`/`data/level-growth.json` values (a short script, or the balance-oriented tests alongside `test/`) rather than reading stale numbers here.
