# §11. Abilities (meta-progression)

*(section 11 of `00-index.md`)*

**Status**: implemented. `data/abilities.json` is now the authoritative
catalog — this document should stop being copied from for catalog content,
same as `07-items-artifacts.md` already does for Items/Artifacts. Engine
logic lives in `src/engine/profile.ts` (persistent pool), `src/data/abilities.ts`
(catalog + roll), `src/engine/artifacts.ts` (shared effect hooks),
`src/engine/combat.ts` (`alwaysHit`), and `src/engine/game.ts` (drop/grant on
Elite/Boss kill, death-flow guaranteed loss + Stardust buyback). UI lives in
`src/ui/abilitySelect.ts`, `src/ui/screens/abilityBuyback.ts`, and the
Elite/Boss unlock reveal folded into `src/ui/screens/rewards.ts` alongside
Item/Artifact drops.

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
are never cursed. That union includes `alwaysHit` (§11.1.1),
`debuffResist` (§11.1.2) and `statBoost` on `magicPower`/`speed`, all
introduced for Abilities and since shared with Artifacts
(`07-items-artifacts.md`). On top of that, Abilities get 1 thing Artifacts
don't have:

- `statBoost` on `aggro`, which `ArtifactEffect` reserves for the
  cursed-only `curseAggroBoost`. It is the same flat/additive/permanent
  modifier `statBoost` already is — `recomputeCharacterStats`
  (`src/engine/party.ts`) sums it beside the other stats.

```
AbilityOnlyEffect =
  | { kind: "statBoost"; stat: "aggro"; amount: number }

AbilityEffect = Exclude<ArtifactEffect, { kind: "curseAggroBoost" }> | AbilityOnlyEffect
```

#### Level scaling of flat effects (`minPercent` / `offenseMultiplierPercent`)

A flat number that is strong at level 1 is negligible at level 100, so three of the shared effect
kinds carry an optional scaling field that only `data/abilities.json` entries set, except `autoDamage`'s, which
`thunder-totem` and `crown-of-destruction` also use (`07-items-artifacts.md`) — every other Artifact keeps
its flat behavior:

- **Every percentage below is measured against the bearer's base stats** — class base plus level
  growth (`characterBaseStats`, `src/engine/party.ts`), before any Artifact, Ability, status effect or
  Exhausted modifier — never the live stat, so equipment or a buff can't inflate an Ability's own scaling.
- `statBoost.minPercent` (`attack`/`defense`/`maxHp`/`maxMp`/`magicPower`): the boost is the larger
  magnitude of `amount` or `round(base * minPercent / 100)`, where `base` is the character's base value
  for that stat.
  Not used for `aggro`/`speed` — they don't grow with level, so a flat bonus never goes stale.
  Shipped values: 5% common, 10% rare, 10% epic.
- `healOnKill.minPercent`: the heal is the larger of `amount` or `round(baseMaxHp * minPercent / 100)`.
  Shipped values: 3% unique, 5% epic.
- `autoDamage.offenseMultiplierPercent` (+ `isMagic`): the per-round tick becomes a real `damage`
  resolution — `amount` plus the bearer's base `magicPower` (`isMagic: true`) or base `attack`
  (otherwise) times the percent, mitigated by the target's defense, like a skill's `offenseMultiplierPercent`. Which stat
  it uses follows the Ability's own nature: Thunderous Aura (lightning, no weapon) is magic; Eye of the
  Storm (paired with an aggro boost, a front-line ability) is physical. Without the field the tick is
  the legacy fixed, unmitigated `amount`, which no shipped Ability or Artifact uses any more. The combat log names
  the source ("X takes N damage from Y's Thunderous Aura", or the Artifact's name).

Note: this deliberately produces 2 union members both tagged
`kind: "statBoost"` (the `ArtifactEffect`-derived one, covering 6 stats,
plus the `aggro` one) rather than 1 merged variant — valid TypeScript, and
any code narrowing on `effect.kind === "statBoost"` just sees the union of
both shapes (`stat` becomes the full 7-literal set in practice). Kept this
way so `ArtifactEffect`'s `statBoost` never names `aggro`, which stays a
cursed-only stat for Artifacts.

```
AbilityDefinition {
  id: Id
  name: string
  description: string
  rarity: ArtifactRarity
  effects: AbilityEffect[]   // usually 1, epic abilities combine 2
}
```

An Ability's `id` is its `name` in kebab-case with apostrophes dropped
(`Leech's Thirst` → `leechs-thirst`), and is what profiles and saves store.

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

Artifacts can carry `alwaysHit` too. Every equipped Artifact and the
Ability count as independent sources, combined as the chance that at least
one succeeds (`alwaysHitChance`, `src/engine/artifacts.ts`).

#### 11.1.2 `debuffResist` — lowers how often enemy debuffs land

A relative reduction of the land chance of every **harmful** status an enemy
skill applies to the bearer. A 60% status against `debuffResist 30` lands
`60% × (1 − 30%) = 42%` of the time.

- **What counts as harmful:** any status for which `isHelpfulStatusEffect`
  (`src/engine/resolver.ts`) is false — stuns, damage-over-time, accuracy
  penalties, vulnerabilities, negative stat mods. A skill that applies several
  statuses at once (`alsoApplyStatusEffectIds`) is one application: it lands or
  is thrown off whole, and counts as harmful if any of them is.
- **Guaranteed statuses are reduced too:** an `applyStatusEffect` with no
  `chance` counts as 100%, so `debuffResist 30` makes it land 70% of the time.
- **One draw:** the roll that decides the application also decides the log line.
  When it fails but would have passed without the Ability, the log reads
  "{target} throws off {status}."; a status that would have missed anyway logs
  nothing. No RNG is drawn when the bearer has no `debuffResist`, so seeded
  streams are unchanged for every existing run.
- **Stacking:** Artifacts can carry `debuffResist` too. Each equipped
  Artifact and the Ability scale the land chance down on their own, so they
  combine as `1 − Π(1 − pᵢ)` (`debuffResistPercent`) and never reach 100% from
  sources below 100%.
- **Scope:** only enemy skills acting on a Character inside combat, at the
  same call site as `alwaysHit`'s per-effect roll (`applySkillEffects`,
  `src/engine/combat.ts`). Statuses from events, hunger, items or allies are
  untouched, and it is unrelated to `fearResist`, which scales fear gain.
