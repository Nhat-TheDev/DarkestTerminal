# §11. Abilities (meta-progression)

*(section 11 of `00-index.md`)*

**Status**: design spec, not yet implemented. Written the way
`07-items-artifacts.md` documents Items/Artifacts, but since the catalog
doesn't exist in code yet, this document is itself the source of truth for
the catalog content (unlike `07`, which defers straight to
`data/artifacts.json`) — once `data/abilities.json` exists, that file
becomes authoritative and this document should stop being copied from,
same as `07` already does for Items/Artifacts.

Full mechanic decision trail (rejected alternatives, rationale for every
number below): `.hermes/features/abilities/BRAINSTORM.md`.

What an Ability is, vs. an Item, vs. an Artifact:

| | Item | Artifact | **Ability** |
|---|---|---|---|
| Nature | Consumable | Permanent relic for 1 run | **Permanent talent, persists *across* runs** |
| Slots | Inventory count | Up to 3 per character | **Exactly 1 per character, no more** |
| When chosen | On pickup, used freely | On pickup, immediate equip/discard | **Before the run starts**, at character select |
| Where it "lives" | `GameState.inventory` | `Character.equippedArtifactIds` | **A persistent profile file, outside any single run's save** |
| Lost when | Used up | Party wipe (with the run) | **Never during a run** — only has a *chance* to be struck from the persistent profile *after* a wipe, and only if non-common |
| Rarity | None | Common/Rare/Unique/Epic | **Common/Rare/Unique/Epic** (reuses `ArtifactRarity`) |

Abilities are the game's first mechanic with state that outlives a single
run. Everything else in the game (`SaveFile`, `src/engine/save.ts`) is
destroyed on permadeath (`deleteSavesForRun`) — the persistent ability
profile is deliberately the one exception.

---

## 11.1 Mechanics

### Data structure

Reuses `ArtifactRarity` (`src/types.ts`) as-is, no forked rarity type.
Reuses the exact `ArtifactEffect` union (`src/types.ts`) minus
`curseAggroBoost`, which stays exclusive to cursed Artifacts — Abilities
are never cursed.

```
AbilityEffect = Exclude<ArtifactEffect, { kind: "curseAggroBoost" }>

AbilityDefinition {
  id: Id
  name: string
  description: string
  rarity: ArtifactRarity
  effects: AbilityEffect[]   // usually 1, epic abilities combine 2
}
```

`Character.equippedAbilityId?: Id | null` — set once at character select,
fixed for the entire run (no mid-run swapping, no respec). Effects apply
through the exact same engine hooks Artifacts already use
(`07-items-artifacts.md` §7.2 "Engine hooks for the Group 2-4 effects") —
those hooks generalize from "scan `equippedArtifactIds`" to "scan
`equippedArtifactIds` + the 1 `equippedAbilityId`," nothing about the
hooks' actual logic changes.

### The persistent profile

New file, sibling to per-run saves in the same directory
(`resolveSaveDir()`, `src/engine/save.ts`) — **`profile.json`**:

```
AbilityProfile {
  version: number
  unlockedAbilityIds: Id[]   // non-common abilities earned across past runs
}
```

- Every `common`-rarity ability in the catalog is **always** selectable —
  it never needs to appear in `unlockedAbilityIds`.
- A `rare`/`unique`/`epic` ability is only selectable at character select
  once its id is in `unlockedAbilityIds`.
- This file is **never** touched by `deleteSavesForRun` — it's the one
  piece of state a permadeath wipe must not destroy.
- A fresh install has no `profile.json` → treated as `{ version: 1,
  unlockedAbilityIds: [] }` (only commons available), exactly matching
  "Ban đầu người chơi chỉ nhận đc common."

### Character-select flow

Runs once, right after class selection and before the run's first floor
generates (between `showCharacterSelect` resolving and `Game`'s
constructor finishing, `src/ui/characterSelect.ts` /
`src/engine/game.ts`). For each of the 4 chosen characters, in party
order:

1. List every `common` ability, plus every non-common ability currently in
   `unlockedAbilityIds` — tagged with its rarity.
2. Player picks exactly 1 (number key), or explicitly skips (dedicated
   key, `0`) — a character can enter the run with no ability equipped.
3. The same ability id **can** be picked by more than 1 character in the
   party at once — no exclusivity lock between party members.

Result stored on each `Character.equippedAbilityId` before the floor
generator runs.

### Mid-run acquisition (Elite/Boss only)

Exactly the same trigger point as the guaranteed Artifact drop
(`07-items-artifacts.md` §7.2 "Drop source" — `src/engine/game.ts`, the
per-monster loop on room-clear, `monster.tier === "elite" || "boss"`), but
as a **separate, independent, non-guaranteed** roll — killing an
Elite/Boss can grant an Artifact *and* an Ability on the same kill, or
just the Artifact, never neither's roll being skipped.

- **Drop chance**: `abilities.dropChance = 0.35` (35%) per eligible kill —
  deliberately below `items.itemDropChance` (0.6) since an Ability
  affects the permanent profile, a much higher-stakes reward than a
  consumable.
