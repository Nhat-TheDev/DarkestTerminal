# §7. Items & Artifacts

*(section 7 of `00-index.md`)*

Items (§7.1) and Artifacts (§7.2) are 2 separate reward systems, see `src/engine/artifacts.ts`, `src/data/items.ts`, `src/data/artifacts.ts`.

**Naming convention**: every `id`/`name` for Items, Artifacts, and the status effects serving these 2 systems is in **English** — matching the naming convention of monsters/classes in `data/monsters.json`/`data/classes.json`.

The 2 concepts are kept clearly separate, not sharing 1 system:

| | Item | Artifact |
|---|---|---|
| Nature | Consumable — used once, then gone | Permanent relic for 1 run — once picked up, kept until permadeath |
| Effect | Instant, active (player chooses when to use it) | Passive, continuous for the whole run (no "use" needed) |
| Used in combat? | Yes — replaces choosing a skill during the command phase | No — adds straight to stats/behavior, doesn't consume a turn |
| Lost when | Used up (decrements 1 from inventory) | Party wipe (permadeath, `05-character-stats.md` section 5) |
| Rarity | No rarity tiers — only differs by effect type | **4 tiers**: Common / Rare / Unique / Epic |

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

Drops randomly when killing **any monster** (regular/Elite/Boss) — **60% chance per kill**. Doesn't drop from Treasure/Event rooms (those 2 rooms are reserved for Artifacts — section 7.2, also see `08-events.md`).

When the 60% roll succeeds, the specific item is chosen from a **combined pool** = the 10 common items (catalog below) + the item(s) specific to the exact `archetypeId` just killed (the "monster-specific items" table below), weighted as:

- **50%** of the total goes to that monster type's specific item(s). **1 monster can belong to multiple groups at once** (e.g. Zombie Knight belongs to both the Zombie group and the Knight/Warrior group) → if a monster has N applicable specific items, this 50% is **split evenly across the N** (N=1 → the full 50% for that item; N=2 → 25%/item). Every archetype in `data/monsters.json` already has at least 1 specific item (no fallback case).
- The remaining **50%** is split evenly across the 10 common-pool items (~5%/item)

Added directly to `GameState.inventory[itemId] += 1` as before, with no change to the in/out-of-combat item-use mechanics.

**Example**: a room with 3 monsters → each monster independently rolls 60% → up to 3 items can drop (no cap on stacking), averaging ~1.8 items per 3-monster room.

### Catalog — 10 items

