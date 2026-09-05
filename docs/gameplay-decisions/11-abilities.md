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
are never cursed. On top of that, Abilities get 2 things Artifacts don't
have:

- `alwaysHit` (§11.1.1 below) — a genuinely new mechanic, since nothing in
  the Artifact catalog needed it.
- `statBoost` widened to 3 more stats — `aggro`/`speed`/`magicPower` —
  that `ArtifactEffect`'s own `statBoost` variant can't target
  (`src/types.ts` restricts it to `attack`/`defense`/`maxHp`/`maxMp`; grep
  confirms no Artifact anywhere uses the other 3). This isn't a new
  mechanism, just the same flat/additive/permanent modifier `statBoost`
  already is — `recomputeCharacterStats` (`src/engine/party.ts`) gains 3
  more cases in the same sum it already computes for the other 4 stats.

```
AbilityOnlyEffect =
  | { kind: "alwaysHit"; chance: number }
  | { kind: "statBoost"; stat: "aggro" | "speed" | "magicPower"; amount: number }

AbilityEffect = Exclude<ArtifactEffect, { kind: "curseAggroBoost" }> | AbilityOnlyEffect
```

Note: this deliberately produces 2 union members both tagged
`kind: "statBoost"` (the `ArtifactEffect`-derived one, still fixed to its
original 4 stats, plus this new one) rather than 1 merged variant — valid
TypeScript, and any code narrowing on `effect.kind === "statBoost"` just
sees the union of both shapes (`stat` becomes the full 7-literal set in
practice). Kept this way instead of hand-merging the two into a single
7-stat `statBoost` type so `ArtifactEffect`'s own definition in
`src/types.ts` never has to be touched to support an Ability-only need.

```
AbilityDefinition {
  id: Id
  name: string
  description: string
  rarity: ArtifactRarity
  effects: AbilityEffect[]   // usually 1, epic abilities combine 2
}
```

`Character.equippedAbilityId?: Id | null` — set once at character select,
fixed for the entire run (no mid-run swapping, no respec). The
`ArtifactEffect`-derived part of `AbilityEffect` applies through the exact
same engine hooks Artifacts already use (`07-items-artifacts.md` §7.2
"Engine hooks for the Group 2-4 effects") — those hooks generalize from
"scan `equippedArtifactIds`" to "scan `equippedArtifactIds` + the 1
`equippedAbilityId`," nothing about the hooks' actual logic changes.
`alwaysHit` needs its own, new hook — see §11.1.1.

#### 11.1.1 `alwaysHit` — pre-empts the game's own hit/proc rolls

A new mechanic, not a reused one: before either of the 2 places the
combat engine already rolls dice to decide whether something lands,
**re-roll the wearer's `alwaysHit` chance first.** On a hit, skip the
roll that was about to happen and treat it as an automatic success. On a
miss, fall through to that roll exactly as if `alwaysHit` didn't exist —
it can only ever help, never hurt.

The 2 existing roll points it intercepts, both in
`applySkillEffects` (`src/engine/combat.ts`):

1. **The fear-accuracy roll** (`rollHits`, `src/engine/resolver.ts`) —
   rolled once per enemy the wearer targets (skipped entirely for
   ultimates, which already always hit — `04-fear-combat.md` §4.1 — so
   `alwaysHit` has nothing to add there). A single-target skill only ever
   has 1 enemy in its target list, so this looks like "once per skill
   use" for those, but it's the identical per-target mechanism an AoE
   skill uses to roll separately for each enemy it hits (`04-fear-combat.md`
   §4.1) — not a coarser, once-per-activation check. This is the roll fear
   tiers Uneasy/Panicked/Broken already impose a miss chance on
   (`getFearAccuracyPenalty`, capped at 20% — `04-fear-combat.md` §4); at
   Calm, this roll never misses to begin with, so `alwaysHit` adds nothing
   there either. Its real value against this roll only shows up once the
   wearer is already at least Uneasy.
