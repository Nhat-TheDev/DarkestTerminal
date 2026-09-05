# §8. Event Room

*(item 8 of `00-index.md`)*

Event room logic lives in `src/engine/dungeon.ts`, `src/engine/game.ts`, `src/engine/events/*.ts`, `src/data/events.ts`, `data/events.json`. The Event room is separate from the Treasure room concept (`07-items-artifacts.md` §7.2 — guaranteed Artifact, no combat, no choices): that idea was never wired into the floor generator, and its placeholder `RoomType` value has since been removed from the codebase as dead code (it's no longer a valid `RoomType` at all). `open-chest` (§8.2 below) fills the same "guaranteed artifact, no combat, no choices" role in practice — it's just one of several possible Event room outcomes rather than its own dedicated room.

**Naming convention**: `id` is in English (matching §7), the description/flavor text is in English (translated).

**Source of truth for every number below**: the event catalog and its `kind`/`forceEquip` fields live in `data/events.json`; roll weights, HP-cost percentages, coin costs, and the §8.15 chain thresholds / §8.16 reflection-repeat chance all live in `data/balance-config.json` field `events` (Cursed Coins overview: `09-currency.md`).

---

## 8.1 Mechanic Overview

Every time the party steps into a room with `RoomType === "event"`, the system rolls 1 event id via `rollEvent(rng, depth, firedOnceEventIds)` (`src/data/events.ts`), split across 2 tiers with an even roll within each tier:

| Tier | Total weight | Includes |
|---|---|---|
| **Common** (light, familiar, few branches) | `events.commonTierWeight` (`data/balance-config.json`) | `open-chest`, `guardian-fight`, `merchant`, `desecrated-altar`, `old-count`, `doubled-back`, `the-delay`, `waiting-supplies` |
| **Rare** (heavier, with deeper risk/trade-offs) | `events.rareTierWeight` | `blood-altar`, `cursed-shrine`, `twin-altars`, `sacrificial-circle`, `gambling-den`, `wandering-hermit`, `collapsed-floor`, `vigil-candle`, `broken-seal`, `half-a-warning`, `still-breathing` |

The roll is otherwise independent of party state, but 4 rare events carry a `minFloorDepth` gate (`vigil-candle`/`broken-seal` at 15, `half-a-warning` at 35, `still-breathing` at 70) and are also `onceLifetime` — excluded from the roll pool once fired, tracked in `GameState.firedOnceEventIds` (10-event-narrative.md Part C.4/C.5).

All Artifact rewards in §8 share the exact same `treasureOrEvent` rarity weights (`RARITY_WEIGHTS`, `src/data/artifacts.ts`) already defined in `07-items-artifacts.md` §7.2 "Rarity & drop rate per tier", **unless an event states its own table** (e.g. `collapsed-floor` only rolls Unique/Epic, `sacrificial-circle`'s roll has a minimum tier floor).

```
EventDefinition {
  id: Id
  name: string
  description: string
  kind: "instantReward" | "combatReward" | "merchant" | "hpGamble" | "choiceReveal" | "artifactExchange" | "rescueGamble" | "coinGamble"
  forceEquip?: boolean       // true only for twin-altars, see 07-items-artifacts.md §7.2
  minFloorDepth?: number     // rollEvent() gate — vigil-candle/broken-seal (15), half-a-warning (35), still-breathing (70)
  onceLifetime?: boolean     // rollEvent() excludes it once fired — the same 4 events above
  noArtifactReward?: boolean // instantReward only — still-breathing skips the usual artifact grant

  // Narrative layer fields (§8.13-§8.16) — optional, never change an event's underlying mechanic,
  // only what description/prompt text is shown and when.
  returnDescription?: string | Record<"won" | "lost" | "declined", string>   // §8.14 — merchant/wandering-hermit (string) or gambling-den (object, keyed by last outcome)
  chainBuildupDescription?: string     // §8.15 Chain 1 — guardian-fight/desecrated-altar only, shown at 2 skips
  chainForcedDescription?: string      // §8.15 Chain 1 — shown at 3 skips, Skip option hidden from then on
  chainForced2Description?: string     // §8.15 Chain 1 tier 2 — 2nd+ firing, past chainTier2MinFloorDepth
  chainForced3Description?: string     // §8.15 Chain 1 tier 3 — 3rd+ firing, past chainTier3MinFloorDepth
  chainEscalatedDescription?: string   // §8.15 Chain 2/3 — sacrificial-circle/blood-altar only, permanent once threshold crossed
  chainEscalated2Description?: string  // §8.15 Chain 2/3 tier 2 — higher threshold, past chainTier2MinFloorDepth
  chainEscalated3Description?: string  // §8.15 Chain 2/3 tier 3 — higher threshold still, past chainTier3MinFloorDepth
  crossEventVariants?: CrossEventVariant[]  // 10-event-narrative.md Part C.1 — conditional text keyed off other events' outcomes, checked after chain states
  descriptionVariants?: string[]       // Part C.2 — random alternate base scenes, picked once per room and pinned
  instantRewardActionLabel?: string    // overrides "Open the chest" for instantReward events whose scene isn't a chest
  reflection?: {                       // §8.16 — every event except open-chest/collapsed-floor
    prompt: string
    escalatedPrompt?: string           // shown instead of `prompt`, only for the 4 events with a chain, once escalated
    escalated2Prompt?: string          // shown instead of `escalatedPrompt`, once tier-2 escalated
    escalated3Prompt?: string          // shown instead of `escalated2Prompt`, once tier-3 escalated
    options: { curious: string; wary: string; dismissive: string }
  }
}
```

The 8 events added by 10-event-narrative.md Part C (`old-count`, `doubled-back`, `the-delay`, `waiting-supplies`, `vigil-candle`, `broken-seal`, `half-a-warning`, `still-breathing`) have their own write-ups at §8.17-8.24, after Collapsed Floor.

`guardian-fight` and `desecrated-altar` both use `kind: "combatReward"` — **they share the same handling mechanics in the engine, differing only in `id`/`name`/`description`**. Likewise, `cursed-shrine`/`twin-altars` share `kind: "choiceReveal"` (reveal information before deciding); `sacrificial-circle`/`wandering-hermit` share `kind: "artifactExchange"` (operating on an artifact the party already owns rather than a plain new roll); `gambling-den` has its own `kind: "coinGamble"` (§8.10 — it no longer touches artifacts as its cost, only rarely produces them as a reward).

Every Artifact granted by any event in this section — whether revealed up front or rolled blind then revealed — goes through the same **decision flow** described in `07-items-artifacts.md` §7.2: Equip (any character, replacing 1 of their own ordinary artifacts if full) or Discard (unless Cursed/`forceEquip`, which skips straight to a forced Equip). None of the per-event sections below repeat that flow — they only describe what's specific to that room.

---

## 8.2 Open Chest (`open-chest`) — *Common*

> "A cracked oak chest sits crooked amid a pile of rubble. Whoever carried it this far didn't carry it any further."

No combat, no price to pay. Entering the room shows the flavor text and a single **[1] Open the chest** action (`Game.openChest()`, `src/engine/events/openChest.ts`) — the artifact isn't granted until the player actively chooses to open it, so the room's description gets a beat on screen before the loot/decision flow takes over. Opening grants 1 Artifact rolled on the standard rarity table, which goes through the normal decision flow (`07-items-artifacts.md` §7.2).

**No recurring NPC, no chain, no reflection** — kept deliberately mundane along with Collapsed Floor (§8.12); see §8.13.

---

## 8.3 Guardian Fight (`guardian-fight`) & Desecrate the Altar (`desecrated-altar`) — *Common*

**Shared mechanic** (`kind: "combatReward"`):

- On entering the room, the player is shown the flavor text plus 2 choices — **[1] Enter and fight** or **[2] Leave without fighting** (`Game.enterGuardianFight()` / `Game.skipGuardianFight()`, `src/engine/events/guardianFight.ts`) — no fight starts automatically on room entry. Leaving without fighting costs nothing and grants nothing (there is no separate "flee mid-combat" mechanic in this game; the only way to walk away is choosing not to enter in the first place).
- Choosing to fight spawns 1-2 monsters (`spawnEventGuardianMonsters`, `src/data/floor.ts`) from the current floor's **medium/strong power-tier archetypes only** (weak-tier archetypes are excluded — a "guardian" is meant to feel like a real threat, not a lone weak monster babysitting a chest), scaled up further via `events.eventGuardianStatMultiplier` (`data/balance-config.json`) on top of that — heavier than a normal combat room, but well below an Elite (no `eliteSkillIds` used).
- Win the fight → guaranteed 1 Artifact rolled on the standard rarity table, through the normal decision flow.
- Lose the fight → no Artifact, the game's existing combat-loss consequences apply as normal (no special rules for the Event room).

**The only difference between the two ids**: flavor text.
- `guardian-fight`: "The scrape of claws on stone echoes from a dark corner. A spiral, coiled tight and closed, is scratched into the wall beside it. Something is guarding the treasure in this room, and it just caught your scent."
- `desecrated-altar`: "The stone altar glows with a pale red light, pulsing as if breathing. A spiral is cut into the base, closed like a knot. Touching it will surely wake whatever sleeps beneath."

**Chain escalation**: repeatedly choosing "Leave without fighting" builds toward a forced encounter — see §8.15 Chain 1, "The Guardian's Grudge." **Reflection**: see §8.16.

---

## 8.4 Merchant Encounter (`merchant`) — *Common*

> "A trembling oil lamp casts light on a cloth spread with strange wares. Each one bears a spiral mark burned into it. A hooded figure bows in greeting, waving you closer."

No combat. On entering the room:

1. A **fixed 4** offers are pre-rolled (`events.merchantOfferCount`, `data/balance-config.json`; each rolled independently on the standard §7.2 rarity table) — fixed for this visit, unless refreshed (below).
2. Each offer clearly displays its **name, description, rarity, and coin price** (`events.merchantPriceCoins` per rarity — Common 50 / Rare 70 / Unique 100 / Epic 150, `09-currency.md`).
3. **Refresh** — the player may pay `events.merchantRefreshCostCoins` (10) to re-roll all 4 offers as a fresh independent set (the old 4 are gone, not added to), up to `events.merchantMaxRefreshes` (3) times per visit (so up to 4 distinct offer-sets total: the initial roll + 3 paid refreshes). Locked once the party can't afford it or the refresh limit is used up.
4. Buy at most **1 offer per visit** overall (unaffected by how many times the offers were refreshed) — the party pays coins directly, no character HP or payer selection needed. Purchasing grants the Artifact through the normal decision flow.
5. **Locked, not hidden**, if the party doesn't have enough coins for that offer — coins can't go negative, so this is a hard block rather than the HP-based safety check other events use.

Implementation: `merchantPurchase`/`merchantRefresh`/`merchantLeave` (`src/engine/events/merchant.ts`).

**Recurring**: the same figure returns on later visits — see §8.14. **Reflection**: see §8.16.

---

## 8.5 Trade HP for an Artifact (`blood-altar`) — *Rare*

> "Ancient carvings on the stone pedestal ooze a dark, still-warm liquid, a spiral unwound and open at its center. It demands a price paid in blood, nothing more, nothing less."

No combat. On entering the room, the player may:

- Choose 1 character in the party, pay a flat % of that character's maxHP (rounded down — `events.bloodAltarHpPercent`, `data/balance-config.json`, exported as `BLOOD_ALTAR_HP_PERCENT` in `src/engine/events/bloodAltar.ts`) → immediately receive 1 fully random Artifact rolled on the standard §7.2 rarity table (you don't know what you'll get in advance — unlike the Merchant, where the specific Artifact is shown up front), through the normal decision flow.
- Or decline, leaving the room without losing anything.

**Safety limit**: if the HP cost is ≥ the chosen character's current HP, the "pay the price" option is locked for that character until a different character with enough HP is chosen, or the room is left. Still HP-only — not a coin event (the flavor text frames losing HP as the actual narrative price, not a shop transaction).

**Chain escalation**: repeated payments (combined with Collapsed Floor's, §8.12) build toward an escalated description — see §8.15 Chain 3, "Blood Debt." **Reflection**: see §8.16.

---

## 8.6 New Underlying Mechanic — Cursed Artifact

The events in §8.7–8.12 that touch this mechanic require a concept in `07-items-artifacts.md` §7.2: **Artifacts with a negative effect**.

```
ArtifactDefinition {
  ...
  isCursed?: boolean   // true = artifact has ≥1 negative effect, shown as a warning when offered at an event
}
```

No dedicated `ArtifactEffect` kind is needed for most Cursed artifacts — the existing `statBoost` field is reused with a negative `amount`. 1 dedicated kind exists purely for the Cursed case:

| Effect | How it's used for Cursed |
|---|---|
| `statBoost` | negative `amount` — reuses the field as-is |
| `curseAggroBoost` | `{ kind: "curseAggroBoost"; amount: number }` — adds aggro to the character wearing it, monsters prioritize targeting this character |

The Cursed catalog (each pairing 1 negative effect with 1 stronger-than-usual positive effect to compensate) lives in `data/artifacts.json`, filtered to `isCursed: true` entries.

A Cursed Artifact **occupies a normal equipment slot** (costs 1 of the character's slots, `07-items-artifacts.md` §7.2), with no additional cost beyond that when equipped, and skips straight to the forced-Equip branch of the decision flow (no Discard option). It only appears via `cursed-shrine` (§8.7) or as an unlucky outcome of `sacrificial-circle` (§8.9) if the roll happens to land on exactly one of the Cursed ids in the standard pool. The **only** way a Cursed artifact can leave a character afterward is Wandering Hermit's Exchange fortune (§8.11) — there is no free "remove curse" service.

---

## 8.7 Cursed Shrine (`cursed-shrine`) — *Rare*

> "A statue with 3 eyes. One of them is open. It wasn't the same one a moment ago."

**No combat** (`kind: "choiceReveal"`). Pre-rolls 1 random Artifact that may be Cursed (`rollArtifactOrCursed`, `src/data/artifacts.ts` — a fixed chance of landing in the Cursed-Artifact pool from §8.6, otherwise a normal roll on the standard table) — **shown in full before you accept it** (unlike `blood-altar` — you see the specific artifact and know whether it's cursed or not, you just don't know what it will be until the single roll happens).

- Step 1: roll, show the result (name + all effects, including the negative one if any).
- Step 2: the player chooses **Accept** or **Decline** (nothing is lost by declining — unlike `blood-altar`, which requires paying up front).
- If Accepted: it goes through the normal decision flow — forced-Equip if it turned out Cursed, optional Equip/Discard otherwise.

**No recurring NPC, no chain.** **Reflection**: see §8.16.

---

## 8.8 Twin Altars (`twin-altars`) — *Rare*

> "Two stone pedestals face each other, each carved with a spiral, open at the center. Choose 1: the other shatters the instant you touch its twin."

**No combat** (`kind: "choiceReveal"`, `forceEquip: true` — the only event that forces immediate equipping). No resource is paid — the price is the missed opportunity.

- **2 specific Artifacts are pre-rolled independently** (2 separate rolls on the standard table), with full name/effects/rarity shown for both at once.
- Choose **exactly 1**, the other disappears forever (no leaving and coming back to change your mind — once chosen, the room clears immediately).
- **There's no "decline both" option** — this room forces a decision, unlike every other event in the game.
- The chosen Artifact then goes through the forced-Equip branch of the decision flow (`07-items-artifacts.md` §7.2) — the player designates a character; if that character is already at 3/3, they must discard 1 of *that character's own* ordinary artifacts first (a different, non-full character doesn't help).

**No recurring NPC, no chain.** **Reflection**: see §8.16.

---

## 8.9 Ritual Circle (`sacrificial-circle`) — *Rare*

> "Old dried blood traces a spiral across the stone, open at one end and too deliberate to be an accident. The circle doesn't accept ordinary offerings, only something already enchanted."

**No combat** (`kind: "artifactExchange"`). Sacrifice 1 **currently-equipped** artifact (nothing sits unequipped anymore — every owned artifact is equipped somewhere) to roll a new Artifact, with the rarity bound to be **equal to or higher than** the tier of the sacrificed artifact — `rollArtifactWithMinRarity` (`src/data/artifacts.ts`), which renormalizes the same `treasureOrEvent` weights used everywhere else (`RARITY_WEIGHTS`) rather than using a separate table, excluding tiers below the threshold.

Choose the artifact to sacrifice from anywhere across the party, confirm → it's permanently removed → roll immediately, the result goes through the normal decision flow. There's no limit on the number of sacrifices in a single visit to the room as long as there's still an artifact to sacrifice — each sacrifice/roll counts as its own action and can be repeated until satisfied or out of artifacts (the room stays open between sacrifices; each new roll's decision must be resolved before the next sacrifice can be made).

**Chain escalation**: repeated sacrifices across the whole run build toward an escalated description — see §8.15 Chain 2, "The Circle Remembers." **Reflection**: see §8.16.

---

## 8.10 Wandering Gambling Den (`gambling-den`) — *Rare*

> "A stranger shuffles 3 overturned cups, sneering in the dark — no brand on his skin, no altar in sight. 'Give me what you have. I'll double it, or keep it for good.'"

**No combat** (`kind: "coinGamble"`). A pure Cursed-Coin escalating gamble, up to 4 rounds, the stake carrying forward as long as the player keeps winning and choosing to continue — it **never wagers an Artifact**.

| Round | Stake (= the pot so far) | Win chance | On win | Reachable only by |
|---|---|---|---|---|
| 1 | 20 coins | 70% | pot → 40 coins | Entry (costs 20 coins up front, requires ≥ 20 on hand) |
| 2 | 40 coins | 60% | pot → 80 coins | Choosing **Continue** after winning round 1 |
| 3 | 80 coins | 50% | pot → 160 coins | Choosing **Continue** after winning round 2 |
| 4 | 160 coins | 30% | **2 Epic Artifacts** — the pot converts into the jackpot reward instead of doubling again | Choosing **Continue** after winning round 3; the event ends here either way |

Config: `events.gamblingDenRounds` (`data/balance-config.json`).

Flow:
1. Entering the room: play Round 1 (pay 20 coins, `gamblingDenEnter`) or leave (no cost, no reward).
2. Roll that round's win chance.
   - **Lose**: the entire current pot is lost outright, event ends, nothing gained.
   - **Win, rounds 1–3**: pot doubles, then a fresh choice — **Stop** (`gamblingDenStop`, bank the current pot as coins, event ends) or **Continue** (`gamblingDenContinue`, restake the *whole* pot on the next round — no partial cash-out).
   - **Win, round 4**: pot converts to **2 Epic Artifacts** instead of coins — last round regardless of outcome, no further "continue." Each of the 2 artifacts goes through the normal decision flow independently, **sequentially** (the 2nd isn't rolled/revealed until the 1st is resolved, same rule as any other multi-artifact grant, `07-items-artifacts.md` §7.2).

Implementation: `src/engine/events/gamblingDen.ts`.

**Recurring**: the same stranger returns, remembering how the last visit ended — see §8.14. **Reflection**: see §8.16.

---

## 8.11 Wandering Hermit (`wandering-hermit`) — *Rare*

> "An old man sits meditating amid the rubble, a spiral mark scarred into his forearm. 'I don't sell. I trade.'"

**No combat** (`kind: "artifactExchange"`), doesn't create a new Artifact from nothing — it's a paid service that interacts with an artifact the party already has. **Exchange fortune is the room's only service** (there's no free "remove curse" service):

- Costs `events.wanderingHermitExchangeCostCoins` (50 coins).
- Choose **any 1 currently-equipped artifact from anywhere in the party — including a Cursed one**. This is the *only* way to shed a Cursed artifact post-launch (`07-items-artifacts.md` §7.2).
- That artifact is permanently removed. A replacement is rolled at **rarity ≥ the given-up artifact's rarity** (`rollArtifactWithMinRarity`, the same mechanic Sacrificial Circle uses, §8.9), and goes through the normal decision flow.
- If the party has no artifacts at all to offer up, or can't afford the cost, the room has nothing to interact with — the only option is to leave.

Implementation: `hermitExchangeFortune` (`src/engine/events/hermit.ts`).

**Recurring**: the same old man returns — see §8.14. **Reflection**: see §8.16.

---

## 8.12 Collapsed Floor (`collapsed-floor`) — *Rare*

> "One wrong step and you fall through to the floor below. A weak groan echoes up from the crack — someone else is still trapped down there."

A rescue mechanic: pay a fixed HP cost up front to attempt the rescue, and the outcome determines whether you get a reward. Still HP-only, same reasoning as Blood Altar.

- Choose 1 character to "climb down and rescue": pay a flat % of that character's maxHP (rounded down — `events.collapsedFloorHpPercent`, `data/balance-config.json`, exported as `COLLAPSED_FLOOR_HP_PERCENT` in `src/engine/events/collapsedFloor.ts`) regardless of the outcome.
- Roll for success (`events.collapsedFloorSuccessChance`, `data/balance-config.json`):
  - **Rescue succeeds**: receive 1 Artifact, rolled restricted to {Unique, Epic} — reusing the exact same `boss` weight ratio from `RARITY_WEIGHTS` (`src/data/artifacts.ts`) as the existing Boss table in `07-items-artifacts.md` §7.2, no new table created. Goes through the normal decision flow.
  - **Too late**: nothing further is received — only the HP already paid is lost.
- Safety limit: if the HP cost is ≥ the chosen character's current HP, the "climb down and rescue" option is locked for that character.
- Can be skipped from the start, losing nothing.

Its successful/attempted payments count toward Chain 3 alongside Blood Altar's (§8.15) even though it has no reflection or recurring NPC of its own.

**No recurring NPC, no reflection** — kept deliberately mundane along with Open Chest (§8.2); see §8.13.

---

## 8.13 Shared Worldview — the Sleeper & the Covenant

Darkest Terminal runs entirely on a TUI — no cutscene, no character portrait, no illustrated environment. Flavor text is the only tool the game has to convey its world, so every event description in this section is written as a piece of 1 coherent world rather than 19 unrelated vignettes.

**The Sleeper** — an entity the dungeon was built to contain or worship (deliberately left ambiguous which). It never physically appears in the game; its presence is only ever felt through:

- **The Covenant** — a cult (extinct or still active, also left ambiguous) that built the shrines, altars, and guardians: `guardian-fight`, `desecrated-altar`, `merchant`, `blood-altar`, `cursed-shrine`, `twin-altars`, `sacrificial-circle`.
- **The Hermit** (`wandering-hermit`) — a Covenant priest who broke with it. In-fiction, this is why they're the only NPC who can strip a Cursed artifact (§8.6/§8.11): they know the Covenant's own rites and use them against it.
- **The Stranger** (`gambling-den`) — explicitly **not** Covenant. An outsider who deals only in coin, never blood or artifacts as a *cost* (only as a rare *prize*, the round-4 jackpot).
- **Ordinary people** — `open-chest`, `collapsed-floor` (§8.2, §8.12), and 3 of the 8 events at §8.17-8.20 (`old-count`, `doubled-back`, `waiting-supplies`) stay mundane on purpose: remnants of past adventuring parties who didn't make it, reflecting the game's own permadeath theme back at the player, with no Covenant/Sleeper connection at all.
- **Evidence of the schism, not an actor in it** — `broken-seal` and `half-a-warning` (§8.22-8.23) are the containment/communion split's own wreckage: a torn seal, a witness's testimony. Neither event is Covenant ground itself, and neither is written to confirm which side of the split was right.
- **Pure dream-logic** — `the-delay` and `vigil-candle` (§8.19, §8.21) carry no institution and no remnant-of-a-person framing at all; they exist to show the dungeon's physical rules breaking on their own, without any Covenant/Sleeper vocabulary attached.
- **The Covenant's own origin, undercut** — `still-breathing` (§8.24) is the 1 event that reaches past the Covenant to what it copied its central symbol from; still never named, but the deepest single piece of evidence in the game.

| Event id | Faction | Why (1 line) |
|---|---|---|
| `open-chest` | — (mundane) | belongings of a dead adventurer |
| `guardian-fight` | Covenant, containment-leaning | a bound construct/ward guarding Covenant ground — spiral scratched closed, coiled tight (11-world-bible.md §11.6) |
| `merchant` | Covenant | a pilgrim trading relics scavenged from deeper floors |
| `desecrated-altar` | Covenant, containment-leaning | a Sleeper shrine, disturbed — spiral cut into the base, closed like a knot (§11.6) |
| `blood-altar` | Covenant, communion-leaning | a pact-altar, blood is literally the toll — spiral unwound and open at its center (§11.6) |
| `cursed-shrine` | Covenant | the Covenant's idol — the "3 eyes" watch how deep the party has gone |
| `twin-altars` | Covenant, communion-leaning | a Covenant rite that tests a pilgrim by forcing an irreversible choice — spiral carved open at the center (§11.6) |
| `sacrificial-circle` | Covenant, communion-leaning | Covenant ritual ground — trades enchanted-for-enchanted only; spiral traced in blood, open at one end (§11.6) |
| `wandering-hermit` | ex-Covenant (apostate) | the only source that can strip a curse |
| `gambling-den` | outsider | explicitly not Covenant — coin only, never blood/artifacts as cost |
| `collapsed-floor` | — (mundane) | another trapped adventurer, not a Covenant device |
| `old-count` | — (mundane) | a stranger's obsessive counting, interrupted mid-mark |
| `doubled-back` | — (mundane) | footprints with no exit — mortality, not doctrine |
| `the-delay` | — (pure dream-logic) | a reflection that lags — no institution, no remnant of a person |
| `waiting-supplies` | — (mundane, edges into Covenant only via §8.15's cross-event text) | a bundle nobody came back for |
| `vigil-candle` | — (pure dream-logic, deliberately unconnected) | a candle that shouldn't still be burning, kept as atmosphere, not evidence |
| `broken-seal` | schism evidence, dual-reading | a torn seal read as communion OR containment depending on the party's own recent bias — never both, never neither |
| `half-a-warning` | schism evidence | a personal testimony, not a Covenant ritual object |
| `still-breathing` | Covenant's own origin, undercut | reveals the spiral was copied, not invented by the Covenant |

Not every Covenant event picks a containment/communion lean — `merchant` and `cursed-shrine` are left
ambiguous on purpose, per `11-world-bible.md` §11.6's own caution against forcing every location to
declare a side.

**Tone, for any future writer touching this content**: the game never confirms whether the Sleeper is real, a delusion of the Covenant, or already dead. No event ever *names* the Sleeper or the Covenant to the player, in dialogue or narration — the player only ever sees a **trace** (an unexplained mark, brand, or pattern recurring across otherwise-unrelated events) and is meant to notice the repetition without being told what it means.

---

## 8.14 Recurring Characters

Only the 3 **personified** events qualify — the ones with a "someone" in the flavor text, not a place or a mechanic: `merchant` (the pilgrim), `wandering-hermit` (the apostate), `gambling-den` (the stranger). The other 8 events are locations/rituals and don't get a "we've met" callback.

From the 2nd time the player resolves one of these 3 events in a run, the room shows `EventDefinition.returnDescription` instead of `description`. Tracked via `GameState.metNarrativeNpcIds: Id[]` (ids of personified events already met this run — resets on New Game, persists through save/load) — set in `resolveEventEntry` (`src/engine/dungeon.ts`), read by the same function and by `currentEventDescription()` (`src/ui/screens/events.ts`, re-derives the same text on every re-render within a visit).

`gambling-den` needs 3 return variants instead of 1 plain string, since the line branches on `GameState.lastGamblingDenOutcome?: "won" | "lost" | "declined"` (the outcome of the player's most recent visit — undefined until the 1st visit closes). `EventDefinition.returnDescription` is therefore typed `string | Record<"won" | "lost" | "declined", string>` — only `gambling-den` uses the object form. Set by `rollRound()`'s loss/jackpot branches (`"lost"`/`"won"`), `gamblingDenStop()` (`"won"` — banking a pot the player chose to walk away with still counts as a win), and `gamblingDenLeave()` (`"declined"`), all in `src/engine/events/gamblingDen.ts`.

| Event id | Return text (2nd+ meeting) |
|---|---|
| `merchant` | "The same hooded figure — or one just like it. The wares are new, but the bow is exactly as before." |
| `wandering-hermit` | "The old man's eyes are already open, like he knew you'd be back. 'Trade again? I don't forget a fair deal.'" |
| `gambling-den` (won) | "The stranger deals a fresh hand without looking up. 'Didn't expect a winner to come back for more.'" |
| `gambling-den` (lost) | "The stranger deals a fresh hand without looking up. 'Back for more? I like watching the same face lose twice.'" |
| `gambling-den` (declined) | "The stranger deals a fresh hand without looking up. 'Changed your mind, or just scared?'" |

No change to any event's mechanics — Merchant/Hermit/Gambling Den still work exactly as in §8.4, §8.10, §8.11.

---

## 8.15 Event Chains

3 small, independent chains, each reusing a counter the player's own choices already produce. Every chain changes flavor text only — no mechanic described elsewhere in §8 changes because of a chain. Tracked via `GameState.narrativeCounters` (never decrease, except Chain 1's `guardianFightsSkipped`, which resets after it fires):

```ts
narrativeCounters: {
  guardianFightsSkipped: number;     // Chain 1
  artifactsSacrificed: number;       // Chain 2
  altarPaymentsCount: number;        // Chain 3
  guardianGrudgeFiredCount: number;  // Chain 1 tier 2 — see below, never resets
}
```

Each chain also has a **tier-2 escalation** (`11-world-bible.md` §11.13) past its original single threshold, gated by floor depth (`events.chainTier2MinFloorDepth`, 15) in addition to the counter, and a **tier-3 escalation** (`10-event-narrative.md` Part C.3) one gate deeper still (`events.chainTier3MinFloorDepth`, 35), so an early/lucky/rich run can't reach either tier on the counter alone.

### Chain 1 — "The Guardian's Grudge" (`guardianFightsSkipped`, `guardianGrudgeFiredCount`)

Reuses the "Leave without fighting" choice from §8.3. **This counter is shared across both event ids** — `guardianFightSkip()` (`src/engine/events/guardianFight.ts`) is the same function for both `guardian-fight` and `desecrated-altar`, so skipping 1 of each counts as 2 toward the same total, not 1 toward 2 separate counters.

- **At 2 skips**: the next room that rolls `guardian-fight` or `desecrated-altar` shows `chainBuildupDescription` — Skip is still offered, nothing mechanical changes, just 1 quiet detail added to the description (e.g. guardian-fight's "just caught your scent" becomes "doesn't look away").
- **At `events.guardianGrudgeForcedThreshold` (3) skips**: the next such room shows `chainForcedDescription` (per-id — guardian-fight's and desecrated-altar's differ) and **does not offer Skip** — `enterGuardianFight()` is the only option, checked both in the UI (`eventGuardianFight` screen hides the option) and in `guardianFightSkip()` itself (rejects the call as a 2nd line of defense).
- The counter **resets to 0** after that forced encounter fires, so the whole cycle (quiet buildup → forced fight) can happen again later in a long run rather than exactly once. `guardianGrudgeFiredCount` increments alongside the reset and never resets itself — it's how a later firing can tell it isn't the first.
- **Tier 2**: once `guardianGrudgeFiredCount >= 1` (this chain has fired before) and floor depth is past `events.chainTier2MinFloorDepth`, the next forced encounter shows `chainForced2Description` instead — deliberately **shared verbatim** between guardian-fight and desecrated-altar, unlike tier 1's per-id text (tier 2 is written to read as losing that specificity, not keeping it). Skip is rejected exactly as at tier 1.
- **Tier 3**: once `guardianGrudgeFiredCount >= 2` and floor depth is past `events.chainTier3MinFloorDepth`, the next forced encounter shows `chainForced3Description` instead — also shared verbatim, same reasoning as tier 2. Skip stays rejected.

`Room.chainVariant?: "buildup" | "forced" | "forced2" | "forced3"` records which text variant a given room resolved to (set by `resolveEventEntry`) — needed because `guardianFightsSkipped` resets right after firing, so by the time §8.16's reflection shows, the counter alone can no longer tell which variant a given room actually was.

### Chain 2 — "The Circle Remembers" (`artifactsSacrificed`)

Increments on every successful `sacrifice()` call (`src/engine/events/sacrifice.ts`), across the whole run (not reset per room visit or per floor — Ritual Circle allows repeat sacrifices in 1 visit, §8.9). Once it reaches `events.circleRemembersThreshold` (5), every subsequent `sacrificial-circle` room uses `chainEscalatedDescription`: "The circle recognizes your hand before you kneel. It doesn't ask anymore." Once it reaches `events.circleRemembersThreshold2` (10) **and** floor depth is past `events.chainTier2MinFloorDepth`, it uses `chainEscalated2Description` instead. Once it reaches `events.circleRemembersThreshold3` (20) **and** floor depth is past `events.chainTier3MinFloorDepth`, it uses `chainEscalated3Description` instead. No mechanical change at any tier — `rollArtifactWithMinRarity` behaves exactly as in §8.9.

### Chain 3 — "Blood Debt" (`altarPaymentsCount`)

Increments by 1 on every successful `bloodAltarPay()` (§8.5) and `collapsedFloorAttempt()` (§8.12) call — "successful" meaning the character had enough HP to pay. Counts *visits*, not HP spent, so a low-level character paying often and a high-level character paying rarely accumulate the same way regardless of how their maxHP (and therefore their HP cost) has grown. Once it reaches `events.bloodDebtThreshold` (4), the next `blood-altar` room uses `chainEscalatedDescription`: "The stone recognizes the taste. It doesn't need to ask this time — it already knows you'll pay." Once it reaches `events.bloodDebtThreshold2` (8) **and** floor depth is past `events.chainTier2MinFloorDepth`, it uses `chainEscalated2Description` instead. Once it reaches `events.bloodDebtThreshold3` (16) **and** floor depth is past `events.chainTier3MinFloorDepth`, it uses `chainEscalated3Description` instead. No mechanical change at any tier.

`pickReflectionPrompt()` (`src/engine/events/shared.ts`) mirrors the same tier-3-before-tier-2-before-tier-1-before-base priority for §8.16's reflection prompt on all 4 events that can escalate.

**Cross-event continuity and the description variant pool** (`10-event-narrative.md` Part C.1/C.2) sit below chain-state priority in `pickEventText()`'s resolution order — a room only falls through to a `crossEventVariants` match or a random `descriptionVariants` pick once no chain state applies. `GameState.eventOutcomes` records a per-event outcome tag (a generic `"resolved"` fallback from `closeEvent()`, or a specific tag from `bloodAltarPay`/`bloodAltarLeave`/`collapsedFloorAttempt`/`collapsedFloorLeave`/`sacrifice`) that `crossEventVariants` conditions read.

---

## 8.16 Post-Event Reflection Choice

**9 of 11 events** — every event except `open-chest` and `collapsed-floor` (§8.13's "deliberately mundane" pair — giving them a reflection beat would imply there's something to reflect on, working against that). After an eligible event resolves, 1 short reflective line is shown plus 3 response options the player picks from — **purely characterization, no reward/stat/mechanical effect of any kind**. Whether a chosen stance ever feeds back into later content is explicitly undecided — see `10-event-narrative.md`.

**Frequency**: always shown the 1st time the player resolves a given event id in a run; a `events.reflectionRepeatChance` (50%) chance every time after that (`maybeTriggerReflection`, `src/engine/events/shared.ts`).

**Response options** are a shared 3-way stance — `curious` / `wary` / `dismissive` — reused across all 9 events rather than bespoke per-event choice sets; only the flavor text is bespoke, the meaning of picking each stance is shared. Recorded in `GameState.eventReflectionStances: Partial<Record<Id, "curious" | "wary" | "dismissive">>` (overwritten on each re-trigger, not a history log).

**Escalated prompt**: the 4 events with a chain (`guardian-fight`, `desecrated-altar`, `sacrificial-circle`, `blood-altar`) show `reflection.escalatedPrompt` instead of `reflection.prompt` when the resolution that just happened was the chain-escalated one — so a player who just lived through Chain 1's forced encounter gets a reflection that matches what actually happened, not the same generic line as any routine fight. Only the lead-in line changes for the escalated case; the 3 response options stay the same (`pickReflectionPrompt`, `src/engine/events/shared.ts`).

Triggered from 2 places, since not every event closes the same way: `closeEvent()` (`src/engine/events/shared.ts`) for the 7 choice-based events (merchant, blood-altar, cursed-shrine, twin-altars, sacrificial-circle, wandering-hermit, gambling-den) plus the Skip half of the 2 combat events; and `Game.resolve()`'s victory branch for the Fight-and-win half of `guardian-fight`/`desecrated-altar` (that path clears the room through the shared combat-resolution flow, not through `closeEvent()`).

**Content** (prompt / escalated prompt where applicable / the 3 options):

**`guardian-fight`**
- Prompt: "The guardian's ashes still carry a trace of incense, not decay. Something tended this room, once."
- Escalated (Chain 1 forced): "You didn't decide to fight this one. It decided you'd stalled long enough."
- curious: "Worth remembering — someone built this on purpose." · wary: "Better not to think about who." · dismissive: "Just a monster. Move on."

**`merchant`**
- Prompt: "The hooded figure never once lifted the hood, not even to count your coin."
- curious: "You find yourself wondering what's under there." · wary: "You don't ask. Some things are better left covered." · dismissive: "Not your business. You got what you came for."

**`desecrated-altar`**
- Prompt: "The glow hasn't fully died down, even now. It's like the stone remembers being touched."
- Escalated (Chain 1 forced): "This time you just ran out of room to keep avoiding it."
- curious: "Worth coming back for, once you know what you're looking for." · wary: "Whatever's under there, you'd rather it stayed asleep." · dismissive: "The glow's already fading. You've still got a floor left to clear."

**`blood-altar`**
- Prompt: "The wound closes faster than it should. The stone took exactly what it asked for, no more."
- Escalated (Chain 3, 4+ payments): "The stone barely had to ask this time. That's the part that stays with you."
- curious: "That's precise, for a slab of rock — someone built it that way on purpose." · wary: "Next time it might ask for more than skin." · dismissive: "A fair price. You've paid worse for less."

**`cursed-shrine`**
- Prompt: "The open eye hasn't blinked once. You'd swear it's still watching, even from here."
- curious: "Three eyes, one open — you find yourself counting the shut ones on your way out." · wary: "One open eye is already 1 too many for your taste." · dismissive: "It's carved stone. Nothing's actually watching you."

**`twin-altars`**
- Prompt: "The shattered pedestal's dust hasn't settled. You didn't choose it, but it still feels like you broke something."
- curious: "What was on that one, you'll never know now." · wary: "Some choices aren't worth revisiting." · dismissive: "Rigged either way — not like you had a real choice."

**`sacrificial-circle`**
- Prompt: "The circle goes quiet again, the pattern in the blood no less deliberate than before. It didn't thank you. It didn't have to."
- Escalated (Chain 2, 5+ sacrifices): "You knelt before you'd even finished deciding to."
- curious: "That pattern wasn't drawn by accident, and you'd like to know by what." · wary: "Not a place you'd want to visit more than you have to." · dismissive: "A fair trade, and a better artifact for it. That's all it needs to be."

**`wandering-hermit`**
- Prompt: "His eyes never opened again after the trade closed. You're not sure he needed them to."
- curious: "Whoever he used to be, before this — he's not telling, and you find yourself wanting to know." · wary: "Some pasts are better left buried, not traded for." · dismissive: "Strange old man, but he held up his end of it."

**`gambling-den`**
- Prompt: "The stranger's already shuffling for the next mark before you've finished walking away."
- curious: "You'd bet he's been doing this longer than the dungeon's been here." · wary: "Not worth sticking around to find out what a 2nd losing streak costs you." · dismissive: "A hustler's a hustler — nothing more mysterious than that."

---

## 8.17 Old Count (`old-count`) — *Common*

> "Someone scratched tally marks into the wall here, hundreds of them, all by the same hand, in neat rows. The last row stops in the middle, mid-stroke."

No combat, no price to pay (`kind: "instantReward"`) — same shape as Open Chest (§8.2): the flavor text shows first, a single confirm action grants the artifact. The confirm option reads **[1] Move on** (`EventDefinition.instantRewardActionLabel`) rather than "Open the chest" — there's nothing here shaped like a container. Confirming (`Game.openChest()`) grants 1 Artifact rolled on the standard rarity table, through the normal decision flow.

**Cross-event variant**: once the party has resolved `open-chest` or `collapsed-floor` this run (either outcome, for `collapsed-floor`), the description gains a closing line — "You've started noticing these more, the deeper you go." (10-event-narrative.md Part C.1, pair 13; see §8.15's cross-event-continuity paragraph for the resolution mechanism).

**No recurring NPC, no chain.** **Reflection**: see §8.16.

---

## 8.18 Doubled Back (`doubled-back`) — *Common*

> "Footprints lead into this room and stop. None lead back out. The room is empty, and there's nowhere else they could have gone."

Same shape as §8.17 — **[1] Move on**, 1 Artifact on the standard table.

**Cross-event variant**: same trigger as Old Count — `open-chest` or `collapsed-floor` resolved this run — the description gains "You're starting to lose count of how many." (Part C.1 pair 12).

**No recurring NPC, no chain.** **Reflection**: see §8.16.

---

## 8.19 The Delay (`the-delay`) — *Common*

> "Still water pools at the edge of the room, dark enough to mirror the torchlight. Your reflection catches up to you a half-second late, every time you move."

Same shape as §8.17/§8.18 — **[1] Move on**, 1 Artifact on the standard table.

**No cross-event variant, deliberately** — no institution, no recurring character, no remnant-of-a-person framing. The plainest possible "this place doesn't fully obey physics" moment, kept isolated on purpose as the template for any future event that needs no Covenant/lore baggage at all (10-event-narrative.md Part C.5).

**No recurring NPC, no chain.** **Reflection**: see §8.16.

---

## 8.20 Waiting Supplies (`waiting-supplies`) — *Common*

> "A bundle sits wrapped and tied at the base of the wall, exactly where someone would leave it to come back for later. The rope is knotted tight, in a careful, deliberate pattern. Nobody's coming back for this."

Same shape as §8.17-8.19 — **[1] Move on**, 1 Artifact on the standard table.

**Cross-event variant**: once the party has resolved `merchant` this run (any outcome), the rope's knot reads as "the same careful knot you've started to recognize" — the only tie between this event and the Merchant's spiral motif (Part C.1 pair 11). Without that prior visit, the base line above carries no such recognition.

**No recurring NPC, no chain.** **Reflection**: see §8.16.

---

## 8.21 Vigil (`vigil-candle`) — *Rare*

> "A candle burns at the end of a corridor no one has walked in years — the dust around it undisturbed, the wax pooled thick and old, but the flame hasn't shrunk. Something sits beside it: folded hands, folded cloth, the shape of someone who sat down and never got back up. Whatever left it there isn't coming back for it."

No combat. Same **[1] Move on** confirm as §8.17-8.20, but gated: `minFloorDepth: 15` (never rolled before floor 15) and `onceLifetime: true` (excluded from the roll pool for the rest of the run once it fires, tracked in `GameState.firedOnceEventIds`). The Artifact sits *in* the scene — mechanically identical to Open Chest's grant, framed as an offering left beside the candle rather than a separate loot beat.

**No cross-event variant, deliberately unconnected** — the first depth-gated event a run can reach, kept as pure atmosphere rather than evidence (10-event-narrative.md Part B.2, Thread 5).

**No recurring NPC, no chain.** **Reflection**: see §8.16.

---

## 8.22 Broken Seal (`broken-seal`) — *Rare*

> "A stone hatch, chained shut and mortared at the edges. Half a spiral is stamped into what's left of the lock, the other half torn away with whatever broke it open."

Same shape as §8.21 — **[1] Move on**, `minFloorDepth: 15`, `onceLifetime: true`, 1 Artifact on the standard table.

**Cross-event variant, 2 independent readings of the same base scene** (Part C.1 pairs 14/15 — array order matters, 1st match wins):
- If the party has resolved `blood-altar` (paid) or `sacrificial-circle` (sacrificed) this run: "...The chain wasn't unlocked. It was torn from the outside, by something that wanted in."
- Else if the party has resolved `guardian-fight` or `desecrated-altar` this run: "...It was torn from the inside, by something that wanted out."
- Otherwise: the base scene above, no interpretation added.

The 2 readings are opposite on purpose — identical physical evidence, read through whichever side of the containment/communion split (§8.13) the party's own recent choices lean toward. Neither reading is ever confirmed correct, and neither can fire alongside the other in the same room.

**No recurring NPC, no chain.** **Reflection**: see §8.16.

---

## 8.23 Half a Warning (`half-a-warning`) — *Rare*

> "Someone carved this fast, and never finished it. What's left: 'saw what happened to the one who tried to carry both. I won't write what was left of them. Choose one side. Don't waver.'"

Same shape as §8.21/§8.22 — **[1] Move on**, `minFloorDepth: 35`, `onceLifetime: true`, 1 Artifact on the standard table.

The first non-institutional evidence of the containment/communion schism (§8.13) the party can find — a personal testimony, not a ritual object or a Covenant ward. Echoes forward once resolved: `blood-altar` (§8.5) gains a closing line on the party's next visit — "You hesitate half a step longer than you used to, before your hand decides for you." The warning doesn't stop the drift described in §8.15's chain escalations; it only adds a beat of resistance before the same reflex wins anyway.

**No recurring NPC, no chain.** **Reflection**: see §8.16.

---

## 8.24 Still Breathing (`still-breathing`) — *Rare*

> "The walls breathe here. Not walls. Ribs. Threads of old cloth are grown into the bone, not over it, and one of them still carries a mark burned the exact same way as every mark you've traded for this whole run."

`minFloorDepth: 70`, `onceLifetime: true` — the deepest-gated event in the game and, by design, the rarest a player will ever actually see. **`noArtifactReward: true`** — confirming (**[1] Move on**) grants nothing at all, no artifact, no stat effect of any kind. 2 mechanical rewards were tried and cut during design (a guaranteed Epic, then a fear-relief effect): a reveal this strong doesn't need one, and needing one would itself be a sign the reveal wasn't landing.

The single deepest-lore reveal in the game — the spiral the Covenant built its entire ritual vocabulary around was never invented by them; it was copied from something already here first. Echoes forward once resolved: `merchant` (§8.4) gains a closing line on the party's next visit — "You don't look at the cloth the way you used to."

**No recurring NPC, no chain.** **Reflection**: see §8.16.
