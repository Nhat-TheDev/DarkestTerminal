# §2. Monster — stats, aggro-based targeting & AI patterns

*(section 2 of `00-index.md`)*

**Naming convention**: every monster `id`/`name` is in **English**, matching `data/monsters.json`.

### Scaling formula by floor depth (`floorDepth`, floor 1 = depth 1)

Current implementation: `growthBonus(stat, floorDepth)`, tapered across 5 tiers — see `06-level-system.md` **§6.3/§6.6**. `speed = baseSpeed` (does not scale with floor).

This is the archetype → instance formula, used when spawning monsters into `Room.monsterIds`; the `attack/defense/hp/maxHp/speed` fields on a `Monster` are always the resolved values — the formula itself is never stored.

### Targeting by `aggro`

Default rule (used by every pattern unless stated otherwise below): **weighted random** over every living character in the party, weighted by the character's current `Character.aggro`. The higher a character's `aggro`, the more likely it is to be picked as the target.

Formula: `P(target = X) = X.aggro / total aggro of all living characters`.

### 3 AI patterns (`MonsterAiPattern`)
- **`aggressive`**: uses the weighted-random-by-`aggro` rule above directly.
- **`defensive`**: if its own HP is below 40% and it has a heal/defensive skill in `skillIds`, it uses that skill (targeting itself); otherwise it falls back to the same weighted-random-by-`aggro` rule as `aggressive`.
- **`erratic`**: **ignores** the `aggro` weighting entirely — picks a uniformly random target among living characters.

### Two archetype groups — regular combat vs guard-room (elite/boss)

15 archetypes, clearly split into 2 groups by the `guardOnly?: boolean` field (`MonsterArchetype`, `src/types.ts`):

- **Regular combat** (`guardOnly` unset/`false`, **11 archetypes**): appear randomly in ordinary combat rooms (1-3 monsters/room) — `COMBAT_ROOM_ARCHETYPES` in `src/data/floor.ts`, filtering out any archetype with `guardOnly: true`.
- **Guard-room** (**5 archetypes**, each with both `eliteSkillIds` and `bossSkillIds` — see `06-level-system.md` §6.12): guard the boss/elite room at the end of each floor — `GUARD_ROOM_ARCHETYPES` in `floor.ts`, filtered to archetypes that have both skill-kit fields, with 1 randomly chosen when building a `boss` room. **Skeleton Guard** is the only archetype that belongs to **both groups** (it still appears in regular combat as well as being eligible as a guard-room pick) — the remaining 4 archetypes (Giant Spider, Dragon, Zombie Knight, Dark Knight) are marked `guardOnly: true`, appearing **only** at the elite/boss tier and never as ordinary trash monsters (e.g. Dragon will never randomly show up as filler on the way to the boss).

Every guard-room randomly picks among the 5 archetypes each time the room is built, using the same shared scaling formula (elite/boss still use the shared `eliteMultiplier`/`bossMultiplier`, §6.5/§6.11).

### 11 regular combat archetypes

| id | Name | baseHp | baseAtk | baseDef | baseSpeed | AI pattern | expReward |
|---|---|---|---|---|---|---|---|
| `dungeon-rat` | Dungeon Rat | 45 | 17 | 1 | 9 | erratic | 6 |
| `black-bat` | Black Bat | 42 | 22 | 1 | 18 | aggressive | 6 |
| `slime` | Slime | 40 | 15 | 1 | 5 | erratic | 6 |
| `skeleton` | Skeleton | 42 | 19 | 4 | 8 | aggressive | 9 |
| `zombie` | Zombie | 45 | 18 | 6 | 4 | defensive | 12 |
| `snake` | Snake | 38 | 20 | 2 | 17 | erratic | 8 |
| `lizard` | Lizard | 46 | 19 | 3 | 11 | aggressive | 9 |
| `spider` | Spider | 40 | 21 | 1 | 15 | aggressive | 9 |
| `skeleton-archer` | Skeleton Archer | 40 | 22 | 3 | 12 | erratic | 10 |
| `skeleton-warrior` | Skeleton Warrior | 40 | 22 | 7 | 7 | defensive | 13 |
| `skeleton-guard`* | Skeleton Guard | 55 | 23 | 7 | 6 | defensive | 15 |

\* `skeleton-guard` is also one of the 5 guard-room archetypes (see above) — listed separately in the table below for clarity, not duplicated data.

### 5 guard-room archetypes (elite/boss)

| id | Name | baseHp | baseAtk | baseDef | baseSpeed | AI pattern | expReward | guardOnly |
|---|---|---|---|---|---|---|---|---|
| `skeleton-guard` | Skeleton Guard | 55 | 23 | 7 | 6 | defensive | 15 | no (shared with regular combat) |
| `giant-spider` | Giant Spider | 50 | 26 | 5 | 14 | aggressive | 16 | yes |
| `dragon` | Dragon | 65 | 31 | 7 | 10 | aggressive | 20 | yes |
| `zombie-knight` | Zombie Knight | 60 | 19 | 10 | 5 | defensive | 17 | yes |
| `dark-knight` | Dark Knight | 58 | 27 | 10 | 9 | defensive | 18 | yes |

Each archetype has its own elite/boss skill kit (`eliteSkillIds`/`bossSkillIds`, `data/monster-skills.json`) — full details, the Finishing Blow mechanic, and a damage verification table are in `06-level-system.md` §6.12.

### Damage verification against Vanguard

Damage is computed via the percentage-based mitigation formula (`mitigatedOffense`, `docs/technical-decisions.md`): `off − off × (def / (60 + def)) − def / 30`, where `off` is the `attack` (or `magicPower` for `isMagic` skills) of the damage source.

Single-hit damage against Vanguard (`baseDefense 10`, no buffs/debuffs) from a basic attack (`amount 0`, floor 1 so no depth bonus applies):

| Group | Archetype | atk | dmg → Vanguard |
|---|---|---|---|
| Lowest | Slime | 15 | 13 |
| … | Dungeon Rat | 17 | 14 |
| … | Zombie | 18 | 15 |
| … | Skeleton, Lizard | 19 | 16 |
| … | Snake | 20 | 17 |
| … | Spider | 21 | 18 |
| Highest (regular combat) | Black Bat, Skeleton Archer, Skeleton Warrior, Skeleton Guard | 22-23 | 19 |

Elite tier (skill strike, `amount 3`, target `singleEnemy`, attack already multiplied by `eliteMultiplier.attack ×1.4` — `06-level-system.md` §6.5):

| Archetype | eliteAtk | strike dmg → Vanguard |
|---|---|---|
| Zombie Knight | 27 | 26 |
| Skeleton Guard | 32 | 30 |
| Giant Spider | 36 | 34 |
| Dark Knight | 38 | 35 |
| Dragon | 43 | 40 |

Boss tier is naturally higher than Elite (using `bossMultiplier.attack ×1.8` instead of `×1.4`, with the same skill formula), and the Finishing Blow (boss execute) is a separate hit, noticeably heavier — see the full table in `06-level-system.md` §6.12.

Strike/cleave skills use a small `amount` (3/2): most of an elite/boss's damage comes from its `baseAttack` after the multiplier and floor-depth scaling are applied. Cleave (`amount 2`, `allEnemies`) is lighter than Strike (`amount 3`, `singleEnemy`) on a per-target basis.
