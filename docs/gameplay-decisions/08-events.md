# §8. Event Room

*(item 8 of `00-index.md`)*

Event room logic lives in `src/engine/dungeon.ts`, `src/engine/game.ts`, `src/engine/events/*.ts`, `src/data/events.ts`, `data/events.json`. The Event room is separate from the Treasure room (the Treasure room keeps its spec unchanged in `07-items-artifacts.md` §7.2: guaranteed Artifact, no combat, no choices — but the floor generator currently doesn't spawn that room type; see the note in §7.2).

**Naming convention**: `id` is in English (matching §7), the description/flavor text is in English (translated).

**Source of truth for every number below**: the event catalog and its `kind`/`forceEquip` fields live in `data/events.json`; roll weights, HP-cost percentages, and coin costs live in `data/balance-config.json` field `events` (Cursed Coins overview: `09-currency.md`).

---

## 8.1 Mechanic Overview

Every time the party steps into a room with `RoomType === "event"`, the system rolls 1 event id via `rollEvent(rng)` (`src/data/events.ts`), split across 2 tiers with an even roll within each tier:

| Tier | Total weight | Includes |
|---|---|---|
| **Common** (light, familiar, few branches) | `events.commonTierWeight` (`data/balance-config.json`) | `open-chest`, `guardian-fight`, `merchant`, `desecrated-altar` |
| **Rare** (heavier, with deeper risk/trade-offs) | `events.rareTierWeight` | `blood-altar`, `cursed-shrine`, `twin-altars`, `sacrificial-circle`, `gambling-den`, `wandering-hermit`, `collapsed-floor` |

The roll is independent of floor/party state — there's no special logic for high/low floors.

All Artifact rewards in §8 share the exact same `treasureOrEvent` rarity weights (`RARITY_WEIGHTS`, `src/data/artifacts.ts`) already defined in `07-items-artifacts.md` §7.2 "Rarity & drop rate per tier", **unless an event states its own table** (e.g. `collapsed-floor` only rolls Unique/Epic, `sacrificial-circle`'s roll has a minimum tier floor).

```
EventDefinition {
  id: Id
  name: string
  description: string
  kind: "instantReward" | "combatReward" | "merchant" | "hpGamble" | "choiceReveal" | "artifactExchange" | "rescueGamble" | "coinGamble"
  forceEquip?: boolean       // true only for twin-altars, see 07-items-artifacts.md §7.2
}
```

`guardian-fight` and `desecrated-altar` both use `kind: "combatReward"` — **they share the same handling mechanics in the engine, differing only in `id`/`name`/`description`**. Likewise, `cursed-shrine`/`twin-altars` share `kind: "choiceReveal"` (reveal information before deciding); `sacrificial-circle`/`wandering-hermit` share `kind: "artifactExchange"` (operating on an artifact the party already owns rather than a plain new roll); `gambling-den` has its own `kind: "coinGamble"` (§8.10 — it no longer touches artifacts as its cost, only rarely produces them as a reward).

Every Artifact granted by any event in this section — whether revealed up front or rolled blind then revealed — goes through the same **decision flow** described in `07-items-artifacts.md` §7.2: Equip (any character, replacing 1 of their own ordinary artifacts if full) or Discard (unless Cursed/`forceEquip`, which skips straight to a forced Equip). None of the per-event sections below repeat that flow — they only describe what's specific to that room.

---

## 8.2 Open Chest (`open-chest`) — *Common*

> "A cracked oak chest sits crooked amid a pile of rubble, its lid ajar as if waiting for someone curious enough to come closer."

No combat, no price to pay. Enter the room → immediately grants 1 Artifact rolled on the standard rarity table, which goes through the normal decision flow (`07-items-artifacts.md` §7.2) — the only difference from the Treasure room is that this is one of several possible Event room outcomes rather than its own dedicated room.

---

## 8.3 Guardian Fight (`guardian-fight`) & Desecrate the Altar (`desecrated-altar`) — *Common*

**Shared mechanic** (`kind: "combatReward"`):

- Spawns 1-2 monsters (`spawnEventGuardianMonsters`, `src/data/floor.ts`) from the current floor's **medium/strong power-tier archetypes only** (weak-tier archetypes are excluded — a "guardian" is meant to feel like a real threat, not a lone weak monster babysitting a chest), scaled up further via `events.eventGuardianStatMultiplier` (`data/balance-config.json`) on top of that — heavier than a normal combat room, but well below an Elite (no `eliteSkillIds` used).
- Win the fight → guaranteed 1 Artifact rolled on the standard rarity table, through the normal decision flow.
- Lose the fight / flee → no Artifact, the game's existing combat-loss consequences apply as normal (no special rules for the Event room).

**The only difference between the two ids**: flavor text.
- `guardian-fight`: "The scrape of claws on stone echoes from a dark corner — something is guarding the treasure in this room, and it just caught your scent."
- `desecrated-altar`: "The stone altar glows with a pale red light, pulsing as if breathing — touching it will surely wake whatever sleeps beneath."

---

## 8.4 Merchant Encounter (`merchant`) — *Common*

> "A trembling oil lamp casts light on a cloth spread with strange wares. A hooded figure bows in greeting, waving you closer."

No combat. On entering the room:

1. A **fixed 4** offers are pre-rolled (`events.merchantOfferCount`, `data/balance-config.json`; each rolled independently on the standard §7.2 rarity table) — fixed for this visit, unless refreshed (below).
2. Each offer clearly displays its **name, description, rarity, and coin price** (`events.merchantPriceCoins` per rarity — Common 50 / Rare 70 / Unique 100 / Epic 150, `09-currency.md`).
3. **Refresh** — the player may pay `events.merchantRefreshCostCoins` (10) to re-roll all 4 offers as a fresh independent set (the old 4 are gone, not added to), up to `events.merchantMaxRefreshes` (3) times per visit (so up to 4 distinct offer-sets total: the initial roll + 3 paid refreshes). Locked once the party can't afford it or the refresh limit is used up.
4. Buy at most **1 offer per visit** overall (unaffected by how many times the offers were refreshed) — the party pays coins directly, no character HP or payer selection needed. Purchasing grants the Artifact through the normal decision flow.
5. **Locked, not hidden**, if the party doesn't have enough coins for that offer — coins can't go negative, so this is a hard block rather than the HP-based safety check other events use.

Implementation: `merchantPurchase`/`merchantRefresh`/`merchantLeave` (`src/engine/events/merchant.ts`).

---

## 8.5 Trade HP for an Artifact (`blood-altar`) — *Rare*

> "Ancient carvings on the stone pedestal ooze a dark, still-warm liquid. It demands a price paid in blood, nothing more, nothing less."

No combat. On entering the room, the player may:

- Choose 1 character in the party, pay a flat % of that character's maxHP (rounded down — `events.bloodAltarHpPercent`, `data/balance-config.json`, exported as `BLOOD_ALTAR_HP_PERCENT` in `src/engine/events/bloodAltar.ts`) → immediately receive 1 fully random Artifact rolled on the standard §7.2 rarity table (you don't know what you'll get in advance — unlike the Merchant, where the specific Artifact is shown up front), through the normal decision flow.
- Or decline, leaving the room without losing anything.

**Safety limit**: if the HP cost is ≥ the chosen character's current HP, the "pay the price" option is locked for that character until a different character with enough HP is chosen, or the room is left. Still HP-only — not a coin event (the flavor text frames losing HP as the actual narrative price, not a shop transaction).

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

> "A statue with 3 eyes. One of them is open."

**No combat** (`kind: "choiceReveal"`). Pre-rolls 1 random Artifact that may be Cursed (`rollArtifactOrCursed`, `src/data/artifacts.ts` — a fixed chance of landing in the Cursed-Artifact pool from §8.6, otherwise a normal roll on the standard table) — **shown in full before you accept it** (unlike `blood-altar` — you see the specific artifact and know whether it's cursed or not, you just don't know what it will be until the single roll happens).

- Step 1: roll, show the result (name + all effects, including the negative one if any).
- Step 2: the player chooses **Accept** or **Decline** (nothing is lost by declining — unlike `blood-altar`, which requires paying up front).
- If Accepted: it goes through the normal decision flow — forced-Equip if it turned out Cursed, optional Equip/Discard otherwise.

---

## 8.8 Twin Altars (`twin-altars`) — *Rare*

> "Two stone pedestals facing each other. Choose 1 — the other shatters the instant you touch its twin."

**No combat** (`kind: "choiceReveal"`, `forceEquip: true` — the only event that forces immediate equipping). No resource is paid — the price is the missed opportunity.

- **2 specific Artifacts are pre-rolled independently** (2 separate rolls on the standard table), with full name/effects/rarity shown for both at once.
- Choose **exactly 1**, the other disappears forever (no leaving and coming back to change your mind — once chosen, the room clears immediately).
- **There's no "decline both" option** — this room forces a decision, unlike every other event in the game.
- The chosen Artifact then goes through the forced-Equip branch of the decision flow (`07-items-artifacts.md` §7.2) — the player designates a character; if that character is already at 3/3, they must discard 1 of *that character's own* ordinary artifacts first (a different, non-full character doesn't help).

---

## 8.9 Ritual Circle (`sacrificial-circle`) — *Rare*

> "Old dried blood stains the stone. The circle doesn't accept ordinary offerings — only something already enchanted."

**No combat** (`kind: "artifactExchange"`). Sacrifice 1 **currently-equipped** artifact (nothing sits unequipped anymore — every owned artifact is equipped somewhere) to roll a new Artifact, with the rarity bound to be **equal to or higher than** the tier of the sacrificed artifact — `rollArtifactWithMinRarity` (`src/data/artifacts.ts`), which renormalizes the same `treasureOrEvent` weights used everywhere else (`RARITY_WEIGHTS`) rather than using a separate table, excluding tiers below the threshold.

Choose the artifact to sacrifice from anywhere across the party, confirm → it's permanently removed → roll immediately, the result goes through the normal decision flow. There's no limit on the number of sacrifices in a single visit to the room as long as there's still an artifact to sacrifice — each sacrifice/roll counts as its own action and can be repeated until satisfied or out of artifacts (the room stays open between sacrifices; each new roll's decision must be resolved before the next sacrifice can be made).

