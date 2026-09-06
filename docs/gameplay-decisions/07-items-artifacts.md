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
  effects: SkillEffect[]     // reuses the exact same existing resolver — no new effect kind needed for items
  weight?: number            // drop weight (default 1), see "Drop source" below
  archetypeIds?: Id[]        // monster-specific items only, see "Monster-specific items" below
  combatUsable?: boolean     // default true; false hides it from the in-combat "use item" list (e.g. Exploration Kit, §3)
}
```

Used in combat: during the command phase, a character chooses "use item" instead of a skill (only items with `combatUsable !== false`, checked by `checkItemUsable` in `src/engine/combat.ts`) — 1 count is subtracted from `GameState.inventory[itemId]`, and `effects` are applied through the exact same existing `resolveSkillEffect` (0 changes to `resolver.ts`). Can also be used outside combat via `Game.useItemOutOfCombat` (e.g. restoring satiety while walking the dungeon loop — Exploration Kit is `combatUsable: false` but still usable this way, no need to wait for combat).

### Drop source

Drops randomly when killing **any monster** (regular/Elite/Boss), gated by `data/balance-config.json` field `items.itemDropChance` (`ITEM_DROP_CHANCE`, `src/data/items.ts`). Doesn't drop from Treasure/Event rooms (those 2 rooms are reserved for Artifacts — section 7.2, also see `08-events.md`).

When the drop roll succeeds (gated by `items.itemDropChance`, `data/balance-config.json`), the specific item is chosen from a **combined pool** = the common-item catalog (below) + the item(s) specific to the exact `archetypeId` just killed (the "monster-specific items" table below). The pool splits into 2 groups, **not an even split within each group** — `ItemDefinition.weight` (`data/items.json`, default `1` when unset) weights each item inside its group (`rollItemDrop`, `src/data/items.ts`):

- One share of the total goes to that monster type's specific item(s), split proportionally to `weight` across the applicable items (not evenly). **1 monster can belong to multiple groups at once** (e.g. Zombie Knight belongs to both the Zombie group and the Knight/Warrior group). Every archetype in `data/monsters.json` already has at least 1 specific item (no fallback case).
- The remaining share is split proportionally to `weight` across the common-pool items — **not evenly**. Some common items carry a `weight` below the default `1` (`data/items.json`) — those get a smaller share at low floor depth than the unweighted ones.
- **Weight scales up with floor depth**: any item with `weight < 1` grows via `effectiveWeight = min(1, weight + itemWeightDepthGrowth × (floorDepth − 1))` (`items.itemWeightDepthGrowth`, `data/balance-config.json`). Once a half-weighted item's `effectiveWeight` reaches `1`, the split among the common items becomes even — the skew described above is specific to early floors. The same growth applies to weighted monster-specific items. Read `data/items.json`/`data/balance-config.json` directly for the current split rather than trusting a hand-copied percentage here, since it drifts the moment weights are retuned.

Added directly to `GameState.inventory[itemId] += 1` as before, with no change to the in/out-of-combat item-use mechanics. A room with multiple monsters rolls the drop independently per monster (no cap on stacking).

### Catalog — common items

Full list (id, name, effect, notes): `data/items.json`, filtered to entries without an `archetypeIds` restriction. As of writing this covers healing/mana potions in two sizes, a fear-calming item, a debuff-cure (`Antidote`), and 2 temporary-buff items (`Whetstone`/`Temporary Ward`) that apply new statuses — check `data/status-effects.json` for any status introduced solely for an item (same shape as skill-granted buffs, differing only in trigger source). Satiety recovery is **not** a consumable-item concern — it only comes from the Rest room's Eat & Drink and from Camp (§3), plus the rare monster-specific Exploration Kit drop described there.

### Monster-specific items

Assigned by **monster group by name/tag** (1 monster can belong to multiple groups — see the multi-group roll mechanic above). Full list: `data/items.json`, filtered to entries with a non-empty `archetypeIds`. Reuses `effects: SkillEffect[]` and the existing resolver as much as possible; a few entries introduce new status effects (check `data/status-effects.json` for any status referenced by an item that doesn't already exist from the skill kits). The Exploration Kit (§3, Camp) is one of these — a humanoid-archetype-only drop with a deliberately low weight (`0.15`) and `combatUsable: false`.

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
3. Equipping consumes 1 of that character's 3 personal slots (1 of the party's 12 total), **permanently** — see "Ways an Artifact can leave a character" below for the only 3 exceptions.

- **Capped Artifacts per character** (`party.maxEquippedArtifacts`, `data/balance-config.json`) — multiplied by party size gives the total equip-slot budget for a run (3 × 4 = 12).
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
  | { kind: "statBoost"; stat: "attack" | "defense" | "maxHp" | "maxMp"; amount: number }

  // Group 2 — distinct combat effects, all counted only for the equipping character
  | { kind: "reflectDamage"; percent: number }    // % of damage a monster deals to the EXACT equipping character is reflected back at the attacker
  | { kind: "poisonOnHit"; chance: number }       // every damage hit dealt by the EXACT equipping character has this % chance to auto-apply "poisoned" to the target, no Rogue Poison Coat needed
  | { kind: "lifesteal"; percent: number }        // every damage hit dealt by the EXACT equipping character heals them for that % of the damage dealt
  | { kind: "dodgeChance"; chance: number }       // every monster attack targeting the EXACT equipping character has this % chance to be dodged entirely (damage = 0), rolled separately, unrelated to fear-accuracy (`04-fear-combat.md` section 4)
  | { kind: "healOnKill"; amount: number }        // whenever the EXACT equipping character lands the killing blow on a monster, heals themself for `amount` HP directly

  // Group 3 — automatic damage, tied to the equipping character but doesn't consume their turn
  | { kind: "autoDamage"; amount: number }        // at the start of every round, as long as the equipping character is alive, automatically deals `amount` damage to 1 random living monster — no `queueAction`, no turn/MP cost, no target selection

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

**Who it applies to**: `statBoost` adds directly to the stats of the **exact equipping character** (not multiplied by `growthWeights`) — computed alongside the Exhausted multiplier in `recomputeCharacterStats` (`src/engine/party.ts`, `03-survival-stats.md`), applied *after* it so Exhausted never reduces an artifact bonus. All Group 2-4 effects likewise only count for the exact equipping character (except `expBoost`, noted above) — computed at the `Character` level (field `equippedArtifactIds`).

### Drop source

4 sources, non-exclusive (unlike Elite/Boss in `02-monster.md` section 2, where those 2 types are mutually exclusive per floor):

| Source | Drop chance for 1 Artifact | Notes |
|---|---|---|
| Killing an **Elite** (floor's final room, not Boss) | Guaranteed | Rarity rolled from the `elite` weights in `RARITY_WEIGHTS` (`src/data/artifacts.ts`) — never Epic |
| Killing a **real Boss** (every `bossFloorInterval` floors, `06-level-system.md` §6.11) | Guaranteed | Rarity rolled from the `boss` weights in `RARITY_WEIGHTS` — never Common/Rare |
| **Treasure room** | — | Was spec'd as its own guaranteed-Artifact room type, but never wired into the floor generator; the placeholder `RoomType` value has since been removed from the codebase as dead code, so there's no such room type in code at all |
| **Event room** | Guaranteed, when visited | See `08-events.md` §8 for the specific event types (`data/events.json`) — `open-chest` (§8.2) fills the "guaranteed artifact, no combat" role Treasure room was meant to have. Rarity uses the `treasureOrEvent` weights in `RARITY_WEIGHTS` |

**Regular monsters** (non-Elite/Boss) **don't** drop Artifacts — only Items (section 7.1) and Cursed Coins (see below). The 2 sources stay separate: regular/Elite/Boss monsters can all drop Items, but only Elite/Boss/the Event room drop Artifacts.

**1 exception to this table**: `waystone-shard` (New catalog entries, Category D, below) opts out of the normal per-rarity pool entirely via `restrictedDropSources` — it never appears from Elite kills or the Event room's standard roll, only from a Boss kill or from `blood-altar` once paid enough times. See its own entry for the full mechanism.

### Rarity & drop rate per tier

**Elite and Boss have entirely separate rarity tables** (not just different weights), both defined in `RARITY_WEIGHTS` (`src/data/artifacts.ts`, not JSON — this is a code-level constant):

- **Elite** — only rolls {Common, Rare, Unique}, **never Epic**.
- **Boss** — only rolls {Unique, Epic}, **never Common/Rare**.
- **Treasure room / Event room** — a 3rd weight table (`treasureOrEvent`), sitting between Elite and Boss in average quality, rolling all 4 rarities.

Exact weights for all 3 tables: `RARITY_WEIGHTS` in `src/data/artifacts.ts`. Catalog size per rarity: `data/artifacts.json`, grouped by `rarity`.

### Catalog

Full list (id, name, rarity, effects): `data/artifacts.json`. Loosely, higher rarities carry a bigger `statBoost`, a more distinctive Group 2/3 effect, or (Epic only) a combination of several effects — but treat the JSON as authoritative rather than this description.

### Lore-bearing descriptions

**Superseded approach**: an earlier pass tried appending a single "observable trace" sentence to a
curated subset of Rare+ artifacts, tying each one back to an existing thread/event by name. Cut
entirely — it read as connecting dots, not writing, and left the plain majority of the catalog
(all of Common tier, most of Rare+) exactly as thin as before. Replaced with the approach below:
**every** artifact in the catalog (all 34 existing, Common included, plus 10 new + 3 event-tied
below) gets its `description` rewritten as a genuine short story — a specific, implied character
and moment, not a static image plus 1 appended detail. None of these are required to connect back
to an existing event or thread; where one does, it's because the story wanted it, not because the
catalog needed coverage.

**Craft discipline carried over from the event-writing side of this project**: no names (nobody
down here exchanges them, matching the established pattern), no resolved motive, no confirmed fact
that would settle anything on §11.9's open list. The 1 thing genuinely new here: vary the *sentence
opening* hard across the whole batch. An early draft of this pass leaned on "Whoever..." as an
opener for nearly every entry — thematically defensible (nobody has a name to use instead) but
mechanically a stamped template read back to back. Final pass below opens with the object itself,
a fact, a number, or embedded dialogue far more often than with "Whoever," which is now used only
mid-sentence, never as the first word.

**Compliance, all 47**: none name "Sleeper," "Covenant," or "the Balance"; none resolve anything on
§11.9's open list (who anyone was, whether a bargain paid off, what a Guardian actually is, whether
either side of a broken schism was right); no item is written with its own will or intent — every
"it doesn't stop," "it's still waiting," "it hasn't gone off yet" describes a fact about the object,
never the object choosing anything.

#### Common (10 of 10 — every 1 rewritten)

| id | Story |
|---|---|
| `iron-gauntlet` | "The warrior who wore this fought until the gauntlet's straps outlasted the arm inside them. Someone cut it free rather than carry the rest." |
| `worn-wooden-shield` | "Every scar on it came from a blow meant for someone standing behind the one holding it — nobody's kept count of how many times that worked." |
| `charm-of-life` | "Carved by someone who wasn't very good at carving, for someone they loved more than they were skilled. Nobody who's held it since has cared about the difference." |
| `small-mana-gem` | "'Guard it with your life,' a spellcaster told their apprentice. The apprentice took the instruction more literally than anyone expected." |
| `sharp-claw` | "The grip on this handle is sized for a hand much smaller than the claw's original owner ever had. Mounting it was somebody else's job entirely — bringing it down was somebody else's again." |
| `stone-of-endurance` | "The runes came later — carved onto a stone that was already being carried around as a lucky weight, long before anyone thought it needed an explanation." |
| `ring-of-focus` | "A mage traded away 3 better rings before settling on this plain one, saying the others made them feel too clever to stay careful." |
| `warriors-necklace` | "Every fang on this came from the same fight. The one who strung them together was the only one left standing by the end of it — and didn't much feel like it, wearing this." |
| `pendant-of-calm` | "'I won't need calm where I'm headed,' they said, handing it back before they left. Nobody who was there wanted to ask what they meant." |
| `travelers-ration` | "There's always 1 more portion in here than the party actually needs — nobody's ever asked who packed it that way, or who the extra was for." |

#### Rare, non-Cursed (9 of 9)

| id | Story |
|---|---|
| `ancient-sword` | "Someone spent their last good days trying to translate the engraving, convinced it named whoever had betrayed them. They never finished. The blade outlived the theory." |
| `heart-of-stone` | "'I carved it after my own heart,' they said, the day they decided to stop letting things hurt them. They were very convincing about it, right up until they weren't." |
| `eternal-vial` | "Its last owner drank from it exactly once a day, no more, certain that any more would use up whatever kept it full. They were still counting when it changed hands." |
| `arcane-core` | "3 books of notes exist trying to transcribe what the humming is saying. All 3 end on the same word — one that nobody since has been able to read as anything but a guess." |
| `thorned-armor` | "Built for someone who didn't trust anyone standing close enough to strike them, let alone embrace them. By all accounts, it worked — though nobody got close enough afterward to say for certain." |
| `venomous-dagger-relic` | "This changed hands exactly once — from whoever poisoned the blade to whoever it was used on. Neither name survived the telling." |
| `vampiric-fang` | "'It only took what the thing didn't need anymore,' insisted whoever pulled this free. Everyone who heard it agreed, mostly just to end the conversation." |
| `featherweight-boots` | "These were made for leaving a room without anyone realizing you'd been in it. Wearing them now, it's hard to say if that was ever a skill, or just a habit nobody could put down." |
| `quickcharge-rune` | "Carved in the dark, in a hurry, before there was time to be sure it would work. It worked. There wasn't time afterward to be grateful for it either." |

#### Rare, Cursed (4 of 4)

| id | Story |
|---|---|
| `blackened-locket` | "It used to hold a portrait. The photo got burned rather than let whoever was in it fall to something worse — and the locket got worn anyway afterward, as if that made the trade fair." |
| `shackle-of-hunger` | "Forged to hold something back, never meant to be worn. Someone put it on anyway, first — desperate enough, it seems, to trade the difference for anger they could actually use." |
| `unstable-core` | "This gets carried carefully, the way you'd carry something that might go off if you stopped paying attention to it. It hasn't gone off yet. That doesn't mean it can't." |
| `heavy-guilt` | "Wear this long enough and the shoulders start curving in on their own. Its last owner called that easier than explaining why they deserved worse." |

#### Unique (7 of 7)

| id | Story |
|---|---|
| `spiked-cloak` | "A new spike was added for every close call its first owner walked away from. It's short exactly 1 spike of what would have been a matching set on both shoulders." |
| `serpent-ring` | "Carved as a warning to any thief who might try to lift it, not as a weapon for its wearer. As far as anyone can tell, it's only ever bitten the people it was made to protect." |
| `thunder-totem` | "Carved during a storm that lasted longer than anyone down here remembers a storm lasting. It started crackling, by every account, before the last line was even cut." |
| `armor-of-wholeness` | "Made for someone who never got the chance to wear it into anything worth calling a battle. It still fits like it's waiting for them to come back and finish that first one." |
| `bloodthirsty-blade` | "'I only meant to make it sharp,' the smith swore. Everyone who's used it since has their own opinion about how that turned out, usually right after using it." |
| `phantom-step` | "These were enchanted by someone who wanted to be somewhere else the instant before they actually were. They got exactly what they asked for. Nobody's sure they were glad they did." |
| `scholars-insight` | "The last third of this notebook is written in a hand trying too hard to match the first two-thirds — somebody wanted badly for nobody to notice." |

#### Epic (4 of 4)

| id | Story |
|---|---|
| `crown-of-destruction` | "The tyrant who wore this spent considerable effort making sure people would remember the name. Ask anyone down here what that name was, though — nobody left down here would know it, or care enough to ask." |
| `immortal-heart` | "More than once, apparently, someone asked for this to finish the job properly — a mercy, maybe. Nobody ever obliged. It's still here, still waiting on that favor." |
| `reapers-covenant` | "The first person to strike this bargain didn't read every term in it. Everyone who's carried it since has just accepted whatever was already agreed to." *(kept deliberately free of any spiral/ritual imagery — its name already contains the word "covenant," coincidentally, `11-world-bible.md` §11.6; the story stays a generic pact-with-death, not compounding the coincidence)* |
| `eternal-scholars-tome` | "The margins used to hold questions. Now they only hold corrections — whoever's still adding to this has gotten better at fighting and worse at explaining why." |

### New catalog entries — 4 categories, 10 items

10 wholly new `ArtifactDefinition` entries, grouped into 4 named categories for design purposes only
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
  either owner would have wanted them to." *(the containment/communion duality of §11.6, embodied
  in a single found object, predating the Covenant's own version of the split — never stated, only
  shown)*
- **Waystone Shard** (Unique, no `statBoost` — its purpose is entirely the check in
  `10-event-narrative.md` §F.4, so it carries only a token effect, e.g. `statBoost maxHp +10`):
  "A shard of something that was never carved, only grown that way — smooth on every broken edge
  except where it snapped. This was already broken long before anyone started marking these walls
  with a spiral." *(the floor-100 "Leave" ending's escape condition — §F.4)* **Restricted drop
  source, an exception to the "Drop source" table below**: excluded from the standard
  `treasureOrEvent` roll (so never from Chain 4's 7 zero-cost events, Elite kills, `merchant`,
  `cursed-shrine`, `twin-altars`, or `sacrificial-circle`) — appears only from a Boss kill, or from
  `blood-altar` once `altarPaymentsCount >= events.bloodDebtThreshold2` (8 payments). Full rationale
  and the `restrictedDropSources` mechanism this needs: `10-event-narrative.md` §F.4.

### Event-tied artifacts — mechanism implemented, 3 items still spec-only

Per request: some items should be tied to a specific event, especially the once-lifetime ones.
`still-breathing` stays `noArtifactReward: true` (a locked decision, `10-event-narrative.md` Part
C.4 — "the reveal is the reward, no mechanical effect of any kind").

**Mechanism — built**:

```ts
// EventDefinition, instantReward only
/** Grants this specific artifact instead of rolling from the standard table — for a scene whose
    reward is a specific object described in the text itself, not a generic loot beat. */
