# §7. Items & Artifacts

*(section 7 of `00-index.md`)*

Items (§7.1) and Artifacts (§7.2) are 2 separate reward systems, see `src/engine/artifacts.ts`, `src/data/items.ts`, `src/data/artifacts.ts`.

**Source of truth for every number below**: catalogs live in `data/items.json`/`data/artifacts.json`; drop rates live in `data/balance-config.json` field `items`/`events`, or as named constants in `src/data/items.ts`/`src/data/artifacts.ts` when not JSON-configurable (called out per section below). This document describes the mechanics and data *shape* — not the current catalog contents or rates.

**Naming convention**: every `id`/`name` for Items, Artifacts, and the status effects serving these 2 systems is in **English** — matching the naming convention of monsters/classes in `data/monsters.json`/`data/classes.json`.

The 2 concepts are kept clearly separate, not sharing 1 system:

| | Item | Artifact |
|---|---|---|
| Nature | Consumable — used once, then gone | Permanent relic for 1 run — once picked up, kept until permadeath |
| Effect | Instant, active (player chooses when to use it) | Passive, continuous for the whole run (no "use" needed) |
| Used in combat? | Yes — replaces choosing a skill during the command phase | No — adds straight to stats/behavior, doesn't consume a turn |
| Lost when | Used up (decrements 1 from inventory) | Party wipe (permadeath, `05-character-stats.md` section 5) |
| Rarity | No rarity tiers — only differs by effect type | Multiple tiers: Common / Rare / Unique / Epic (`ArtifactRarity`, `src/types.ts`) |

---

## 7.1 Items (consumables)

### Data structure

Reuses the existing `ItemDefinition` sketch already present in `../../dungeon-crawler-data-model.ts` section 1.6, simplified for the current scope (consumables only — no `equipment`/`keyItem`, see `01-class-skill.md` section 1.5 "Design notes" last bullet, where `usesPerCombat` is reserved for items):

```
ItemDefinition {
  id: Id
  name: string
  description: string
  effects: SkillEffect[]   // reuses the exact same existing resolver — no new effect kind needed for items
}
```

Used in combat: during the command phase, a character chooses "use item" instead of a skill — 1 count is subtracted from `GameState.inventory[itemId]`, and `effects` are applied through the exact same existing `resolveSkillEffect` (0 changes to `resolver.ts`). Can also be used outside combat (e.g. restoring hunger/thirst while walking the dungeon loop, no need to wait for combat).

### Drop source

Drops randomly when killing **any monster** (regular/Elite/Boss), gated by `data/balance-config.json` field `items.itemDropChance` (`ITEM_DROP_CHANCE`, `src/data/items.ts`). Doesn't drop from Treasure/Event rooms (those 2 rooms are reserved for Artifacts — section 7.2, also see `08-events.md`).

When the drop roll succeeds (gated by `items.itemDropChance`, `data/balance-config.json`), the specific item is chosen from a **combined pool** = the common-item catalog (below) + the item(s) specific to the exact `archetypeId` just killed (the "monster-specific items" table below). The pool splits into 2 groups, **not an even split within each group** — `ItemDefinition.weight` (`data/items.json`, default `1` when unset) weights each item inside its group (`rollItemDrop`, `src/data/items.ts`):

- One share of the total goes to that monster type's specific item(s), split proportionally to `weight` across the applicable items (not evenly). **1 monster can belong to multiple groups at once** (e.g. Zombie Knight belongs to both the Zombie group and the Knight/Warrior group). Every archetype in `data/monsters.json` already has at least 1 specific item (no fallback case).
- The remaining share is split proportionally to `weight` across the common-pool items — **not evenly**. Some common items carry a `weight` below the default `1` (`data/items.json`) — those get a smaller share at low floor depth than the unweighted ones.
- **Weight scales up with floor depth**: any item with `weight < 1` grows via `effectiveWeight = min(1, weight + itemWeightDepthGrowth × (floorDepth − 1))` (`items.itemWeightDepthGrowth`, `data/balance-config.json`). Once a half-weighted item's `effectiveWeight` reaches `1`, the split among the common items becomes even — the skew described above is specific to early floors. The same growth applies to weighted monster-specific items. Read `data/items.json`/`data/balance-config.json` directly for the current split rather than trusting a hand-copied percentage here, since it drifts the moment weights are retuned.

Added directly to `GameState.inventory[itemId] += 1` as before, with no change to the in/out-of-combat item-use mechanics. A room with multiple monsters rolls the drop independently per monster (no cap on stacking).

### Catalog — common items

Full list (id, name, effect, notes): `data/items.json`, filtered to entries without an `archetypeIds` restriction. As of writing this covers healing/mana potions in two sizes, hunger/thirst restoratives (`Ration`/`Water Flask`), a fear-calming item, a debuff-cure (`Antidote`), and 2 temporary-buff items (`Whetstone`/`Temporary Ward`) that apply new statuses — check `data/status-effects.json` for any status introduced solely for an item (same shape as skill-granted buffs, differing only in trigger source).