- **Not an immediate decision** (unlike Artifacts' reveal→equip/discard
  flow) — the rolled ability id is silently appended to
  `GameState.runAbilityPool: Id[]` for this run. Duplicates are allowed:
  rolling an ability a character already has equipped is meaningful (see
  "Reconfirm / insurance" below).
- **Rarity depends on both source (Elite vs. Boss) and current floor
  depth** — "the deeper you are, the better the ability," implemented as
  a linear interpolation between a depth-1 table and a depth-cap table
  (mirrors how `items.itemWeightDepthGrowth` already scales item weights
  by depth, just applied per-rarity instead of per-item):

```
// data/balance-config.json, new "abilities" block
"abilities": {
  "dropChance": 0.35,
  "depthCap": 30,
  "rarityWeightsByDepth": {
    "elite": {
      "atDepth1":   { "common": 60, "rare": 30, "unique": 10, "epic": 0 },
      "atDepthCap": { "common": 20, "rare": 35, "unique": 35, "epic": 10 }
    },
    "boss": {
      "atDepth1":   { "common": 0, "rare": 30, "unique": 55, "epic": 15 },
      "atDepthCap": { "common": 0, "rare": 5,  "unique": 45, "epic": 50 }
    }
  },
  "depthPerConfirmSlot": 5,
  "maxConfirmSlots": 6,
  "lossChance": { "rare": 0.25, "unique": 0.45, "epic": 0.65 }
}
```

For a rarity `r` at depth `d` (clamped to `[1, depthCap]`):
`weight(r, d) = atDepth1[r] + (atDepthCap[r] − atDepth1[r]) × (d − 1) / (depthCap − 1)`,
then fed into the same `rng.weightedPick` pattern `rollArtifactRarity`
already uses (`src/data/artifacts.ts`), filtering zero-weight entries
first. Identical shape to the existing Artifact `RARITY_WEIGHTS` table:
Elite skews common/rare, Boss never rolls common and skews unique/epic.

### Death flow (the only end-state — no "victory" exists in the game today)

Hooks into the sole place `gameOver` becomes `"defeat"`
(`Game.postMoveCheck()`, `src/engine/game.ts`), before
`App.syncUiToGameState()` triggers `deleteSavesForRun`:

1. **Score** = `state.floor.depth` reached at death (not kills, not time —
   matches the game's existing "depth is your record" framing).
2. **Confirm slots**:
   `confirmSlots = min(maxConfirmSlots, floor(depthReached /
   depthPerConfirmSlot), dedupedRunAbilityPool.length)`.
3. **Confirm picker** (skipped entirely if `confirmSlots === 0` or the
   pool is empty) — player picks up to `confirmSlots` distinct ability
   ids out of `runAbilityPool` (deduplicated). Every id picked is merged
   into `AbilityProfile.unlockedAbilityIds` (no-op if already present —
   e.g. picking a `common` id does nothing, it was already always
   available).
4. **Loss roll** — for every character whose `equippedAbilityId` resolves
   to a non-`common` ability: roll `lossChance[rarity]` (Rare 25% / Unique
   45% / Epic 65%). On a hit, remove that ability id from
   `unlockedAbilityIds` — it can no longer be picked at character select
   in any future run until re-earned from scratch via mid-run acquisition.
5. **Reconfirm / insurance exception** (below) — skip step 4's roll
   entirely for a character if their equipped ability's id is among the
   ids the player just picked in step 3 this same death.
6. **Persist** — write the updated `AbilityProfile` to `profile.json`
   *before or independently of* `deleteSavesForRun`, so the per-run wipe
   never touches it.
7. **Results screen** — always shown after the confirm picker (or
   immediately, if there was no picker): "N abilities added to your pool"
   + one line per loss, e.g. "Vanguard's *Bloodletting* was lost."

### Reconfirm / insurance

If a character's currently-equipped ability (chosen at the *start* of
this run, from the persistent pool) gets rolled again this same run from
an Elite/Boss kill (duplicates in `runAbilityPool` are allowed on purpose
for this reason), the player can spend one of their death-time confirm
slots on that same id. Doing so exempts that character from the loss roll
entirely for this death — narratively, the character "relearned/
reaffirmed" the talent deep in the dungeon, so it's secure even if the
run ends badly. This is the only way to fully remove the death-time risk
from an equipped non-common ability; simply surviving with it equipped
and never re-rolling it leaves the loss roll live every time the party
wipes.

---

## 11.2 Catalog (design content — becomes `data/abilities.json`)

23 abilities: 8 Common (always available), 6 Rare, 5 Unique, 4 Epic.
Magnitudes are calibrated against `data/artifacts.json`'s values at the
same rarity (§7.2) wherever a same-rarity artifact with the same effect
kind exists — Abilities don't need a separate balance philosophy from
Artifacts, they differ in *slot count* (1 vs. 3) and *persistence risk*,
not in raw power-per-tier. A few effect kinds have no same-rarity artifact
to copy directly; those are called out inline below rather than silently
invented.

### Common — always selectable

