# §8. Event Room

*(item 8 of `00-index.md`)*

Event room logic lives in `src/engine/dungeon.ts`, `src/engine/game.ts`, `src/data/events.ts`, `data/events.json`. The Event room is separate from the Treasure room (the Treasure room keeps its spec unchanged in `07-items-artifacts.md` §7.2: guaranteed Artifact, no combat, no choices — but the floor generator currently doesn't spawn that room type; see the note in §7.2).

**Naming convention**: `id` is in English (matching §7), the description/flavor text is in English (translated).

**Source of truth for every number below**: the event catalog and its `kind`/`forceEquip` fields live in `data/events.json`; roll weights and HP-cost percentages live in `data/balance-config.json` field `events`, re-exported as named constants in `src/data/events.ts`/`src/engine/game.ts`. A handful of mechanics (merchant offer count, cursed-shrine roll chance, gambling-den coin-flip) are hardcoded inline where they're used (called out below) rather than exposed as data.

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
  kind: "instantReward" | "combatReward" | "merchant" | "hpGamble" | "choiceReveal" | "artifactExchange" | "rescueGamble"
  forceEquip?: boolean       // true only for twin-altars, see §8.13
}
```

`guardian-fight` and `desecrated-altar` both use `kind: "combatReward"` — **they share the same handling mechanics in the engine, differing only in `id`/`name`/`description`**. Likewise, `cursed-shrine`/`twin-altars` share `kind: "choiceReveal"` (reveal information before deciding); `sacrificial-circle`/`gambling-den`/`wandering-hermit` share `kind: "artifactExchange"` (operating on an artifact you already own rather than a plain new roll).

---

## 8.2 Open Chest (`open-chest`) — *Common*

> "A cracked oak chest sits crooked amid a pile of rubble, its lid ajar as if waiting for someone curious enough to come closer."

No combat, no price to pay. Enter the room → immediately grants 1 Artifact rolled on the standard rarity table, added to `GameState.unequippedArtifactIds` — exactly the same mechanic as the Treasure room in `07-items-artifacts.md` §7.2, the only difference being that this is one of several possible Event room outcomes rather than its own dedicated room.

---

## 8.3 Guardian Fight (`guardian-fight`) & Desecrate the Altar (`desecrated-altar`) — *Common*

**Shared mechanic** (`kind: "combatReward"`):

- Spawns 1-2 monsters (`spawnEventGuardianMonsters`, `src/engine/dungeon.ts`) from the current floor's normal monster pool (not a separate Elite/Boss pool — reuses `spawnMonster()` in `src/data/monsters.ts`), scaled up compared to the normal spawn level for that floor via `events.eventGuardianStatMultiplier` (`data/balance-config.json`) — heavier than a normal combat room, but well below an Elite (no `eliteSkillIds` used).
- Win the fight → guaranteed 1 Artifact rolled on the standard rarity table.
- Lose the fight / flee → no Artifact, the game's existing combat-loss consequences apply as normal (no special rules for the Event room).

**The only difference between the two ids**: flavor text.
- `guardian-fight`: "The scrape of claws on stone echoes from a dark corner — something is guarding the treasure in this room, and it just caught your scent."
- `desecrated-altar`: "The stone altar glows with a pale red light, pulsing as if breathing — touching it will surely wake whatever sleeps beneath."

---

## 8.4 Merchant Encounter (`merchant`) — *Common*

> "A trembling oil lamp casts light on a cloth spread with strange wares. A hooded figure bows in greeting, waving you closer."

No combat. On entering the room:

1. A small number of specific Artifacts are pre-rolled (`offerCount`, hardcoded range in `src/engine/dungeon.ts`; each rolled independently, once, on the standard §7.2 rarity table) — fixed for this visit to the room, and won't change if you leave and come back (if the game allows returning to a room).
2. Each offer clearly displays its **name, description, rarity, and HP price** before purchase — the price is a % of the paying character's maxHP, per rarity tier (`events.merchantPricePercent`, `data/balance-config.json`, exported as `MERCHANT_PRICE_PERCENT` in `src/engine/game.ts`).
3. The player chooses **any one character in the party** to pay the price (not necessarily the one who will equip the Artifact — the Artifact still goes into the shared `unequippedArtifactIds` pool like any other source; deciding who equips it happens separately on the party management screen).
4. Buy at most 1 offer per visit to the room, or decline all and leave empty-handed.
5. **Safety limit**: if the % maxHP price is ≥ the chosen character's current HP (i.e. it would bring HP to 0 or below), that offer is **locked/hidden** for that character — no trade can be made that would kill them. The player can switch to a different character with enough HP, or skip that offer.

---

## 8.5 Trade HP for an Artifact (`blood-altar`) — *Rare*

> "Ancient carvings on the stone pedestal ooze a dark, still-warm liquid. It demands a price paid in blood, nothing more, nothing less."

No combat. On entering the room, the player may:

- Choose 1 character in the party, pay a flat % of that character's maxHP (rounded down — `events.bloodAltarHpPercent`, `data/balance-config.json`, exported as `BLOOD_ALTAR_HP_PERCENT` in `src/engine/game.ts`) → immediately receive 1 fully random Artifact rolled on the standard §7.2 rarity table (you don't know what you'll get in advance — unlike the Merchant, where the specific Artifact is shown up front).
- Or decline, leaving the room without losing anything.

**Safety limit**: same rule as the Merchant (§8.4, item 5) — if the HP cost is ≥ the chosen character's current HP, the "pay the price" option is locked for that character until a different character with enough HP is chosen, or the room is left.

---

## 8.6 New Underlying Mechanic — Cursed Artifact

The events in §8.7–8.12 that touch this mechanic require a concept that doesn't yet exist in `07-items-artifacts.md` §7.2: **Artifacts with a negative effect**. Schema extension:

```
ArtifactDefinition {
  ...
  isCursed?: boolean   // true = artifact has ≥1 negative effect, shown as a warning when offered at an event
}
```

No new `ArtifactEffect` kind is needed — existing fields are reused with negative/inverted values:

| Effect | How it's used for Cursed |
|---|---|
| `statBoost` | negative `amount` — reuses the field as-is |
| `curseAggroBoost` | `{ kind: "curseAggroBoost"; amount: number }` — adds aggro to the character wearing it, monsters prioritize targeting this character |
| `curseDrainBoost` | `{ kind: "curseDrainBoost"; percent: number }` — inverts `survivalDrainReduction`, speeds up hunger/thirst depletion |

The suggested Cursed catalog (each pairing 1 negative effect with 1 stronger-than-usual positive effect to compensate) lives in `data/artifacts.json`, filtered to `isCursed: true` entries — `CURSED_ARTIFACT_IDS` in `src/data/artifacts.ts`.

A Cursed Artifact **occupies a normal equipment slot** (costs 1 of the character's slots, `07-items-artifacts.md` §7.2), with no additional cost beyond that when equipped. It only appears via `cursed-shrine` (§8.7) or as an unlucky outcome of `sacrificial-circle`/`gambling-den` if the roll happens to land on exactly one of the Cursed ids in the standard pool.

---

## 8.7 Cursed Shrine (`cursed-shrine`) — *Rare*

> "A statue with 3 eyes. One of them is open."

**No combat** (`kind: "choiceReveal"`). Pre-rolls 1 random Artifact that may be Cursed (`rollArtifactOrCursed`, `src/data/artifacts.ts` — a fixed chance of landing in the Cursed-Artifact pool from §8.6, otherwise a normal roll on the standard table) — **shown in full before you accept it** (unlike `blood-altar` — you see the specific artifact and know whether it's cursed or not, you just don't know what it will be until the single roll happens).

- Step 1: roll, show the result (name + all effects, including the negative one if any).
- Step 2: the player chooses **Accept** or **Decline** (nothing is lost by declining — unlike `blood-altar`, which requires paying up front).
- If Accepted: it goes into the shared pool like a normal artifact, **optional-equip** under the general rule in §8.13 (no obligation to equip it right away, even if it's Cursed) — the risk only becomes real once the player actively equips it later.

---

## 8.8 Twin Altars (`twin-altars`) — *Rare*

> "Two stone pedestals facing each other. Choose 1 — the other shatters the instant you touch its twin."

**No combat** (`kind: "choiceReveal"`, `forceEquip: true` — the only event that forces immediate equipping, see §8.13). No resource is paid — the price is the missed opportunity.

- **2 specific Artifacts are pre-rolled independently** (2 separate rolls on the standard table), with full name/effects/rarity shown for both at once.
- Choose **exactly 1**, the other disappears forever (no leaving and coming back to change your mind — once chosen, the room clears immediately).
- **There's no "decline both" option** — this room forces a decision, unlike every other event in the game.
- The chosen Artifact **must be equipped immediately** on a character the player designates — if the party's equip slots are already full, one currently-equipped artifact (any) must be unequipped first to make room (see §8.13).

---

## 8.9 Ritual Circle (`sacrificial-circle`) — *Rare*

> "Old dried blood stains the stone. The circle doesn't accept ordinary offerings — only something already enchanted."

**No combat** (`kind: "artifactExchange"`). Sacrifice 1 Artifact (from the shared pool or currently equipped — if equipped, it's automatically unequipped before the sacrifice) to roll a new Artifact, with the rarity bound to be **equal to or higher than** the tier of the sacrificed artifact — `rollArtifactWithMinRarity` (`src/data/artifacts.ts`), which renormalizes the same `treasureOrEvent` weights used everywhere else (`RARITY_WEIGHTS`) rather than using a separate table, excluding tiers below the threshold.

Choose the artifact to sacrifice from your owned list (shared pool + everything equipped across the party), confirm → roll immediately, the result is **optional-equip** under the general rule in §8.13. There's no limit on the number of sacrifices in a single visit to the room as long as there's still an artifact to sacrifice — each sacrifice/roll counts as its own action and can be repeated until satisfied or out of artifacts.

---

## 8.10 Wandering Gambling Den (`gambling-den`) — *Rare*

> "A stranger shuffles 3 overturned cups, sneering in the dark. 'Give me what you have. I'll double it, or keep it for good.'"

**No combat** (`kind: "artifactExchange"`). Wager 1 Artifact — chosen only from the unequipped pool (`unequippedArtifactIds`, currently-equipped artifacts can't be wagered) — for a chance to double it within the same tier:

- Choose 1 unequipped artifact, confirm the wager.
- Roll a coin flip (`gamblingDenBet`, `src/engine/game.ts` — currently an even split, hardcoded inline rather than exposed as data):
  - **Win**: keep the wagered artifact, **plus receive 1 additional Artifact rolled within the exact tier wagered** (e.g. wager a Rare → winning grants another Rare, not necessarily the same id — if that tier only has the wagered id left, a duplicate is allowed).
  - **Lose**: **the wagered artifact is lost** (leaves the pool permanently), nothing is received.
- No unequipped artifacts available → the only option is to leave.

An artifact won this way is **optional-equip** under §8.13.

---

## 8.11 Wandering Hermit (`wandering-hermit`) — *Rare*

> "An old man sits meditating amid the rubble, eyes closed. 'I sell nothing. I only... trade.'"

**No combat** (`kind: "artifactExchange"`), doesn't create a new Artifact — it's a service that interacts with artifacts you already have. Choose exactly one of the following services (free, usable once per visit to the room):

| Service | Condition | Effect |
|---|---|---|
| Remove curse | Party has ≥1 Cursed Artifact currently equipped | Removes that artifact from the character; the artifact **disappears entirely** (doesn't return to the shared pool, including its accompanying positive effect) |
| Exchange fortune | Has ≥1 Artifact of any kind (shared pool or equipped) | Choose 1 artifact, trade it for 1 different random Artifact rolled on the standard table (can't pick the same new one) |
| *(nothing to interact with)* | — | Can only leave |

The result of "Exchange fortune" is **optional-equip** under §8.13.

---

## 8.12 Collapsed Floor (`collapsed-floor`) — *Rare*

> "One wrong step and you fall through to the floor below. A weak groan echoes up from the crack — someone else is still trapped down there."

A rescue mechanic: pay a fixed HP cost up front to attempt the rescue, and the outcome determines whether you get a reward.

- Choose 1 character to "climb down and rescue": pay a flat % of that character's maxHP (rounded down — `events.collapsedFloorHpPercent`, `data/balance-config.json`, exported as `COLLAPSED_FLOOR_HP_PERCENT` in `src/engine/game.ts`) regardless of the outcome.
- Roll for success (`events.collapsedFloorSuccessChance`, `data/balance-config.json`):
  - **Rescue succeeds**: receive 1 Artifact, rolled restricted to {Unique, Epic} — reusing the exact same `boss` weight ratio from `RARITY_WEIGHTS` (`src/data/artifacts.ts`) as the existing Boss table in `07-items-artifacts.md` §7.2, no new table created.
  - **Too late**: nothing further is received — only the HP already paid is lost.
- Safety limit: if the HP cost is ≥ the chosen character's current HP, the "climb down and rescue" option is locked for that character.
- Can be skipped from the start, losing nothing.

The Artifact reward (if any) is **optional-equip** under §8.13.

---

## 8.13 Receiving an Artifact from an Event — equipping rules

`07-items-artifacts.md` §7.2 defines that any artifact picked up always goes into the shared pool `unequippedArtifactIds` first; equipping/unequipping is a separate, free action with no limit on how many times it can be done, up to the party's total equip-slot budget (`party.maxEquippedArtifacts` × party size, `07-items-artifacts.md` §7.2).

**Every event except `twin-altars`**: the artifact goes straight into the shared pool, with no separate "equip now or set aside" prompt — the player equips it whenever they like on the party management screen (already exists, key `a`).

**`twin-altars` (`forceEquip: true`)** — the only event that forces immediate equipping, with no "set aside" option:

- After choosing 1 of the 2 Artifacts shown, the player **must immediately designate 1 character** to equip it.
- If the designated character's equip slots are already full, they **must** choose one currently-equipped artifact on that character to unequip first (you can't dodge this by picking a different, already-full character).