### Monster-specific items

Assigned by **monster group by name/tag** (1 monster can belong to multiple groups — see the multi-group roll mechanic above). Full list: `data/items.json`, filtered to entries with a non-empty `archetypeIds`. Reuses `effects: SkillEffect[]` and the existing resolver as much as possible; a few entries introduce new status effects (check `data/status-effects.json` for any status referenced by an item that doesn't already exist from the skill kits).

---

## 7.2 Artifacts (permanent relics for the run)

### Equipment — an Artifact is attached to 1 specific character, not the whole party

An Artifact is **equipment**. Once picked up → it goes into a shared unequipped pool (`GameState.unequippedArtifactIds: Id[]`) → the player **actively attaches** it to any character outside combat (same party-management screen, "Expedition Roster" panel — cannot be changed while combat is in progress, to avoid loadout shuffling mid-fight).

```
Character.equippedArtifactIds: Id[]   // capped per data/balance-config.json field party.maxEquippedArtifacts
GameState.unequippedArtifactIds: Id[] // shared pool, artifacts picked up but not yet equipped on anyone
```

- **Capped Artifacts per character** (`party.maxEquippedArtifacts`, `data/balance-config.json`) — multiplied by the party size (`PARTY_SIZE`, `src/ui/characterSelect.ts`) gives the total equip-slot budget for a run.
- Attaching/detaching is **free, unlimited, no cost** — an artifact isn't "consumed" when detached, it just goes back into the shared pool and can be attached to a different character at any time (outside combat).
- Picking up more artifacts than there are total party slots → the surplus sits in the shared pool, still owned but **inactive** until equipped (replacing another currently equipped artifact).
- **Effects only apply to the exact character wearing it** (except `expBoost`, an exception because EXP is shared — see the "Why" table below).

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

  // Group 4 — affects out-of-combat systems (survival/cooldown are already per-character; EXP is the exception since partyExp is shared)
  | { kind: "expBoost"; percent: number }         // adds % to the expReward of EVERY kill while this artifact is equipped by anyone (EXP is the shared `partyExp` — §6.9 — so this is the sole exception not restricted to a single person)
  | { kind: "fearResist"; percent: number }       // reduces % of every fear-gain source for the EXACT equipping character (`Character.survival.fear` is already per-character — `03-survival-stats.md` section 3), doesn't apply to active fear reduction
  | { kind: "cooldownReduction"; turns: number }  // reduces the `cooldownTurns` of the EXACT equipping character's skills directly (minimum 0) — `Character.cooldownsRemaining` is already per-character
  | { kind: "survivalDrainReduction"; percent: number } // reduces % of the per-action hunger/thirst drain rate for the EXACT equipping character (`03-survival-stats.md` section 3), already per-character

ArtifactDefinition {
  id: Id
  name: string
  description: string
  rarity: ArtifactRarity
  effects: ArtifactEffect[]   // usually just 1, epic ones may combine several
}
```

**Stacking on duplicates**: if 1 character equips 2 artifacts of the same type (taking up 2 of their slots) → the effect stacks directly for that person alone (2× `statBoost`, 2 independent rolls for `poisonOnHit`/`dodgeChance`/etc.). If 2 different characters each equip 1 of the same artifact type, **each is computed independently** per person, with no shared stacking.

**Who it applies to**: `statBoost` adds directly to the stats of the **exact equipping character** (not multiplied by `growthWeights`). All Group 2-4 effects likewise only count for the exact equipping character (except `expBoost` — the exception, since EXP is the shared `partyExp`, noted right in the effect block above) — computed at the `Character` level (field `equippedArtifactIds`).

### Drop source

4 sources, non-exclusive (unlike Elite/Boss in `02-monster.md` section 2, where those 2 types are mutually exclusive per floor):

| Source | Drop chance for 1 Artifact | Notes |
|---|---|---|
| Killing an **Elite** (floor's final room, not Boss) | Guaranteed | Rarity rolled from the `elite` weights in `RARITY_WEIGHTS` (`src/data/artifacts.ts`) — never Epic |
| Killing a **real Boss** (every `bossFloorInterval` floors, `06-level-system.md` §6.11) | Guaranteed | Rarity rolled from the `boss` weights in `RARITY_WEIGHTS` — never Common/Rare |
| **Treasure room** | Guaranteed, when visited | `RoomType "treasure"` exists in the code but the floor generator currently doesn't spawn this room type (only spawns Event rooms at the branch stage) — in practice, never encountered in-game |
| **Event room** | Guaranteed, when visited | See `08-events.md` §8 for the specific event types (`data/events.json`). Rarity uses the `treasureOrEvent` weights in `RARITY_WEIGHTS` |

**Regular monsters** (non-Elite/Boss) **don't** drop Artifacts — only Items (section 7.1). The 2 sources stay separate: regular/Elite/Boss monsters can all drop Items, but only Elite/Boss/the 2 room types drop Artifacts.

### Rarity & drop rate per tier

**Elite and Boss have entirely separate rarity tables** (not just different weights), both defined in `RARITY_WEIGHTS` (`src/data/artifacts.ts`, not JSON — this is a code-level constant):

- **Elite** — only rolls {Common, Rare, Unique}, **never Epic**.
- **Boss** — only rolls {Unique, Epic}, **never Common/Rare**.
- **Treasure room / Event room** — a 3rd weight table (`treasureOrEvent`), sitting between Elite and Boss in average quality, rolling all 4 rarities.

Exact weights for all 3 tables: `RARITY_WEIGHTS` in `src/data/artifacts.ts`. Catalog size per rarity: `data/artifacts.json`, grouped by `rarity`.

### Catalog

Full list (id, name, rarity, effects): `data/artifacts.json`. Loosely, higher rarities carry a bigger `statBoost`, a more distinctive Group 2/3 effect, or (Epic only) a combination of several effects — but treat the JSON as authoritative rather than this description.

### `autoDamage` trigger mechanism

`autoDamage` triggers at the **start of every round** (before the player's command phase — the same round boundary that combat fear-gain also uses, `03-survival-stats.md` section 3), picking 1 living monster **uniformly at random** (uniform, like the `erratic` pattern in `02-monster.md` section 2, not based on `aggro`) — no MP cost, doesn't go through `queueAction`, doesn't appear in the skill selection list. Logged as its own separate event line, distinct from any character's turn.

### Engine hooks for the Group 2-4 effects

None of the Group 2-4 effects exist in any form in the current skill/status system (`01-class-skill.md` section 1.5) — each one has its own dedicated hook in the engine:

- **`reflectDamage`**: after a monster successfully deals `damage` to the **exact character wearing this artifact** (not another party member), roll `percent`; if it hits, deal `percent × the damage just taken` back at that monster (doesn't go through the monster's `defense` — a reflect isn't a regular attack).
- **`poisonOnHit`**: after the **exact character wearing this artifact** successfully deals `damage` to a monster (any skill/basic attack of theirs, not just Poison Coat), roll `chance`; if it hits, `applyStatusEffect "poisoned"` on that monster — the same "on-hit rider" mechanic already used for Poison Coat (`docs/technical-decisions.md` §4.2), differing only in that the trigger source is an artifact instead of a temporary status. Another party member landing a hit does **not** trigger this effect unless they also have their own `poisonOnHit` artifact equipped.
- **`lifesteal`**: hooks into the exact spot where the resolver computes `finalDamage` for a `damage` effect dealt by the **exact character wearing this artifact** (`resolver.ts`) — after subtracting the target's hp, adds `round(finalDamage × percent)` to their own hp (capped at `maxHp`).
- **`dodgeChance`**: rolled **before** the `finalDamage` calculation step when a monster targets `damage` at the **exact character wearing this artifact** — on a hit, the entire effect is skipped (damage = 0, not just reduced), distinct from the existing fear-based accuracy roll (`04-fear-combat.md` section 4, which only applies to character skills targeting enemies, not monster attacks targeting characters). A monster targeting a different ally doesn't roll this dodge.
- **`healOnKill`**: hooks into the exact point where a monster is removed from `CombatState.combatants` (hp ≤ 0) — **only triggers if the finishing blow (the final `damage` effect that brought hp to ≤ 0) was dealt by the exact character wearing this artifact**, healing `amount` straight to themself (capped at `maxHp`, not applicable to other allies).
- **`expBoost`**: multiplies into the step where `applyPartyExp` receives `expGained` from `game.ts` (`06-level-system.md` §6.9) — `expGained = round(expGained × (1 + sum of percent across every expBoost artifact currently equipped by anyone in the party))`. This is the **only effect not restricted to the person who landed the kill** — `partyExp` is a single value shared by the whole party (§6.9).
- **`fearResist`**: multiplies into the **per-round combat fear-gain** of the **exact character wearing this artifact** (`fearGainForRound` — `03-survival-stats.md` section 3) — via `actualFear = round(baseFear × (1 − sum of percent))`, doesn't apply to active fear reduction (Acolyte skill/item, unaffected, counted at full 100%) or victory relief. Allies not wearing this artifact still receive fear at full rate as usual.
- **`cooldownReduction`**: subtracted directly from the `cooldownTurns` assigned when 1 of the **exact character wearing this artifact**'s skills goes on cooldown (`Character.cooldownsRemaining[skillId] = skill.cooldownTurns − sum of turns`, minimum 0) — doesn't instantly refresh a skill already on cooldown from before the artifact was equipped, doesn't affect other allies' cooldowns.
- **`survivalDrainReduction`**: multiplies into the base per-action drain rate of the **exact character wearing this artifact** (`03-survival-stats.md` section 3: `hungerDrainPerAction`/`thirstDrainPerAction`, already tracked separately per `Character.survival`) — `actualDrain = round(baseDrain × (1 − sum of percent), rounded to 1 decimal place)`.