---

## 8.10 Wandering Gambling Den (`gambling-den`) — *Rare*

> "A stranger shuffles 3 overturned cups, sneering in the dark. 'Give me what you have. I'll double it, or keep it for good.'"

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

---

## 8.11 Wandering Hermit (`wandering-hermit`) — *Rare*

> "An old man sits meditating amid the rubble, eyes closed. 'I sell nothing. I only... trade.'"

**No combat** (`kind: "artifactExchange"`), doesn't create a new Artifact from nothing — it's a paid service that interacts with an artifact the party already has. **Exchange fortune is the room's only service** (there's no free "remove curse" service):

- Costs `events.wanderingHermitExchangeCostCoins` (50 coins).
- Choose **any 1 currently-equipped artifact from anywhere in the party — including a Cursed one**. This is the *only* way to shed a Cursed artifact post-launch (`07-items-artifacts.md` §7.2).
- That artifact is permanently removed. A replacement is rolled at **rarity ≥ the given-up artifact's rarity** (`rollArtifactWithMinRarity`, the same mechanic Sacrificial Circle uses, §8.9), and goes through the normal decision flow.
- If the party has no artifacts at all to offer up, or can't afford the cost, the room has nothing to interact with — the only option is to leave.

Implementation: `hermitExchangeFortune` (`src/engine/events/hermit.ts`).

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
