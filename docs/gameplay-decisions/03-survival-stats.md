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

Modeled as a **live-computed condition, not a stored status effect** — mirrors how fear tiers work (`getFearTier(fear)` in `resolver.ts`, a function of the current value, not an `ActiveStatusEffect` with `turnsRemaining`). `isPartyExhausted(satiety)` (`src/engine/survival.ts`) is applied inside `recomputeCharacterStats` (`src/engine/party.ts`) — after the character's own base stat, before artifact bonuses are added on top. Whenever `GameState.satiety` itself changes (room-entry drain, Camp, Rest room Eat & Drink), `recomputeAllPartyStats(state)` re-runs this for the whole party, so Exhausted turns on/off instantly and continuously as satiety crosses 30 in either direction — no `StatusEffectDefinition` entry at all.

### Dying — satiety ≤ 10

While `satiety ≤ survival.dyingThreshold` (10), the **whole party** additionally takes a poison-like DOT: every living character loses a fixed amount of HP each combat round (`applyDyingDamage`, `src/engine/survival.ts`, called from `resolveRound` in `combat.ts`), using the same per-round tick point the `poisoned` status already uses.

Per-round damage equals **Poisoned II**'s tick amount (`poisoned-ii`, `data/status-effects.json`) — `survival.dyingDamagePerRound` is sourced from that same value, so retuning Poisoned II automatically retunes Dying too. Same live-computed approach as Exhausted, not a stored status effect. **Stacks with Exhausted** — 10 ≤ 30, so both conditions are active at once below the Dying threshold: Exhausted's stat penalty plus Dying's HP tick, simultaneously.

Same reasoning as Exhausted — it's not a normal status-effect instance, so it has no cure mechanic of its own — the only way out is raising satiety back above 10 (Rest room, Camp, Exploration Kit).

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

### Camp Reflection

A 4th piece of content at Rest rooms, independent of which of the 3 options above is picked and
independent of `08-events.md` §8.16's post-event reflection — no shared data, no shared trigger
logic, deliberately, since the register is different: §8.16 is a short in-the-moment dialogue beat
reacting to 1 room; Camp Reflection is the party looking back at its own *accumulated* pattern of
exchanges across the whole run so far, fires at most 4 times ever, and is meant to land each time
rather than repeat.

**Tracking** — entirely new `GameState` fields, none of them touching `narrativeCounters`,
`eventOutcomes`, `pendingReflection`, or `eventReflectionStances`:

```ts
/** Increments by 1 each time the party resolves an event in LORE_EXPOSURE_EVENT_IDS — every event
    id except open-chest, the 1 event explicitly "Outside the Balance" (11-world-bible.md §11.12).
    Never resets, never decreases. Written in closeEvent() (src/engine/events/shared.ts), alongside
    but independent of that function's existing eventOutcomes/firedOnceEventIds writes. */
loreExposureCount: number;

/** Set at rest-room entry (moveToRoom's "rest" branch, src/engine/dungeon.ts) when a new tier —
    computed fresh from loreExposureCount each time, not stored — is higher than the highest tier
    already present in campReflectionChoices. Skipped if state.pendingReflection is currently set
    (narrow defensive check only, not a dependency). Cleared once the player picks a response. */
pendingCampReflectionTier: 1 | 2 | 3 | 4 | null;

/** Which option (0/1/2) was picked at each tier — a genuine per-tier record, unlike
    eventReflectionStances (overwritten on repeat), since each tier fires exactly once per run. */
campReflectionChoices: Partial<Record<1 | 2 | 3 | 4, 0 | 1 | 2>>;
```

Tier thresholds against `loreExposureCount` (proposed, a balance decision pending playtesting real
run lengths, not a lore one): **tier 1 at 3, tier 2 at 8, tier 3 at 15, tier 4 at 25.**

