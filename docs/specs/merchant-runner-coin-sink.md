# Spec: Merchant's Runner (Rest Room coin sink)

Status: **proposed, not implemented.** This is an implementation spec, not a decision
doc. When the mechanic is built, move its finalized rules into
`docs/gameplay-decisions/` and update the docs that describe what it changes
(`09-currency.md`, `07-items-artifacts.md`, `docs/developer-guide.md`), per the "keep data and
docs in sync" rule in `CLAUDE.md`.

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

He offers three interactions inside one visit (see "Rest room flow"):

1. **Trophy → buff barter** — trade 5 identical trophies for one of 2 offered combat
   buffs, scoped to the current floor's elite/boss room.
2. **Shop** — buy consumable items from the runner, singly or as a 3-item lot, at
   prices set by rarity tier. Merchant-style: rotating offers, refreshable for coin.
3. **Junk buyback** — sell consumables and trophies to the runner at 1/5 of the shop's
   single price.

## 1. Trophy → buff barter

### Buff scope

The buff is granted immediately on trade and persists, inactive and hidden, until
the party enters that floor's elite/boss room, where it activates for that
combat and is then consumed. It is not shown anywhere before that room: only the elite/boss
room displays it. If the floor ends without the party reaching an
elite/boss room, the buff is lost unused.

This does not fit the current `ActiveStatusEffect` model
(`src/types.ts:472-483`), which only expires by `turnsRemaining` or
`linkedSummonId`. **New plumbing required:** a room-scoped expiry mode on
`ActiveStatusEffect` (e.g. a `scopedToRoomType: "eliteOrBoss"` flag) that is
checked/consumed at combat start instead of decremented per turn, rather than
a duration-based effect.

### Buff formula

A barter buff is a **percentage of the party's own effect**, so it keeps its value at any
depth (unlike the flat item statuses). It is computed from the traded trophy's tier and its
source monster (`data/monsters.json` fields).

**Magnitude comes from the trophy's final tier (rarity), not from `powerTier`.** The tier
already folds in `powerTier`, the `minFloor` bump and the group "+1" (see "Tier formula"), so a rare trophy from a weak monster buys the same magnitude as a rare
trophy from a medium one, and `minFloor` is not counted a second time.

| Trophy tier | Magnitude (P) |
|---|---|
| Common | 5% |
| Uncommon | 8% |
| Rare | 12% |
| Unique | 15% |
| Epic | 18% |
| Legendary | 22% |

P is 5 / 8 / 12% for Common to Rare and 18% for Epic (the elite figure); Unique and
Legendary are interpolated. Costs are 5 trophies
(Common–Unique), 3 (Epic) and 1 (Legendary), so a rarer trophy buys a bigger buff for fewer
items.

**What P is a percentage of.** P is a share of the stat's *effect*, the same convention as
the artifact stat budget (`07-items-artifacts.md`, "Level bands & drop schedule"), so +P% of
one stat is worth about +P% of another:

| Stat | Delta for +P% effect | At level 10 / 25 / 50, P = 8% |
|---|---|---|
| Attack, magic power | `P% × stat` | +2.6 / +4.7 / +7.2 attack (party average) |
| Defense | `P% × (defenseMitigationX + defense)`, i.e. P% of effective HP | +5.2 / +7.0 / +9.0 |
| Max HP | `P% × max HP` | +20 / +35 / +53 |

An attack buff grants P% to attack **and** to magic power, so a caster gains from it as much
as a fighter does.

Defense is deliberately not "P% of the defense stat": at defense 47, +8% of the stat is
+3.8 points, which cuts damage taken by about 4%, while +7 points cuts it by about
7.5%, the 8% of effective HP the tier promises. `defenseMitigationX` is 40
(`data/balance-config.json`).

**Stats in scope for the first version:** attack and magic power (together), defense, speed
and HP regeneration per turn. Crit, Accuracy, Evasion, status-application chance, debuff resist and Max HP are
deferred, since `CombatStat` has only attack / defense / aggro / speed and each of those
needs new plumbing (magic power is added to it, see "Engine/UI work required").

**Primary stat**, from `monsterType`: armored / tanky / sentinel → DEF; bruiser / striker /
glass → ATK; balanced → ATK and DEF at P/2 each.

**Secondary effect**, from `race`, at P/2: beast → speed; slime → HP regen per turn;
golem → DEF; undead → HP regen per turn; elemental, demi-human, human-like → ATK;
shadow-creature → speed.

Group trophies: every monster in a group shares the same `race` / `subRace` by definition,
so the secondary effect is unambiguous, and the primary stat uses the most common
`monsterType` among the group's members (`archetypeIds`). Magnitude needs no template
monster, since it comes from the trophy's tier.

### Barter offers and cost

- The runner shows **2 random offers**, with no refresh, drawn from the trophy kinds
  that can drop on the current floor (a trophy qualifies if at least one monster in its
  `archetypeIds` has `minFloor` ≤ the floor's depth, the same filter floor generation
  uses in `src/data/floor.ts`). The 2 offers are always different trophy kinds. Each
  offer names a trophy
  kind and the buff it buys: offer "trophy A" → buff A1, offer "trophy B" → buff B1,
  where the buff comes from the "Buff formula" applied to that trophy's source monster.
- Cost by trophy tier, all of the same kind (same item id): **Legendary 1, Epic 3,
  every other tier 5.** Legendary trophies are eligible for offers.
- Both offers can be bought in the same visit. A bought buff is granted immediately and
  stays hidden until the floor's elite/boss room (see "Buff scope"). All bought buffs
  apply together, with no cap.
- Once the party has bartered a buff on a floor, the barter option is no longer shown in
  that floor's later Rest rooms.

