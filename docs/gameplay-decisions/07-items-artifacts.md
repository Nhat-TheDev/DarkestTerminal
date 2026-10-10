# §7. Items & Artifacts

*(section 7 of `00-index.md`)*

Items (§7.1) and Artifacts (§7.2) are 2 separate reward systems, see `src/engine/artifacts.ts`, `src/data/items.ts`, `src/data/artifacts.ts`.

**Source of truth for every number below**: catalogs live in `data/items.json`/`data/artifacts.json`; drop rates live in `data/balance-config.json` field `items`/`events`, or as named constants in `src/data/items.ts`/`src/data/artifacts.ts` when not JSON-configurable (called out per section below). This document describes the mechanics and data *shape* — not the current catalog contents or rates.

**Naming convention**: every `id`/`name` for Items, Artifacts, and the status effects serving these 2 systems is in **English** — matching the naming convention of monsters/classes in `data/monsters.json`/`data/classes.json`.

The 2 concepts are kept clearly separate, not sharing 1 system:

| | Item | Artifact |
|---|---|---|
| Nature | Consumable — used once, then gone | Permanent relic for 1 run — once equipped, kept until permadeath |
| Effect | Instant, active (player chooses when to use it) | Passive, continuous for the whole run (no "use" needed) |
| Used in combat? | Yes, unless `combatUsable: false` — replaces choosing a skill during the command phase | No — adds straight to stats/behavior, doesn't consume a turn |
| Lost when | Used up (decrements 1 from inventory) | Party wipe (permadeath, `05-character-stats.md` section 5) |
| Rarity | No rarity tiers — only differs by effect type | Multiple tiers: Common / Rare / Unique / Epic (`ArtifactRarity`, `src/types.ts`) |

---

## 7.1 Items (consumables)

### Data structure

The `ItemDefinition` shape lives in `src/types.ts`, simplified for the current scope (consumables only — no `equipment`/`keyItem`, see `01-class-skill.md` section 1.5 "Design notes" last bullet, where `usesPerCombat` is reserved for items):

```
ItemDefinition {
  id: Id
  name: string
  description: string
  target: SkillTarget
  effects: SkillEffect[]     // reuses the exact same existing resolver — no new effect kind needed for items
  tier: ItemTier             // common | uncommon | rare | unique | epic | legendary — sets the drop weight, see "Drop source" below
  archetypeIds?: Id[]        // a trophy: drops only from these monsters, see "Trophies" below
  groupItem?: boolean        // a trophy shared by several monsters of one race: its drop weight is scaled down
  combatUsable?: boolean     // default true; false hides it from the in-combat "use item" list (e.g. Exploration Kit, §3)
}
```