2. **The per-effect chance roll** (`effect.chance` on a `SkillEffect`,
   checked once per effect per target inside `applySkillEffects`) — this
   is what gates most class skills' debuff/status-application effects
   (`data/classes.json`, e.g. a Rogue's stun/weaken chance), rolled
   **independently for every qualifying effect on every target**, at the
   exact same per-target granularity as point 1 above — so a
   multi-target or multi-effect skill re-rolls `alwaysHit` fresh each
   time, exactly like the underlying roll it's guarding already does.

**Explicitly out of scope** (not intercepted, to keep the mechanic's
footprint to the 2 rolls actually named "hit" and "debuff chance" in the
game's own vocabulary, not every % roll anywhere in the engine):
the *target's* own `dodgeChance` roll against the wearer's attack (that's
the target's evasion, not the wearer's accuracy); any Artifact/Ability
`poisonOnHit`-style on-hit rider, which resolves through its own
dedicated engine hook (`07-items-artifacts.md` §7.2), not through
`SkillEffect.chance`; and monster accuracy (this only ever applies to a
Character wearer's own actions, mirroring how every other Group 2 effect
in this system is scoped to "the exact character wearing it").

Only ever relevant on the wearer's own turn, and only for skills that
target an enemy — never rolled for heal/buff effects aimed at allies
(`applySkillEffects` doesn't roll accuracy for those to begin with).

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
   of `battle-instinct` either). Once a character locks in an id, it drops
   out of every later character's list for this screen. This applies only
   to *this run's* equip choices — it has no effect on `unlockedAbilityIds`
   itself, which stays a plain set with no notion of "who owns what."

Result stored on each `Character.equippedAbilityId` before the floor
generator runs.

### Mid-run acquisition — both Elite and Boss unlock instantly; only Boss also grants Stardust

Both still hook into the exact same trigger point as the guaranteed
Artifact drop (`07-items-artifacts.md` §7.2 "Drop source" —
`src/engine/game.ts`, the per-monster loop on room-clear,
`monster.tier === "elite" || "boss"`), and both still roll independently
of the Artifact drop on the same kill.

- **Ability roll (Elite and Boss alike): instant, permanent, free.** On a
  successful roll, the ability id is added straight to
  `AbilityProfile.unlockedAbilityIds` — no pool, no decision screen, no
  Stardust cost, no waiting for death. It's simply available at the next
  character-select from then on (mid-run, it does nothing for the
  *current* run — equipped abilities are still locked in for the run,
  §11.1 "Character-select flow"). Logged as a flavor line, the same way a
  passive Item pickup is (no interrupt to the dungeon loop). There is no
  per-run ability pool at all — an ability found mid-run either becomes
  real immediately, or the roll simply missed.
- **Boss kills additionally, unconditionally, grant exactly 1 Stardust**,
  `GameState.runStardust: number += 1`, regardless of whether the ability
  roll above hit or missed. Since a real Boss only appears every
  `bossFloorInterval` floors (5, `data/level-growth.json`), this is also
  "1 Stardust every 5 floors" — the cadence the feature was originally
  requested with. Stardust has exactly one use: buying back a lost
  ability at this run's death flow (below) — it plays no role in mid-run
  acquisition itself.

The ability roll shares the same drop-chance/rarity mechanics for both
sources:

- **Drop chance**: `abilities.dropChance = 0.35` (35%) per eligible kill —
  deliberately below `items.itemDropChance` (0.6) since an Ability
  affects the permanent profile, a much higher-stakes reward than a
  consumable.
- **The roll excludes any ability id already in `unlockedAbilityIds`.**
  This directly implements "tỉ lệ rơi chỉ rơi những abilities chưa có
  trong pool chung": a hit always surfaces something the player doesn't
  already have.
  - **Catalog-exhaustion fallback**: if every ability in the rolled
    rarity tier is already unlocked, re-roll the rarity excluding that
    tier and redistribute its weight across the rest. If literally every
    non-`common` ability in the whole catalog is already unlocked, the
    roll simply yields nothing that kill — there's nothing left to find.
- **A roll that resolves to `common` grants nothing** — it's already
  always available, so there's nothing to unlock.
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
Boss kills stay the better free-unlock roll *and* the only Stardust
source, which is what makes reaching Bosses worth the detour on top of
whatever Elites a floor happens to offer.

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
3. **Stardust buyback — reclaim only, no swapping for something else.**
   (Skipped entirely if the lost set is empty.) There is no "pick a
   different ability instead" option and no shared candidate pool to draw
   from — the only thing Stardust ever buys back is the *exact* ability a
   character just lost. The player addresses lost-set entries in whatever
   order they like:
   - **Skip** — spend nothing, that ability stays lost (removed from
     `unlockedAbilityIds`, same as if it were never reclaimed).
   - **Reclaim** — pay `stardustCostByRarity[rarity of the lost ability]`
     (Rare 2 / Unique 3 / Epic 4) to re-add that exact id to
     `unlockedAbilityIds`. Since every lost-set entry is for a distinct id
     (no-duplicate-in-party, §11.1 "Character-select flow"), reclaiming
     one entry can never collide with another — there's no shared-resource
     contention to sequence or resolve, unlike an earlier draft of this
     spec that included a swap-to-something-new option.
   - Spending stops once `runStardust` can no longer afford anything left
     to reclaim.
4. **Persist** — write the updated `AbilityProfile` to `profile.json`
   *before or independently of* `deleteSavesForRun`, so the per-run wipe
   never touches it. Any `runStardust` left unspent is discarded with the
   rest of the run's state — it does not carry over to the next run (a
   fresh run always starts at `runStardust = 0`).
5. **Results screen** — shown after the buyback (or immediately, if the
   lost set was empty): 1 line per lost-set entry, e.g. "Vanguard's
   *Bloodletting* was lost — reclaimed for 2 Stardust" / "Rogue's
   *Phantom Reflexes* was lost for good."
6. **Next run starts with more (or the same) choices, never fewer than
   what survived.** There is no dedicated "pick your ability again"
   moment tied to this death — the very next time the player starts a new
   run, §11.1 "Character-select flow" runs exactly as it always does,
   simply against whatever `unlockedAbilityIds` looks like *now*: any
   reclaimed-this-death ids are back in it, any Elite/Boss finds from this
   run that were never equipped (so never at risk) are still in it
   untouched, and anything left unreclaimed is gone until re-earned from
   scratch via a future Elite/Boss roll. This is the entire mechanism
   behind "sau khi chơi lại người chơi sẽ có thêm quyền được lựa chọn
   abilities" — more choices next time is simply a byproduct of the pool
   having grown, not a separate reward screen.

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
  pattern will need equivalent branches for `Character.equippedAbilityId`
  and `GameState.runStardust` against `data/abilities.json` once that
  catalog exists, plus a migration default (`null`/`0`/absent) for saves
  written before this feature existed. Noted now so it isn't missed when
  coding starts.
- **No-duplicate enforcement only ever needs to check the party's current
  4 `equippedAbilityId`s**, at character select only — the Stardust
  buyback can't create a duplicate in the first place, since every
  lost-set entry reclaims a distinct id that's already guaranteed unique
  (see "Stardust buyback" step 3) and buyback never touches what's
  *equipped* anyway, only what's *unlocked*. It never needs to consult
  `unlockedAbilityIds`, which is intentionally allowed to contain the same
  id "available" to more than one future pick — the exclusivity is only
  about what's simultaneously equipped, never about what's unlocked.
- **Catalog exhaustion is a real, reachable end state**, not a
  theoretical one — 16 non-common abilities total (§11.2) is a small
  enough catalog that a dedicated player could plausibly unlock all of
  them across enough runs. From that point on, Elite/Boss ability rolls
  permanently yield nothing (the roll's exclusion rule has nothing left to
  offer), which is an acceptable "collection complete" end state for now,
  flagged under Open follow-ups as a likely spot to expand the catalog
  later.

---

## 11.2 Catalog (design content — becomes `data/abilities.json`)

24 abilities: 8 Common (always available), 6 Rare, 5 Unique, 5 Epic.
Magnitudes are calibrated against `data/artifacts.json`'s values at the
same rarity (§7.2) wherever a same-rarity artifact with the same effect
kind exists — Abilities don't need a separate balance philosophy from
Artifacts, they differ in *slot count* (1 vs. 3) and *persistence risk*,
not in raw power-per-tier. A few effect kinds have no same-rarity artifact
to copy directly; those are called out inline below rather than silently
invented.

**Balance rule specific to Abilities, not inherited from Artifacts: no 2
abilities in the same rarity tier may buff the same stat/effect axis.**
Artifacts can double up safely (`iron-gauntlet` +3 attack and
`sharp-claw` +4 attack both being findable just means you can eventually
own both of 12 slots) — but a character equips exactly 1 Ability, ever,
for the whole run. If 2 same-tier Abilities buffed the same axis at
different magnitudes, the smaller one would be strictly worse with no
compensating upside, and no rational player would ever pick it — dead
catalog space, not a real choice. Every tier below is built so each
ability owns a distinct axis; see `.hermes/features/abilities/
BRAINSTORM.md` D11 for the pairs an earlier draft got wrong and how each
was fixed.

### Common — always selectable

| id | name | description | effect |
|---|---|---|---|
| `battle-instinct` | Battle Instinct | Raw aggression channeled into every swing, honed through repetition. | `statBoost attack +4` |
| `iron-skin` | Iron Skin | Years of taking hits without flinching have toughened the skin itself. | `statBoost defense +3` |
| `hardy-constitution` | Hardy Constitution | A body built to endure — sheer physical resilience, nothing magical about it. | `statBoost maxHp +30` |
| `deep-reserves` | Deep Reserves | A trained ability to hold more magic in reserve than most ever learn to. | `statBoost maxMp +10` |
| `unshaken-resolve` | Unshaken Resolve | A mind trained not to let the dark get the better of it. | `fearResist 10%` |
| `evasive-instinct` | Evasive Instinct | An instinct honed to slip aside the instant before a blow lands. | `dodgeChance 3%` |
| `leeching-will` | Leeching Will | A stubborn will that leeches a little life back from every wound it deals. | `lifesteal 4%` |
| `arcane-aptitude` | Arcane Aptitude | A natural aptitude for channeling magic, drawn on with every spell cast. | `statBoost magicPower +4` |

8 abilities, 8 distinct axes (attack / defense / maxHp / maxMp /
fearResist / dodgeChance / lifesteal / magicPower) — no 2 abilities
compete for the same pick. `arcane-aptitude` replaces the original
`poisonOnHit`-based 8th slot — see "Why `poisonOnHit` was removed
entirely" below the Rare table for the reasoning, which applies to every
tier at once, not just Common.

`arcane-aptitude`'s `+4` isn't copied from `battle-instinct`'s `+4`
attack by coincidence: `magicPower` and `attack` share the *exact same*
per-level growth rate (`data/level-growth.json` tier 1 = `3` for both,
confirmed identical at every tier — `docs/gameplay-decisions/01-class-
skill.md` §"Base stats balancing formula" treats them as literally
interchangeable, 1 balance point each). Whatever magnitude is fair for a
flat `attack` bonus is, by the game's own conversion rate, equally fair
for the same-numbered `magicPower` bonus — the cleanest calibration
available for any pair of stats in this catalog, since no EV estimate or
judgment call is needed at all.

**Why `dodgeChance`/`lifesteal` are 3%/4%, not a flat 3% for both**: these
2 effect kinds have no Common-tier Artifact to mirror (they only start
appearing on Rare Artifacts), so an earlier draft of this doc just halved
each one's Rare-tier % uniformly. That's a category error — halving the
*percentage* only produces equal *value* if a % point means the same
thing for both effects, and it doesn't, because `dodgeChance` avoids what
a monster would have dealt to the wearer (the *bigger* number in this
game — monsters hit harder than a level-1 character does) while
`lifesteal` is a cut of what the wearer deals out (the *smaller* number).
Computed directly from the game's own damage formula (`mitigatedOffense`,
`src/engine/resolver.ts`, `combat.defenseMitigationX/Y = 60/30`) against a
representative early fight — a depth-2 Dungeon Rat (atk 19, def 3) vs. the
level-1 party-average character (atk 10, def 7, from `data/classes.json`),
over a ~4-round fight (the game's own "quick victory" benchmark is 3
rounds, `03-survival-stats.md`, so 4 is a typical, non-quick regular
fight) with roughly 1 attack thrown and taken per round:

