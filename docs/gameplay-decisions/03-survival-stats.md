# §3. Numeric thresholds for survival stats

*(section 3 of `00-index.md`)*

All 3 stats (`fear`, `hunger`, `thirst`) fall within the range **0–100**.

### Starting values — identical across classes
`hunger: 100, thirst: 100, fear: 0`. There is no per-class field for this — these are constants applied whenever a new `Character` is created, independent of class.

### Hunger / Thirst
- Each action within the dungeon loop (moving to a new room, or 1 combat turn): `hunger -1`, `thirst -1.5` (thirst drains faster than hunger).
- When `hunger` or `thirst` hits 0: the character takes `damage = 2% maxHp` on every subsequent action until it's replenished (both stats stack if they hit bottom at the same time).
- Restored via items: `Ration` (+40 hunger) and `Water Flask` (+40 thirst), using the `modifyStat` effect like any other item (`07-items-artifacts.md` §7).
- The rest room does **not** restore `hunger`/`thirst` — all 3 rest-room choices only affect `hp`/`mp`/`fear` (see the "Rest room" section below); hunger/thirst can only be restored via items.

### Fear
- **Per combat round**: at the end of each round where the fight has **not yet ended**, every living character gains additional fear:
  - `+1` normally, or **`+3` instead (not additive with `+1`)** if the character is below **60% maxHP**.
  - Both amounts **scale +5%/floor** (`depth 1` = base amount, no bonus), each with its own cap: the normal tier caps at **3/round**, the below-60%-HP tier caps at **6/round**.
  - Reduced by the `fearResist` artifact — see `07-items-artifacts.md` §7.2.
  - Implementation: `fearGainForRound`/`applyRoundFear` in `src/engine/survival.ts`, called from `resolveRound` (`src/engine/combat.ts`) every round that doesn't end the fight.
- **Winning a fight**: `fear -= 10` for the whole team (every living character); if the fight was against an **Elite or Boss**, `fear -= 15` **instead** (not additive with `-10`) — determined by the actual tier of the monster just defeated (`Monster.tier !== "normal"`), not by the room type. Implementation: `applyVictoryFearRelief`, called from `finalizeRound` when `outcome === "victory"`.
- Losing a mini-game: `fear += 15` (fixed, regardless of mini-game type).
- Rest room ("Chat" option): `fear -= 20`.

Fear does not increase while moving between rooms — it only increases during combat that drags on (per round, as described above).

### Rest room

Entering a rest room, the player picks 1 of 3 options (`Game.restAction`); each option only affects `hp`/`mp`/`fear`, never touching `hunger`/`thirst`:

| Option | Effect |
|---|---|
| **Eat & Drink** (`restEatDrink`) | `hp += 50% maxHp`, `mp += 50% maxMp` |
| **Chat** (`restChat`) | `hp += 10% maxHp`, `mp += 10% maxMp`, `fear -= 20` |
| **Skip** | No effect at all, just marks the room as cleared (`room.cleared = true`) and moves on |

All 3 options mark the room as "cleared" once chosen (cannot be repeated).

### 4 fear tiers (shared with `04-fear-combat.md` section 4 below)
| Tier | Range | Name |
|---|---|---|
| 1 | 0–39 | Calm |
| 2 | 40–69 | Uneasy |
| 3 | 70–99 | Panicked |
| 4 | 100 | Broken |
