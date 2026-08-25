# Artifact rework / Currency / Survival rework — Future direction (not yet implemented)

**Not present in the current code.** This document is a reference spec for
when this batch of changes is built, and does not describe the current state
of the game — see `./design-doc.md`, section "Future direction".

**Related**: `./design-doc.md` items 1.3, 1.6, 1.7; amends
`gameplay-decisions/03-survival-stats.md` §3, `gameplay-decisions/04-fear-combat.md` §4,
`gameplay-decisions/07-items-artifacts.md` §7.2, `gameplay-decisions/08-events.md` §8.

**All numbers below are confirmed** (see §E — no open decisions remain), but
none of them exist in `data/balance-config.json` yet — this document is the
spec to build from, not a description of anything currently running.

This proposal touches 4 things, requested together: (A) an Artifact-system
rework, (B) a new currency, (C) a survival-stat rework, (D) a fear-relief
rebalance. Each is written to stand on its own, but A and B/C interact with
the event catalog in `08-events.md`, called out inline.

---

## A. Artifact rework — permanent equip, no unequip, same cap as today

### A.1 What changes vs. the current model (`07-items-artifacts.md` §7.2)

| | Current | New |
|---|---|---|
| On pickup | Always goes into shared pool `unequippedArtifactIds`, equip later, whenever | Player decides **immediately**: equip now (on a chosen character) or discard |
| Equip/unequip | Free, unlimited, any time outside combat | **Equip is permanent** — once worn, a character keeps it for the rest of the run. No manual unequip (2 narrow, explicit exceptions below) |
| Cap | `party.maxEquippedArtifacts` (3) × party size (4) = 12 equip slots, enforced **per character** | **Unchanged** — still 3 per character, 12 total for the party (confirmed) |
| Cursed artifacts | Optional-equip like any other (§8.6/§8.7) | **Must** be equipped, no discard option |

The cap itself doesn't change at all — same 3-per-character / 12-party-total numbers as today (`data/balance-config.json` field `party.maxEquippedArtifacts`, unchanged). What changes is everything *around* the cap: no more free reassignment, and a pickup is a one-shot decision instead of "goes into a pool, sort it out later."

### A.2 New equip flow — decision on pickup

Every time an Artifact is granted (Elite/Boss kill, Treasure room, or an Event room outcome — same 4 sources as today, §7.2 "Drop source"), the flow becomes:

1. **Reveal** the artifact (name, rarity, effects) — unchanged from today for the sources that already reveal up front (Open Chest, Guardian Fight, Merchant, Twin Altars, Cursed Shrine's own reveal step). Sources that roll blind today (Blood Altar, Sacrificial Circle, Gambling Den win, Wandering Hermit's fortune exchange) still roll blind, then reveal the result before this step — no change there.
2. **Decision**, shown right after the reveal:
   - **Ordinary artifact**: player picks **Equip** or **Discard** (gone for good, never enters any pool). Equip only lists characters with an open personal slot (< 3 equipped) — if literally every character is already at 3/3 (party at the full 12), Equip isn't offered at all, only Discard.
   - **Cursed artifact** (`isCursed: true`) **or** an event marked `forceEquip: true` (currently only Twin Altars): **no Discard option** — the player must designate a character, including one already at 3/3. If the **designated character** is already at their personal cap of 3, the player must first choose **1 of that same character's own currently-equipped artifacts** to permanently discard, freeing a slot on them specifically — *then* the forced artifact is equipped there. (Freeing a slot on a *different* character doesn't help — the forced artifact still needs to land on the one the player designated.) This reuses the *same* `forceEquip`/`isCursed` fields already in `data/*.json`/`src/types.ts` — no new schema field needed for the trigger itself.
3. Equipping consumes 1 of that character's 3 personal slots (and so 1 of the party's 12 total), permanently — no future unequip except the exceptions in A.5 below (Wandering Hermit's "Exchange fortune" service, and Sacrificial Circle's sacrifice-for-reroll, both of which explicitly consume/replace an artifact by design, not a general-purpose unequip).

**Decision**: discarding a Cursed artifact is never offered — the whole point of the mechanic is that a Cursed artifact is a real commitment, not a free peek.