- damage taken per hit ≈ 16.8, damage dealt per hit ≈ 9.4
- at a flat 3%, expected value per fight was **2.01** for dodge but only
  **1.13** for lifesteal — lifesteal was quietly worth barely half of
  dodge for the "same" number, exactly the kind of imbalance this catalog
  is supposed to rule out
- solving each effect's % for a shared ~2.0-per-fight target instead:
  dodge ≈2.98% (rounds to the same 3%, so that one was fine by
  coincidence), lifesteal ≈5.3%

Lifesteal's solved value (≈5.3%) would tie or pass Rare's own
`bloodletting` (5%), breaking the one pattern every other shared axis in
this catalog follows (Rare is strictly higher than Common on the same
axis: attack 4<8, defense 3<8, maxHp 30<50, dodge 3<6). Rounded down to
**4%** instead — still a real correction from the original 3% (EV 1.51
vs. 1.13, ≈33% higher) and closer to dodge's 2.01, while keeping Common
strictly below Rare on every shared axis. None of this is exact — it
rests on one assumed fight length and hit-rate — but it's grounded in the
game's real numbers and internally consistent with itself, not a borrowed
ratio from a different tier that was never checked against what these
specific abilities are actually worth to the character holding them.

### Rare — must be unlocked

| id | name | description | effect |
|---|---|---|---|
| `predators-edge` | Predator's Edge | An instinct for finding the gap in an enemy's guard. | `statBoost attack +8` |
| `bulwark-stance` | Bulwark Stance | A stance drilled until it's second nature — nothing gets through easily. | `statBoost defense +8` |
| `second-wind` | Second Wind | The talent for finding one more reserve of strength when it matters most. | `statBoost maxHp +50` |
| `bloodletting` | Bloodletting | A brutal technique that turns every wound dealt into strength regained. | `lifesteal 5%` |
| `featherstep-training` | Featherstep Training | Years of drilling footwork most fighters never bother to learn. | `dodgeChance 6%` |
| `restless-vigor` | Restless Vigor | An energy that never settles, always pushing the body to move first. | `statBoost speed +3` |