## 2. Shop — pricing and stock

The runner sells **consumables only** (items with `effects`, not artifacts). The stock
is mostly non-trophy consumables; trophies appear as a rare offer. Presentation and
refresh work like the Merchant (`src/engine/events/merchant.ts`): a rolled offer list,
purchases lock when the party can't afford them, and a coin-priced Refresh re-rolls
the list.

### Price by tier

Price is set by the item's tier (the 6-tier ladder below), not per item.

| Tier | Single | Lot of 3 (same item) | Lot discount |
|---|---|---|---|
| Common | 15 | 40 | 11% |
| Uncommon | 25 | 65 | 13% |
| Rare | 50 | 135 | 10% |
| Unique | 80 | 220 | 8% |
| Epic | 150 | 420 | 7% |
| Legendary | not sold | — | — |

Non-trophy consumables sold here only reach Common–Rare, so Unique and Epic prices apply only
to the rare trophy offers. `exploration-kit` (Unique) is never sold.

### Stock

- **5 offers** per visit. Each offer is independently a single item (30%) or a lot of 3
  (70%).
- Each offer has a **5% chance to be a trophy** instead of a non-trophy consumable. The
  30/70 single/lot split applies to trophy offers too.
- **Refresh** uses the Merchant's values: 10 coin, up to 3 per visit
  (`events.merchantRefreshCostCoins` / `events.merchantMaxRefreshes`).
- The 5 offers are distinct items.
- Tier odds depend on floor depth (see "Tier odds by depth").
- A trophy bought here counts toward barter like a dropped one, so coin can be turned into
  a combat buff.

### Tier odds by depth