### A.3 Cap enforcement

- `GameState` no longer needs a persistent `unequippedArtifactIds` pool — an artifact is either **equipped on someone** or it never existed (discarded artifacts leave no trace). The only transient state needed is "an artifact was just rolled and is awaiting the player's equip/discard decision" (e.g. `GameState.pendingArtifactDecision?: { artifactId: Id; forceEquip: boolean }`), cleared once the player answers.
- `party.maxEquippedArtifacts` (`data/balance-config.json`) and the per-character cap check on `Character.equippedArtifactIds` are both **unchanged** from today — only the *path* to filling those slots changes (one-shot decision instead of pool + free reassignment).
- Since 4 characters × a cap of 3 each sums to exactly 12, "the party is at its full 12" and "every character is individually at 3/3" are the same condition — so a forced-equip artifact only ever needs a replacement when its *designated* character specifically is already full, whether or not the rest of the party has room to spare.

### A.4 Effect on event-room mechanics (`08-events.md` §8)

Every event that relied on the free shared pool needs its wording adjusted — mechanically, most of them barely change, since "equipped" is now just "owned":

- **Open Chest, Guardian Fight/Desecrated Altar, Merchant, Blood Altar** (§8.2–8.5): unaffected in substance — the artifact they grant now goes through the A.2 decision instead of straight into a shared pool. No change to the room mechanic itself.
- **Cursed Shrine** (§8.7): keeps its existing reveal-then-Accept/Decline step *before* anything is granted — declining a Cursed roll here still costs nothing (that gate is separate from, and happens before, the A.2 decision). Once **Accepted**, it counts as "received" and the no-discard/forced-equip rule from A.2 applies immediately.
- **Twin Altars** (§8.8): already `forceEquip: true` — no change, now just phrased as "the general forced-equip rule from A.2 applies to whichever of the 2 is chosen."
- **Sacrificial Circle** (§8.9): "sacrifice" now always means sacrificing a **currently-equipped** artifact (nothing sits unequipped anymore) — pick any owned artifact across the party, it's permanently removed (freeing 1 slot), roll the replacement at ≥ its rarity, and that replacement goes through the normal A.2 decision (optional-equip, discard allowed, matching today's "optional-equip" note).
- **Wandering Gambling Den** (§8.10): **no longer wagers an Artifact at all** — reworked into a pure Cursed-Coin gamble, see B.3. Its only remaining artifact touchpoint is the round-4 jackpot (2 Epic Artifacts), each going through the normal A.2 decision independently.
- **Wandering Hermit** (§8.11): **"Remove curse" is removed entirely** — *Exchange fortune* is now the room's only service (confirmed). This also means a Cursed artifact has exactly **1** way to leave a character post-launch: paying to exchange it (below), never a free removal. *Exchange fortune* now costs coins and picks its rarity floor — see B.3. Mechanically: choose 1 currently-equipped artifact from anywhere in the party (**including a Cursed one**), it's permanently removed, the replacement is rolled at ≥ its rarity, and that roll goes through the normal A.2 decision (optional-equip). If the party has no artifacts at all to offer up, the room has nothing to interact with — same "can only leave" fallback as today (§8.11's 3rd table row), now the *only* other outcome besides Exchange fortune.
- **Collapsed Floor** (§8.12): unaffected in substance, same as Blood Altar — its reward goes through A.2 instead of straight into the pool.

### A.5 The only ways an equipped Artifact can still leave a character, post-launch

1. **Wandering Hermit — Exchange fortune** (50 coins, any artifact including Cursed, §8.11/B.3) — the room's only service; "Remove curse" no longer exists, so this is also the *only* way to shed a Cursed artifact.
2. **Sacrificial Circle** — sacrifice-for-reroll (§8.9).

Nothing else ever unequips or reassigns an artifact — no free swap on the party-management screen anymore for Artifacts (that screen still exists for whatever else it manages, e.g. viewing loadouts). Gambling Den no longer touches equipped artifacts at all (B.3) — it only ever *adds* artifacts (round-4 win), never removes one.

---

## B. Currency — Cursed Coins (đồng xu nguyền rủa)

### B.1 Overview

A new resource, separate from `partyExp`/`inventory`, tracked as `GameState.coins: number` (party-wide, shared — like `partyExp`, not per-character). Earned exclusively from combat kills. Spent in event rooms as an alternative to paying with HP.

### B.2 Drop rule

**100% drop chance on every monster kill** (regular, Elite, and Boss alike) — unlike Items (§7.1, gated by `items.itemDropChance`), coins always drop. Amount depends on the monster's power, using a dedicated tier table rather than being derived from `expReward` (which already carries its own floor-depth/elite/boss scaling for a different purpose — reusing it here would make coin income grow much faster than intended purely as a side effect of retuning EXP).

**Decision — flat by tier, no floor-depth growth.** The request ties the amount to "how strong/weak the monster is," not to floor depth — so this table is intentionally **flat regardless of `floorDepth`**, keeping the coin economy roughly stable across the whole run rather than inflating late-game. Revisit if playtesting shows coins become trivial to stockpile by floor 10+.

| Monster group | Coin drop (per kill) |
|---|---|
| `powerTier: "weak"` | 4–6 *(exact, as given)* |
| `powerTier: "medium"` | 7–8 *(exact, as given)* |
| `powerTier: "strong"` | 9–11 *(confirmed)* |
| Elite | 13–15 *(exact, as given)* |
| Boss | 26–30 *(confirmed)* |

New config: `data/balance-config.json` field `currency.coinDropByTier: { weak: [min,max], medium: [min,max], strong: [min,max], elite: [min,max], boss: [min,max] }`, read into a `rollCoinDrop(monster)` function (`src/data/monsters.ts` or a new `src/data/currency.ts`) — same shape/spirit as `rollItemDrop`. A room with multiple monsters rolls coins independently per monster, same as Items (§7.1).

### B.3 Spend — Merchant, Gambling Den, Wandering Hermit (confirmed)

3 events switch to coins; Blood Altar and Collapsed Floor keep paying in HP (not named as switching — both are written with blood/physical-risk flavor text, "a price paid in blood," "climb down and rescue," where losing HP is the actual narrative price, not a shop transaction).

**Merchant** (§8.4): flat **coin price per rarity**, replacing `events.merchantPricePercent` (% of `maxHp`):

| Rarity | Price |
|---|---|
| Common | 50 coins |
| Rare | 70 coins |
| Unique | 100 coins |
| Epic | 150 coins |

The existing safety-limit rule (§8.4 item 5) becomes "offer locked if the party doesn't have enough coins," dropping the HP-kill-risk framing entirely (coins can't go negative, unlike HP). New config: `events.merchantPriceCoins: { common: 50, rare: 70, unique: 100, epic: 150 }`, replacing `merchantPricePercent`.

**Merchant also gains a Refresh action** (confirmed): today's `offerCount` (a hardcoded range, §8.4 item 1) becomes a **fixed 4** offers shown at once. The player may pay **10 coins** to **Refresh** — re-rolls all 4 offers as a fresh independent set (old 4 are gone, replaced, not added to) — up to **3 times per visit to the room** (so up to 4 distinct offer-sets total: the initial roll + 3 paid refreshes). Still at most **1 purchase per visit** overall (unchanged from today) — Refresh only changes what's on offer, not the 1-purchase cap. Locked the same way as a purchase if the party can't afford the 10-coin cost, and locked outright once the 3-refresh limit is used up. New config: `events.merchantOfferCount: 4` (replacing the old range), `events.merchantRefreshCostCoins: 10`, `events.merchantMaxRefreshes: 3`.

**Wandering Gambling Den** (§8.10) — full rework: **no longer wagers an Artifact at all**, becomes a pure Cursed-Coin escalating gamble, up to 4 rounds, the stake carrying forward as long as the player keeps winning and choosing to continue:

| Round | Stake (= the pot so far) | Win chance | On win | Reachable only by |
|---|---|---|---|---|
| 1 | 20 coins | 70% | pot → 40 coins | Entry (costs 20 coins up front, requires ≥ 20 on hand) |
| 2 | 40 coins | 60% | pot → 80 coins | Choosing **Continue** after winning round 1 |
| 3 | 80 coins | 50% | pot → 160 coins | Choosing **Continue** after winning round 2 |
| 4 | 160 coins | 30% | **2 Epic Artifacts** — the pot converts into the jackpot reward instead of doubling again | Choosing **Continue** after winning round 3; the event ends here either way |

Flow, true to the "real gambling" framing in the request:
1. Entering the room: play Round 1 (pay 20 coins) or leave (no cost, no reward, same as declining any other event).
2. Roll that round's win chance.
   - **Lose**: the entire current pot is lost outright, event ends, nothing gained.
   - **Win, rounds 1–3**: pot doubles, then a fresh choice — **Stop** (bank the current pot as coins, event ends, success) or **Continue** (restake the *whole* pot on the next round — no partial cash-out).
   - **Win, round 4**: pot converts to **2 Epic Artifacts** instead of coins, each going through the normal A.2 equip/discard decision independently — last round regardless of outcome, no further "continue."

New config: `events.gamblingDenRounds: [{ stake: 20, winChance: 0.7 }, { stake: 40, winChance: 0.6 }, { stake: 80, winChance: 0.5 }, { stake: 160, winChance: 0.3, jackpotArtifactCount: 2, jackpotRarity: "epic" }]`. Schema note: `gambling-den`'s `EventKind` (`data/events.json`) changes from `"artifactExchange"` to a new kind (e.g. `"coinGamble"`) — it no longer spends an artifact as its cost, only rarely produces one as its reward.

**Wandering Hermit — Exchange fortune** (§8.11): **"Remove curse" is removed — Exchange fortune is now the room's only service.** It now costs **50 coins** (was free). Player chooses **any 1 currently-equipped artifact from anywhere in the party — including a Cursed one** (with "Remove curse" gone, this is now the *only* way to shed a Cursed artifact — always paid, always gets something back). That artifact is permanently removed, a replacement is rolled at **rarity ≥ the given-up artifact's rarity** (reusing `rollArtifactWithMinRarity`, the same mechanic Sacrificial Circle already uses, §8.9 — previously Exchange Fortune had no rarity floor and excluded Cursed artifacts; both restrictions are now lifted/changed), and the roll goes through the normal A.2 decision (optional-equip, discard allowed).

New config: `events.wanderingHermitExchangeCostCoins: 50`.

---

## C. Survival rework — Satiety ("No đủ") replaces hunger/thirst

### C.1 Merge hunger + thirst into 1 party-wide stat

`Character.survival.hunger`/`.thirst` (per-character, `03-survival-stats.md` §3) are replaced by a single **`GameState.satiety: number`**, range 0–100, **shared by the whole party** — not tracked per character. `Character.survival` keeps only `fear` (still per-character, unchanged — §4 unaffected).

`survival.initialHunger`/`initialThirst` → `survival.initialSatiety: 100`.

### C.2 Drain — only on room transitions

**Decision — replaces the old per-action model entirely.** Today, hunger/thirst drain on *every action* — moving to a new room *or* 1 combat turn (`03-survival-stats.md` §3, `hungerDrainPerAction`/`thirstDrainPerAction`). The new rule is narrower and explicit: **satiety only drains when the party moves into a new room**, `−10` flat, regardless of room type — not per combat turn, not per action within a fight. Combat can now run arbitrarily long without draining satiety on its own.

New config: `survival.satietyDrainPerRoom: 10` (flat, replacing both `hungerDrainPerAction` and `thirstDrainPerAction`).

### C.3 Exhausted ("Kiệt quệ") — satiety ≤ 30

While `satiety ≤ survival.exhaustedThreshold` (30), the **whole party** is Exhausted:

- Every character's **own** `attack`, `defense`, `magicPower`, `aggro`, `speed` is reduced to **2/3** of its current value (i.e. **−1/3**) — `maxHp`/`maxMp` are explicitly untouched.
- **Artifact `statBoost` bonuses are not reduced** — only the character's own base/leveled stat shrinks. Worked example from the request: a character with 30 `attack` + 6 `attack` from an equipped artifact → while Exhausted: `round(30 × 2/3) = 20`, plus the untouched `+6` from the artifact → effective `attack = 26`.

**Decision — modeled as a live-computed condition, not a stored status effect.** This mirrors how fear tiers already work (`getFearTier(fear)` in `resolver.ts` — a function of the current value, not an `ActiveStatusEffect` with `turnsRemaining`): a new `isPartyExhausted(satiety)` check, applied at the same point stat totals are resolved for combat (after the character's own stat, before artifact bonuses are added on top) — because it needs to turn on/off instantly and continuously as `satiety` crosses 30 in either direction, and it applies to the whole party at once rather than 1 character picking it up from a skill/monster hit. No new `StatusEffectDefinition` entry, no `curableByMiniGame` — it clears itself automatically the moment satiety is restored above 30 (rest room, Camp, or items).

New config: `survival.exhaustedThreshold: 30`, `survival.exhaustedStatMultiplier: 0.667` (≈ 2/3, or model as `× 2 / 3` directly to avoid rounding drift — implementer's call).

### C.4 Dying ("Hấp hối") — satiety ≤ 10

While `satiety ≤ survival.dyingThreshold` (10), the **whole party** additionally takes a **poison-like DOT** — per the request, "tương tự như dính độc" (behaves the same as being Poisoned): every living character loses a fixed amount of HP each combat round, using the exact same per-round tick point the `poisoned` status already uses (`perTurnEffects`, `03-survival-stats.md`/`01-class-skill.md` §1.7) — just triggered by the party-wide `satiety` condition instead of a stored `ActiveStatusEffect`, same live-computed approach as C.3. Stacks with Exhausted (10 ≤ 30, so both conditions are active at once below the Dying threshold — Exhausted's stat penalty plus Dying's HP tick, simultaneously).

**Confirmed** — per-round damage equals **Poisoned II**'s tick amount (`poisoned-ii`, `data/status-effects.json`, currently **6 HP/round**) — Dying reads that same value at resolution time rather than duplicating the number, so retuning Poisoned II automatically retunes Dying too. New config: `survival.dyingDamagePerRound` sourced from `status-effects.json["poisoned-ii"].perTurnEffects[0].amount` (implementer's call whether to literally read the status entry or copy its current value into a dedicated `survival` field — either way, keep the 2 in sync).

Not curable by mini-game (same reasoning as C.3 — it's not a normal status effect instance) — the only cure is raising `satiety` back above 10 (rest room, Camp, items).

### C.5 Camp ("Tạm dừng chân") — a new post-victory option, distinct from the Rest room

A **new choice appears after winning any combat room** (regular/Elite/Boss — not just entering a dedicated Rest room, which is a separate, pre-existing room type with its own 3-option flow, `03-survival-stats.md` §3 "Rest room," unchanged by this section). Choosing it:

- Costs **1 "Exploration Kit"** item (new item, `category: "consumable"`) — the party starts a run with **4**. New config: `party.startingExplorationKits: 4`.
- Restores **+30 satiety only** — explicitly **no** HP/MP restore (that's what the dedicated Rest room is for).
- Not offered if the party has 0 Exploration Kits left.

**Exploration Kit is not usable in combat** — it must not appear in the in-combat "use item" list at all (unlike every other current item, which can be used both in and out of combat, §7.1). This needs a new field on `ItemDefinition`: `combatUsable?: boolean` (default `true` for every existing item; `false` for Exploration Kit) — the combat item-selection UI filters on this field.

**Drop source**: a low-weight, monster-specific drop (reusing the exact mechanic already described in §7.1 "Monster-specific items" — `archetypeIds` + `weight`) from **humanoid archetypes**: `zombie`, `zombie-knight`, `skeleton`, `skeleton-archer`, `skeleton-warrior`, `skeleton-guard`, `dark-knight` (every skeleton/zombie/knight archetype currently in `data/monsters.json`). **Decision — weight `0.15`**, deliberately lower than any existing monster-specific item weight (`data/items.json` currently ranges `0.5`–`1`), since the request calls for a distinctly rarer drop than the norm; still grows toward `1` with floor depth via the existing `itemWeightDepthGrowth` mechanic, same as every other under-`1`-weighted item (§7.1).

### C.6 Rest room "Eat & Drink" update

`restEatDrink` (`03-survival-stats.md` §3 "Rest room") changes from *"hp/mp restored by `eatDrinkRestorePercent` (50%)"* to: **30% HP + 30% MP + 30 satiety**, in one action. `Chat` (`restChat`) is unchanged — it still only touches `hp`/`mp`/`fear`, no satiety restore (satiety recovery stays tied to "eating," matching the stat's new name and theme).

New config: `survival.eatDrinkRestorePercent: 0.3` (down from `0.5`), `survival.eatDrinkSatietyRestore: 30`.

### C.7 Summary of config/schema changes

- `data/balance-config.json` field `survival`: remove `initialHunger`, `initialThirst`, `hungerDrainPerAction`, `thirstDrainPerAction`, `starvationDamagePercent` (or repurpose the last one, see C.4); add `initialSatiety`, `satietyDrainPerRoom`, `exhaustedThreshold`, `exhaustedStatMultiplier`, `dyingThreshold`, `dyingDamagePerRound`, `campSatietyRestore` (=30), `eatDrinkSatietyRestore` (=30); change `eatDrinkRestorePercent` from `0.5` to `0.3`.
- `data/balance-config.json` field `party`: add `startingExplorationKits: 4`.
- `SurvivalStats` (`src/types.ts`): drop `hunger`/`thirst`, keep only `fear`.
- `GameState` (`src/types.ts`): add `satiety: number`.
- `ItemDefinition` (`src/types.ts`): add `combatUsable?: boolean`.
- `data/items.json`: add the `exploration-kit` entry (`archetypeIds` = humanoid list, `weight: 0.15`, `combatUsable: false`, effect: `modifyStat` on `satiety` for `+30` — reusing the resolver's existing `modifyStat` effect kind, same mechanic already used for `Ration`/`Water Flask` today).

---

## D. Fear victory relief rebalance (amends `03-survival-stats.md` §3 "Winning a fight")

Replaces the current flat `survival.fearVictoryRelief` (10) / `survival.fearEliteOrBossVictoryRelief` (15) with a relief that also depends on how fast the fight was won, using the existing `CombatState.roundNumber` at the moment `outcome === "victory"` is set (no new tracking needed — that field already exists and increments per round).

| Fight type | Normal relief | Quick-win relief | Quick-win condition |
|---|---|---|---|
| Regular | **5** (was 10) | **10** | won with `roundNumber < 3` (won by the end of round 1 or 2) |
| Elite / Boss | **8** (was 15) | **12** | won with `roundNumber < 5` (won by the end of round 1–4) |

Both are still **not additive** with the base — same "instead of, not on top of" rule the current Elite/Boss relief already uses vs. the regular one. Determined by actual monster tier (`Monster.tier !== "normal"`), same as today, not by room type.

New config, replacing the 2 existing fields: `survival.fearVictoryRelief: 5`, `survival.fearVictoryReliefQuick: 10`, `survival.fearQuickVictoryRoundThreshold: 3`, `survival.fearEliteOrBossVictoryRelief: 8`, `survival.fearEliteOrBossVictoryReliefQuick: 12`, `survival.fearEliteOrBossQuickVictoryRoundThreshold: 5`.

---

## E. Open decisions

**None remaining** — every earlier open question is confirmed:

~~1. Strong/Boss coin drop range~~ — **resolved**: 9–11 / 26–30, as proposed (§B.2).

~~2. Which events use coins~~ — **resolved**: Merchant (§B.3 table, plus a paid Refresh action), Gambling Den (full rework, §B.3), and Wandering Hermit's Exchange fortune (50 coins, now the room's only service, §B.3/A.4). Blood Altar/Collapsed Floor stay HP-only.

~~3. Dying DOT damage~~ — **resolved**: equals Poisoned II (6 HP/round, §C.4).

~~4. Artifact cap~~ — **resolved**: cap stays exactly as today, 3 per character / 12 total for the party (§A.1/A.3).

~~5. Wandering Hermit — Remove curse~~ — **resolved**: removed entirely; Exchange fortune is the room's only service (§A.4/B.3/A.5).
