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
| Lost when | Used up | Party wipe (with the run) | **Guaranteed on party wipe** if non-common — every non-common equipped ability is struck from the persistent profile the moment the run ends, no roll involved (recoverable only by spending that run's Stardust, §11.1 "Death flow") |
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
3. **No 2 characters in the party may end the screen with the same
   ability id equipped** (commons included — a party can't stack 4 copies
   of `steady-hands` either). Once a character locks in an id, it drops
   out of every later character's list for this screen. This applies only
   to *this run's* equip choices — it has no effect on `unlockedAbilityIds`
   itself, which stays a plain set with no notion of "who owns what."

Result stored on each `Character.equippedAbilityId` before the floor
generator runs.

### Mid-run acquisition — Elite and Boss now play 2 different roles

Both still hook into the exact same trigger point as the guaranteed
Artifact drop (`07-items-artifacts.md` §7.2 "Drop source" —
`src/engine/game.ts`, the per-monster loop on room-clear,
`monster.tier === "elite" || "boss"`), and both still roll independently
of the Artifact drop on the same kill — but they no longer resolve the
same way:

- **Elite: instant, permanent, free.** On a successful roll, the ability
  id is added straight to `AbilityProfile.unlockedAbilityIds` — no pool,
  no decision screen, no Stardust cost. It's simply available at the next
  character-select from then on (mid-run, it does nothing for the
  *current* run — equipped abilities are still locked in for the run,
  §11.1 "Character-select flow"). Logged as a flavor line, the same way a
  passive Item pickup is (no interrupt to the dungeon loop).
- **Boss: pooled, gated behind Stardust and the death flow.** On a
  successful roll, the id is appended to a new **per-run, Boss-only**
  pool, `GameState.runBossAbilityPool: Id[]` — not unlocked yet. It only
  ever becomes real (added to `unlockedAbilityIds`) if the player spends
  Stardust on it at this run's death flow (below). If never spent, it's
  discarded with the rest of the run's state.
- **Every Boss kill also grants exactly 1 Stardust**, `GameState.
  runStardust: number += 1`, regardless of whether the ability roll above
  hit or missed. Since a real Boss only appears every `bossFloorInterval`
  floors (5, `data/level-growth.json`), this is also "1 Stardust every 5
  floors" — the cadence the feature was originally requested with. Unlike
  the ability roll, this part is unconditional, not a probability.

Both rolls share the same drop-chance/rarity mechanics as before:

- **Drop chance**: `abilities.dropChance = 0.35` (35%) per eligible kill —
  deliberately below `items.itemDropChance` (0.6) since an Ability
  affects the permanent profile, a much higher-stakes reward than a
  consumable.
- **The roll excludes any ability id already in `unlockedAbilityIds`**,
  and — for the Boss roll specifically — also excludes ids already sitting
  in this run's own `runBossAbilityPool` (no point queuing the exact same
  unspent candidate twice). This directly implements "tỉ lệ rơi chỉ rơi
  những abilities chưa có trong pool chung": both sources only ever
  surface something the player doesn't already have.
  - **Catalog-exhaustion fallback**: if every ability in the rolled
    rarity tier is already unlocked (or, for Boss, already pending in
    `runBossAbilityPool`), re-roll the rarity excluding that tier and
    redistribute its weight across the rest. If literally every
    non-`common` ability in the whole catalog is already unlocked, the
    roll simply yields nothing that kill — there's nothing left to find.