**Skip-to-highest, not sequential**: if the party jumps straight from tier 0 to tier 3 between 2
rest visits (event rooms aren't evenly spaced with rest rooms), only tier 3's content shows — tiers
1-2 are silently skipped, never shown later. Same design language `08-events.md` §8.15's chain-tier
escalation already uses (a jump straight to tier 2 never backfills tier 1's text), independently
implemented here, not shared code. Fires deterministically the first time a new tier is reached, no
chance roll — unlike §8.16's reflection, which needs `reflectionRepeatChance` because it can
trigger many times per event id; Camp Reflection fires at most 4 times, ever.

**UI**: a new screen (e.g. `"campReflection"` in `UiState`, `src/ui/state.ts`, rendered from a new
`src/ui/screens/campReflection.ts`), not a variant of the existing `eventReflection` screen,
triggered from the rest-room entry flow rather than from event-room `closeEvent()`.

**Content — all 4 tiers, final text.** Tier 0 (Untouched) has no content — nothing has happened
yet, nothing to reflect on, same principle as Open Chest/Collapsed Floor having no §8.16 reflection.

**Tier 1 — Use**

> "Someone's checking their supplies again before sleep, same as every night. Tonight it takes
> slightly less time than it used to. It's just faster now, knowing which pouch to reach for
> first."

- "It's not worth thinking about. Whatever gets it done fastest is fine."
- "Someone should be keeping count. Just in case it starts to matter later."
- "Somewhere back there, reaching for it stopped feeling like deciding to."

**Tier 2 — Optimization**

> "The whole day's route got picked around which rooms were worth the detour — not for the
> treasure, for the trade. Three floors ago that would have sounded insane. Whoever suggested it
> first, none of you can quite say."

- "It's efficient. That's all that needs to be true about it."
- "Getting good at something like this isn't the same as it being safe."
- "You almost admire how naturally it's become part of the plan."

**Tier 3 — Dependence**

> "Nobody argued about it this time. Whoever was closest just did it, the way you'd catch a
> falling cup without thinking, and the rest of you kept eating like nothing happened. Someone
> almost said something. Didn't."

- "Someone should have said something. Nobody wanted to be the first."
- "There wasn't anything to say. It's just what the party does now."
- "You keep waiting for it to feel like a choice again. It hasn't, in a while."

**Tier 4 — Unawareness**

> "Nobody mentions it anymore, at camp or anywhere else. It isn't that it stopped mattering — it
> stopped being a separate thing from everything else you do to get through a day. Someone asks
> what's for dinner. Someone else answers with their mouth full. The rest of it just happened
> somewhere in between, the way breathing happens."

- "It doesn't need explaining anymore."
- "Explaining it wouldn't change anything now."
- "Nobody's asked in a long time. Nobody will."

**Craft notes**: none of the 4 tiers reuse imagery already established elsewhere in the game (hand,
wound, stone, circle, spiral) — deliberately, since Camp Reflection is the party looking at itself,
not at any altar/ritual object, and needed its own sensory palette (supplies, a route, a dropped
cup, a meal). "Nobody" is used exactly twice as a prompt-opener (tier 3, tier 4) plus once as a
deliberate doubled echo in tier 4's last option — an escalating motif specific to this content,
never reused from tier 1-2's different framing or from any existing event text. The 3 options per
tier are bespoke self-narratives, not a `curious`/`wary`/`dismissive` relabeling — a plausible
self-narrative at tier 1 ("just efficient") isn't plausible at tier 4 (nothing there is still
efficient-vs-unsafe framed), so reusing 1 fixed label set across all 4 tiers would have forced a
fit the content no longer supports.

**Downstream effect on 1 other event**: does not touch `eventOutcomes` as part of its own tracking
— but the moment tier 4 resolves, 1 line writes a synthetic tag into the *existing* `eventOutcomes`
map: `state.eventOutcomes["camp-reflection"] = "unaware"`. A narrow, deliberate bridge: Camp
Reflection's own tracking stays fully independent as specified above; this single key exists only
so the already-built `crossEventVariants` pipeline (`10-event-narrative.md` Part C.1) can reference
it with zero changes to that pipeline's own code. `wandering-hermit` gains a `crossEventVariants`
entry keyed on `{"eventId": "camp-reflection", "outcome": "unaware"}` — of the 3 recurring figures,
he's the 1 who learned this exact drift the hard way (`11-world-bible.md` §11.8), so he's the most
plausible to notice it in someone else before they notice it in themselves:

> "An old man sits meditating amid the rubble, a spiral mark scarred into his forearm. He doesn't
> look up right away this time. When he finally does, it isn't your face he's checking first."

(Exact wording not yet craft-reviewed — flagging the connection point here, text to be finalized
alongside implementation.)

**Compliance check against `11-world-bible.md`**: no mechanic here implies the dream is tracking
the party — `loreExposureCount` is entirely the party's own accumulated behavior, read by nothing
outside this mechanism except the 1 synthetic bridge tag above. Agency stays real at every tier
(§11.5) — tier 3's "whoever was closest just did it" and tier 4's "the rest of it just happened
somewhere in between" both describe the party's own hands acting, never the dream choosing for
them. Resolves nothing on §11.9's open list — entirely about the party's own psychology, never
about Sleeper, the Covenant, or any of the 3 recurring figures' unresolved questions. Never names
"Sleeper," "Covenant," or "the Balance."

**Build order and files touched**: `src/types.ts` (4 new `GameState` fields), `src/data/loreExposure.ts`
(new — `LORE_EXPOSURE_EVENT_IDS`, thresholds, `campReflectionTier()`), `src/engine/events/shared.ts`
(`closeEvent()`'s new increment), `src/engine/dungeon.ts` (`moveToRoom`'s rest-room branch — tier
check, `pendingCampReflectionTier` set), `src/engine/game.ts` (new field init, a
`pickCampReflectionChoice()` method), `src/engine/migration.ts` (migration guards for the 4 new
fields), `src/ui/state.ts` (new `UiState` kind), `src/ui/screens/campReflection.ts` (new),
`data/events.json` (the `wandering-hermit` cross-event addition once its text is finalized),
`test/` (new test file for the counting/tiering/trigger/skip-to-highest logic).

### Fear tiers (shared with `04-fear-combat.md` section 4 below)

4 tiers, computed by `getFearTier(fear)` (`src/engine/resolver.ts`) — the tier boundaries are hardcoded there (not in `data/balance-config.json`), since they're read alongside the combat-effect functions in the same module:

| Tier | Name |
|---|---|
| 1 | Calm |
| 2 | Uneasy |
| 3 | Panicked |
| 4 | Broken |

Exact numeric ranges for each tier: `getFearTier` in `src/engine/resolver.ts`.