guaranteedArtifactId?: Id;
```

```ts
// src/engine/events/openChest.ts
if (!event.noArtifactReward) {
  const artifactId = event.guaranteedArtifactId ?? rollArtifact("treasureOrEvent", ctx.rng);
  grantArtifact(state, artifactId);
}
```

**Wired so far**: `waiting-supplies` → `travelers-ration` (an artifact that already exists in
`data/artifacts.json` — `10-event-narrative.md` Part A, addressing the "too many free common
rewards" finding). The 3 once-lifetime events below still roll the standard table — their dedicated
items are written here but not yet added to `data/artifacts.json`, and pointing
`guaranteedArtifactId` at an id that doesn't exist in the real catalog would throw at runtime. Wire
these once the 47-item catalog rewrite (this file, above) actually lands in `data/artifacts.json`:

- **Vigil Cloth** (`vigil-candle`'s guaranteed drop, Unique, `fearResist 15%`): "Folded before it
  was ever set down, the way you'd fold something you meant to come back for. It got folded the
  same exact way every night — until the night nobody came back to unfold it again."
- **Torn Lock-Plate** (`broken-seal`'s guaranteed drop, Unique, `dodgeChance 10%`): "The other half
  of what was stamped into the seal — the half torn away, not the half still in the lock. Read
  together, the two halves would complete the spiral. Nobody's ever held both."
- **Worn Chalk Stub** (`half-a-warning`'s guaranteed drop, Unique, `cooldownReduction 1 turn`):
  "Worn down to a nub, carving something into stone that should have taken half as long. Whatever
  hand held it needed to stay steady right up until it didn't."

**Remaining build**: `data/artifacts.json` (all 34 existing `description` fields rewritten in
place — no id/rarity/effect changes — plus 13 new entries: 10 category items + 3 event-tied above),
`data/events.json` (`guaranteedArtifactId` set on `vigil-candle`/`broken-seal`/`half-a-warning`
once their items exist). `test/` already covers the mechanism itself (`guaranteedArtifactId` always
grants that exact id, never a roll, via `waiting-supplies`); the 34+13 new/changed descriptions
don't need test coverage beyond the JSON parsing.

### `autoDamage` trigger mechanism

`autoDamage` triggers at the **start of every round** (before the player's command phase — the same round boundary that combat fear-gain also uses, `03-survival-stats.md`), picking 1 living monster **uniformly at random** (uniform, like the `erratic` pattern in `02-monster.md` section 2, not based on `aggro`) — no MP cost, doesn't go through `queueAction`, doesn't appear in the skill selection list. Logged as its own separate event line, distinct from any character's turn.

### Engine hooks for the Group 2-4 effects

None of the Group 2-4 effects exist in any form in the current skill/status system (`01-class-skill.md` section 1.5) — each one has its own dedicated hook in the engine:

- **`reflectDamage`**: after a monster successfully deals `damage` to the **exact character wearing this artifact** (not another party member), roll `percent`; if it hits, deal `percent × the damage just taken` back at that monster (doesn't go through the monster's `defense` — a reflect isn't a regular attack).
- **`poisonOnHit`**: after the **exact character wearing this artifact** successfully deals `damage` to a monster (any skill/basic attack of theirs, not just Poison Coat), roll `chance`; if it hits, `applyStatusEffect "poisoned"` on that monster — the same "on-hit rider" mechanic already used for Poison Coat (`docs/technical-decisions.md` §4.2), differing only in that the trigger source is an artifact instead of a temporary status. Another party member landing a hit does **not** trigger this effect unless they also have their own `poisonOnHit` artifact equipped.
- **`lifesteal`**: hooks into the exact spot where the resolver computes `finalDamage` for a `damage` effect dealt by the **exact character wearing this artifact** (`resolver.ts`) — after subtracting the target's hp, adds `round(finalDamage × percent)` to their own hp (capped at `maxHp`).
- **`dodgeChance`**: rolled **before** the `finalDamage` calculation step when a monster targets `damage` at the **exact character wearing this artifact** — on a hit, the entire effect is skipped (damage = 0, not just reduced), distinct from the existing fear-based accuracy roll (`04-fear-combat.md` section 4, which only applies to character skills targeting enemies, not monster attacks targeting characters). A monster targeting a different ally doesn't roll this dodge.
- **`healOnKill`**: hooks into the exact point where a monster is removed from `CombatState.combatants` (hp ≤ 0) — **only triggers if the finishing blow (the final `damage` effect that brought hp to ≤ 0) was dealt by the exact character wearing this artifact**, healing `amount` straight to themself (capped at `maxHp`, not applicable to other allies).
- **`expBoost`**: multiplies into the step where `applyPartyExp` receives `expGained` from `game.ts` (`06-level-system.md` §6.9) — `expGained = round(expGained × (1 + sum of percent across every expBoost artifact currently equipped by anyone in the party))`. This is the **only effect not restricted to the person who landed the kill** — `partyExp` is a single value shared by the whole party (§6.9).
- **`fearResist`**: multiplies into the **per-round combat fear-gain** of the **exact character wearing this artifact** (`fearGainForRound` — `03-survival-stats.md`) — via `actualFear = round(baseFear × (1 − sum of percent))`, doesn't apply to active fear reduction (Acolyte skill/item, unaffected, counted at full 100%) or victory relief. Allies not wearing this artifact still receive fear at full rate as usual.
- **`cooldownReduction`**: subtracted directly from the `cooldownTurns` assigned when 1 of the **exact character wearing this artifact**'s skills goes on cooldown (`Character.cooldownsRemaining[skillId] = skill.cooldownTurns − sum of turns`, minimum 0) — doesn't instantly refresh a skill already on cooldown from before the artifact was equipped, doesn't affect other allies' cooldowns.
- **`curseAggroBoost`**: added directly to `Character.aggro` in `recomputeCharacterStats` (`src/engine/party.ts`), on top of the class base + Exhausted multiplier — see §8.6.