- **Calibration:** 10 / 16 / 24 / 32 by tier is a first-pass ladder, not
  derived from an expected-value model the way `dodgeChance`/`lifesteal` were —
  there is no same-kind Artifact to anchor to.

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
  unlockedAbilityIds: [] }` (only commons available).

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
  §11.1 "Character-select flow"). Revealed the same way an Artifact drop
  is — an entry in the room-clear reward screen (`GameState.lastRoomDrops`
  → `buildRewardEntries`, `src/ui/screens/rewards.ts`), viewable for its
  name/rarity/effect/description exactly like an Artifact entry — not a
  combat-log line the way a passive Item pickup is. A permanent catalog
  unlock earns the same popup weight as an Artifact, since it changes the
  persistent profile the same way an Artifact changes the run; only the
  Boss's Stardust grant stays a log line (§ below), matching how coin
  gains are logged rather than revealed. There is no per-run ability pool
  at all — an ability found mid-run either becomes real immediately, or
  the roll simply missed.
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
  This directly implements "drops only surface abilities not already in the shared pool": a hit always surfaces something the player doesn't
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
first. Same idea as the Artifact rarity odds (`artifactRarityWeights`, `07-items-artifacts.md`) but with its own tables:
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
   behind "after replaying, players get more abilities to choose from" — more choices next time is simply a byproduct of the pool
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

34 abilities: 9 Common (always available), 10 Rare, 8 Unique, 7 Epic.
Magnitudes are calibrated against `data/artifacts.json`'s values at the
same rarity (§7.2) wherever a same-rarity artifact with the same effect
kind exists — Abilities don't need a separate balance philosophy from
Artifacts, they differ in *slot count* (1 vs. 3) and *persistence risk*,
not in raw power-per-tier. A few effect kinds have no same-rarity artifact
to copy directly; those are called out inline below rather than silently
invented.

**Writing rule for descriptions, not inherited from Artifacts: every
multi-effect (Epic) description gestures at each effect it grants — no
effect left silently unaddressed by the flavor text.** Caught by an
independent craft review (`.claude/skills/narrative-craft-panel`) finding
`thornhide`'s original description named only its `reflectDamage` half
and said nothing about its `statBoost maxHp` half, while every other Epic
already covered both of its effects. Stated explicitly here so the next
multi-effect Ability added doesn't quietly repeat the gap — a quick check
against the other 4 Epic rows below is enough, no rigid template needed.

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
| `battle-instinct` | Battle Instinct | Aggression with nowhere left to go but into the next swing. | `statBoost attack +5` (min 5% base) |
| `iron-skin` | Iron Skin | Enough hits taken that the flinch stopped coming. | `statBoost defense +4` (min 5% base) |
| `hardy-constitution` | Hardy Constitution | Takes the same hits as everyone else and gets up from more of them. | `statBoost maxHp +20` (min 5% base) |
| `deep-reserves` | Deep Reserves | Holds more magic in reserve than most ever learn how to reach for. | `statBoost maxMp +10` (min 5% base) |
| `unshaken-resolve` | Unshaken Resolve | A mind trained not to let the dark get the better of it. | `fearResist 10%` |
| `sidestep` | Sidestep | A half-step sideways that's already happened by the time the blow arrives. | `dodgeChance 3%` |
| `leechs-thirst` | Leech's Thirst | Takes back a mouthful from every wound it deals. | `lifesteal 4%` |
| `arcane-aptitude` | Arcane Aptitude | Spells take shape before the words are finished. | `statBoost magicPower +5` (min 5% base) |
| `stubborn-blood` | Stubborn Blood | Poison, hexes, whatever the dark drips into the wound — sometimes the body just refuses it. | `debuffResist 10%` |

9 abilities, 9 distinct axes (attack / defense / maxHp / maxMp /
fearResist / dodgeChance / lifesteal / magicPower / debuffResist) — no 2 abilities
compete for the same pick. `arcane-aptitude` replaces the original
`poisonOnHit`-based 8th slot — see "Why `poisonOnHit` was removed
entirely" below the Rare table for the reasoning, which applies to every
tier at once, not just Common.

`arcane-aptitude`'s `+5` isn't copied from `battle-instinct`'s `+5`
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
axis: attack 5<10, defense 4<8, maxHp 20<50, dodge 3<6). Rounded down to
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
| `predators-edge` | Predator's Edge | Finds the gap in a guard before the enemy knows it's open. | `statBoost attack +10` (min 10% base) |
| `bulwark-stance` | Bulwark Stance | Feet set, weight behind the shield. Blows arrive at something already braced for them. | `statBoost defense +8` (min 10% base) |
| `second-wind` | Second Wind | Past the point where the body should have quit, there turns out to be a little more. | `statBoost maxHp +50` (min 10% base) |
| `bloodletting` | Bloodletting | Every wound it opens gives a little back. | `lifesteal 5%` |
| `featherstep-training` | Featherstep Training | Footwork most fighters never bother to learn, until it's the only reason they're still standing. | `dodgeChance 6%` |
| `restless-vigor` | Restless Vigor | Never quite at rest, even in camp, and first to move whenever anything starts. | `statBoost speed +5` |
| `deepened-channel` | Deepened Channel | The spell leaves with more behind it than the caster meant to give. | `statBoost magicPower +10` (min 10% base) |
| `wellspring` | Wellspring | A deeper reserve than the caster remembers building. | `statBoost maxMp +20` (min 10% base) |
| `fixed-gaze` | Fixed Gaze | Doesn't blink until the curse has taken. | `alwaysHit 10%` |
| `warded-flesh` | Warded Flesh | Old marks under the skin turn curses aside before they settle. | `debuffResist 16%` |

The first 5 mirror their Rare-tier artifact counterparts
(`ancient-sword`/`heart-of-stone`/`eternal-vial`, `vampiric-fang`,
`featherweight-boots`) — `restless-vigor` replaces the original
`poisonOnHit`-based `toxic-touch` and is calibrated directly against
`speed`'s own spread (see below), not against an Artifact.

`deepened-channel` mirrors `predators-edge` (`magicPower` and `attack` are
interchangeable, see Common); `wellspring` doubles `deep-reserves`'s `+10`.
`fixed-gaze` and `warded-flesh` are the middle rungs of the `alwaysHit`
(10 / 15 / 20) and `debuffResist` (10 / 16 / 24 / 32) ladders, see §11.1.1 and
§11.1.2. The matching Artifacts (`hunters-tally-stick`, `bitter-root-charm`,
`07-items-artifacts.md`) sit lower because up to three of them stack.

### Why `poisonOnHit` was removed from the Ability catalog entirely

Not a rebalance — a removal, at every tier that had it (`toxic-touch`
here, the old Common 8th slot, and half of the Epic `lodestone`
below, at the time still named `storm-within`).
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

**Why `speed +5`, not a number matched to Rare's other 3 flat-stat
abilities (attack+10/defense+8/maxHp+50) by the same balance-points method
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
one that never decays. `+5` was chosen directly against `speed`'s own
real spread instead: it closes roughly half of the entire 6-class gap, a
permanent, always-relevant nudge without redefining the turn order on its
own. The Unique-tier `quickened-pulse` continues the same ladder at `+8`.

### Unique — must be unlocked

| id | name | description | effect |
|---|---|---|---|
| `executioners-instinct` | Executioner's Instinct | Knows exactly where the killing blow lands, and how to recover from delivering it. | `healOnKill 20` (min 3% max HP) |
| `thunderous-aura` | Thunderous Aura | Lightning gathers on its own and strikes something every round, no weapon raised. | `autoDamage 20 + 40% magic power` |
| `vampiric-discipline` | Vampiric Discipline | Drinks deep from every wound it deals. | `lifesteal 10%` |
| `phantom-reflexes` | Phantom Reflexes | The body moves before the mind's finished deciding to. | `dodgeChance 12%` |
| `battle-scholar` | Battle Scholar | Writes down what nearly killed it after every fight, and reads it back before the next. | `expBoost 15%` |
| `hexbinder` | Hexbinder | Says the target's name aloud. The curse takes it as an order. | `alwaysHit 15%` |
| `quickened-pulse` | Quickened Pulse | A pulse that runs a beat ahead of everyone else's, and the body follows it. | `statBoost speed +8` |
| `bitter-marrow` | Bitter Marrow | What the enemy tries to put in the blood fails to take more often than it should. Something in the bone won't have it. | `debuffResist 24%` |

`thunderous-aura`/`vampiric-discipline`/`phantom-reflexes`/`battle-scholar`
exactly mirror their Unique-tier artifact counterparts (`thunder-totem`,
`bloodthirsty-blade`, `phantom-step`, `scholars-insight`).
**`executioners-instinct` is the one exception** — `data/artifacts.json`
has no Unique-tier `healOnKill` artifact to copy (only the Epic
`reapers-covenant` at `25`), so `20` is a deliberately interpolated value:
above what a Rare-tier effect would carry, below the Epic reference.

`hexbinder` (`alwaysHit 15`) and `bitter-marrow` (`debuffResist 24`) sit on
the same ladders. `quickened-pulse` (`speed +8`) continues Rare's
`restless-vigor` (`+5`).

### Epic — must be unlocked

| id | name | description | effects |
|---|---|---|---|
| `thornhide` | Thornhide | A share of every blow goes back to whoever dealt it, and there's more left in the body to take the next. | `reflectDamage 15%` + `statBoost maxHp +60` (min 10% base) |
| `reapers-instinct` | Reaper's Instinct | Every kill closes a little of what the fight opened, and every wound it deals feeds it a little more. | `healOnKill 25` (min 5% max HP) + `lifesteal 8%` |
| `lodestone` | Lodestone | Every enemy in the room keeps looking at it, and every round something near it takes a hit no one saw thrown. | `autoDamage 22 + 50% attack` + `statBoost aggro +15` |
| `grandmasters-focus` | Grandmaster's Focus | Waits less between strikes and takes more from every fight. | `cooldownReduction 1` + `expBoost 20%` |
| `unerring-will` | Unerring Will | Fear stays outside the hands. Some strikes, and some curses, land because they were never going to miss. | `alwaysHit 20%` + `fearResist 12%` |
| `arcane-font` | Arcane Font | Somewhere past the hundredth cast the caster stopped drawing on the magic and became where it comes from. The spells land harder, and the supply barely thins. | `statBoost magicPower +14` (min 10% base) + `statBoost maxMp +28` (min 10% base) |
| `sealed-bulwark` | Sealed Bulwark | Plate and ward set into the same frame — blows slow to land, and curses slower to stay. | `debuffResist 32%` + `statBoost defense +12` (min 10% base) |

`thornhide`/`reapers-instinct`/`grandmasters-focus` mirror their
Epic-tier artifact counterparts exactly (`immortal-heart`'s
`reflectDamage`/`maxHp` pair, `reapers-covenant`, `eternal-scholars-tome`)
— `thornhide` deliberately drops `immortal-heart`'s 3rd effect
(`defense +10`) to stay a 2-effect ability, since Abilities only ever
occupy 1 slot and don't need to match an Artifact's full effect count to
match its per-effect magnitude.

`lodestone` (originally `storm-within` — see `.hermes/features/abilities/BRAINSTORM.md` D15) used to
mirror `crown-of-destruction` exactly too (`autoDamage 12` +
`poisonOnHit 8%`) — its `poisonOnHit` half is now `statBoost aggro +15`
instead ("Why `poisonOnHit` was removed" under the Rare table has the
full reasoning; it doesn't scale-decay the way poison does, and pairs
naturally with `autoDamage`'s new flavor — everyone's eyes are drawn to
it, while something near it is struck by no visible hand). `+15` was
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

`arcane-font` (`magicPower +14`, `maxMp +28`) is `deepened-channel` and
`wellspring` merged and stepped up, with the `minPercent 10` floor Epic
`statBoost` entries carry. `sealed-bulwark` pairs the top `debuffResist` rung
with `defense +12`, an axis no other Epic uses.

`unerring-will` is the exception — it has no same-tier Artifact to copy: the
only Artifact `alwaysHit` is Rare's `hunters-tally-stick` at `8%` (§11.1.1). Placed at
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
