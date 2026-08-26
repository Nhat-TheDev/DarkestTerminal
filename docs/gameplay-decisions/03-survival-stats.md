# §3. Survival stats — fear, satiety

*(section 3 of `00-index.md`)*

**Source of truth for every number below**: `data/balance-config.json` field `survival`, read into named constants in `src/engine/survival.ts` (fear-per-round handling, satiety drain, Exhausted/Dying) and `src/engine/resolver.ts`/`combat.ts` (fear's effect on combat, `04-fear-combat.md` §4). This document names the mechanic and the field that drives it — not the current value.

There are 2 survival stats, tracked at different scopes:

| Stat | Scope | Range |
|---|---|---|
| `fear` | Per character (`Character.survival.fear`) | 0–100 |
| `satiety` | Party-wide (`GameState.satiety`) | 0–100 |

Both are clamped to their range via `clamp(...)` wherever they're modified (`src/engine/survival.ts`, `src/engine/resolver.ts`).

### Starting values
`fear` starts at `survival.initialFear` for every new `Character`, independent of class. `satiety` starts at `survival.initialSatiety` (100) once per run, on `GameState`, not per character.

---

## Satiety

Satiety replaced the earlier per-character hunger/thirst pair — 1 shared value for the whole party instead of 2 tracked separately on every character.

### Drain — once per room, amount depends on room type

Satiety drains **exactly once per room the party resolves**, never per combat turn or per action within a fight — a fight can run arbitrarily long without draining satiety on its own. For a room that starts a fight, the drain applies on **victory** (`Game.resolve()`), not on the ambush itself, so a fight that's abandoned mid-way doesn't cost satiety.

| Room outcome | Drain |
|---|---|
| Combat room / Boss room victory, or a combat-triggering event (Guardian Fight/Desecrated Altar) victory | `survival.satietyDrainCombat` (10) |
| Non-combat event (Open Chest, Merchant, Blood Altar, Cursed Shrine, Twin Altars, Sacrificial Circle, Gambling Den, Wandering Hermit, Collapsed Floor) | `survival.satietyDrainEvent` (5) |
| Rest room | `0` — entering or using the Rest room never drains satiety |

Implementation: `drainSatiety(state, amount, log)` (`src/engine/survival.ts`), called from `src/engine/dungeon.ts` (`moveToRoom`) for non-combat entries and from `src/engine/game.ts` (`Game.resolve()`, victory branch) for combat.

The drain/threshold numbers are sized against the existing floor-generation guarantee: every path already passes through `floorGeneration.minRestRoomsPerPath`–`maxRestRoomsPerPath` (1–2, `src/data/floorPatterns.ts`) Rest rooms, and the Rest room's Eat & Drink option restores satiety too (see below) — so a party following the critical path is expected to hit at least 1 Rest room before satiety drains far enough to reach Exhausted, as long as they don't stall on Skip repeatedly.

### Exhausted — satiety ≤ 30

While `satiety ≤ survival.exhaustedThreshold` (30), the **whole party** is Exhausted:

- Every character's **own** `attack`, `defense`, `magicPower`, `aggro`, `speed` is multiplied by `survival.exhaustedStatMultiplier` (≈ 2/3) — `maxHp`/`maxMp` are never touched.
- **Artifact `statBoost` bonuses are not reduced** — only the character's own base/leveled stat shrinks. Example: a character with 30 `attack` + 6 `attack` from an equipped artifact, while Exhausted: `round(30 × 2/3) = 20`, plus the untouched `+6` from the artifact → effective `attack = 26`.

Modeled as a **live-computed condition, not a stored status effect** — mirrors how fear tiers work (`getFearTier(fear)` in `resolver.ts`, a function of the current value, not an `ActiveStatusEffect` with `turnsRemaining`). `isPartyExhausted(satiety)` (`src/engine/survival.ts`) is applied inside `recomputeCharacterStats` (`src/engine/party.ts`) — after the character's own base stat, before artifact bonuses are added on top. Whenever `GameState.satiety` itself changes (room-entry drain, Camp, Rest room Eat & Drink), `recomputeAllPartyStats(state)` re-runs this for the whole party, so Exhausted turns on/off instantly and continuously as satiety crosses 30 in either direction — no `StatusEffectDefinition` entry, no `curableByMiniGame`.

### Dying — satiety ≤ 10

While `satiety ≤ survival.dyingThreshold` (10), the **whole party** additionally takes a poison-like DOT: every living character loses a fixed amount of HP each combat round (`applyDyingDamage`, `src/engine/survival.ts`, called from `resolveRound` in `combat.ts`), using the same per-round tick point the `poisoned` status already uses.

Per-round damage equals **Poisoned II**'s tick amount (`poisoned-ii`, `data/status-effects.json`) — `survival.dyingDamagePerRound` is sourced from that same value, so retuning Poisoned II automatically retunes Dying too. Same live-computed approach as Exhausted, not a stored status effect. **Stacks with Exhausted** — 10 ≤ 30, so both conditions are active at once below the Dying threshold: Exhausted's stat penalty plus Dying's HP tick, simultaneously.

Not curable by mini-game (same reasoning as Exhausted — it's not a normal status-effect instance) — the only cure is raising satiety back above 10 (Rest room, Camp, Exploration Kit).

### Camp — a post-victory option, distinct from the Rest room

A choice offered **after winning any combat room** (regular/Elite/Boss, not just entering a dedicated Rest room — a separate, pre-existing room type with its own 3-option flow, see below):

- Costs **1 Exploration Kit** item (`ItemDefinition.combatUsable: false`, `data/items.json` entry `exploration-kit`) — the party starts a run with `party.startingExplorationKits` (4).
- Restores **+30 satiety only** (`survival.campSatietyRestore`) — explicitly **no** HP/MP restore, that's what the Rest room is for.
- Not offered if the party has 0 Exploration Kits left.

Implementation: `Game.camp()` → `campAction` (`src/engine/survival.ts`); UI flow in `src/ui/screens/camp.ts`, wired in after `roomReward` via `proceedAfterVictory`/`finishVictorySequence` (`src/ui/screens/context.ts`).

**Drop source**: a low-weight, monster-specific drop (same mechanic as any other monster-specific item, §7.1) from humanoid archetypes: `zombie`, `zombie-knight`, `skeleton`, `skeleton-archer`, `skeleton-warrior`, `skeleton-guard`, `dark-knight`. Weight `0.15` — deliberately lower than any other monster-specific item weight (which range `0.5`–`1`) — still grows toward `1` with floor depth via the standard `itemWeightDepthGrowth` mechanic (§7.1).

Exploration Kit also has a normal `effects: [{ kind: "modifyStat", stat: "satiety", amount: 30 }]`, usable out of combat like any other item (`combatUsable: false` only blocks it from the in-combat item list) — `modifyStat` targeting `"satiety"` reads/writes `GameState.satiety` directly (needs a `gameState` reference in `ResolveContext`, since satiety isn't on `Character`), distinct from `modifyStat` targeting `fear` which stays per-character.

---

## Fear

- **Per combat round**: at the end of each round where the fight has **not yet ended**, every living character gains additional fear via `fearGainForRound`/`applyRoundFear` (`src/engine/survival.ts`), called from `resolveRound` (`src/engine/combat.ts`):
  - A base amount (`survival.fearPerRoundBase`), or a higher amount instead (`survival.fearPerRoundLowHp`, not additive with the base) if the character is below a low-HP threshold (`survival.fearLowHpThresholdPercent` of `maxHp`).
  - Both amounts scale up with floor depth (`survival.fearPerRoundDepthGrowth`), each with its own cap (`survival.fearPerRoundBaseCap`/`fearPerRoundLowHpCap`).
  - Reduced by the `fearResist` artifact — see `07-items-artifacts.md` §7.2.
- **Winning a fight** — relief now also depends on how fast the fight was won (`CombatState.roundNumber` at the moment `outcome === "victory"` is set):

  | Fight type | Normal relief | Quick-win relief | Quick-win condition |
  |---|---|---|---|
  | Regular | `survival.fearVictoryRelief` (5) | `survival.fearVictoryReliefQuick` (10) | won with `roundNumber < survival.fearQuickVictoryRoundThreshold` (3) |
  | Elite / Boss | `survival.fearEliteOrBossVictoryRelief` (8) | `survival.fearEliteOrBossVictoryReliefQuick` (12) | won with `roundNumber < survival.fearEliteOrBossQuickVictoryRoundThreshold` (5) |

  Neither pair is additive with the other — same "instead of, not on top of" rule the Elite/Boss relief always used vs. the regular one. Determined by the actual tier of the monster just defeated (`Monster.tier !== "normal"`), not by room type. Implementation: `applyVictoryFearRelief(party, isEliteOrBossFight, roundNumber)`, called from `finalizeRound` when `outcome === "victory"`.
- Losing a mini-game: a fixed fear increase, regardless of mini-game type (`gameplay-decisions/00-index.md` → `minigame-decisions.md`, not yet implemented).
- Rest room ("Chat" option): reduces fear by `survival.chatFearRelief` (`CHAT_FEAR_RELIEF`, `src/engine/survival.ts`).

Fear does not increase while moving between rooms — it only increases during combat that drags on (per round, as described above).

---

## Rest room

Entering a rest room, the player picks 1 of 3 options (`Game.restAction`):

| Option | Effect |
|---|---|
| **Eat & Drink** (`restEatDrink`) | `hp`/`mp` restored by `survival.eatDrinkRestorePercent` (30%) of max, **plus** `+survival.eatDrinkSatietyRestore` (30) satiety, all in 1 action |
| **Chat** (`restChat`) | `hp`/`mp` restored by `survival.chatRestorePercent` of max, plus `fear` reduced by `survival.chatFearRelief` — unchanged, still doesn't touch satiety (satiety recovery stays tied to "eating") |
| **Skip** | No effect at all, just marks the room as cleared (`room.cleared = true`) and moves on |

All 3 options mark the room as "cleared" once chosen (cannot be repeated). Entering/using the Rest room itself never drains satiety (see the drain table above).

### Fear tiers (shared with `04-fear-combat.md` section 4 below)

4 tiers, computed by `getFearTier(fear)` (`src/engine/resolver.ts`) — the tier boundaries are hardcoded there (not in `data/balance-config.json`), since they're read alongside the combat-effect functions in the same module:

| Tier | Name |
|---|---|
| 1 | Calm |
| 2 | Uneasy |
| 3 | Panicked |
| 4 | Broken |

Exact numeric ranges for each tier: `getFearTier` in `src/engine/resolver.ts`.
