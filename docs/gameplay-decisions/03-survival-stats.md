# §3. Survival stats — fear, hunger, thirst

*(section 3 of `00-index.md`)*

**Source of truth for every number below**: `data/balance-config.json` field `survival`, read into named constants in `src/engine/survival.ts` (fear-per-round handling) and `src/engine/resolver.ts`/`combat.ts` (fear's effect on combat, `04-fear-combat.md` §4). This document names the mechanic and the field that drives it — not the current value.

All 3 stats (`fear`, `hunger`, `thirst`) are clamped to the same fixed range, applied via `clamp(...)` wherever they're modified (`src/engine/survival.ts`, `src/engine/resolver.ts`).

### Starting values — identical across classes
`hunger`/`thirst`/`fear` all start from `survival.initialHunger`/`initialThirst`/`initialFear` (`data/balance-config.json`). There is no per-class field for this — these are constants applied whenever a new `Character` is created, independent of class.

### Hunger / Thirst
- Each action within the dungeon loop (moving to a new room, or 1 combat turn) drains both stats by `survival.hungerDrainPerAction`/`thirstDrainPerAction` — thirst is tuned to drain faster than hunger.
- When `hunger` or `thirst` hits 0: the character takes damage on every subsequent action until it's replenished, sized as `survival.starvationDamagePercent` of `maxHp` (`STARVATION_DAMAGE_PERCENT`, `src/engine/survival.ts`) — both stats stack if they hit bottom at the same time.
- Restored via items: `Ration` (hunger) and `Water Flask` (thirst), using the `modifyStat` effect like any other item (`07-items-artifacts.md` §7) — exact restore amounts: `data/items.json`.
- The rest room does **not** restore `hunger`/`thirst` — all 3 rest-room choices only affect `hp`/`mp`/`fear` (see the "Rest room" section below); hunger/thirst can only be restored via items.

### Fear
- **Per combat round**: at the end of each round where the fight has **not yet ended**, every living character gains additional fear via `fearGainForRound`/`applyRoundFear` (`src/engine/survival.ts`), called from `resolveRound` (`src/engine/combat.ts`):
  - A base amount (`survival.fearPerRoundBase`), or a higher amount instead (`survival.fearPerRoundLowHp`, not additive with the base) if the character is below a low-HP threshold (`survival.fearLowHpThresholdPercent` of `maxHp`).
  - Both amounts scale up with floor depth (`survival.fearPerRoundDepthGrowth`), each with its own cap (`survival.fearPerRoundBaseCap`/`fearPerRoundLowHpCap`).
  - Reduced by the `fearResist` artifact — see `07-items-artifacts.md` §7.2.
- **Winning a fight**: the whole team's fear is reduced by `survival.fearVictoryRelief`; if the fight was against an **Elite or Boss**, `survival.fearEliteOrBossVictoryRelief` applies **instead** (not additive) — determined by the actual tier of the monster just defeated (`Monster.tier !== "normal"`), not by the room type. Implementation: `applyVictoryFearRelief`, called from `finalizeRound` when `outcome === "victory"`.
- Losing a mini-game: a fixed fear increase, regardless of mini-game type (`gameplay-decisions/00-index.md` → `minigame-decisions.md`, not yet implemented).
- Rest room ("Chat" option): reduces fear by `survival.chatFearRelief` (`CHAT_FEAR_RELIEF`, `src/engine/survival.ts`).

Fear does not increase while moving between rooms — it only increases during combat that drags on (per round, as described above).

### Rest room

Entering a rest room, the player picks 1 of 3 options (`Game.restAction`); each option only affects `hp`/`mp`/`fear`, never touching `hunger`/`thirst`:

| Option | Effect |
|---|---|
| **Eat & Drink** (`restEatDrink`) | `hp`/`mp` restored by `survival.eatDrinkRestorePercent` of max |
| **Chat** (`restChat`) | `hp`/`mp` restored by `survival.chatRestorePercent` of max, plus `fear` reduced by `survival.chatFearRelief` |
| **Skip** | No effect at all, just marks the room as cleared (`room.cleared = true`) and moves on |

All 3 options mark the room as "cleared" once chosen (cannot be repeated).

### Fear tiers (shared with `04-fear-combat.md` section 4 below)

4 tiers, computed by `getFearTier(fear)` (`src/engine/resolver.ts`) — the tier boundaries are hardcoded there (not in `data/balance-config.json`), since they're read alongside the combat-effect functions in the same module:

| Tier | Name |
|---|---|
| 1 | Calm |
| 2 | Uneasy |
| 3 | Panicked |
| 4 | Broken |

Exact numeric ranges for each tier: `getFearTier` in `src/engine/resolver.ts`.