The tier of each offer is rolled with the same method as artifact rarity
(`artifactRarityWeights`, `src/data/artifacts.ts`; `07-items-artifacts.md` "Rarity odds by
depth"): floors are grouped in steps of 10, the **anchor step is floors 51–60**, and every
step away multiplies tier `i` (Common = 0, Uncommon = 1, ...) by `tilt ^ (i × steps from
anchor)`, then renormalizes. Odds freeze beyond `maxStepsFromAnchor` steps.

Two tables, because the shop's non-trophy consumables only exist at Common–Rare:

| Offer kind | Tiers rolled | Anchor at floors 51–60 |
|---|---|---|
| Non-trophy consumable | Common / Uncommon / Rare | 25 / 35 / 40 |
| Trophy | Common / Uncommon / Rare / Unique / Epic | 10 / 20 / 30 / 25 / 15 |

With `tilt` 2.0, resulting odds (%):

| Floors | Consumable C / U / R | Trophy C / U / R / Un / E |
|---|---|---|
| 1–10 | 95.7 / 4.2 / 0.1 | 93.9 / 5.9 / 0.3 / 0 / 0 |
| 21–30 | 83.3 / 14.6 / 2.1 | 76.8 / 19.2 / 3.6 / 0.4 / 0 |
| 41–50 | 47.6 / 33.3 / 19.0 | 31.7 / 31.7 / 23.8 / 9.9 / 3.0 |
| 51–60 | 25 / 35 / 40 | 10 / 20 / 30 / 25 / 15 |
| 71–80 | 3.1 / 17.4 / 79.5 | 0.2 / 1.3 / 8.0 / 26.6 / 63.9 |
| 91–100 | 0.2 / 5.2 / 94.6 | 0 / 0 / 0.7 / 9.4 / 89.9 |

Legendary is never rolled (not sold). A trophy offer picks a tier, then a trophy of that
tier that can drop at this depth (a monster in its `archetypeIds` has `minFloor` ≤ depth);
if none exists, the tier is dropped and the roll repeats over the remaining tiers.

Config: a `shop` block in `data/balance-config.json` (`floorsPerStep`, `anchorFirstFloor`
51, `tilt`, `maxStepsFromAnchor`, `anchorWeights.consumable` / `.trophy`), read by a
rarity-odds helper shared with `artifactRarityWeights`, which is currently typed to the 4
artifact rarities.

Price tables, the trophy offer chance, offer count, single/lot split and the buyback
divisor live in `data/balance-config.json` (`events` block, next to
`merchantPriceCoins`), not in code.

## 3. Junk buyback

The runner buys **consumables and trophies** from the party's inventory at **1/5 of the
shop's single price for the item's tier**, rounded to the nearest coin. Artifacts are not
bought. Items the shop never sells are refused: Legendary trophies and `exploration-kit`.
That also stops the 3 kits from `waiting-supplies` from becoming coin.

| Tier | Buyback |
|---|---|
| Common | 3 |
| Uncommon | 5 |
| Rare | 10 |
| Unique | 16 |
| Epic | 30 |
| Legendary | refused |

`exploration-kit` (Unique) is refused as well.

At 1/5 the shop's price, buying and reselling can't be looped for profit.

## Rest room flow

The runner is rolled on entering a Rest room (50%).

- **Runner present:** a notice screen appears first, saying the Merchant's Runner is here
  and showing his appearance text and any dialogue. When it ends, the normal Rest screen
  follows with **[Eat] [Chat] [Trade with the runner] [Skip]**.
- **No runner:** no notice, and the Rest screen offers Eat / Chat / Skip as today.

Choosing Trade opens the runner's screen (barter, shop, buyback). Leaving it ends the
room (`room.cleared = true`), so **trading replaces the room's rest action**: the party
does not also eat or chat.

**Order:** runner notice → the Rest screen choice (Eat / Chat / Trade / Skip) → Camp
Reflection, if one is pending (`pendingCampReflectionTier`). The reflection comes last,
after the choice and any trading are done.

## Trophy item system

### Tier ladder (6 tiers)

`Common < Uncommon < Rare < Unique < Epic < Legendary`

This ladder applies to every item, trophy or not; it does not change the Common / Rare /
Unique / Epic artifact rarity used by the Merchant.

### Trophies have no effect

A trophy is a barter token: it has `effects: []`. It can still be selected and used, which
consumes it and does nothing. What a trophy is worth comes from its tier (drop weight, shop
price, barter cost, buff magnitude) and from its source monster (buff stats), not from an
effect. Using one shows: *"It has no effect at all. Strange."* (`data/strings.json`).

Nine existing items lose their effects. Four are already among the 31 trophies below
(`bat-blood`, `slime-solution`, `venom-thorn`, `dragon-scale`). Five more become trophies:
`grave-dust` (dropped by `skeleton`, `skeleton-archer`, `skeleton-guard`), `rotten-flesh`
(`zombie`, `zombie-knight`), `broken-blade-fragment` (`skeleton-warrior`, `zombie-knight`,
`dark-knight`), `rat-meat` (`dungeon-rat`) and `venom-gland` (`snake`, `lizard`, `spider`).
Their ids are kept, except `rat-meat`, which becomes `rat-tail` (name Rat Tail). Their
descriptions are rewritten
below, since the old ones promised an effect. The five keep the tier they were assigned
rather than the tier formula's, and none is a group item (no 0.6 drop multiplier). For
buff stats, their `monsterType` and `race` are the most common among their monsters; a
tie goes to the first archetype in `archetypeIds`.

### Tier formula

**Individual (per-monster) item**, base tier from `powerTier`, bumped one step
if `minFloor` clears a threshold:

| powerTier | Base | Bump condition |
|---|---|---|
| weak | Common | `minFloor` ≥ 20 → Uncommon |
| medium | Uncommon | `minFloor` ≥ 30 → Rare |
| strong | Rare | `minFloor` ≥ 40 → Unique |
| elite/boss role | Epic | `minFloor` ≥ 70 → Legendary |

**Group (race/subRace) item**: tier = the most common tier among the group's member
monsters (computed via the table above), bumped **one further step**. Group items are
rarer than any single member's own individual item. Ties go to the higher tier, except a
three-way tie (only Warband Trophy), which takes the middle tier.

A monster that has both an individual and a group item can drop either, not both from one
kill; the split follows the weights below.

### Loot-table weight by tier

Every item, trophy or not, carries a `tier` field on `ItemDefinition`. `weight` is no
longer hand-set: it is derived from the tier at load time and the `weight` field is removed
from `data/items.json`.

| Tier | Weight |
|---|---|
| Common | 1 |
| Uncommon | 0.8 |
| Rare | 0.5 |
| Unique | 0.3 |
| Epic | 0.1 |
| Legendary | 0.05 |

- The tier-weight table and a group-item multiplier (0.6) live in `data/balance-config.json`
  (`items` block). A group trophy is marked in data so the multiplier applies to it.
- The depth growth for weights below 1 (`items.itemWeightDepthGrowth`, `effectiveWeight` in
  `src/data/items.ts`) is retired: with every item tiered, it would flatten all tiers to
  weight 1 from about floor 11.

### Drop rates

- **Drop chance per kill: 90%** (`items.itemDropChance`, currently 0.6).
- **Which pool a drop comes from.** A monster with a trophy rolls the trophy bucket 40% of
  the time and the ordinary bucket 60%. The ordinary bucket is the general pool (tier-weighted
  base items) and nothing else: no non-trophy item is locked to a monster any more
  (`exploration-kit` loses its `archetypeIds`). A monster with no trophy (Lesser Vampire, The
  Founder) uses the ordinary bucket only.
- The trophy share is config (`items.trophyDropShare` 0.4), replacing the constant `50` in
  `rollItemDrop` (`src/data/items.ts`).
- Within a bucket, each item's chance is its tier weight over the bucket's total (a group
  trophy is scaled by 0.6 first).

Effect on healing and mana income (chance that a kill drops a health potion, averaged over
all 43 archetypes): about 13.5% per kill before, about 3.8% with these settings, 28% of
today's. A trophy monster spends 40% of its drops on trophies, and the general pool grows from 8
to 45 items. No category weight is applied to the potions.

### Final item list (31 trophies plus 5 converted items, covering 41 of 43 monster archetypes)

Two monsters have **no trophy**: **Lesser Vampire** (minor recurring undead, not
distinctive enough to warrant one) and **The Founder** (final boss).

Archetypes whose roles are exactly `["elite","boss"]` each keep a standalone item and are
not part of any group. `skeleton-guard` also has the `normal` role and stays in the
`old-bone` group.

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

#### Individual items kept alongside a group item (11)

One representative monster per group also keeps its own lower-tier individual item:

| id | name | tier | monster | existing item? |
|---|---|---|---|---|
| `bat-blood` | Bat Blood | Common | Black Bat | yes, effect removed |
| `bear-claw` | Bear Claw | Rare | Cave Bear | new |
| `silk-gland` | Silk Gland | Uncommon | Spider | new |
| `prayer-beads` | Prayer Beads | Uncommon | Cultist Zealot | new |
| `rotten-bandage` | Rotten Bandage | Uncommon | Zombie | new |
| `bone-shield-fragment` | Bone Shield Fragment | Rare | Skeleton Warrior | new |
| `slime-solution` | Slime Solution | Common | Slime | yes, effect removed |
| `knuckle-guard` | Knuckle Guard | Rare | Orc Brute | new |
| `ember` | Ember | Rare | Fire Elemental | new |
| `hollow-plate` | Hollow Plate | Unique | Wraith | new |
| `core-fragment` | Core Fragment | Unique | Lesser Golem | new |

Every other monster inside a group drops **only** the shared group item.

#### Elite/boss standalone items (9)

| id | name | tier | monster | existing item? |
|---|---|---|---|---|
| `venom-thorn` | Venom Thorn | Epic | Giant Spider | yes, effect removed |
| `warped-vambrace` | Warped Vambrace | Epic | Zombie Knight | new |
| `broken-oath-sigil` | Broken Oath Sigil | Epic | Dark Knight | new |
| `warlords-trophy-chain` | Warlord's Trophy Chain | Epic | Orc Chieftain | new |
| `nobles-signet` | Noble's Signet | Epic | Vampire Lord | new |
| `dragon-scale` | Dragon Scale | Legendary | Dragon | yes, effect removed |
| `unraveled-fragment` | Unraveled Fragment | Legendary | Void Amalgamation | new |
| `weathered-keystone` | Weathered Keystone | Legendary | Ancient Golem | new |
| `phylactery-shard` | Phylactery Shard | Legendary | Lich | new |

#### Converted items (5)

Existing items that become trophies (see "Trophies have no effect"). Tier is by assignment.

| id | tier | archetypeIds |
|---|---|---|
| `grave-dust` | Common | `skeleton`, `skeleton-archer`, `skeleton-guard` |
| `rotten-flesh` | Common | `zombie`, `zombie-knight` |
| `broken-blade-fragment` | Uncommon | `skeleton-warrior`, `zombie-knight`, `dark-knight` |
| `rat-tail` (was `rat-meat`) | Uncommon | `dungeon-rat` |
| `venom-gland` | Rare | `snake`, `lizard`, `spider` |

Descriptions for every trophy are in "Item descriptions".

## Non-trophy item tiers

The existing non-trophy items in `data/items.json` are classified on the low end of the
same ladder, **Common through Rare** (Unique and above are reserved for trophies and
artifacts), with one exception, `exploration-kit`. That is the 8 plain consumables plus `exploration-kit`, which loses its monster lock
and joins the general pool.

The weight column is derived from the tier table above:

| id | old weight | new weight | effect | tier |
|---|---|---|---|---|
| `small-health-potion` | 1 | 1 | heal 60 | Common |
| `small-mana-potion` | 1 | 1 | restoreMp 30 | Common |
| `calming-draught` | 1 | 1 | fear -25 | Common |
| `antidote` | 0.5 | 1 | removes Poisoned only | Common |
| `large-health-potion` | 0.5 | 0.8 | heal 120 | Uncommon |
| `large-mana-potion` | 0.5 | 0.8 | restoreMp 55 | Uncommon |
| `whetstone` | 0.5 | 0.8 | empower, 2 turns | Uncommon |
| `temporary-ward` | 0.5 | 0.8 | fortify, 2 turns | Uncommon |
| `exploration-kit` | 0.15 | 0.3 | satiety +30, party-wide (lock removed; not sold) | Unique |

`exploration-kit` is the one non-trophy item above Rare: Unique, weight 0.3 instead of 0.15,
so twice as common in drops. It is not sold in the shop and the runner does not buy it back;
see "Exploration Kit sourcing".

### Exploration Kit sourcing

`exploration-kit` is not sold and not bought back. It comes from two places:

- **Monster drops**, from the general pool, at Unique weight (0.3).
- **The `waiting-supplies` event**, which gives **3 `exploration-kit` in addition to** the
  artifact it already grants (`guaranteedArtifactId: "travelers-ration"`, `data/events.json`).
  The scene is a bundle left for someone to come back for, so rope, chalk and a map case fit it.

Engine: `waiting-supplies` is an `instantReward` event resolved by `openChest`
(`src/engine/events/openChest.ts`), which only grants an artifact today. Add an optional
`guaranteedItems: { itemId, count }[]` field to the event definition (`src/types.ts`, next to
`guaranteedArtifactId`), validate it in the events loader, and have `openChest` add the counts
to `GameState.inventory` and mention them in the result message. The `waiting-supplies` entry
sets `guaranteedItems: [{ "itemId": "exploration-kit", "count": 3 }]`.

## New consumables (36) and potion rescale

Every value below is **flat**: no `maxHpPercent`, no `minPercent`. Flat numbers don't keep
pace with growth, so each tier is sized for the floor band it is meant for, and the tier
odds by depth (see "Tier odds by depth") put the right tier in front of the player:

| Tier | Intended floors | Party avg max HP / MP at that band | Monster avg HP / def at that band |
|---|---|---|---|
| Common | 1–10 | 165–252 / 73–108 | 125–199 / 13–22 |
| Uncommon | 11–25 | 252–439 / 108–178 | 199–465 / 22–49 |
| Rare | 26–50 | 439–657 / 178–266 | 465–831 / 49–82 |

(Party figures are the mean over the 9 classes at level 5/10/25/50, monster figures the
mean over normal archetypes eligible at floor 5/10/25/50, both computed from
`classGrowthBonus` / `spawnMonster`. Floor depth stands in for level.)

### Potions — 3 tiers

Health and mana each get a Rare tier, and every amount rises. `target` is `self`.

| id | tier | heal / MP now → new | Note |
|---|---|---|---|
| `small-health-potion` | Common | 30 → 60 | ~30% of avg max HP at the band |
| `large-health-potion` | Uncommon | 70 → 120 | ~35% |
| `greater-health-potion` | Rare | new, 220 | ~40% |
| `small-mana-potion` | Common | 20 → 30 | ~33% of avg max MP |
| `large-mana-potion` | Uncommon | 45 → 55 | ~35% |
| `greater-mana-potion` | Rare | new, 90 | ~40% |

The existing ids are kept. Changing the amounts of the four existing potions changes every
loot roll that yields them.

### Loot pool

The 36 new consumables have no `archetypeIds`, so they join the general loot pool
(`BASE_ITEM_IDS`, `src/data/items.ts`) and drop from any monster, with weights taken from
their tier, as does `exploration-kit` once its lock is removed. The pool grows from 8 to 45
items (total weight 34.0). See "Drop rates" for the effect on healing and mana income.

### Other consumables — each with its own status

Each buff or debuff item defines **its own status effect** in `data/status-effects.json`:
`id` = the item's id, `name` = the item's name, sitting beside `guard`, `empower`,
`corroded` and the other existing statuses. The item's `applyStatusEffect` points at that
id. Existing statuses are not reused. Whether a status counts as helpful or harmful (which
decides what an Antidote cleanses) is inferred from its shape (`isHelpfulStatusEffect`):
a negative stat delta, a `damage` tick, `stuns` or `accuracyPenaltyPercent` mark it
harmful, so the new statuses need no flag.

| item id | name | tier | target | own status (flat) | turns |
|---|---|---|---|---|---|
| `cracker-string` | Cracker String | Common | singleEnemy | instant physical damage 37 | — |
| `frost-flask` | Frost Flask | Uncommon | singleEnemy | instant ice damage 71 | — |
| `thunder-charge` | Thunder Charge | Rare | singleEnemy | instant lightning damage 94 | — |
| `honing-oil` | Honing Oil | Rare | singleAlly | attack +27 | 3 |
| `marrow-broth` | Marrow Broth | Uncommon | singleAlly | heal 23 per turn | 3 |
| `serpent-oil` | Serpent Oil | Rare | singleAlly | existing `poison-coat` (on-hit `poisoned`) | 3 |
| `tar-flask` | Tar Flask | Common | singleEnemy | speed −6 | 2 |
| `smoke-pellet` | Smoke Pellet | Common | singleEnemy | `accuracyPenaltyPercent` 40 | 1 |
| `bandage-roll` | Bandage Roll | Common | singleAlly | heal 12 per turn | 3 |
| `resin-wrap` | Resin Wrap | Common | singleAlly | defense +8 | 2 |
| `repelling-smoke-powder` | Repelling Smoke Powder | Common | singleAlly | aggro −20 | 1 |
| `acid-vial` | Acid Vial | Uncommon | singleEnemy | defense −12 | 3 |
| `pitch-bomb` | Pitch Bomb | Uncommon | singleEnemy | instant fire damage 71 | — |
| `war-paint` | War Paint | Uncommon | allAllies | attack +8 | 2 |
| `blister-bomb` | Blister Bomb | Rare | allEnemies | instant fire damage 68 to each enemy | — |
| `rot-bomb` | Rot Bomb | Rare | allEnemies | instant poison damage 68 to each enemy | — |
| `fracture-charge` | Fracture Charge | Rare | singleEnemy | defense −25 | 3 |
| `deafening-charge` | Deafening Charge | Rare | singleEnemy | `stuns` | 1 |
| `rally-standard` | Rally Standard | Rare | allAllies | attack +16 | 3 |
| `bulwark-draught` | Bulwark Draught | Rare | allAllies | defense +22 | 2 |
| `field-tonic` | Field Tonic | Rare | allAllies | direct `heal` 90, no status | — |
| `spark-salt` | Spark Salt | Common | singleAlly | magic power +5 | 2 |
| `scholars-candle` | Scholar's Candle | Uncommon | singleAlly | magic power +13 | 2 |
| `hushed-bell` | Hushed Bell | Uncommon | allAllies | magic power +10 | 2 |
| `etched-lens` | Etched Lens | Rare | singleAlly | magic power +23 | 3 |
| `pitch-pipe` | Pitch Pipe | Rare | allAllies | magic power +17 | 3 |

The five magic power items serve the casters: a caster's damage and healing scale with magic
power (`offensiveStatFor` and the `heal` case in `src/engine/resolver.ts`), so attack buffs do
nothing for Mage, Acolyte, Plague Doctor or Summoner. Their values use the same ladder as the
attack buffs, applied to the party's average magic power (15.6 / 38.7 / 63.1 at level 5 / 18 /
38). The defense and speed debuff bombs already help casters, since enemy defense mitigates
magic damage too.