The first 5 mirror their Rare-tier artifact counterparts
(`ancient-sword`/`heart-of-stone`/`eternal-vial`, `vampiric-fang`,
`featherweight-boots`) — `restless-vigor` replaces the original
`poisonOnHit`-based `toxic-touch` and has no Artifact counterpart at all,
since no Artifact targets `speed` either.

### Why `poisonOnHit` was removed from the Ability catalog entirely

Not a rebalance — a removal, at every tier that had it (`toxic-touch`
here, the old Common 8th slot, and half of the Epic `storm-within` below).
The `poisoned` status effect it procs deals a flat `4` damage/turn for `3`
turns (`data/status-effects.json`) — a fixed `12`-damage payout that never
scales with anything, while monster HP keeps climbing with floor depth on
the same growth curve characters use (`tier1.maxHp` rate `14`/depth,
`data/level-growth.json`). Computed directly against a representative
weak monster's HP (Slime, base `52`): that flat `12` is **23% of its HP at
depth 1**, but only **11% at depth 5**, **6.7% at depth 10**, and **3.8%
at depth 20** — an effect that keeps getting weaker for the entire rest of
a run, on a mechanic (Abilities) that's explicitly meant to matter for the
long haul, not just the opening floors. `dodgeChance`/`lifesteal` don't
have this problem (a `%` of a *current* incoming/outgoing hit scales
automatically with however big that hit already is), which is exactly why
they stayed and `poisonOnHit` didn't. This only removes `poisonOnHit` from
the *Ability* catalog — the Artifact catalog's own `venomous-dagger-relic`/
`serpent-ring` and Rogue's Poison Coat/Bomb skills keep the exact same
mechanic; fixing poison's scaling everywhere it appears in the base game
is a much bigger, already-shipped-code change, out of scope here.

