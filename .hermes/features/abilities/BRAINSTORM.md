# Brainstorm: Abilities meta-progression

Status: finalized. All architectural decisions came from the user directly
(via conversation) or from codebase investigation; the remaining numeric
constants and UI-copy details were explicitly delegated to the implementer
("these are all easily tunable JSON constants, not hard architectural
choices") and are resolved below with rationale, not left open.

## Source of Truth (already decided, not up for debate in this doc)

1. **What an Ability is**: a single passive slot per character (max 1,
   separate from the 3 Artifact slots), chosen at character-select from a
   **persistent, cross-run unlock pool** — the game's first ever
   cross-run persistence (confirmed by codebase investigation: today
   everything lives in one run's `SaveFile`, `src/engine/save.ts`).
2. **Rarity tiers**: reuse `ArtifactRarity` (`common | rare | unique |
   epic`, `src/types.ts:143`) as-is — same domain concept, no reason to
   fork it.
3. **Effect vocabulary**: reuse the exact `ArtifactEffect` groups 1-4
   (`statBoost`, `reflectDamage`, `poisonOnHit`, `lifesteal`,
   `dodgeChance`, `healOnKill`, `autoDamage`, `expBoost`, `fearResist`,
   `cooldownReduction`) — **not** `curseAggroBoost` (stays exclusive to
   cursed Artifacts). The engine already resolves these purely by
   `effect.kind`, scoped today to `equippedArtifactIds` — generalizing the
   scan to "equipped artifacts + the 1 equipped ability" is a small,
   contained change, not a rewrite of 9 hooks.
4. **Starting availability**: every `common` ability in the catalog is
   always selectable, no unlock needed. `rare`/`unique`/`epic` abilities
   must appear in the persistent profile's `unlockedAbilityIds` before
   they can be picked in *any* future run.
5. **Character-select flow**: new step between `showCharacterSelect`
   (`src/ui/characterSelect.ts`) resolving and `new Game(...)` finishing
   construction (`src/engine/game.ts` constructor, party built ~line 61,
   `checkEntryRoomAmbush()` ~line 85) — 1 ability pick per character,
   fixed for the whole run. Stored as `Character.equippedAbilityId?: Id |
   null`, directly on `Character` (parallel to `equippedArtifactIds`) —
   simplest option since it never changes mid-run, confirmed correct by
   investigation of `createCharacter` (`src/engine/party.ts:52-76`).
6. **Mid-run acquisition**: Elite/Boss kills (`src/engine/game.ts`
   ~358-372, the existing `rollArtifact`/`grantArtifact` branch) get a
   parallel, independent roll for an ability. Unlike Artifacts, this is
   **not** an immediate equip/discard decision — it's silently appended
   to a new `GameState.runAbilityPool: Id[]` (duplicates allowed on
   purpose — see point 8).
7. **Depth scaling**: "the higher the floor, the better the ability" is
   implemented the same way item-weight depth scaling already works
   (`items.itemWeightDepthGrowth`, `src/data/items.ts`) — a formula the
   codebase already trusts, not a new idea introduced by this feature.
8. **Death flow / scoring** — user-decided, not re-litigated here:
   - Score = `state.floor.depth` reached at death (not kill count, not a
     depth+boss-kills composite — user picked "floor depth reached" for
     simplicity and consistency with the game's existing "depth is your
     record" philosophy).
   - At death, `confirmSlots` lets the player pick that many abilities out
     of the run's (deduplicated) `runAbilityPool` to permanently add to
     the profile's `unlockedAbilityIds`.
   - Loss risk is **high and steep by rarity** (user explicitly chose the
     "Cao, tăng mạnh theo rarity" option over the flatter alternatives) —
     for every character whose equipped ability is non-common, roll a
     rarity-scaled chance to permanently strike it from the persistent
     profile.
   - **Reconfirm/insurance exception**: if the character's already-equipped
     ability was re-rolled into `runAbilityPool` this run *and* the player
     spends one of their confirm slots on that same id, the loss roll is
     skipped entirely for that character this death. This is what makes
     duplicate rolls of an already-unlocked ability meaningful instead of
     wasted (point 6).
   - The player is told afterward which character lost which ability, so
     future character-select choices are informed.
9. **Storage**: a new sibling file next to per-run saves in
   `resolveSaveDir()` (`src/engine/save.ts`) — `profile.json`, shape `{
   version: number; unlockedAbilityIds: Id[] }`. Written independently of
   `SaveFile`/`deleteSavesForRun` so permadeath's save-wipe (`postMoveCheck`
   → `deleteSavesForRun`, confirmed the sole "defeat" path in the game —
   there is no reachable "victory" state today) never touches it.
10. **Docs convention**: new `docs/gameplay-decisions/11-abilities.md`
    following the exact structure of `07-items-artifacts.md`, cross-linked
    from `00-index.md` and `design-doc.md` §1.6/§5 the same way
    Items/Artifacts already are.

## Decisions delegated to the implementer (resolved here, with rationale)

### D1. `equippedAbilityId` placement
**Decided**: directly on `Character`, optional (`equippedAbilityId?: Id |
null`). Already covered under Source of Truth point 5. The only real
alternative — a separate side-table keyed by character id — was rejected:
it would just be extra indirection for a value that's 1:1 with a character
and never changes mid-run.

### D2. Ability drop chance per Elite/Boss kill
Rejected alternatives:
- **Guaranteed (100%), like Artifacts** — rejected: Artifacts are already
  guaranteed on every Elite/Boss; stacking a second guaranteed permanent
  reward on the same kill would over-reward late-game farming and clash
  with abilities being the *rarer*, higher-stakes system (permanent loss
  risk attached, unlike Artifacts).
- **Very low (~10%)** — rejected: at that rate a run needs many Elite/Boss
  kills before the `runAbilityPool` has anything worth confirming, which
  fights the death-flow design (point 8) where the pool is meant to
  routinely have *something* to choose from.

**Decided**: `abilities.dropChance = 0.35` (35%, independent roll,
separate from the Artifact roll on the same kill) — sits deliberately
below `items.itemDropChance` (0.6, existing constant) since an ability is
a much higher-stakes, permanent-pool-affecting reward than a consumable.
Stored as a single tunable balance-config constant.

### D3. Rarity-weight-by-depth curve
Rejected alternatives:
- **A single static table** (like Artifacts' `RARITY_WEIGHTS`, no depth
  scaling) — rejected: it directly contradicts the user's explicit
  requirement ("tầng càng cao cấp độ abilities sẽ càng tốt").
- **A continuous formula per rarity** (`effectiveWeight = min(cap, weight +
  growth × (depth-1))`, i.e. reusing the item-weight-growth formula
  verbatim) — rejected as the *sole* mechanism: that formula only grows a
  single weight toward a ceiling, it doesn't also shrink the *other*
  weights, so tables don't visibly "graduate" from common-heavy to
  epic-heavy the way the request implies.

**Decided**: two fixed weight tables per source (`elite`, `boss`) — one
"at depth 1" and one "at depth cap" — linearly interpolated per rarity by
current floor depth, clamped to `[1, depthCap]`. This is a small, fully
deterministic, easily unit-tested mechanism (exact values at depth 1 and
depth cap are asserted directly; a midpoint can be spot-checked by the
same linear formula) while still satisfying "higher floor ⇒ better
odds" continuously in between.

```jsonc
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

Rationale for the specific numbers: `depthCap = 30` and
`depthPerConfirmSlot = 5` both key off the existing `bossFloorInterval =
5` (`data/level-growth.json`) — a real Boss (and thus the best ability
odds) appears every 5 floors, so "1 more confirm slot every 5 floors"
keeps the death-scoring cadence aligned with the game's own difficulty/
reward cadence instead of introducing an unrelated number. `depthCap = 30`
= 6 boss floors deep, a genuinely deep run, by which point the tables have
fully "matured" — `maxConfirmSlots = 6` (see D5) is set to match this
exactly, so a death at or past depth 30 both maxes out the rarity tables
and earns the full 6 confirm slots (`floor(30 / 5) = 6`) in the same
breath, instead of the cap and the cadence disagreeing by one slot.
`elite`/`boss` depth-1 tables intentionally mirror the existing Artifact
`RARITY_WEIGHTS` shape (elite skews common/rare, boss skews unique/epic,
boss never rolls common) so the two reward systems feel consistent at
floor 1.

`confirmSlots` formula, made explicit here rather than left to prose:
`confirmSlots = min(maxConfirmSlots, floor(depthReached /
depthPerConfirmSlot), dedupedRunAbilityPool.length)` — the 3rd term is the
obvious real-world ceiling (never offer more slots than there are distinct
abilities to spend them on).

### D4. Loss-chance-by-rarity values
User already fixed the *shape* ("cao, tăng mạnh theo rarity"). Concrete
numbers chosen from the user's own example anchors in that conversation
turn (rare ~25%, unique ~45%, epic ~65%) — used verbatim rather than
re-deriving different numbers, since the user cited them as their
preferred anchor point for "high and steep."

### D5. Confirm-slot cap
**Decided**: `maxConfirmSlots = 6` — set to exactly match `floor(depthCap /
depthPerConfirmSlot)` (see D3's reconciliation note) so the cap and the
depth-scaling cadence tell the same story instead of disagreeing by one
slot. In practice `runAbilityPool` rarely holds much more than this in a
single run at the drop rate above, so the cap is a safety ceiling more
than an active balance lever.

### D6. UI copy/layout for the 2 new screens
No prior art to contradict — decided by directly mirroring existing
conventions:
- **Character-select ability pick**: same interaction shape as
  `characterSelect.ts` (number-key select, list rendered with rarity tag
  next to each name, `[locked]` abilities from higher tiers simply don't
  appear in the list — nothing to render for what the player hasn't
  unlocked yet). One sub-screen per character in party order, "skip/no
  ability" bound to a dedicated key (`0`) alongside the numbered list.
- **Game-over confirm/results**: extends `gameover.ts` with the same
  `handleKey`/render-loop shape as `artifactDecision.ts`, in 2 stages
  (confirm-picker shown only if `runAbilityPool` is non-empty and
  `confirmSlots > 0`, then a results summary always shown) rather than a
  single combined screen — keeps each screen's key-handling logic small
  and matches the existing "1 screen module = 1 focused interaction"
  pattern (`artifactDecisionPickCharacter` / `artifactDecisionPickReplace`
  already split this way for the Artifact flow).

## Explicitly out of scope for this feature (see PLAN.md Scope for the full list)
- No UI/engine work for a "victory" end state (none exists today; abilities
  only ever resolve through the defeat path).
- No changes to the Artifact system itself beyond generalizing the passive-
  effect scan (D-independent, Source of Truth point 3).
- No mid-run ability swapping/respec.