### Cures

`antidote` removes **Poisoned only** (`removeStatusEffect` with
`statusEffectId: "poisoned"`) and is Common. Every other cure targets one damage-over-time or one specific status, covering
exactly what monsters apply to the party (from `data/monster-skills.json`): Poisoned,
Burning, Bleeding, Acid Burn, Stunned, Blinded, Webbed, Weakened and Corroded. None of these
has a number to size, since a cure only names the status it removes.

| item id | name | tier | target | removes |
|---|---|---|---|---|
| `antidote` | Antidote | Common | singleAlly | `poisoned` |
| `burn-salve` | Burn Salve | Common | singleAlly | `burning` |
| `styptic-powder` | Styptic Powder | Common | singleAlly | `bleeding` (all stacks) |
| `eyewash` | Eyewash | Common | singleAlly | `blinded` |
| `thread-knife` | Thread Knife | Common | singleAlly | `webbed` |
| `lye-wash` | Lye Wash | Uncommon | singleAlly | `acid-burn` |
| `smelling-salts` | Smelling Salts | Uncommon | singleAlly | `stunned` |
| `mending-paste` | Mending Paste | Uncommon | singleAlly | `weakened` and `corroded` |
| `purge-draught` | Purge Draught | Rare | allAllies | one harmful status from each ally (no `statusEffectId`) |