The 3 freed slots (Common, Rare, half of Epic) went to 3 stats no
Artifact or Ability had ever touched before — `magicPower` (Common,
above), `speed` (here), and `aggro` (Epic, below) — rather than being
left empty or refilled with a 4th `dodgeChance`/`lifesteal` copy at a
different number, which would've just been more of what the catalog
already had plenty of.

**Why `speed +3`, not a number matched to Rare's other 3 flat-stat
abilities (attack+8/defense+8/maxHp+50) by the same balance-points method
used for `magicPower`**: it was tried, and the result was absurd.
`speed`'s own conversion rate in the game's `BalancePoints` formula is
`speedRate = 12` (`01-class-skill.md` §"Base stats balancing formula") —
matching Rare's other abilities' ballpark (~2.7-4.0 balance points each)
would mean `speed +32` to `+48`. `speed` only ranges `8`-`17` across all 6
classes at level 1 (`data/classes.json`) — a `+32` would make the
*slowest* class in the game faster than the *fastest* one is today, by a
wide margin. The reason the formula breaks down here: `attack`/`defense`/
`maxHp` all **grow with level** (`data/level-growth.json`), so a Rare-tier
bonus that looks big at level 1 is deliberately front-loaded — it shrinks
in relative terms as the character levels, the same way Rare's own flat
bonuses do everywhere else in this catalog. `speed` (and `aggro`) **never
grow with level at all** (`docs/gameplay-decisions/05-character-stats.md`)
— a flat bonus to either one keeps exactly the same absolute weight for
the entire run, never diluted. Matching a decaying stat's day-1 magnitude
with a never-decaying one's day-1 magnitude systematically overpays the
one that never decays. `+3` was chosen directly against `speed`'s own
real spread instead: it closes roughly a third of the entire 6-class gap
(e.g. lets Acolyte's `9` catch up to Mage's `10`), a permanent, always-
relevant nudge without redefining the turn order on its own.

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
| `storm-within` | Storm Within | A storm that never fully settles — drawing every eye toward it while lashing out on its own. | `autoDamage 12` + `statBoost aggro +15` |
| `grandmasters-focus` | Grandmaster's Focus | Mastery sharp enough to recover skills faster and absorb every lesson battle offers. | `cooldownReduction 1` + `expBoost 25%` |
| `unerring-will` | Unerring Will | A conviction so absolute that fear itself can't shake the outcome — some strikes and afflictions simply cannot be denied. | `alwaysHit 20%` + `fearResist 12%` |