- **A roll that resolves to `common` grants nothing** (Elite: nothing to
  add, it's already always available; Boss: nothing appended to the
  pool) — enforced at roll time.
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
  "stardustCostByRarity": { "rare": 2, "unique": 3, "epic": 4 }
}
```

For a rarity `r` at depth `d` (clamped to `[1, depthCap]`):
`weight(r, d) = atDepth1[r] + (atDepthCap[r] − atDepth1[r]) × (d − 1) / (depthCap − 1)`,
then fed into the same `rng.weightedPick` pattern `rollArtifactRarity`
already uses (`src/data/artifacts.ts`), filtering zero-weight entries
first. Identical shape to the existing Artifact `RARITY_WEIGHTS` table:
Elite skews common/rare, Boss never rolls common and skews unique/epic —
which now doubles as the game's own way of saying "Elite finds are the
steady trickle, Boss finds are the rare, better-odds ones worth actually
spending Stardust on."

### Death flow (the only end-state — no "victory" exists in the game today)

Hooks into the sole place `gameOver` becomes `"defeat"`
(`Game.postMoveCheck()`, `src/engine/game.ts`), before
`App.syncUiToGameState()` triggers `deleteSavesForRun`:

1. **Guaranteed loss, no roll.** For every character whose
   `equippedAbilityId` resolves to a non-`common` ability, immediately
   remove that id from `unlockedAbilityIds`. This is unconditional — the
   old probability-by-rarity roll is gone. Since §11.1 "Character-select
   flow" now forbids 2 characters sharing an id, every character with a
   non-common ability equipped is necessarily losing a *distinct* one —
   there's no "shared id, split outcome" case left to reconcile.
2. **Collect the lost set** — 1 entry per character who just lost an
   ability: `{ characterId, lostAbilityId, rarity }`. A character who
   entered the run with `common` or no ability equipped contributes
   nothing here and gets no buyback opportunity (nothing was lost for
   them to buy back).
3. **Stardust buyback** (skipped entirely if the lost set is empty) — the
   player addresses lost-set entries **one at a time, in whatever order
   they pick**, and each decision **commits immediately** before the next
   entry is presented (no batch/simultaneous selection — see the
   implementation note below for exactly why this matters). For the
   entry currently being addressed:
   - **Skip** — spend nothing, that ability stays lost.
   - **Reclaim** — pay `stardustCostByRarity[rarity of the lost ability]`
     (Rare 2 / Unique 3 / Epic 4) for the *exact* id that was just lost,
     re-adding it to `unlockedAbilityIds`.
   - **Swap** — pick a *different* id instead from this run's
     `runBossAbilityPool` (shared across every lost-set entry, not tied to
     which character's kill found it — see
     `.hermes/features/abilities/BRAINSTORM.md` for why a shared pool was
     chosen over a per-finder-character one), and pay
     `stardustCostByRarity[rarity of the chosen candidate]` — **the
     candidate's own rarity, not the lost ability's**. A Rare loss swapped
     for an Epic find costs the Epic's 4, not the Rare's 2; a lost Epic
     swapped for a Rare find only costs 2. Getting this backwards (charging
     the lost ability's rarity regardless of what's bought) would let an
     Epic candidate be bought at Rare prices — the cost is what you're
     acquiring, never what you're replacing.
   - **Immediately upon committing a Reclaim or Swap**, the chosen id is
     added to `unlockedAbilityIds` and removed from `runBossAbilityPool`
     (if it came from there) so it can never be claimed by a later
     lost-set entry this same death — this is what makes "an id can only
     be unlocked once per death" an actual sequencing guarantee rather
     than just a stated intent: because entries are resolved one at a
     time with each choice committed before the next begins, there is no
     window where 2 entries could both be mid-selection on the same
     candidate. Spending stops once `runStardust` can no longer afford
     anything left to buy.
   - There is no notion of "this Boss ability belongs to that character" —
     the pool and the currency are both party-wide; any lost-set entry may
     spend on any still-available candidate regardless of which character
     killed which Boss.
4. **Persist** — write the updated `AbilityProfile` to `profile.json`
   *before or independently of* `deleteSavesForRun`, so the per-run wipe
   never touches it. Any `runStardust` left unspent, and any
   `runBossAbilityPool` ids nobody bought, are discarded with the rest of
   the run's state — Stardust does not carry over to the next run (a
   fresh run always starts at `runStardust = 0`).
5. **Results screen** — shown after the buyback (or immediately, if the
   lost set was empty): 1 line per lost-set entry, stating what was lost
   and what happened to it — reclaimed, swapped for something else, or
   left lost — e.g. "Vanguard's *Bloodletting* was lost — reclaimed for 2
   Stardust" / "Mage's *Thunderous Aura* was lost — replaced with
   *Battle Scholar*" / "Rogue's *Phantom Reflexes* was lost for good."

Why this replaces the old probabilistic system entirely: guaranteed loss
is a harsher baseline than the old 25/45/65% roll, but the player is now
given real agency and a resource (Stardust) to fight back with instead of
hoping a die roll goes their way — and the resource is self-limiting in
exactly the way the old system needed an artificial
`maxInsurancePerDeath` cap to fake. A typical death at depth 15-25 yields
2-5 Stardust (1 per Boss every 5 floors) — enough to reclaim 1, maybe 2,
of a full loadout's losses, not all of them; only a genuinely deep run
(each Epic reclaim alone costs 4 Stardust, i.e. 4 Boss kills / 20 floors)
can afford to recover most or all of a 4-ability loadout. The risk still
scales down exactly where it should — shallow, lower-investment runs —
without needing a hand-picked cap bolted on top.

### Edge cases & clarifications

- **Exactly one `profile.json`, shared globally.** `resolveSaveDir()`
  (`src/engine/save.ts`) resolves to a single directory per install/OS
  user — every quicksave, autosave, and manual save already lives there
  side by side. `profile.json` is one more file in that same directory,
  **not** per save-slot and **not** per-run. A character's
  `equippedAbilityId` is locked in once, at that run's creation
  (§11.1 "Character-select flow"), and is never retroactively changed by
  `unlockedAbilityIds` gaining or losing entries from a *different* run
  finishing later — only the *next* character-select screen sees the
  updated pool.
- **Individual character deaths before the final wipe don't matter.**
  `postMoveCheck()`'s wipe condition is `party.every(c => !c.isAlive)` —
  by definition, every character is dead by the time the death flow runs,
  regardless of the order they fell in. There's no special case for "a
  character died 10 floors before the wipe" vs. "died on the final round"
  — every equipped non-common ability in the party is evaluated the same
  way.
- **Save-scumming is a pre-existing risk class, not a new one — but the
  stakes are higher here.** A player can already quicksave before an
  Elite/Boss fight and reload if the Artifact roll disappoints; Abilities
  inherit the exact same exposure through the same drop hook. What's
  different is the incentive: an Artifact reroll only affects the current
  run, while an Ability reroll can permanently inflate the persistent
  profile, so the temptation to reload-farm a specific rare/unique/epic
  ability is materially stronger. Not solved by this spec — flagged as a
  known follow-up (e.g. a future move to seed the roll off the room's own
  seed rather than the live RNG stream would close it, but that's an RNG-
  architecture change out of scope here).
- **Save-file integrity checks need new branches when this is
  implemented.** `isSaveStateValid` and `migrateGameState`
  (`src/engine/save.ts`) already validate/backfill `equippedArtifactIds`
  against the Artifact catalog for old or malformed saves — the same
  pattern will need equivalent branches for `Character.equippedAbilityId`,
  `GameState.runBossAbilityPool`, `GameState.runStardust`, and whatever
  pending-buyback state the death-flow UI needs, against
  `data/abilities.json` once that catalog exists, plus a migration
  default (`null`/`[]`/`0`/absent) for saves written before this feature
  existed. Noted now so it isn't missed when coding starts.
- **No-duplicate enforcement only ever needs to check the party's current
  4 `equippedAbilityId`s**, both at character select and right after the
  Stardust buyback resolves (the buyback can't actually violate it in
  practice — see "Stardust buyback" step 3 — but validating the invariant
  once buyback finishes is cheap insurance against a future bug). It never
  needs to consult `unlockedAbilityIds`, which is intentionally allowed to
  contain the same id "available" to more than one future pick — the
  exclusivity is only about what's simultaneously *equipped*, never about
  what's unlocked.
- **Catalog exhaustion is a real, reachable end state**, not a
  theoretical one — 15 non-common abilities total (§11.2) is a small
  enough catalog that a dedicated player could plausibly unlock all of
  them across enough runs. From that point on, Elite/Boss ability rolls
  permanently yield nothing (the roll's exclusion rule has nothing left to
  offer), which is an acceptable "collection complete" end state for now,
  flagged under Open follow-ups as a likely spot to expand the catalog
  later.

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
  (drop rate, the Stardust cost table, and the depth-1/depth-cap weight
  tables are the most likely candidates to need adjustment).
- No Ability currently uses `expBoost`'s party-wide exception behavior
  differently from how Artifacts already handle it (§7.2) — same rule
  applies: even though it's a single character's equipped ability, its
  `expBoost` still boosts the shared `partyExp`.
- **Catalog size vs. Elite's free instant-unlock rate**: since Elite kills
  now hand out permanent unlocks for free (no Stardust, no death gate),
  the 15-ability non-common catalog could get exhausted faster than
  originally modeled when this doc still gated *all* acquisition behind
  the death flow. Worth simulating once implemented — either drop rate or
  catalog size may need adjusting sooner than the Stardust-side numbers.