A cure used on an ally who does not carry the status does nothing and is still consumed.
Acolyte's Purify still removes any one debuff, so the class keeps its general cleanse.

### Damage bombs

Six bombs deal **instant, flat damage on use**, not damage over time: `cracker-string`,
`pitch-bomb`, `frost-flask`, `thunder-charge` (single enemy) and `blister-bomb`, `rot-bomb`
(every enemy). They hit once and leave no status, so no status entries exist for them.

- **Flat damage.** An item's effects resolve like a skill's, and a `damage` effect adds the
  user's offense unless `offenseMultiplierPercent` is 0. These bombs set it to 0, so every class
  deals the same damage, and the amount is `amount` minus `defense / defenseMitigationY`
  (about 1–8 points). The amounts below already add that back at the reference defense.
- **Sizing.** Damage is a multiple of one basic physical hit against the average monster at
  the middle of the tier band (24 / 39 / 43 at floors 5 / 18 / 38): single target ×1.5
  (Common), ×1.7 (Uncommon), ×2.0 (Rare); the two Rare area bombs ×1.6 per enemy. A bomb
  costs a turn, so it has to beat an attack to be worth carrying.
- **Damage types matter.** Race profiles apply (`data/monster-races.json`): undead take +20%
  fire and resist poison, vermin resist poison 40%, the draconic race resists fire and ice
  40%, and a monster with 100% resistance takes none. The fire / poison / ice / lightning /
  physical mix lets a party answer a monster's race. The user's fear penalty
  (`damageMultiplierFor`) still reduces a bomb's damage.