`undying-will`/`reapers-instinct`/`grandmasters-focus` mirror their
Epic-tier artifact counterparts exactly (`immortal-heart`'s
`reflectDamage`/`maxHp` pair, `reapers-covenant`, `eternal-scholars-tome`)
— `undying-will` deliberately drops `immortal-heart`'s 3rd effect
(`defense +10`) to stay a 2-effect ability, since Abilities only ever
occupy 1 slot and don't need to match an Artifact's full effect count to
match its per-effect magnitude.

`storm-within` used to mirror `crown-of-destruction` exactly too
(`autoDamage 12` + `poisonOnHit 8%`) — its `poisonOnHit` half is now
`statBoost aggro +15` instead ("Why `poisonOnHit` was removed" under the
Rare table has the full reasoning; it doesn't scale-decay the way poison
does, and pairs naturally with `autoDamage`'s flavor — a presence violent
enough to draw every hit *and* strike back on its own). `+15` was
calibrated against `aggro`'s own targeting-weight formula
(`P(target = X) = X.aggro / total party aggro)`,
`docs/gameplay-decisions/02-monster.md`), not `BalancePoints` — the game's
own docs explicitly exclude `aggro` from that formula, since it's a
relative weight, not an absolute power stat, so there's no shared
conversion rate to borrow the way `magicPower` borrowed `attack`'s. The 1
existing aggro-boosting effect in the game, the cursed-only
`curseAggroBoost` (`unstable-core`, `data/artifacts.json`), uses `+25` —
severe by design, since it's a downside with no opt-out. `+15` (60% of
that) is deliberately smaller: this is a positive, chosen "protector"
pick, not an imposed penalty, but still large enough to matter against
real base values (`data/classes.json`) — e.g. a Mage's `8` aggro becomes
`23`, nearly tripling how often monsters single them out, a real
tank-support build enabler rather than a token nudge.

`unerring-will` is the exception — it has no Artifact counterpart at all,
since `alwaysHit` doesn't exist as an Artifact effect (§11.1.1). Placed at
Epic rather than invented at a lower tier because of *breadth*, not raw
magnitude: it's the only effect in the whole catalog that touches 2
different combat rolls at once, on every enemy-targeting skill the wearer
ever uses, for the entire run — a kind of universal, always-relevant
utility no single-target stat or proc-chance effect can match, which is
the same reason the other 4 Epics justify their slot by combining 2
effects instead of maxing out 1. `alwaysHit 20%` was set from the user's
own example value directly (`.hermes/features/abilities/BRAINSTORM.md`
D13 has the full reasoning for why 20% and paired `fearResist 12%` were
kept rather than tuned against the other Epics' numbers, which don't
share a comparable unit to calibrate against). `fearResist` reappearing
here (Common's `unshaken-resolve` is the only other user of this axis, at
10%) is a deliberate thematic pairing, not filler: both halves of this
ability are about fear specifically failing to cost the wearer anything —
resisting it building up, and shrugging off the one combat penalty it
already causes.

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
- **Catalog size vs. the free instant-unlock rate**: since both Elite and
  Boss kills hand out permanent unlocks for free the moment they roll (no
  Stardust, no death gate — Stardust only ever buys back losses), the
  16-ability non-common catalog could get exhausted faster than originally
  modeled when this doc still gated *all* acquisition behind the death
  flow. Worth simulating once implemented — either drop rate or catalog
  size may need adjusting sooner than the Stardust-side numbers.
- **The base game's `poisonOnHit`/Poison Coat/Poison Bomb mechanic has the
  same non-scaling flaw** that got it removed from this catalog (§"Why
  `poisonOnHit` was removed") — its flat damage-per-turn doesn't grow with
  floor depth the way monster HP does, so it likely gets weaker over the
  same run for Artifacts and Rogue skills too. Out of scope for this doc
  (that's already-shipped code, not part of the unimplemented Abilities
  feature), but worth a separate look.