| id | name | description | effect |
|---|---|---|---|
| `steady-hands` | Steady Hands | A talent for keeping every strike controlled, never wasted. | `statBoost attack +3` |
| `iron-skin` | Iron Skin | Years of taking hits without flinching have toughened the skin itself. | `statBoost defense +3` |
| `vital-spark` | Vital Spark | An unusually stubborn will to keep the body going past its limits. | `statBoost maxHp +20` |
| `deep-reserves` | Deep Reserves | A trained ability to hold more magic in reserve than most ever learn to. | `statBoost maxMp +10` |
| `battle-instinct` | Battle Instinct | Raw aggression channeled into every swing, honed through repetition. | `statBoost attack +4` |
| `unshaken-resolve` | Unshaken Resolve | A mind trained not to let the dark get the better of it. | `fearResist 10%` |
| `hardy-constitution` | Hardy Constitution | A body built to endure — sheer physical resilience, nothing magical about it. | `statBoost maxHp +30` |
| `focused-mind` | Focused Mind | A disciplined mind draws more from the same well of magic. | `statBoost maxMp +15` |

### Rare — must be unlocked

| id | name | description | effect |
|---|---|---|---|
| `predators-edge` | Predator's Edge | An instinct for finding the gap in an enemy's guard. | `statBoost attack +8` |
| `bulwark-stance` | Bulwark Stance | A stance drilled until it's second nature — nothing gets through easily. | `statBoost defense +8` |
| `second-wind` | Second Wind | The talent for finding one more reserve of strength when it matters most. | `statBoost maxHp +50` |
| `toxic-touch` | Toxic Touch | A trick learned from the dungeon's own venomous things — every hit carries a little of it now. | `poisonOnHit chance 6%` |
| `bloodletting` | Bloodletting | A brutal technique that turns every wound dealt into strength regained. | `lifesteal 5%` |
| `featherstep-training` | Featherstep Training | Years of drilling footwork most fighters never bother to learn. | `dodgeChance 6%` |

All 6 exactly mirror their Rare-tier artifact counterparts
(`ancient-sword`/`heart-of-stone`/`eternal-vial`, `venomous-dagger-relic`,
`vampiric-fang`, `featherweight-boots`).

### Unique — must be unlocked

| id | name | description | effect |
|---|---|---|---|
| `executioners-instinct` | Executioner's Instinct | Knows exactly where the killing blow lands, and how to recover from delivering it. | `healOnKill 20` |
| `thunderous-aura` | Thunderous Aura | An aura that occasionally lashes out on its own, independent of any weapon. | `autoDamage 6` |
| `vampiric-discipline` | Vampiric Discipline | A discipline that turns combat itself into sustenance. | `lifesteal 10%` |
| `phantom-reflexes` | Phantom Reflexes | Reflexes trained past the point of conscious thought — the body moves before the mind decides. | `dodgeChance 12%` |
| `battle-scholar` | Battle Scholar | Draws a lesson from every fight, learning faster than the rest of the party. | `expBoost 15%` |

`thunderous-aura`/`vampiric-discipline`/`phantom-reflexes`/`battle-scholar`
exactly mirror their Unique-tier artifact counterparts (`thunder-totem`,
`bloodthirsty-blade`, `phantom-step`, `scholars-insight`).
**`executioners-instinct` is the one exception** — `data/artifacts.json`
has no Unique-tier `healOnKill` artifact to copy (only the Epic
`reapers-covenant` at `25`), so `20` is a deliberately interpolated value:
above what a Rare-tier effect would carry, below the Epic reference.

### Epic — must be unlocked

| id | name | description | effects |
|---|---|---|---|
| `undying-will` | Undying Will | A will strong enough to turn punishment right back at whoever dealt it. | `reflectDamage 15%` + `statBoost maxHp +60` |
| `reapers-instinct` | Reaper's Instinct | An instinct honed on death itself — every kill feeds the next. | `healOnKill 25` + `lifesteal 8%` |
| `storm-within` | Storm Within | A storm that never fully settles, lashing out with damage and poison alike. | `autoDamage 12` + `poisonOnHit 8%` |
| `grandmasters-focus` | Grandmaster's Focus | Mastery sharp enough to recover skills faster and absorb every lesson battle offers. | `cooldownReduction 1` + `expBoost 25%` |

All 4 mirror their Epic-tier artifact counterparts exactly
(`immortal-heart`'s `reflectDamage`/`maxHp` pair, `reapers-covenant`,
`crown-of-destruction`, `eternal-scholars-tome`) — `undying-will`
deliberately drops `immortal-heart`'s 3rd effect (`defense +10`) to stay a
2-effect ability, since Abilities only ever occupy 1 slot and don't need
to match an Artifact's full effect count to match its per-effect
magnitude.

---

## 11.3 Open follow-ups (not blocking, tracked for later tuning)

- All numeric constants above live in `data/balance-config.json`/this
  catalog — expect rebalancing once the feature is actually played
  (drop rate, loss chances, and the depth-1/depth-cap weight tables are
  the most likely candidates to need adjustment).
- No Ability currently uses `expBoost`'s party-wide exception behavior
  differently from how Artifacts already handle it (§7.2) — same rule
  applies: even though it's a single character's equipped ability, its
  `expBoost` still boosts the shared `partyExp`.