- Because the damage is flat it falls behind monster HP at depth (about 29% / 21% / 13% of
  an average monster's HP at the Common / Uncommon / Rare band).

Non-trophy pool by tier: Common 15, Uncommon 14, Rare 15, Unique 1 (`exploration-kit`, drops
only; the shop sells the other 44). All numbers live in `data/items.json` and
`data/status-effects.json`, not in code.

## Existing consumables — own statuses

The 2 existing consumables whose status **directly raises or lowers a stat** get their own
status in `data/status-effects.json` (`id` = item id, `name` = item name, flat values only):
`whetstone` and `temporary-ward`. The new `honing-oil` and `marrow-broth` are built the same
way. `serpent-oil` is indirect (an on-hit poison rider) and keeps the existing `poison-coat`
and `poisoned`. Trophies have no effect, so they have no status. The existing statuses stay
in the file, since class skills and monsters use them.

Sizing rule (config-driven), shared with the status-based new consumables:

- Strength as a share of the reference stat, by tier: Common 30%, Uncommon 33%, Rare 36%.
- Party-wide (`allAllies`) buffs are scaled by 0.75.
- The reference stat is the party average (buffs; magic power for the magic power items) or the normal-monster average (debuffs)
  at a **reference level**: for an item locked to monsters (`archetypeIds`), the floor where
  it first drops plus 5; for an unlocked item, the middle of its tier band (Common 1–10,
  Uncommon 11–25, Rare 26–50).
- Aggro (`repelling-smoke-powder`) is already flat and keeps −20.

| item id | tier | target | own status (flat) | turns |
|---|---|---|---|---|
| `whetstone` | Uncommon | singleAlly | attack +15 | 2 |
| `temporary-ward` | Uncommon | singleAlly | defense +12 | 2 |

## Item descriptions

All English, in the voice of `data/monsters.json`: concrete, physical, no explanation, at
most one odd detail per item, and no promise of an effect (trophies have none).

### New consumables (36)

| id | description |
|---|---|
| `cracker-string` | A string of paper-wrapped charges, each the size of a thumb. Pull the end and they go off in order. |
| `frost-flask` | A flask of brine frozen solid, white with frost on the outside. It does not thaw in the hand. |
| `thunder-charge` | A copper tube sealed at both ends with wax, heavy for its size. It hums when nothing is touching it. |
| `honing-oil` | A flask of thin oil that smells of hot iron. The smell stays on the cloth for days. |
| `marrow-broth` | A flask of marrow boiled down until it sets cold. Warmed in the hands, it pours. |
| `serpent-oil` | Thick yellow-green oil drawn from something that bit. A blade wiped with it stays wet for the length of a fight. |
| `burn-salve` | A tin of grease and crushed aloe gone grey. It stings going on, and then it does not. |
| `styptic-powder` | Alum ground fine and kept dry in waxed paper. Packed into a cut, it closes the edges. |
| `eyewash` | A small bottle of boiled fennel and salt water, with a dropper made from a quill. |
| `thread-knife` | A curved blade no longer than a finger, made for cutting thread. Webbing parts along its edge like wet paper. |
| `lye-wash` | Thinned lye in a stoppered flask, for washing off what eats metal. It is rough on the hands. |
| `smelling-salts` | Pale crystals in a brass case. One sniff and the eyes water, and whoever was down gets up. |
| `mending-paste` | Tallow and clay worked into a grey paste. Smeared on armour, it fills the pits and stays. |
| `purge-draught` | A cloudy draught that tastes of ash and river water. Whoever drinks it is sick within the minute, and better after. |
| `tar-flask` | Black tar in a clay flask, thick enough to hold a thumbprint. |
| `smoke-pellet` | A pinch of powder that goes to grey smoke when crushed. |
| `bandage-roll` | Boiled linen, rolled tight and still stiff. It has been boiled more than once. |
| `resin-wrap` | Pine resin over cloth, wound tight around the forearm. |
| `repelling-smoke-powder` | A pinch of grey powder in a twist of paper. Burned at someone's feet, it gives off a sour smoke that nothing hunting wants to walk into. |
| `acid-vial` | Green-stained glass, stoppered with wax, the inside of the glass etched cloudy. |
| `pitch-bomb` | Pitch and lamp oil in a fired jar, fuse of twisted rag. |
| `war-paint` | Ochre and ash, kept in a tin lid and thumbed across the cheek before a fight. |
| `blister-bomb` | Quicklime and sulphur packed into a clay shell that is thin on purpose. |
| `rot-bomb` | Matter scraped from the bottom of a grave pit and sealed in clay before it had finished rotting. |
| `fracture-charge` | A shaped charge in a brass cup, made to be set against a plate. |
| `deafening-charge` | A charge packed for noise and not fire, wrapped in wet leather so it does not go off in the pack. |
| `rally-standard` | A torn banner on a broken haft, the colours faded to the same brown as everything else. |
| `bulwark-draught` | Iron filings in wine. The skin goes grey and holds. |
| `field-tonic` | A stoneware bottle meant to be split four ways, with four notches cut in the neck to show where. |
| `spark-salt` | Coarse grey salt that crackles faintly when held near a mage's hand. |
| `scholars-candle` | A candle stub scored with fine lines at even intervals. Lit, it gives a steady light that does not move in a draught. |
| `hushed-bell` | A small brass bell with the clapper bound in felt. Shaken, it makes no sound, and the room goes quiet around it. |
| `etched-lens` | A disc of ground glass with a ring etched into one face. Held up, it makes edges look sharper than they are. |
| `pitch-pipe` | A short reed pipe that gives one note and no other. Blown once in a room, everyone in it begins to hum the same pitch. |
| `greater-health-potion` | A dark red draught so thick it moves slowly when the bottle is tilted. It smells of iron before it smells of herbs. |
| `greater-mana-potion` | A blue so deep it is nearly black in the flask. The glass is cold to hold. |

### New trophies (27)

| id | description |
|---|---|
| `vermin-hide` | Strips of hide peeled from the small things that live under the floors. Some of it is fur, some of it is skin, and it has all dried to the same grey. |
| `predator-sinew` | A length of sinew as long as a forearm, still pulled tight by whatever it was cut from. It will not lie flat on any surface. |
| `chitin-shard` | A curved shard of scale or plate; it is hard to say which. One edge is a seam that came apart clean, the other was broken off. |
| `cult-rag` | A strip of coarse robe cloth, dyed a dark red-brown that may not be the original colour. The hem has been cut off all the way round. |
| `grave-cloth` | Burial linen, brown at the folds and stiff where it was wet. It has been wrapped round something and unwrapped since, and the creases have not given. |
| `old-bone` | A short bone polished on two faces where it slid against the next one. The third face is still rough. |
| `ooze-residue` | Dried ooze, cracked into flakes like river mud. Something small is still set into one of them, too small to name. |
| `warband-trophy` | A cord hung with teeth, a brass ring and a few small bones, knotted by someone who wanted them counted. It hangs heavier at one end. |
| `elemental-core` | A fist-sized stone that is a different temperature every time it is picked up. Wherever it is set down it leaves a ring, damp or scorched, never the same twice. |
| `wraith-essence` | A vial that looks empty. The inside of the stopper is cold, and stays cold. |
| `stone-core` | A rough grey lump with one flat face, cut level by something that does not draw a straight line by eye. Tapped, it answers a little late. |
| `bear-claw` | A claw as long as a hand, blunted at the tip from years of being dragged along stone. Three grooves run down the flat side, deep as a thumbnail. |
| `silk-gland` | A dried sac no bigger than a thumbnail, one end still trailing a fine thread. Pulled gently, it comes out a hand's length and stops. |
| `prayer-beads` | A short string of dark beads, worn shiny along about a dozen and left rough elsewhere. Someone always held it in the same place. |
| `rotten-bandage` | A bandage still wound in its last shape, stiff with something brown. The knot is neat. |
| `bone-shield-fragment` | A curved slice of bone from a rim. Two small holes run through the inside, worn oval by the strap that used to pass through them. |
| `knuckle-guard` | A bar of iron bent to fit a fist, the finger hollows worn deeper on one side. The hand it was made for was larger than yours. |
| `ember` | A lump of charcoal that kept the grain of the wood it came from, and the knot where a branch left it. |
| `hollow-plate` | A shoulder plate, rusted through on the inside and bright on the outside. |
| `core-fragment` | A chip of dressed stone with one groove across it, ruled as straight as any mason could. The groove goes on past the edge, where the rest of the stone was. |
| `warped-vambrace` | A forearm guard bent inward along one side, as though what wore it swelled. The buckles are fastened and the leather is whole. It was never taken off. |
| `broken-oath-sigil` | A badge cut in half through a device that can no longer be read. The cut is clean, and its edges are worn as smooth as the face. |
| `warlords-trophy-chain` | A length of chain hung with pieces of other people's armour: a buckle, a hinge, a spur, part of a rank badge. Each link was forged for weight. |
| `nobles-signet` | A gold signet ring, the crest worn nearly flat from years of pressing into wax. It is always clean when the pouch is opened. |
| `unraveled-fragment` | A thumb of grey matter with a hinge at one end and a row of small teeth at the other. Set on a table, the hinge closes slowly on nothing. |
| `weathered-keystone` | A wedge of stone that once locked an arch in place. The curve of the arch is still cut into both faces, though nothing has curved above it for a long time. |
| `phylactery-shard` | A curved sliver of black glass, thin as a fingernail. Held to the light, it shows the room with the door still shut. |

### Existing items, rewritten (9)

The old descriptions promised an effect. Ids are kept.

| id | old description | new description |
|---|---|---|
| `bat-blood` | Still-warm bat blood, gulped down mid-battle to stay standing. | A stoppered vial of dark, thin blood that took several bats to fill. It smells of copper. |
| `slime-solution` | The translucent ooze of a slime monster, strangely able to unclog the flow of magic. | A jar of translucent ooze that has settled clear at the top. Whatever the slime had not finished dissolving is still in the jar. |
| `venom-thorn` | A thorn as thick as a finger — piercing a target makes the venom already in their body take hold many times faster. | A thorn as thick as a finger, the tip stained yellow-green. The stain is wet. |
| `dragon-scale` | A heavy dragon scale, its metallic sheen still warm from fire — enough to forge a shield for the whole party. | A scale as wide as a shield, still warm, with a metallic sheen. The edges are rounded from a lifetime of sliding against the others. |
| `grave-dust` | Finely ground bone dust from an old grave — rubbed on skin, it sets the flesh like old bone. | Bone ground to a fine grey dust and folded into a scrap of cloth. It clings to the fingers and takes more than one washing to leave. |
| `broken-blade-fragment` | A broken weapon fragment, still sharp, stripped down to be reforged into a new blade. | A length of broken blade, snapped clean across with the edge still keen. The maker's mark is on the part that is missing. |
| `rat-tail` (was `rat-meat`; name **Rat Tail**) | Dungeon rat meat, tough but strangely nutritious — the body visibly recovers after eating it. | A rat's tail dried hard as cord, still curled the way it dried. |
| `venom-gland` | A still-fresh venom gland, used to coat a weapon before a long encounter. | A venom gland the size of a bean, taut as a grape and yellow at the stalk. |
| `rotten-flesh` | A piece of rotting flesh reeking with a foul stench — other monsters would rather steer clear. | A palm-sized piece of flesh gone soft and dark, wrapped in a leaf that has stopped helping. |

## Engine/UI work required

- **Rest room**: `Game.restAction` (`src/engine/game.ts:274`) offers exactly 3 fixed
  choices (Eat/Chat/Skip) with no chance-roll or sub-event state. Needed: a `Rng.chance(0.5)`
  roll on rest-room entry (`src/engine/dungeon.ts:57-69`), a runner notice screen shown
  before the Rest screen, a fourth "Trade" choice, and a new `activeEvent`-style sub-screen
  (mirroring `src/ui/screens/events.ts`, `state.activeEvent`) to host the shop, barter and
  buyback UI. Leaving it clears the room.
- **Magic power as a combat stat**: add `"magicPower"` to `CombatStat` (`src/types.ts:19`) and
  `COMBAT_STAT_LABEL` (`src/data/statusEffects.ts`). `applyCombatStatDelta` and
  `getCombatStatValue` already index the actor by stat name, so characters and summons work;
  monsters have no `magicPower`, so a magic power effect must never target one. Whether
  `recomputeAllPartyStats` (`src/engine/party.ts`) preserves an applied magic power delta the
  way it does attack is to be checked when building it.
- **Status effects**: extend `ActiveStatusEffect` (`src/types.ts:472-483`) with a
  room-scoped expiry mode (see "Buff scope") instead of the turn-count / linked-summon
  model, and add the new statuses' data. Barter buffs beyond attack, defense, speed and
  regen are out of scope for the first version.
- **Items**: add a `tier` field to `ItemDefinition` for every item, remove `weight` from
  `data/items.json`, derive weight from the tier and retire `effectiveWeight`'s depth
  growth, make the trophy share config in `rollItemDrop`, and drop `exploration-kit`'s
  `archetypeIds` (`src/data/items.ts`). Trophies use `effects: []`, so `itemEffectSummary` needs a
  "no effect" text (*"It has no effect at all. Strange."*), and using one consumes it. Group
  trophies need a marker for the 0.6 drop multiplier.
- **Item text and targets**: `TARGET_NOTE` in `src/data/items.ts` covers only self /
  singleAlly / allAllies / singleEnemy, so `allEnemies` (`blister-bomb`, `rot-bomb`) needs a
  note and the item-use UI has to be checked for picking it. `itemEffectSummary` has no
  `damage` case (needs the amount and type, plus strings in `data/strings.json`) and prints a
  generic "remove status" line for a cure, which must name the status. A cure that names a
  status uses `removeStatusEffect` with `statusEffectId`, which the resolver already
  supports; `mending-paste` carries two such effects.
- **Shop**: a tier-odds helper shared with `artifactRarityWeights`, which is typed to the 4
  artifact rarities, and a `shop` block in `data/balance-config.json` (see "Tier odds by
  depth").
- **Merchant event UI/data patterns** (`data/events.json`'s `merchant` entry,
  `data/strings.json:258-267`, `src/ui/screens/events.ts`, the `eventMerchant` cases of `handleKey`, `renderMain` and `renderFooter`) are reusable for the
  shop-list rendering and flavor text. "Buy items from the player" and "bulk trade for a
  buff" are new interaction types with no code to copy.
- **Save compatibility**: `src/engine/save.ts` accepts only saves whose version equals the app
  version (`ALLOWED_LEGACY_SAVE_VERSIONS` is empty), so a release carrying this feature
  rejects older saves and the `rat-meat` → `rat-tail` rename needs no remap. If an older
  version is ever allowed, `migrateGameState` (`src/engine/migration.ts`, the loop that drops
  inventory counts for unknown item ids) must first remap `rat-meat` to `rat-tail`, or the
  count is silently deleted.
- **Events**: the `guaranteedItems` field and the `waiting-supplies` change described under
  "Exploration Kit sourcing".
- **Docs to update when built**: `09-currency.md` (it says exactly 3 events accept coins),
  `07-items-artifacts.md` (items, tiers, weights), `08-events.md` (§8.20 and the event data
  structure), `docs/developer-guide.md`.
