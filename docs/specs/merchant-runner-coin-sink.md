# Spec: Merchant's Runner (Rest Room coin sink)

Status: **proposed, not implemented.** This is an implementation spec drafted from a
design discussion, not a decision doc — move the finalized mechanic into
`docs/gameplay-decisions/` once built, per the "keep data and docs in sync" rule
in `CLAUDE.md`.

## Problem this solves

Coin currently has only 4 flat-priced sinks (Merchant purchase/refresh, Gambling
Den entry, Wandering Hermit exchange), none of which scale with floor depth, and
Rest rooms — the room type the player visits most — have no coin interaction at
all. Coin becomes irrelevant once the player has bought what they want from the
Merchant early on.

## Feature overview

A new NPC, the **Merchant's Runner**, has a 50% chance to appear when the party
enters a Rest room. He is affiliated with the existing Merchant (per
`src/engine/events/merchant.ts`) and has unique flavor dialogue on appearance,
written as if he had been waiting for the party (reuse the `description`/
`descriptionVariants` pattern from `data/events.json`'s `merchant` entry).

He offers three independent interactions:

1. **Trophy → buff barter** — trade monster trophy items for a combat buff
   scoped to the current floor's elite/boss room.
2. **Bulk sell** — buy rare items from the runner, bulk lots only, no retail.
3. **Junk buyback** — sell unwanted items to the runner for a low flat price.

## 1. Trophy → buff barter

### Buff scope (confirmed)

The buff is granted immediately on trade and persists, inactive/hidden, until
the party enters that floor's elite/boss room, where it activates for that
combat and is then consumed. If the floor ends without the party reaching an
elite/boss room, the buff is lost unused.

This does not fit the current `ActiveStatusEffect` model
(`src/types.ts:472-482`), which only expires by `turnsRemaining` or
`linkedSummonId`. **New plumbing required:** a room-scoped expiry mode on
`ActiveStatusEffect` (e.g. a `scopedToRoomType: "eliteOrBoss"` flag) that is
checked/consumed at combat start instead of decremented per turn, rather than
a duration-based effect.

### Buff formula

Computed from the traded trophy's source monster (`data/monsters.json` fields):

- **Magnitude** — base % from `powerTier` (weak +5%, medium +8%, strong +12%,
  elite/boss role +18%), plus a small bonus from `minFloor` (+0.15% per
  `minFloor` point).
- **Primary stat** — from `monsterType`: armored/tanky/sentinel → DEF buff;
  bruiser/striker → ATK buff; glass → Crit buff; balanced → small mixed
  ATK+DEF.
- **Secondary flavor effect** — from `race`: undead → resist 1 debuff/turn;
  beast → +Speed; elemental → +status-application chance; golem → +flat DEF;
  human-like → +Accuracy; shadow-creature → +Evasion; slime → HP regen/turn;
  demi-human → +Crit chance.

Trophy items dropped by a group (multiple monsters sharing one item) do not
carry a single source monster, so the buff formula for a group item should use
the group's dominant/representative `powerTier`/`monsterType`/`race` — pick one
canonical "template" monster per group item when wiring this up (not yet
chosen; needs a decision pass alongside implementation).

### Trade cost

Not yet decided. Earlier discussion floor: "3 of the same trophy → minor buff,
2 elite-tier trophies → major buff" — needs to be revisited now that trophies
have 6 tiers instead of a flat pool; likely maps to trophy tier rather than a
fixed count. **Open TODO.**

## 2. Bulk sell / 3. Junk buyback — pricing

**Not decided.** An earlier draft proposed a bulk lot of 3 Rare items for 180
coin, and junk buyback at Common 3 / Rare 6 / Unique 10 / Epic 15 coin — but
that predates the tier ladder expanding to 6 tiers (see below) and should be
re-derived from the new ladder, not reused as-is.

## Trophy item system

### Tier ladder (new, 6 tiers)

`Common < Uncommon < Rare < Unique < Epic < Legendary`

This is specific to trophy items — it does not change the existing
Common/Rare/Unique/Epic artifact rarity used by the Merchant.

### Tier formula

**Individual (per-monster) item**, base tier from `powerTier`, bumped one step
if `minFloor` clears a threshold:

| powerTier | Base | Bump condition |
|---|---|---|
| weak | Common | `minFloor` ≥ 20 → Uncommon |
| medium | Uncommon | `minFloor` ≥ 30 → Rare |
| strong | Rare | `minFloor` ≥ 40 → Unique |
| elite/boss role | Epic | `minFloor` ≥ 70, or is the true final boss → Legendary |

**Group (race/subRace) item**: tier = the mode (most common) tier among the
group's member monsters (computed via the table above), bumped **one further
step** above that — group items are intentionally rarer than any single
member's own individual item.

A monster in a group that also keeps its own individual item can drop **either**
of the two (its own lower-tier individual item, or a rarer chance at the shared
group item) — not both from a single kill. Drop-weight split between the two
is not yet decided — **open TODO**.

### Final item list (31 items, covering 42 of 43 monster archetypes)

Two monsters intentionally have **no trophy at all**: **Lesser Vampire** (minor
recurring undead, not distinctive enough to warrant one) and **The Founder**
(final boss — drops no trophy).

Elite/boss archetypes (`roles` includes `"elite"`/`"boss"` in
`data/monsters.json`) each keep their own standalone item — they are excluded
from race/subRace group items.

#### Group items (11) — `archetypeIds` lists every monster that can drop it

| id | name | tier | archetypeIds |
|---|---|---|---|
| `vermin-hide` | Vermin Hide | Uncommon | `dungeon-rat`, `black-bat`, `vampire-bat`, `toxic-toad` |
| `predator-sinew` | Predator Sinew | Unique | `dire-wolf`, `cave-bear` |
| `chitin-shard` | Chitin Shard | Rare | `snake`, `lizard`, `spider`, `armored-beetle` |
| `cult-rag` | Cult Rag | Rare | `cultist-initiate`, `cultist-zealot` |
| `grave-cloth` | Grave Cloth | Rare | `ghoulish-crawler`, `zombie` |
| `old-bone` | Old Bone | Unique | `skeleton`, `skeleton-mage`, `skeleton-archer`, `skeleton-warrior`, `skeleton-guard` |
| `ooze-residue` | Ooze Residue | Rare | `slime`, `swamp-slime`, `lava-slime` |
| `warband-trophy` | Warband Trophy | Rare | `goblin`, `goblin-shaman`, `orc-brute` |
| `elemental-core` | Elemental Core | Unique | `fire-elemental`, `water-elemental` |
| `wraith-essence` | Wraith Essence | Epic | `ghost`, `wraith` |
| `stone-core` | Stone Core | Epic | `gargoyle`, `lesser-golem`, `mimic` |

Flavor descriptions for all 11 (in the established spare/sensory tone) were
drafted in the design discussion and still need to be finalized and copied
into `data/items.json` — see conversation log, not duplicated here to avoid
drift between two copies.

#### Individual items kept alongside a group item (11)

One representative monster per group above also keeps its own lower-tier
individual item (dual drop pool: its own item, or a rarer shot at the group
item):

| id | name | tier | monster | existing item? |
|---|---|---|---|---|
| `bat-blood` | Bat Blood | Common | Black Bat | yes, reuse as-is |
| `bear-claw` | Bear Claw | Rare | Cave Bear | new |
| `silk-gland` | Silk Gland | Uncommon | Spider | new |
| `prayer-beads` | Prayer Beads | Uncommon | Cultist Zealot | new |
| `rotten-bandage` | Rotten Bandage | Uncommon | Zombie | new |
| `bone-shield-fragment` | Bone Shield Fragment | Rare | Skeleton Warrior | new |
| `slime-solution` | Slime Solution | Common | Slime | yes, reuse as-is |
| `knuckle-guard` | Knuckle Guard | Rare | Orc Brute | new |
| `ember` | Ember | Rare | Fire Elemental | new |
| `hollow-plate` | Hollow Plate | Unique | Wraith | new |
| `core-fragment` | Core Fragment | Unique | Lesser Golem | new |

Every other monster inside a group (e.g. Dungeon Rat, Vampire Bat, Toxic Toad,
Snake, Lizard, Armored Beetle, ...) drops **only** the shared group item —
no individual item.

#### Elite/boss standalone items (9)

| id | name | tier | monster | existing item? |
|---|---|---|---|---|
| `venom-thorn` | Venom Thorn | Epic | Giant Spider | yes, reuse as-is |
| `warped-vambrace` | Warped Vambrace | Epic | Zombie Knight | new |
| `broken-oath-sigil` | Broken Oath Sigil | Epic | Dark Knight | new |
| `warlords-trophy-chain` | Warlord's Trophy Chain | Epic | Orc Chieftain | new |
| `nobles-signet` | Noble's Signet | Epic | Vampire Lord | new |
| `dragon-scale` | Dragon Scale | Legendary | Dragon | yes, reuse as-is |
| `unraveled-fragment` | Unraveled Fragment | Legendary | Void Amalgamation | new |
| `weathered-keystone` | Weathered Keystone | Legendary | Ancient Golem | new |
| `phylactery-shard` | Phylactery Shard | Legendary | Lich | new |

## Non-trophy item tiers

Separate from trophies, the player also asked for the existing non-trophy
items in `data/items.json` to be classified using the low end of the same
ladder — **Common through Rare only** (Unique/Epic/Legendary stay reserved for
trophies and artifacts). This covers the 8 plain consumables plus the 5
pre-existing `archetypeIds` items that were *not* folded into the trophy list
above (`exploration-kit`, `grave-dust`, `broken-blade-fragment`,
`rotten-flesh`, `venom-gland`).

Tier assigned from each item's `weight` in `data/items.json` (lower weight =
rarer in the loot table) as the primary signal, with effect strength as a
tie-break:

| id | weight | effect | tier |
|---|---|---|---|
| `small-health-potion` | 1 | heal 30 | Common |
| `small-mana-potion` | 1 | restoreMp 20 | Common |
| `calming-draught` | 1 | fear -25 | Common |
| `rotten-flesh` | 1 | debuff distracted, 1 turn | Common |
| `large-health-potion` | 0.5 | heal 70 | Uncommon |
| `large-mana-potion` | 0.5 | restoreMp 45 | Uncommon |
| `antidote` | 0.5 | cleanse status effect | Uncommon |
| `whetstone` | 0.5 | empower, 2 turns | Uncommon |
| `temporary-ward` | 0.5 | fortify, 2 turns | Uncommon |
| `grave-dust` | 0.5 | fortify, 2 turns (archetype-locked) | Uncommon |
| `broken-blade-fragment` | 0.5 | empower, 2 turns (archetype-locked) | Uncommon |
| `venom-gland` | 0.5 | poison-coat, 3 turns, 3-monster lock | Rare |
| `exploration-kit` | 0.15 | satiety +30, party-wide, 7-monster lock | Rare |

This needs the same `trophyTier`-style field added to `ItemDefinition` noted
below (or a shared, more neutrally-named `tier` field covering both trophies
and regular items, rather than two separate fields — worth deciding during
implementation rather than here).