Used in combat: during the command phase, a character chooses "use item" instead of a skill (only items with `combatUsable !== false`, checked by `checkItemUsable` in `src/engine/combat.ts`) — 1 count is subtracted from `GameState.inventory[itemId]`, and `effects` are applied through the exact same existing `resolveSkillEffect` (0 changes to `resolver.ts`). An item can also deal flat damage (a `damage` effect with `offenseMultiplierPercent: 0` ignores the user's attack) and target `allEnemies`; both are combat-only. `useItemOutOfCombat` rejects `singleEnemy` and `allEnemies` items, and any item with an `applyStatusEffect` effect: its status counts down in combat turns and lasts until the next victory, so used beforehand it would be a free pre-buff. `magicPower` is a combat stat like `attack`, so an item's status can buff it for casters; monsters have no `magicPower`, so such an effect only ever lands on characters and summons. Items that do not apply a status can also be used outside combat via `Game.useItemOutOfCombat` (e.g. restoring satiety while walking the dungeon loop — Exploration Kit is `combatUsable: false` but still usable this way, no need to wait for combat).

### Drop source

Drops randomly when killing **any monster** (regular/Elite/Boss), gated by `data/balance-config.json` field `items.itemDropChance` (0.9, `ITEM_DROP_CHANCE`, `src/data/items.ts`). Doesn't drop from Treasure/Event rooms (those 2 rooms are reserved for Artifacts — section 7.2, also see `08-events.md`).

When the drop roll succeeds, `rollItemDrop` (`src/data/items.ts`) first picks a bucket, then an item inside it:

- **Trophy bucket** — chosen with probability `items.trophyDropShare` (0.4), only for a monster that has trophies (`archetypeIds` containing its archetype). A monster with no trophy (Lesser Vampire, The Founder) skips this step.
- **General pool** — every other drop: the items with no `archetypeIds`.
- **Weight inside a bucket** = `items.tierWeights[tier]` (one weight per tier, falling from common to legendary), times `items.groupDropMultiplier` (0.6) for a `groupItem`. Weight no longer scales with floor depth. Read `data/balance-config.json` for the current numbers rather than trusting a hand-copied percentage here.

With every consumable in the general pool, a given potion drops far less often than when the pool held a handful of items, and a monster with a trophy spends 40% of its drops on trophies. That thins out healing and mana income on purpose, so coins and the Runner matter.

Added directly to `GameState.inventory[itemId] += 1` as before, with no change to the in/out-of-combat item-use mechanics. A room with multiple monsters rolls the drop independently per monster (no cap on stacking).

### Catalog — general pool

Full list (id, name, effect, tier): `data/items.json`, filtered to entries without an `archetypeIds` restriction — 45 items: 15 Common, 14 Uncommon, 15 Rare and 1 Unique (`exploration-kit`, `combatUsable: false`). Satiety recovery is **not** a consumable-item concern — it only comes from the Rest room's Eat & Drink and from Camp (§3), plus the rare Exploration Kit drop described there.

By kind:

- **Healing and mana potions** in 3 tiers each (the amounts are in `data/items.json`), plus `field-tonic` (heals the whole party) and `calming-draught` (fear).
- **Buffs** — `whetstone`, `honing-oil`, `war-paint`, `rally-standard` (attack), `temporary-ward`, `resin-wrap`, `bulwark-draught` (defense), `spark-salt`, `scholars-candle`, `hushed-bell`, `etched-lens`, `pitch-pipe` (magic power, for casters), `repelling-smoke-powder` (aggro down), `bandage-roll`, `marrow-broth` (heal each turn), `serpent-oil` (an on-hit poison rider, reusing `poison-coat`).
- **Damage bombs** — flat damage on use, from the item alone (`offenseMultiplierPercent: 0`), so every class deals the same: `cracker-string`, `pitch-bomb`, `frost-flask`, `thunder-charge` (one enemy) and `blister-bomb`, `rot-bomb` (every enemy). Race resistances still apply.
- **Debuff bombs** — `tar-flask` (speed), `smoke-pellet` (accuracy), `acid-vial`, `fracture-charge` (defense), `deafening-charge` (stun).
- **Cures** — each removes one status: `antidote` (Poisoned), `burn-salve`, `styptic-powder`, `eyewash`, `thread-knife`, `lye-wash`, `smelling-salts`, `mending-paste`, and `purge-draught` (one harmful status from each ally). Together they cover exactly the statuses monsters apply to the party (Poisoned, Burning, Bleeding, Acid Burn, Stunned, Blinded, Webbed, Weakened, Corroded). A cure used on an ally who does not carry the status does nothing and is still consumed. Acolyte's Purify is the general cleanse of any one debuff.

Each buff or debuff item has its own status in `data/status-effects.json` (id = item id, flat values), so check that file for the numbers. Check `data/items.json` for the exact effects.

<!-- docs:intent-begin -->
**How the shipped values were set.** This is a record of the method, not a rule the engine checks; all values live in the JSON. Every amount is flat, never a share of max HP, so each tier is sized for the floor band the tier odds put it in (`03-survival-stats.md`, "Shop tier odds"): Common for floors 1–10, Uncommon 11–25, Rare 26–50.

- **Potions** restore roughly 30% (Common), 35% (Uncommon) and 40% (Rare) of the average party max HP or MP at their band.
- **Buffs and debuffs from a status** are a share of a reference stat, 30% (Common), 33% (Uncommon) or 36% (Rare), scaled by 0.75 when the target is `allAllies`. The reference stat is the party average (buffs; magic power for the magic power items) or the normal-monster average (debuffs), taken at the middle of the tier's band. Aggro is already flat and is not scaled.
- **Damage bombs** deal a multiple of one basic physical hit against the average monster at the middle of the band: ×1.5 (Common), ×1.7 (Uncommon), ×2.0 (Rare) for one enemy, ×1.6 per enemy for the two area bombs. Using an item costs a turn, so a bomb has to beat an attack to be worth carrying. Their flat amounts already add back the small defense term (`defense / defenseMitigationY`) at the reference defense.
- **Cures** name the status they remove and have no number to size.
<!-- docs:intent-end -->

### Trophies

A trophy is a monster remnant with `effects: []`: it can be used, which only consumes it and shows "It has no effect at all. Strange." (in a combat log or as the room message), and its purpose is to be traded to the Merchant's Runner: sold for coins or bartered for a combat buff (`03-survival-stats.md`). The inventory and reward screens list its effect as "No effect." Each has an `archetypeIds` list of the monsters that drop it, and a `tier` that follows the monster's `powerTier` and `minFloor`. Full list: `data/items.json`, filtered to entries with a non-empty `archetypeIds`.

- **Individual trophy** — one monster's own item. Tier from `powerTier` (weak = common, medium = uncommon, strong = rare, elite/boss = epic), raised one step when `minFloor` clears 20 / 30 / 40 / 70 for weak / medium / strong / elite-boss. <!-- docs:intent -->
- **Group trophy** (`groupItem: true`) — shared by the monsters of one race group. Tier is the most common tier among its members plus one step (ties go to the higher tier; a three-way tie takes the middle). A monster may carry both an individual and a group trophy, and then each drop is one or the other.
- A handful of older items (Grave Dust, Rotten Flesh, Broken Blade Fragment, Rat Tail, Venom Gland) are trophies with a tier set by hand.

How the catalog is laid out: in each race group, one representative monster also keeps its own lower-tier individual trophy, and every other member drops only the group trophy. An archetype whose roles are exactly elite and boss has its own trophy and belongs to no group. A trophy's description must never promise an effect, since it has none. Two monsters have no trophy: Lesser Vampire and The Founder, the scripted final boss.

---

## 7.2 Artifacts (permanent relics for the run)

### Equipment — permanent, one-shot decision on pickup

An Artifact is **equipment**, attached to 1 specific character (not the whole party). Unlike a normal equipment system, there is **no free reassignment**: the moment an Artifact is granted, the player makes a single, immediate, permanent decision.

```
Character.equippedArtifactIds: Id[]   // capped per data/balance-config.json field party.maxEquippedArtifacts
GameState.pendingArtifactDecision?: { artifactId: Id; forceEquip: boolean } | null
```

There is **no shared "unequipped pool"** — an Artifact either ends up equipped on a character, or it never existed (a discarded one leaves no trace). `pendingArtifactDecision` is the only transient state: "an Artifact was just rolled/revealed and is awaiting the player's answer," cleared the moment they answer. It's singular, never a queue — even when a source grants more than 1 Artifact at once (Gambling Den's round-4 jackpot, §8.10, 2 Epics), decisions resolve **sequentially**: the 2nd artifact isn't even rolled/revealed until the 1st is fully resolved.

**The decision flow**, every time an Artifact is granted:

1. **Reveal** — name, rarity, full effect list, description.
2. **Decision**:
   - **Ordinary artifact**: **Equip** (choose any character — including one already at 3/3, which becomes a voluntary *replacement*: pick 1 of that character's own currently-equipped *ordinary*, non-Cursed artifacts to permanently discard, freeing the slot) or **Discard** (gone for good, never offered for a Cursed artifact).
   - **Cursed artifact** (`isCursed: true`) or an event marked `forceEquip: true` (Twin Altars, §8.8): **no Discard option** — the player must designate a character, including one at 3/3 (same forced-replacement rule as above, still restricted to discarding an *ordinary* artifact on that character).
3. Equipping consumes 1 of that character's `party.maxEquippedArtifacts` (3) personal slots, **permanently** — see "Ways an Artifact can leave a character" below for the only 3 exceptions.

- **Capped Artifacts per character** (`party.maxEquippedArtifacts`, `data/balance-config.json`) — multiplied by the party size, `party.size` (4), gives the total equip-slot budget for a run.
- **Effects only apply to the exact character wearing it** (except `expBoost`, an exception because EXP is shared — see the "Who it applies to" note below).

Implementation: `grantArtifact`/`resolveArtifactEquip`/`discardPendingArtifact`/`removeArtifactFromCharacter` (`src/engine/party.ts`); UI flow in `src/ui/screens/artifactDecision.ts`, given top priority by `App.syncUiToGameState()` and `finishVictorySequence` (`src/ui/screens/context.ts`) — a pending decision is always resolved before the player can act on anything else, including a fresh floor's entry-room ambush.

### Ways an equipped Artifact can still leave a character

1. **Wandering Hermit — Exchange fortune** (50 coins, any artifact including Cursed, §8.11) — the room's only service; this is also the *only* way to shed a Cursed artifact.
2. **Sacrificial Circle** — sacrifice-for-reroll (§8.9).
3. **Replacement on a full character** (the decision flow above) — voluntary for an ordinary artifact, mandatory for a Cursed/`forceEquip` one; either way, only ever costs an *ordinary* artifact.

Nothing else ever unequips or reassigns an artifact — there's no free swap screen for artifacts anymore. Pressing `a` in-game opens a **view-only** artifact list (name, rarity, wearer, full effect text) rather than a management screen.

### Effect data structure

Effects are **passive, additive**, and don't go through the combat resolver like a skill/item — grouped into 4 categories:

```
ArtifactRarity = "common" | "rare" | "unique" | "epic"

ArtifactEffect =
  // Group 1 — flat stat bonus for the equipping character
  | { kind: "statBoost"; stat: "attack" | "defense" | "maxHp" | "maxMp" | "magicPower" | "speed"; amount: number }

  // Group 2 — distinct combat effects, all counted only for the equipping character
  | { kind: "reflectDamage"; percent: number }    // % of damage a monster deals to the EXACT equipping character is reflected back at the attacker
  | { kind: "poisonOnHit"; chance: number; statusEffectId: Id; durationTurns: number } // every damage hit dealt by the EXACT equipping character has this % chance to auto-apply `statusEffectId` (`poisoned` on every artifact that carries it) to the target for `durationTurns`, no Rogue Poison Coat needed
  | { kind: "lifesteal"; percent: number }        // every damage hit dealt by the EXACT equipping character heals them for that % of the damage dealt
  | { kind: "dodgeChance"; chance: number }       // every monster attack targeting the EXACT equipping character has this % chance to be dodged entirely (damage = 0), rolled separately, unrelated to fear-accuracy (`04-fear-combat.md` section 4)
  | { kind: "alwaysHit"; chance: number }         // each of the EXACT equipping character's enemy-targeting hit rolls and per-effect debuff-chance rolls has this % chance to succeed outright before it is rolled (`11-abilities.md` §11.1.1)
  | { kind: "debuffResist"; percent: number }     // scales down, by this %, the land chance of every harmful status an enemy skill applies to the EXACT equipping character (60% with 30 becomes 42%; a status with no `chance` counts as 100%) (`11-abilities.md` §11.1.2)
  | { kind: "healOnKill"; amount: number; minPercent?: number }        // whenever the EXACT equipping character lands the killing blow on a monster, heals themself for `amount` HP directly (`minPercent`: at least that % of their base max HP — Abilities only, `11-abilities.md`)

  // Group 3 — automatic damage, tied to the equipping character but doesn't consume their turn
  | { kind: "autoDamage"; amount: number; offenseMultiplierPercent?: number; isMagic?: boolean }        // at the start of every round, as long as the equipping character is alive, automatically deals `amount` damage to 1 random living monster — no `queueAction`, no turn/MP cost, no target selection (with `offenseMultiplierPercent`, used by Abilities and by `thunder-totem`/`crown-of-destruction`: plus the bearer's base attack/magicPower scaled by it, mitigated by defense — `11-abilities.md`)

  // Group 4 — affects out-of-combat systems (fear/cooldown are already per-character; EXP is the exception since partyExp is shared)
  | { kind: "expBoost"; percent: number }         // adds % to the expReward of EVERY kill while this artifact is equipped by anyone (EXP is the shared `partyExp` — §6.9 — so this is the sole exception not restricted to a single person)
  | { kind: "fearResist"; percent: number }       // reduces % of every fear-gain source for the EXACT equipping character (`Character.survival.fear` is already per-character — `03-survival-stats.md`), doesn't apply to active fear reduction
  | { kind: "cooldownReduction"; turns: number }  // reduces the `cooldownTurns` of the EXACT equipping character's skills directly (minimum 0) — `Character.cooldownsRemaining` is already per-character

  // Cursed-only (§8.6) — never appears on an ordinary artifact
  | { kind: "curseAggroBoost"; amount: number }   // adds aggro to the EXACT equipping character, monsters prioritize targeting them

ArtifactDefinition {
  id: Id
  name: string
  description: string
  rarity: ArtifactRarity
  effects: ArtifactEffect[]   // usually just 1, epic ones may combine several
  isCursed?: boolean          // §8.6
}
```

**Stacking on duplicates**: if 1 character equips 2 artifacts of the same type (taking up 2 of their slots) → the effect stacks directly for that person alone (2× `statBoost`, 2 independent rolls for `poisonOnHit`/`dodgeChance`/etc.). If 2 different characters each equip 1 of the same artifact type, **each is computed independently** per person, with no shared stacking.

**Stacking of `alwaysHit` and `debuffResist`**: a chance-like value can't simply add up, so every equipped Artifact and the equipped Ability each count as an independent source — `alwaysHit` combines as the chance that at least one succeeds, `debuffResist` as `1 − Π(1 − pᵢ)`. Neither can reach 100% from sources below 100%, so no cap is needed.

**Who it applies to**: `statBoost` adds directly to the stats of the **exact equipping character** (not multiplied by `growthWeights`) — computed alongside the Exhausted multiplier in `recomputeCharacterStats` (`src/engine/party.ts`, `03-survival-stats.md`), applied *after* it so Exhausted never reduces an artifact bonus. All Group 2-4 effects likewise only count for the exact equipping character (except `expBoost`, noted above) — computed at the `Character` level (field `equippedArtifactIds`).

### Drop source

4 sources, non-exclusive (unlike Elite/Boss in `02-monster.md` section 2, where those 2 types are mutually exclusive per floor):

| Source | Drop chance for 1 Artifact | Notes |
|---|---|---|
| Killing an **Elite** (floor's final room, not Boss) | Guaranteed | Rarity rolled from the `elite` odds at the current floor depth (`artifactRarityWeights`, `src/data/artifacts.ts`) — never Epic |
| Killing a **real Boss** (every `bossFloorInterval` floors, `06-level-system.md` §6.11) | Guaranteed | Rarity rolled from the `boss` odds at the current floor depth — mostly Common/Rare on floors 1–20, Unique/Epic-heavy from floor 31 |
| **Treasure room** | — | Was spec'd as its own guaranteed-Artifact room type, but never wired into the floor generator; the placeholder `RoomType` value has since been removed from the codebase as dead code, so there's no such room type in code at all |
| **Event room** | Guaranteed, when visited | See `08-events.md` §8 for the specific event types (`data/events.json`) — `open-chest` (§8.2) fills the "guaranteed artifact, no combat" role Treasure room was meant to have. Rarity uses the `treasureOrEvent` odds at the current floor depth, except the exchange events, see below |

**Regular monsters** (non-Elite/Boss) **don't** drop Artifacts — only Items (section 7.1) and Cursed Coins (see below). The 2 sources stay separate: regular/Elite/Boss monsters can all drop Items, but only Elite/Boss/the Event room drop Artifacts.

**1 exception to this table**: `waystone-shard` (New catalog entries, Category D, below) opts out of the normal per-rarity pool entirely via `restrictedDropSources` — it never appears from Elite kills or the Event room's standard roll, only from a Boss kill or from `blood-altar` once paid enough times. See its own entry for the full mechanism.

### Rarity & drop rate per tier

**Elite, Boss and Treasure/Event each have their own odds, and all three shift with floor depth** (`artifactRarityWeights`, `src/data/artifacts.ts`; numbers in `data/balance-config.json` → `artifacts`). The formula is below under "Level bands & drop schedule". Two rules survive from the earlier fixed tables: **Elite never rolls Epic** (its Epic anchor is 0, and a zero anchor stays zero at every depth), and Treasure/Event sit between Elite and Boss in average quality.

Not depth-scaled, on purpose: **Sacrificial Circle** and **Wandering Hermit** roll through `rollArtifactWithMinRarity`, which keeps the fixed `events.exchangeRarityWeights` table (common / rare / unique / epic) renormalized above the required minimum, and **Gambling Den** picks its jackpot rarity directly from `events.gamblingDenRounds`. Catalog size per rarity: `data/artifacts.json`, grouped by `rarity`.

### Level bands & drop schedule

Each rarity is tuned for a character level band, and floor depth stands in for level (a monster at floor `d` is built on the same growth curve as a character at level `d`; that equivalence is an assumption, not measured from play):

| Rarity | Intended level band |
|---|---|
| Common | 1–15 |
| Rare | 16–30 |
| Unique | 31–45 |
| Epic | 46+ |

<!-- docs:intent-begin -->
**Stat budget for pure-stat artifacts.** One artifact should improve its stat's *effect* by about **6% (Common), 8% (Rare), 10% (Unique), 12% (Epic)** at the middle of its band, measured against the mean stat of the classes that actually use it (level 8 / 23 / 38 / 60). For `attack`, `magicPower`, `maxHp` and `maxMp` that is a plain share of the stat. For `defense` the share is of effective HP, `bonus / (defenseMitigationX + defense)` (`defenseMitigationX` is 40 in `data/balance-config.json`), because of the mitigation curve (`mitigatedOffense`, `resolver.ts`); a defense point buys far less than its share of the stat suggests. An artifact with two stats counts each at 0.7, one with three at 0.5. Catalog values at or above the budget stay as they are, so it is a floor for new items rather than a cap; `cracked-spiral-stone` (`maxMp +22`) and `fused-twin-coins` (`attack +13`) sit on it.

**Stats stay flat; `autoDamage` scales.** Artifacts are swapped during a run, so their stat bonuses are flat numbers, not shares of the bearer's base stats (Abilities, which last the whole run, use `minPercent` instead). The exception is `autoDamage`, whose fixed damage falls to 1–2% of a monster's HP at its level band. `thunder-totem` deals `6 + 25%` of the bearer's base `magicPower` and `crown-of-destruction` deals `12 + 30%` of base `attack` (plus its `poisonOnHit`), resolved as a normal `damage` hit against defense on 1 random living monster per round. That is about 4.3% of a floor-38 monster's HP for the totem and 5.2% of a floor-60 monster's for the crown (1.4% and 2.1% before scaling), roughly half of `thunderous-aura` and `lodestone` at the same tier. A class with none of the scaling stat (a Rogue with the totem, a Mage with the crown) gets a weaker tick than the old fixed one, since the flat part is now mitigated too.
<!-- docs:intent-end -->

**Rarity odds by depth.** Depth is grouped into steps of `artifacts.floorsPerStep` (10) floors, so every floor in a step shares one set of odds. The step containing `artifacts.anchorFirstFloor` (31) uses the source's `anchorWeights`; every other step follows

```
w_r   = anchor_r × tilt ^ ( i_r × (step − anchorStep) )     i = 0, 1, 2, 3 for common, rare, unique, epic
odds  = 100 × w_r / Σ w
```

Going deeper multiplies rare by `tilt`, unique by `tilt²` and epic by `tilt³` relative to common; going shallower divides. The tilt is `artifacts.tilt` (2.5). Anchors, in the order of the legend:

<!-- docs:begin rarityOdds part=anchors -->
*Generated from `data/balance-config.json` (`artifacts`) by `bun run docs:sync`. Do not edit.*

| Source | Anchor at floors 31–40 (C / R / U / E) |
|---|---|
| Elite | 15 / 40 / 45 / 0 |
| Boss | 5 / 25 / 55 / 15 |
| Treasure / Event / Merchant | 15 / 35 / 40 / 10 |
<!-- docs:end -->

Resulting odds (%):

<!-- docs:begin rarityOdds part=odds bands=1,11,21,31,41,51 -->
*Generated from `data/balance-config.json` (`artifacts`) by `bun run docs:sync`. Do not edit.*

| Floors | Elite | Boss | Treasure / Event |
|---|---|---|---|
| 1–10 | 84.5 / 14.4 / 1.0 / 0 | 73.2 / 23.4 / 3.3 / 0.1 | 86.2 / 12.9 / 0.9 / 0.0 |
| 11–20 | 66.5 / 28.4 / 5.1 / 0 | 47.8 / 38.2 / 13.4 / 0.6 | 69.2 / 25.8 / 4.7 / 0.2 |
| 21–30 | 39.3 / 41.9 / 18.8 / 0 | 20.2 / 40.4 / 35.5 / 3.9 | 41.6 / 38.8 / 17.8 / 1.8 |
| 31–40 | 15 / 40 / 45 / 0 | 5 / 25 / 55 / 15 | 15 / 35 / 40 / 10 |
| 41–50 | 3.8 / 25.2 / 71.0 / 0 | 0.8 / 9.7 / 53.2 / 36.3 | 2.9 / 17.2 / 49.1 / 30.7 |
| 51–60 | 0.7 / 12.4 / 86.9 / 0 | 0.1 / 2.6 / 36.0 / 61.3 | 0.4 / 5.2 / 36.9 / 57.6 |
<!-- docs:end -->

The first band of floors almost never drops a Unique or Epic, which is the point of the schedule. The exponential shape also means that, deep enough, only Unique and Epic still drop. Past `artifacts.maxStepsFromAnchor` (10) steps from the anchor the odds stop changing. Anchors and `tilt` are first-pass numbers; the whole schedule is tuned from `balance-config.json` without touching code. Collapsed Floor rolls the Boss odds at the current depth, so on shallow floors its reward is a Common or Rare rather than a guaranteed Unique/Epic.

### Catalog

Full list (id, name, rarity, effects): `data/artifacts.json`. Loosely, higher rarities carry a bigger `statBoost`, a more distinctive Group 2/3 effect, or (Epic only) a combination of several effects — but treat the JSON as authoritative rather than this description.

### Lore-bearing descriptions

**Every** artifact in the catalog (all 34 existing, Common included, plus 10 new + 3 event-tied
below) gets its `description` written as a genuine short story — a specific, implied character
and moment, not a static image plus 1 appended detail. None of these are required to connect back
to an existing event or thread; where one does, it's because the story wanted it, not because the
catalog needed coverage.

**Craft discipline carried over from the event-writing side of this project**: no names (nobody
down here exchanges them, matching the established pattern), no resolved motive, no confirmed fact
that would settle anything on §11.9's open list. Sentence openings vary hard across the whole
batch — entries open with the object itself, a fact, a number, or embedded dialogue far more often
than with "Whoever," which appears only mid-sentence, never as the first word.

No entry names "Sleeper," "Covenant," or "the Balance," or resolves anything on §11.9's open list
(who anyone was, whether a bargain paid off, what a Guardian actually is, whether either side of a
broken schism was right). No item is written with its own will or intent — phrasing like "it
doesn't stop" or "it's still waiting" describes a fact about the object, never the object choosing
anything.

#### Common (10 of 10 — every 1 rewritten)

<!-- docs:begin artifacts ids=iron-gauntlet,worn-wooden-shield,charm-of-life,small-mana-gem,sharp-claw,stone-of-endurance,ring-of-focus,warriors-necklace,pendant-of-calm,travelers-ration -->
*Generated from `data/artifacts.json` by `bun run docs:sync`. Do not edit.*

| id | Rarity | Effect | Story |
|---|---|---|---|
| `iron-gauntlet` | Common | +3 attack. | "The warrior who wore this fought until the gauntlet's straps outlasted the arm inside them. Someone cut it free rather than carry the rest." |
| `worn-wooden-shield` | Common | +3 defense. | "Every scar on it came from a blow meant for someone standing behind the one holding it." |
| `charm-of-life` | Common | +20 max HP. | "Carved by someone who wasn't very good at carving, for someone they loved more than they were skilled." |
| `small-mana-gem` | Common | +10 max MP. | "'Guard it with your life,' a spellcaster told their apprentice. It was found afterward in a closed fist, and the fist was not easy to open." |
| `sharp-claw` | Common | +4 attack. | "The grip on this handle is sized for a hand much smaller than the claw's original owner ever had. One person pulled it, another mounted it, and a third swung it." |
| `stone-of-endurance` | Common | +30 max HP. | "The runes came later — carved onto a stone that was already being carried around as a lucky weight, long before anyone thought it needed an explanation." |
| `ring-of-focus` | Common | +15 max MP. | "A mage traded away 3 better rings before settling on this plain one, saying the others made them feel too clever to stay careful." |
| `warriors-necklace` | Common | +5 defense. | "Every fang on this came from the same fight. The one who strung them together was the only one left standing by the end of it — and didn't much feel like it, wearing this." |
| `pendant-of-calm` | Common | -10% fear accumulated. | "'I won't need calm where I'm headed,' they said, handing it back before they left. The cord was still knotted to fit their neck." |
| `travelers-ration` | Common | +15 max HP. | "There's always 1 more portion in here than the party actually needs — nobody's ever asked who packed it that way, or who the extra was for." |
<!-- docs:end -->

#### Rare, non-Cursed (9 of 9)

<!-- docs:begin artifacts ids=ancient-sword,heart-of-stone,eternal-vial,arcane-core,thorned-armor,venomous-dagger-relic,vampiric-fang,featherweight-boots,quickcharge-rune -->
*Generated from `data/artifacts.json` by `bun run docs:sync`. Do not edit.*

| id | Rarity | Effect | Story |
|---|---|---|---|
| `ancient-sword` | Rare | +8 attack. | "Someone spent their last good days trying to translate the engraving, convinced it named whoever had betrayed them. They never finished. The blade outlived the theory." |
| `heart-of-stone` | Rare | +8 defense. | "'I carved it after my own heart,' they said, the day they decided to stop letting things hurt them. The carving is deep and even everywhere except at the center, where the hand lifted." |
| `eternal-vial` | Rare | +50 max HP. | "Its last owner drank from it exactly once a day, no more, certain that any more would use up whatever kept it full. They were still counting when it changed hands." |
| `arcane-core` | Rare | +25 max MP. | "3 books of notes exist trying to transcribe what the humming is saying. All 3 end on the same word — one that nobody since has been able to read as anything but a guess." |
| `thorned-armor` | Rare | Reflects 5% of damage taken back to the attacker. | "Built for someone who didn't trust anyone standing close enough to strike them, let alone embrace them. By all accounts, it worked — though nobody got close enough afterward to say for certain." |
| `venomous-dagger-relic` | Rare | 6% chance to inflict Poisoned on hit. | "This changed hands exactly once — from whoever poisoned the blade to whoever it was used on. Neither name survived the telling." |
| `vampiric-fang` | Rare | Heals 5% of damage dealt. | "'It only took what the thing didn't need anymore,' insisted whoever pulled this free. It leaves a faint warmth in the hand that does not come from the hand." |
| `featherweight-boots` | Rare | 6% chance to fully dodge an attack. | "These were made for leaving a room without anyone realizing you'd been in it. Wearing them now, it's hard to say if that was ever a skill, or just a habit nobody could put down." |
| `quickcharge-rune` | Rare | -1 turn skill cooldown. | "Carved in the dark, in a hurry, before there was time to be sure it would work. It worked. There wasn't time afterward to be grateful for it either." |
<!-- docs:end -->

#### Rare, Cursed (4 of 4)

<!-- docs:begin artifacts ids=blackened-locket,shackle-of-hunger,unstable-core,heavy-guilt -->
*Generated from `data/artifacts.json` by `bun run docs:sync`. Do not edit.*

| id | Rarity | Effect | Story |
|---|---|---|---|
| `blackened-locket` | Rare | -20 max HP. +10 attack. | "It used to hold a portrait. The portrait was burned rather than let whoever was in it fall to something worse — and the locket got worn anyway afterward, as if that made the trade fair." |
| `shackle-of-hunger` | Rare | -6 defense. +8 attack. | "Forged to hold something back, never meant to be worn. Someone put it on anyway, first — desperate enough, it seems, to trade the difference for anger they could actually use." |
| `unstable-core` | Rare | +25 aggro. +30 max MP. | "This gets carried carefully, the way you'd carry something that might go off if you stopped paying attention to it. It hasn't gone off yet. That doesn't mean it can't." |
| `heavy-guilt` | Rare | -6 defense. Heals 8% of damage dealt. | "Wear this long enough and the shoulders start curving in on their own. Its last owner called that easier than explaining why they deserved worse." |
<!-- docs:end -->

#### Unique (7 of 7)

<!-- docs:begin artifacts ids=spiked-cloak,serpent-ring,thunder-totem,armor-of-wholeness,bloodthirsty-blade,phantom-step,scholars-insight -->
*Generated from `data/artifacts.json` by `bun run docs:sync`. Do not edit.*

| id | Rarity | Effect | Story |
|---|---|---|---|
| `spiked-cloak` | Unique | Reflects 10% of damage taken back to the attacker. | "A new spike was added for every close call its first owner walked away from. It's short exactly 1 spike of what would have been a matching set on both shoulders." |
| `serpent-ring` | Unique | 12% chance to inflict Poisoned on hit. | "Carved as a warning to any thief who might try to lift it, not as a weapon for its wearer. As far as anyone can tell, it's only ever bitten the people it was made to protect." |
| `thunder-totem` | Unique | Deals 6 + 25% base magic power damage to 1 random enemy at the start of each round. | "Carved during a storm that lasted longer than anyone down here remembers a storm lasting. It started crackling, by every account, before the last line was even cut." |
| `armor-of-wholeness` | Unique | +6 attack. +6 defense. +40 max HP. | "Made for someone who never got the chance to wear it into anything worth calling a battle. The lining has no sweat in it, and the buckles have never been moved off the first hole." |
| `bloodthirsty-blade` | Unique | Heals 10% of damage dealt. | "'I only meant to make it sharp,' the smith swore. Everyone who's used it since has their own opinion about how that turned out, usually right after using it." |
| `phantom-step` | Unique | 12% chance to fully dodge an attack. | "These were enchanted by someone who wanted to be somewhere else the instant before they actually were. The soles are worn through at the toe and nowhere else." |
| `scholars-insight` | Unique | +15% EXP gained for the party. | "The last third of this notebook is written in a hand trying too hard to match the first two-thirds — somebody wanted badly for nobody to notice." |
<!-- docs:end -->

#### Epic (4 of 4)

<!-- docs:begin artifacts ids=crown-of-destruction,immortal-heart,reapers-covenant,eternal-scholars-tome -->
*Generated from `data/artifacts.json` by `bun run docs:sync`. Do not edit.*

| id | Rarity | Effect | Story |
|---|---|---|---|
| `crown-of-destruction` | Epic | Deals 12 + 30% base attack damage to 1 random enemy at the start of each round. 8% chance to inflict Poisoned on hit. | "The tyrant who wore this spent considerable effort making sure people would remember the name. Ask anyone down here what that name was, though — nobody left down here would know it, or care enough to ask." |
| `immortal-heart` | Epic | Reflects 15% of damage taken back to the attacker. +10 defense. +60 max HP. | "More than once, apparently, someone asked for this to finish the job properly — a mercy, maybe. Nobody ever obliged. It's still here, still waiting on that favor." |
| `reapers-covenant` | Epic | Heals 25 HP on defeating a target. Heals 8% of damage dealt. | "The first person to strike this bargain didn't read every term in it. Everyone who's carried it since has just accepted whatever was already agreed to." |
| `eternal-scholars-tome` | Epic | +25% EXP gained for the party. -1 turn skill cooldown. | "The margins used to hold questions. Now they only hold corrections — whoever's still adding to this has gotten better at fighting and worse at explaining why." |
<!-- docs:end -->

### New catalog entries — 4 categories, 11 items

11 wholly new `ArtifactDefinition` entries, grouped into 4 named categories for design purposes only
— mechanically, plain artifacts rolled through the same rarity tables as everything else in §7.2, no
collection mechanic, no tracked set, no special drop source.

**A — Belongings of Those Before** (Thread 4) — deliberately mundane and personal:

- **Worn Wedding Band** (Rare, `statBoost maxHp +25`): "'A promise I intend to keep,' they used to
  say about it. By the end, they'd stopped explaining it to anyone — including themselves."
- **Child's Whittled Horse** (Rare, `statBoost defense +5`): "Whittled by hands too unsteady for
  the job, for someone who wouldn't have cared about the wobble. It was never delivered. It stands
  anyway, the same as it was meant to."
- **Bundle of Undelivered Letters** (Unique, `fearResist 15%`): "Addressed to someone who was never
  told to expect them, tied with string by someone who kept meaning to send just 1 more before
  finally handing over the whole stack. The ink on top has blurred from handling, not weather —
  reread more than it was ever written."

**B — Ritual Fragment** (Thread 1/2, Covenant-adjacent):

- **Half a Chalice** (Rare, `lifesteal 8%`): "Two people broke this in half on purpose, each taking
  the piece they thought proved they were right. Neither of them made it back down here to settle
  it."
- **Torn Ritual Page** (Unique, `expBoost 10%`): "Torn free by the hand writing it, not by whoever
  found it after. The handwriting stays careful right up until it doesn't — like something
  interrupted the hand before it interrupted the thought."
- **Snapped Ritual Blade** (Epic, `statBoost attack +15` + `cooldownReduction 1 turn`): "Forged for
  a single, specific cut nobody ever explained to whoever was meant to swing it. It snapped on the
  first and only attempt. Nobody's sure if that means it failed, or worked exactly as intended."

**C — Guardian Remnant** (Thread 2):

- **Guardian's Unburnt Ember** (Rare, `statBoost defense +8`): "Pulled from something that had
  stopped moving but hadn't quite finished burning — still warm on the way up, by whoever pulled it
  free. It's been cold in every hand since."
- **Guardian's Scale** (Unique, `reflectDamage 12%`): "Pried loose from something nobody who was
  there could agree on the shape of, afterward. It's warm on 1 side no matter how it's turned, and
  hasn't matched a single thing anyone's fought since."

**D — Older Than the Mark** (echoes `still-breathing`'s reveal without repeating it):

- **Cracked Spiral Stone** (Unique, `statBoost maxMp +20`): "Scratched into stone with something
  that wasn't a chisel, long before anyone down here started using one. This wasn't a copy of
  anything. Every spiral cut since has been copying this, several hands removed, and none of them
  know it."
- **Fused Twin Coins** (Epic, `statBoost attack +10` + `statBoost defense +10`): "2 coins from 2
  different people, melted together by something neither of them chose. One face stays closed in
  on itself; the other's worn open. Nobody's ever managed to pry them apart, and it's not clear
  either owner would have wanted them to."
- **Waystone Shard** (Unique, no `statBoost` — its purpose is entirely the check in
  `10-event-narrative.md` §F.4, so it carries only a token effect, e.g. a small `statBoost maxHp`):
  "A shard of something that was never carved, only grown that way — smooth on every broken edge
  except where it snapped. This was already broken long before anyone started marking these walls
  with a spiral." *(the floor-100 "Leave" ending's escape condition — §F.4)* **Restricted drop
  source, an exception to the "Drop source" table below**: excluded from the standard
  `treasureOrEvent` roll (so never from Chain 4's 7 zero-cost events, Elite kills, `merchant`,
  `cursed-shrine`, `twin-altars`, or `sacrificial-circle`) — appears only from a Boss kill, or from
  `blood-altar` once `altarPaymentsCount >= events.bloodDebtThreshold2` (8 payments). Full rationale
  and the `restrictedDropSources` mechanism this needs: `10-event-narrative.md` §F.4.

### Caster, speed and debuff-resist artifacts — 11 items

Artifacts can raise `attack`, `defense`, `maxHp`, `maxMp`, `magicPower` and `speed`, and can carry `alwaysHit` and `debuffResist` (introduced for Abilities, `11-abilities.md`). `aggro` stays Ability-only. `magicPower` also lifts every `isMagic` heal (`resolver.ts`), so these serve healers as much as nukers. Descriptions follow the rules in "Lore-bearing descriptions" above.

<!-- docs:begin artifacts ids=cracked-scrying-glass,knotted-red-thread,resonant-tuning-fork,runners-ankle-cord,bitter-root-charm,hunters-tally-stick,censer-of-ash,signal-whistle,threshold-salt-pouch,stormglass-orb,unbroken-seal -->
*Generated from `data/artifacts.json` by `bun run docs:sync`. Do not edit.*

| id | Rarity | Effect | Story |
|---|---|---|---|
| `cracked-scrying-glass` | Common | +3 magic power. | "Dropped once by an apprentice, and the crack runs edge to edge. Spells came easier afterward, they said, and nobody offered to fix the glass." |
| `knotted-red-thread` | Common | Harmful statuses enemies apply are 6% less likely to land. | "9 knots, and only the last one has never frayed. Whoever tied it was tying against something particular, and never said what." |
| `resonant-tuning-fork` | Rare | +8 magic power. | "Struck once, mid-incantation, it rang for the length of a full watch. The spell being cast at the time went off a good deal harder than intended." |
| `runners-ankle-cord` | Rare | +2 speed. | "Frayed white at both ends from being tied fast and untied faster. Nobody who's owned it can say when they last stood still." |
| `bitter-root-charm` | Rare | Harmful statuses enemies apply are 10% less likely to land. | "Chewed flat at one end by someone who kept it in their mouth until the bitterness stopped registering, and the sickness with it." |
| `hunters-tally-stick` | Rare | 8% chance to bypass a hit or debuff-chance roll entirely. | "39 notches, each cut only once the thing was confirmed dead. The 40th is half-started and has never been finished." |
| `censer-of-ash` | Unique | +12 magic power. | "Nobody has ever emptied the ash inside, and it's still warm. Casters who've held it say the words come out heavier, as though they'd been written somewhere first." |
| `signal-whistle` | Unique | +4 speed. | "Blown from a standstill it gives nothing but breath. Blown mid-run it carries three floors down, and everything below turns to look." |
| `threshold-salt-pouch` | Unique | Harmful statuses enemies apply are 15% less likely to land. | "Enough salt to line every doorway on a floor, and the pouch is still full. Whoever poured the first line stopped at the last door and did not pour that one." |
| `stormglass-orb` | Epic | +15 magic power. -1 turn skill cooldown. | "The weather inside the glass never matches the weather outside. It clears a moment before every spell, and by the time the caster looks up, it's clouding again." |
| `unbroken-seal` | Epic | Harmful statuses enemies apply are 20% less likely to land. -15% fear accumulated. | "Pressed 3 times over the same letter, by 3 different hands, the wax has never been broken. Everyone who carried it said it got easier once they stopped wondering what was inside." |
<!-- docs:end -->

**Calibration.** `magicPower` and `attack` are interchangeable stats (`11-abilities.md`, Common), so `magicPower` reuses the `attack` ladder: `+3` Common (`iron-gauntlet`), `+8` Rare (`ancient-sword`), `+15` Epic (`snapped-ritual-blade`); Unique `+12` is interpolated between Rare and Epic, the way `executioners-instinct` is in the Ability catalog. `speed` is deliberately small (`+2` Rare, `+4` Unique): it never grows with level and only spans `8`–`17` across the classes, and three equipped Artifacts stack, so a Rare-tier `+8` would be absurd. `alwaysHit` and `debuffResist` values (`8%`; `6% / 10% / 15% / 20%`) sit below the Ability rungs (`10 / 15 / 20`; `10 / 16 / 24 / 32`) because up to three of them stack. None of these numbers is derived from an expected-value model; they are first-pass and meant to be tuned in play. <!-- docs:intent -->

### Event-tied artifacts

Some items are tied to a specific event, especially the once-lifetime ones. `still-breathing` stays
`noArtifactReward: true` (a locked decision, `10-event-narrative.md` Part C.4 — "the reveal is the
reward, no mechanical effect of any kind").

**Mechanism**:

```ts
// EventDefinition, instantReward only
/** Grants this specific artifact instead of rolling from the standard table — for a scene whose
    reward is a specific object described in the text itself, not a generic loot beat. */
guaranteedArtifactId?: Id;
```

```ts
// src/engine/events/openChest.ts
if (!event.noArtifactReward) {
  const artifactId = event.guaranteedArtifactId ?? rollArtifact("treasureOrEvent", ctx.rng, state.floor.depth);
  grantArtifact(state, artifactId);
}
```

**Wired**: `waiting-supplies` → `travelers-ration` (`10-event-narrative.md` Part A, addressing the
"too many free common rewards" finding), plus the 3 once-lifetime events below, each pointing
`guaranteedArtifactId` at its own dedicated Unique artifact in `data/artifacts.json`:

- **Vigil Cloth** (`vigil-candle`'s guaranteed drop, Unique, `fearResist 15%`): "Folded before it
  was ever set down, the way you'd fold something you meant to come back for. It got folded the
  same exact way every night — until the night nobody came back to unfold it again."
- **Torn Lock-Plate** (`broken-seal`'s guaranteed drop, Unique, `dodgeChance 10%`): "The other half
  of what was stamped into the seal — the half torn away, not the half still in the lock. Read
  together, the two halves would complete the spiral. Nobody's ever held both."
- **Worn Chalk Stub** (`half-a-warning`'s guaranteed drop, Unique, `cooldownReduction 1 turn`):
  "Worn down to a nub, carving something into stone that should have taken half as long. Whatever
  hand held it needed to stay steady right up until it didn't."

### `autoDamage` trigger mechanism

`autoDamage` triggers at the **start of every round** (before the player's command phase — the same round boundary that combat fear-gain also uses, `03-survival-stats.md`), picking 1 living monster **uniformly at random** (uniform, like the `opportunistic` pattern in `02-monster.md` section 2, not based on `aggro`) — no MP cost, doesn't go through `queueAction`, doesn't appear in the skill selection list. Logged as its own separate event line, distinct from any character's turn. An `autoDamage` with `offenseMultiplierPercent` (Abilities and the two `autoDamage` Artifacts) is resolved as a normal `damage` effect instead of a raw HP subtraction, so its log line reads like a skill hit and the target's defense applies.

### Engine hooks for the Group 2-4 effects

None of the Group 2-4 effects exist in any form in the current skill/status system (`01-class-skill.md` section 1.5) — each one has its own dedicated hook in the engine:

- **`reflectDamage`**: after a monster successfully deals `damage` to the **exact character wearing this artifact** (not another party member), roll `percent`; if it hits, deal `percent × the damage just taken` back at that monster (doesn't go through the monster's `defense` — a reflect isn't a regular attack).
- **`poisonOnHit`**: after the **exact character wearing this artifact** successfully deals `damage` to a monster (any skill/basic attack of theirs, not just Poison Coat), roll `chance`; if it hits, `applyStatusEffect` of the effect's own `statusEffectId` on that monster for the effect's own `durationTurns` — the same "on-hit rider" mechanic already used for Poison Coat (`docs/technical-decisions.md` §4.2), differing only in that the trigger source is an artifact instead of a temporary status. Another party member landing a hit does **not** trigger this effect unless they also have their own `poisonOnHit` artifact equipped.
- **`lifesteal`**: hooks into the exact spot where the resolver computes `finalDamage` for a `damage` effect dealt by the **exact character wearing this artifact** (`resolver.ts`) — after subtracting the target's hp, adds `round(finalDamage × percent)` to their own hp (capped at `maxHp`).
- **`dodgeChance`**: rolled **before** the `finalDamage` calculation step when a monster targets `damage` at the **exact character wearing this artifact** — on a hit, the entire effect is skipped (damage = 0, not just reduced), distinct from the existing fear-based accuracy roll (`04-fear-combat.md` section 4, which only applies to character skills targeting enemies, not monster attacks targeting characters). A monster targeting a different ally doesn't roll this dodge.
- **`healOnKill`**: hooks into the exact point where a monster is removed from `CombatState.combatants` (hp ≤ 0) — **only triggers if the finishing blow (the final `damage` effect that brought hp to ≤ 0) was dealt by the exact character wearing this artifact**, healing `amount` straight to themself (capped at `maxHp`, not applicable to other allies). With `minPercent` set (Abilities only) the heal is the larger of `amount` or that percent of the bearer's base max HP (class base plus level growth).
- **`alwaysHit` / `debuffResist`**: read by the same `combat.ts` call sites as the Ability versions (`rollsAlwaysHit`, the per-effect chance roll in `applySkillEffects`) — the sums in `src/engine/artifacts.ts` now cover equipped Artifacts and the Ability together. Mechanics: `11-abilities.md` §11.1.1 and §11.1.2.
- **`expBoost`**: multiplies into the step where `applyPartyExp` receives `expGained` from `game.ts` (`06-level-system.md` §6.9) — `expGained = round(expGained × (1 + sum of percent across every expBoost artifact currently equipped by anyone in the party))`. This is the **only effect not restricted to the person who landed the kill** — `partyExp` is a single value shared by the whole party (§6.9).
- **`fearResist`**: multiplies into the **per-round combat fear-gain** of the **exact character wearing this artifact** (`fearGainForRound` — `03-survival-stats.md`) — via `actualFear = round(baseFear × (1 − sum of percent))`, doesn't apply to active fear reduction (Acolyte skill/item, unaffected, counted at full 100%) or victory relief. Allies not wearing this artifact still receive fear at full rate as usual.
- **`cooldownReduction`**: subtracted directly from the `cooldownTurns` assigned when 1 of the **exact character wearing this artifact**'s skills goes on cooldown (`Character.cooldownsRemaining[skillId] = skill.cooldownTurns − sum of turns`, minimum 0) — doesn't instantly refresh a skill already on cooldown from before the artifact was equipped, doesn't affect other allies' cooldowns.
- **`curseAggroBoost`**: added directly to `Character.aggro` in `recomputeCharacterStats` (`src/engine/party.ts`), on top of the class base + Exhausted multiplier — see §8.6.