| id | Name | Effect (`effects`) | Notes |
|---|---|---|---|
| `small-health-potion` | Small Health Potion | `heal 30` | |
| `large-health-potion` | Large Health Potion | `heal 70` | |
| `small-mana-potion` | Small Mana Potion | `restoreMp 20` | |
| `large-mana-potion` | Large Mana Potion | `restoreMp 45` | |
| `ration` | Ration | `modifyStat hunger +40` | Used outside combat, restores hunger |
| `water-flask` | Water Flask | `modifyStat thirst +40` | Used outside combat, restores thirst |
| `calming-draught` | Calming Draught | `modifyStat fear -25` | |
| `antidote` | Antidote | `removeStatusEffect` (clears any 1 debuff, no need to specify an id — same as Purify's ally branch, `01-class-skill.md` section 1.4) | |
| `whetstone` | Whetstone | `applyStatusEffect "empower"` (+6 attack, 2 turns — new status, see table below) | Temporary buff via item, doesn't consume another character's "use skill" turn in the round |
| `temporary-ward` | Temporary Ward | `applyStatusEffect "fortify"` (+8 defense, 2 turns — new status) | |

2 new statuses need to be added to `data/status-effects.json` for the last 2 buff items (same shape as the existing `rally`/`guard` in `01-class-skill.md` section 1.5, differing only in that the trigger source is an item instead of a skill — the `id` is in English since it's tied to an item, unlike the Vietnamese-language convention for statuses belonging to character skills):

| id | Name | `perTurnEffects` | Duration |
|---|---|---|---|
| `empower` | Empower | `modifyCombatStat attack +6` | 2 turns |
| `fortify` | Fortify | `modifyCombatStat defense +8` | 2 turns |

### Monster-specific items

9 items, assigned by **monster group by name/tag** (1 monster can belong to multiple groups — see the multi-group roll mechanic above). Reuses `effects: SkillEffect[]` and the existing resolver as much as possible; the last 2 items (`rotten-flesh`, `venom-thorn`) use new status effects, noted explicitly.

| id | Name | Assigned to `archetypeId` | Effect (`effects`) | Notes |
|---|---|---|---|---|
| `grave-dust` | Grave Dust | `skeleton`, `skeleton-archer`, `skeleton-guard` ("regular/guard skeleton" group, 3 archetypes) | `applyStatusEffect "fortify"` (+8 defense, 2 turns, self) | Bone dust hardens the user's flesh |
| `broken-blade-fragment` | Broken Blade Fragment | `skeleton-warrior`, `zombie-knight`, `dark-knight` ("armed warrior" group, 3 archetypes) | `applyStatusEffect "empower"` (+6 attack, 2 turns, self — reuses the existing status) | A still-sharp broken weapon fragment; the wielder learns a nastier strike |
| `rotten-flesh` | Rotten Flesh | `zombie`, `zombie-knight` ("undead" group, 2 archetypes) | `applyStatusEffect "distracted"` (`modifyCombatStat aggro -20`, 1 turn, self) | The rotten smell makes other monsters pay less attention to the carrier — temporarily lowers aggro |
| `venom-gland` | Venom Gland | `snake`, `lizard`, `spider` (small reptile/insect group, 3 archetypes) | `applyStatusEffect "poison-coat"` (self, 3 turns — reuses the exact status from the Rogue's "Poison Coat" skill, `01-class-skill.md` §1.4: every `damage` hit dealt while the buff is active automatically applies `poisoned` to the struck target) | Coats the weapon in venom, just like the assassin skill |
| `venom-thorn` | Venom Thorn | `giant-spider` (split off from the small-reptile group — representing "large creature") | `applyStatusEffect "poison-vulnerable"` targeting 1 enemy (new status, see notes) | The venomous thorn doesn't itself apply poison — it just doubles the poison damage the target takes if it is/becomes `poisoned` from another source (Venom Gland, Poison Coat, a Rogue skill, etc.) |
| `rat-meat` | Rat Meat | `dungeon-rat` | `applyStatusEffect "regeneration"` (new status: `heal 10`/turn, 3 turns, self, non-stacking — see notes) | Heals over time |
| `bat-blood` | Bat Blood | `black-bat` | `heal 20` (instant, self) | |
| `slime-solution` | Slime Solution | `slime` | `restoreMp 20` (instant, self) | |
| `dragon-scale` | Dragon Scale | `dragon` | `applyStatusEffect "fortify"` targeting **allAllies** (+8 defense, 2 turns, whole party — reuses the `fortify` status, following the same pattern as the Vanguard's Rally skill, `01-class-skill.md` §1.2) | `dragon` is `guardOnly` (only encountered as Elite/Boss). The only item that targets `allAllies` instead of self |

**3 new status effects need to be added to `data/status-effects.json`** (in addition to the already-existing `empower`/`fortify`/`poison-coat`/`poisoned`):

| id | Name | `perTurnEffects` | Duration | New behavior notes |
|---|---|---|---|---|
| `distracted` | Distracted | `modifyCombatStat aggro -20` | 1 turn | Uses the existing `modifyCombatStat` on the `aggro` field — a negative value instead of positive like `taunt` |
| `regeneration` | Regeneration | `heal 10` | 3 turns | **Non-stacking**: reapplying while already active just refreshes the duration back to 3, without adding a new instance — this is already the default behavior of `applyStatusEffectToActor`, no separate code needed |
| `poison-vulnerable` | Poison Vulnerable | *(none, amplifies only)* | 2 turns | Uses the `vulnerableTo?: { statusEffectId: Id; multiplier: number }` field on `StatusEffectDefinition` — an actor carrying this status has every `poisoned` damage tick on them multiplied by `multiplier` (2.0 = double, base 4 HP/turn → 8 HP/turn). Doesn't apply `poisoned` itself — only amplifies it if already/later applied from another source |

---

## 7.2 Artifacts (permanent relics for the run)

### Equipment — an Artifact is attached to 1 specific character, not the whole party

An Artifact is **equipment**. Once picked up → it goes into a shared unequipped pool (`GameState.unequippedArtifactIds: Id[]`) → the player **actively attaches** it to any character outside combat (same party-management screen, "Expedition Roster" panel — cannot be changed while combat is in progress, to avoid loadout shuffling mid-fight).

```
Character.equippedArtifactIds: Id[]   // max 3, new field on Character
GameState.unequippedArtifactIds: Id[] // shared pool, artifacts picked up but not yet equipped on anyone
```

- **Max 3 Artifacts per character** — 4 characters × 3 slots = **12 equip slots** total for the party per run.
- Attaching/detaching is **free, unlimited, no cost** — an artifact isn't "consumed" when detached, it just goes back into the shared pool and can be attached to a different character at any time (outside combat).
- Picking up more than 12 (total party slots) → the surplus sits in the shared pool, still owned but **inactive** until equipped (replacing another currently equipped artifact).
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
  | { kind: "survivalDrainReduction"; percent: number } // reduces % of the per-action hunger/thirst drain rate for the EXACT equipping character (`03-survival-stats.md` section 3: base -1 hunger/-1.5 thirst, already per-character)

ArtifactDefinition {
  id: Id
  name: string
  description: string
  rarity: ArtifactRarity
  effects: ArtifactEffect[]   // usually just 1, epic ones may combine several
}
```

**Stacking on duplicates**: if 1 character equips 2 artifacts of the same type (taking up 2/3 of their slots) → the effect stacks directly for that person alone (2× `statBoost`, 2 independent rolls for `poisonOnHit`/`dodgeChance`/etc.). If 2 different characters each equip 1 of the same artifact type, **each is computed independently** per person, with no shared stacking.

**Who it applies to**: `statBoost` adds directly to the stats of the **exact equipping character** (not multiplied by `growthWeights`). All Group 2-4 effects likewise only count for the exact equipping character (except `expBoost` — the exception, since EXP is the shared `partyExp`, noted right in the effect block above) — computed at the `Character` level (field `equippedArtifactIds`).

### Drop source

4 sources, non-exclusive (unlike Elite/Boss in `02-monster.md` section 2, where those 2 types are mutually exclusive per floor):

| Source | Drop chance for 1 Artifact | Notes |
|---|---|---|
| Killing an **Elite** (floor's final room, not Boss) | **100%** | Rarity rolled from the separate "Elite" table below — never Epic |
| Killing a **real Boss** (every 5 floors, `06-level-system.md` §6.11) | **100%** | Rarity rolled from the separate "Boss" table below — never Common/Rare |
| **Treasure room** | **100%** (guaranteed, when visited) | `RoomType "treasure"` exists in the code but the floor generator currently doesn't spawn this room type (only spawns Event rooms at the branch stage) — in practice, never encountered in-game |
| **Event room** | **100%** (guaranteed, when visited) | See `08-events.md` §8 for the 11 specific event types. Rarity uses the "Treasure/Event" table below |

**Regular monsters** (non-Elite/Boss) **don't** drop Artifacts — only Items (section 7.1). The 2 sources stay separate: regular/Elite/Boss monsters can all drop Items, but only Elite/Boss/the 2 room types drop Artifacts.

### Rarity & drop rate per tier

**Elite and Boss have entirely separate rarity tables** (not just different weights):

**Elite** — only rolls {Common, Rare, Unique}, **never Epic**:

| Rarity | Drop weight |
|---|---|
| Common | **55%** |
| Rare | **35%** |
| Unique | **10%** |
| Epic | **0%** (impossible) |

**Boss** — only rolls {Unique, Epic}, **never Common/Rare**:

| Rarity | Drop weight |
|---|---|
| Common | **0%** (impossible) |
| Rare | **0%** (impossible) |
| Unique | **65%** |
| Epic | **35%** |

**Treasure room / Event room** — keep the original table, sitting between Elite and Boss in average quality:

| Rarity | Drop weight | Count in catalog | Effect characteristics |
|---|---|---|---|
| Common | **50%** | 10 | 1 small `statBoost`, or 1 lightest-tier distinctive/system effect |
| Rare | **30%** | 9 | 1 larger `statBoost`, or 1 light-tier distinctive/system effect |
| Unique | **15%** | 7 | Clearly-felt distinctive/system effect, or `autoDamage`, or multi-stat `statBoost` |
| Epic | **5%** | 4 | Combines ≥2 effects, the strongest in the catalog |

### Catalog — 30 Artifacts

**Common (10)**:

| id | Name | Effect |
|---|---|---|
| `iron-gauntlet` | Iron Gauntlet | `statBoost attack +3` |
| `worn-wooden-shield` | Worn Wooden Shield | `statBoost defense +3` |
| `charm-of-life` | Charm of Life | `statBoost maxHp +20` |
| `small-mana-gem` | Small Mana Gem | `statBoost maxMp +10` |
| `sharp-claw` | Sharp Claw | `statBoost attack +4` |
| `stone-of-endurance` | Stone of Endurance | `statBoost maxHp +30` |
| `ring-of-focus` | Ring of Focus | `statBoost maxMp +15` |
| `warriors-necklace` | Warrior's Necklace | `statBoost defense +5` |
| `pendant-of-calm` | Pendant of Calm | `fearResist 10%` |
| `travelers-ration` | Traveler's Ration | `survivalDrainReduction 15%` |

**Rare (9)** — clearly bigger `statBoost` than Common, or a light-tier distinctive/system effect:

| id | Name | Effect |
|---|---|---|
| `ancient-sword` | Ancient Sword | `statBoost attack +8` |
| `heart-of-stone` | Heart of Stone | `statBoost defense +8` |
| `eternal-vial` | Eternal Vial | `statBoost maxHp +50` |
| `arcane-core` | Arcane Core | `statBoost maxMp +25` |
| `thorned-armor` | Thorned Armor | `reflectDamage 5%` |
| `venomous-dagger-relic` | Venomous Dagger (Relic) | `poisonOnHit 6%` |
| `vampiric-fang` | Vampiric Fang | `lifesteal 5%` |
| `featherweight-boots` | Featherweight Boots | `dodgeChance 6%` |
| `quickcharge-rune` | Quickcharge Rune | `cooldownReduction 1` |

**Unique (7)** — clearly-felt distinctive/system effect, or `autoDamage`, or multi-stat:

| id | Name | Effect |
|---|---|---|
| `spiked-cloak` | Spiked Cloak | `reflectDamage 10%` |
| `serpent-ring` | Serpent Ring | `poisonOnHit 12%` |
| `thunder-totem` | Thunder Totem | `autoDamage 6` (every round, 1 random monster) |
| `armor-of-wholeness` | Armor of Wholeness | `statBoost attack +6` + `statBoost defense +6` + `statBoost maxHp +40` |
| `bloodthirsty-blade` | Bloodthirsty Blade | `lifesteal 10%` |
| `phantom-step` | Phantom Step | `dodgeChance 12%` |
| `scholars-insight` | Scholar's Insight | `expBoost 15%` |

**Epic (4)** — combines multiple effects, the strongest in the catalog:

| id | Name | Effect |
|---|---|---|
| `crown-of-destruction` | Crown of Destruction | `autoDamage 12` + `poisonOnHit 8%` |
| `immortal-heart` | Immortal Heart | `reflectDamage 15%` + `statBoost defense +10` + `statBoost maxHp +60` |
| `reapers-covenant` | Reaper's Covenant | `healOnKill 25` + `lifesteal 8%` |
| `eternal-scholars-tome` | Eternal Scholar's Tome | `expBoost 25%` + `cooldownReduction 1` |

### `autoDamage` trigger mechanism

`autoDamage` triggers at the **start of every round** (before the player's command phase — the same round boundary that combat fear-gain also uses, `03-survival-stats.md` section 3), picking 1 living monster **uniformly at random** (uniform, like the `erratic` pattern in `02-monster.md` section 2, not based on `aggro`) — no MP cost, doesn't go through `queueAction`, doesn't appear in the skill selection list. Logged as its own separate event line, distinct from any character's turn.

### Engine hooks for the 9 Group 2-4 effects

None of the Group 2-4 effects exist in any form in the current skill/status system (`01-class-skill.md` section 1.5) — each one has its own dedicated hook in the engine:

- **`reflectDamage`**: after a monster successfully deals `damage` to the **exact character wearing this artifact** (not another party member), roll `percent`; if it hits, deal `percent × the damage just taken` back at that monster (doesn't go through the monster's `defense` — a reflect isn't a regular attack).
- **`poisonOnHit`**: after the **exact character wearing this artifact** successfully deals `damage` to a monster (any skill/basic attack of theirs, not just Poison Coat), roll `chance`; if it hits, `applyStatusEffect "poisoned"` on that monster — the same "on-hit rider" mechanic already used for Poison Coat (`docs/technical-decisions.md` §4.2), differing only in that the trigger source is an artifact instead of a temporary status. Another party member landing a hit does **not** trigger this effect unless they also have their own `poisonOnHit` artifact equipped.
- **`lifesteal`**: hooks into the exact spot where the resolver computes `finalDamage` for a `damage` effect dealt by the **exact character wearing this artifact** (`resolver.ts`) — after subtracting the target's hp, adds `round(finalDamage × percent)` to their own hp (capped at `maxHp`).
- **`dodgeChance`**: rolled **before** the `finalDamage` calculation step when a monster targets `damage` at the **exact character wearing this artifact** — on a hit, the entire effect is skipped (damage = 0, not just reduced), distinct from the existing fear-based accuracy roll (`04-fear-combat.md` section 4, which only applies to character skills targeting enemies, not monster attacks targeting characters). A monster targeting a different ally doesn't roll this dodge.
- **`healOnKill`**: hooks into the exact point where a monster is removed from `CombatState.combatants` (hp ≤ 0) — **only triggers if the finishing blow (the final `damage` effect that brought hp to ≤ 0) was dealt by the exact character wearing this artifact**, healing `amount` straight to themself (capped at `maxHp`, not applicable to other allies).
- **`expBoost`**: multiplies into the step where `applyPartyExp` receives `expGained` from `game.ts` (`06-level-system.md` §6.9) — `expGained = round(expGained × (1 + sum of percent across every expBoost artifact currently equipped by anyone in the party))`. This is the **only effect not restricted to the person who landed the kill** — `partyExp` is a single value shared by the whole party (§6.9).
- **`fearResist`**: multiplies into the **per-round combat fear-gain** of the **exact character wearing this artifact** (`fearGainForRound` — `03-survival-stats.md` section 3) — via `actualFear = round(baseFear × (1 − sum of percent))`, doesn't apply to active fear reduction (Acolyte skill/item, unaffected, counted at full 100%) or victory relief. Allies not wearing this artifact still receive fear at full rate as usual.
- **`cooldownReduction`**: subtracted directly from the `cooldownTurns` assigned when 1 of the **exact character wearing this artifact**'s skills goes on cooldown (`Character.cooldownsRemaining[skillId] = skill.cooldownTurns − sum of turns`, minimum 0) — doesn't instantly refresh a skill already on cooldown from before the artifact was equipped, doesn't affect other allies' cooldowns.
- **`survivalDrainReduction`**: multiplies into the base per-action drain rate of the **exact character wearing this artifact** (`03-survival-stats.md` section 3: `hunger -1`, `thirst -1.5`, already tracked separately per `Character.survival`) — `actualDrain = round(baseDrain × (1 − sum of percent), rounded to 1 decimal place)`.