## Engine/UI work required

- **Rest room**: currently `Game.restAction` (`src/engine/game.ts:274`) offers
  exactly 3 fixed choices (Eat/Chat/Skip), no chance-roll or sub-event state.
  Need: a `Rng.chance(0.5)` roll on rest-room entry (`src/engine/dungeon.ts:57-69`),
  and a new `activeEvent`-style sub-screen (mirroring `src/ui/screens/events.ts`,
  `state.activeEvent`) to host the runner's dialogue/shop UI — Rest rooms have
  no such sub-screen today.
- **Status effects**: extend `ActiveStatusEffect` (`src/types.ts:472-482`) with
  a room-scoped expiry mode (see buff scope above) instead of the current
  turn-count/linked-summon-only model.
- **Items**: add `trophyTier` (or similar) field to `ItemDefinition` so the
  runner's shop UI and buff-magnitude lookup can read tier without re-deriving
  it from `archetypeIds` at runtime. New items above still use the existing
  `archetypeIds` mechanism (`src/data/items.ts:75-78`) for drop-table wiring —
  no new drop-table system needed there.
- **Merchant event UI/data patterns** (`data/events.json`'s `merchant` entry,
  `data/strings.json:258-267`, `src/ui/screens/events.ts:73-273`) are reusable
  for the runner's shop-list rendering and flavor text, but "buy junk from the
  player" and "bulk trade for a buff" are new interaction types with no code
  to copy — only the presentation pattern carries over.

## Open TODOs before implementation can start

1. Trophy trade cost (how many / which tier of trophy buys which buff tier).
2. Bulk-sell and junk-buyback coin prices, re-derived for the 6-tier ladder.
3. Which monster is the "template" for a group item's buff formula (magnitude/
   stat/race effect), since group items have no single source monster.
4. Drop-weight split for monsters that have both an individual and a group
   item available.
5. Flavor descriptions for all 20 new items (11 group + 9 elite/boss, minus
   the 3 reused existing ones already worded) — drafted in conversation, not
   yet finalized or written into `data/items.json`.
