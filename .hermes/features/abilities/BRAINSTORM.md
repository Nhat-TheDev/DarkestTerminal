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

## Revision — gaps found on a deeper spec review (post-finalization)

A second, deeper pass over the finalized spec (requested explicitly: "review
chi tiết hơn") surfaced real internal contradictions the first pass missed.
Fixed directly in `docs/gameplay-decisions/11-abilities.md`; logged here for
the decision trail.

- **Loss-roll granularity was wrong.** The original spec said "for every
  *character* whose equipped ability is non-common, roll a loss chance."
  But `unlockedAbilityIds` is a single list shared by the whole profile —
  if 2 characters both have the same ability equipped, "lost for character
  A, kept for character B" is not a representable state. **Fixed**: the
  loss roll (and the reconfirm exemption) is now per **distinct equipped
  ability id** across the party, rolled once regardless of how many
  characters share it.
- **Common abilities shouldn't enter `runAbilityPool` at all.** The
  original spec let a `common` roll get appended to the pool and then
  treated confirming it as a harmless no-op at death. Simpler and
  equivalent: never append a `common` result to the pool in the first
  place (rejected alternative: filtering it out at confirm-time instead —
  works but adds pointless entries to the death-time candidate list for no
  benefit).
- **The candidate-list / no-op interaction needed disambiguating.** An
  already-unlocked non-common id must **stay pickable** in the death-time
  confirm picker even though picking it doesn't change the profile — its
  entire purpose there is triggering the reconfirm/insurance exemption,
  not the (redundant) unlock. The original wording risked being read as
  "filter out no-ops," which would have silently broken the insurance
  mechanic.
- **Single global `profile.json` wasn't stated outright.** Confirmed
  against `src/engine/save.ts`: `resolveSaveDir()` is one directory per
  install, already shared by every quicksave/autosave/manual save — so
  `profile.json` sitting there is naturally global, not per-slot. Stated
  explicitly now to close the ambiguity rather than leaving it implied.
- **Save-scumming named as an accepted, pre-existing risk.** Elite/Boss
  drop rolls (Artifacts today, Abilities once implemented) both read from
  the live RNG stream, so reloading a save before the kill and refighting
  can reroll the result. Abilities raise the stakes (a permanent profile
  change vs. a single-run Artifact), so the incentive to abuse this is
  stronger — explicitly flagged as a known, unsolved follow-up rather than
  silently inherited.
- **Save-integrity implementation note added**, not a design change:
  `isSaveStateValid`/`migrateGameState` will need new validation/migration
  branches for the 3 new state fields, mirroring the existing
  `equippedArtifactIds` handling — flagged now so it isn't missed once
  coding starts.

## D7. Insurance-laundering exploit found on a 3rd review pass — capped

A follow-up review of the fixes above (specifically checking whether the
confirm-picker-then-loss-roll ordering combined with an uncapped
reconfirm exemption could be abused) surfaced a real, previously
undocumented gap: nothing stopped a player from insuring **every**
distinct non-common ability the party has equipped in the same death, as
long as they'd re-rolled each one from an Elite/Boss kill that run and had
enough confirm slots (up to 6 at depth ≥ 30) to spend on all of them. A
4-character party rarely equips more than 3-4 distinct non-common ids, so
a sufficiently deep/long run could realistically launder its *entire*
loadout past the loss roll, every death — silently defeating the "high,
steep loss risk" the user explicitly chose (over the flatter/lower-risk
alternatives) precisely on the runs where the most was at stake.

Rejected alternatives:
- **Leave it uncapped, document as an accepted "reward for skilled/deep
  play"** — rejected: this isn't a skill reward, it's a mechanical bypass
  of the death mechanic's core risk, and it disproportionately favors
  exactly the deepest/most-invested runs, the opposite of where risk
  should bite hardest.
- **Replace the exemption with a %-reduction instead of a full skip**
  (e.g. insuring a reconfirmed id halves its loss chance instead of
  zeroing it) — rejected as unnecessary complexity for the same practical
  outcome as a hard cap, and it still doesn't bound how many ids can be
  discounted at once in a single death.

**Decided**: `abilities.maxInsurancePerDeath = 1` — a hard cap, independent
of `confirmSlots`, on how many of the picks made in the death-time confirm
step may actually trigger the loss-roll exemption. The player can still
confirm up to `confirmSlots` *new* (not-currently-equipped) abilities into
the profile as before; only the insurance side-effect is capped. This
preserves the intended flavor (protect the 1 talent you care about most)
while guaranteeing every other equipped non-common ability still faces its
full, uncapped `lossChance` every death — keeping the mechanic's stakes
real at exactly the depth where the user wanted them to matter most.

## D8. User-directed redesign — Stardust replaces the probabilistic loss/reconfirm system entirely

The user requested 4 changes in one turn, which together superseded D3-D7
above rather than layering on top of them. Logged individually:

**D8.1 — No 2 party members may equip the same ability id.** Directly
requested ("mỗi char sẽ mang abilities khác nhau không trùng lặp").
Reverses the earlier "no exclusivity lock" call from the first pass. Side
benefit discovered while integrating it: this makes the old "roll per
distinct id vs. per character" ambiguity (D-fix from the 2nd review round)
moot going forward — with no duplicates possible, "per id" and "per
character" are now the same thing by construction.

**D8.2 — Elite/Boss ability rolls exclude ids already in
`unlockedAbilityIds`.** Directly requested ("tỉ lệ rơi chỉ rơi những
abilities chưa có trong pool chung"). Implemented as an exclusion filter
at roll time, with a re-roll-the-tier fallback for the case where an
entire rarity tier is already exhausted, and a "yields nothing" fallback
for the case where the whole catalog is exhausted (see 11-abilities.md
"Edge cases").

**D8.3 — New Stardust currency, earned only from Boss kills (every 5
floors), spent only at that run's own death.** Directly requested: amount
(1 per Boss kill), cost table (Rare 2 / Unique 3 / Epic 4), and "used only
in the run it dies in, not persistent" (user's answer to the dedicated
clarifying question — rejected alternative: banking Stardust across runs
in `profile.json`, which the user didn't choose).

Follow-up clarifying question resolved **Elite's role**: the user chose to
keep Elite's existing probabilistic ability-drop mechanic rather than
retire it in favor of Boss-only acquisition. Reconciling this with D8.3
("pool lựa chọn sẽ là các abilities nhận từ boss") required a 2-tier
acquisition split not explicit in the user's original message, decided
here: **Elite drops unlock instantly and for free** (no pool, no Stardust,
mirrors nothing else in the game exactly but is the simplest way to keep
Elite relevant without it colliding with the boss-only buyback pool);
**Boss drops go into a new `runBossAbilityPool`**, spent only through the
Stardust buyback. Rejected alternative: keep Elite drops in the same
per-run pool as Boss drops but exclude them from buyback eligibility —
rejected because that leaves Elite-found abilities with no resolution
path at all (never unlocked, never usable), which is strictly worse than
either "unlock it" or "don't roll it."

Also resolved via clarifying question: the Boss-found candidate pool at
buyback time is **shared across the whole party**, not bound to whichever
character was in the fight that dropped it — the user picked this over
per-finder-character ownership, and it's also what makes "swap to a new
ability" a real choice for every lost-set entry regardless of who
personally defeated which Boss.

**D8.4 — Death now guarantees the loss of every equipped non-common
ability (no roll), recoverable only through the Stardust buyback.**
Directly requested ("khi chết sẽ mất toàn bộ abilities [không phải]
common trên người — điểm thay đổi" — the user's own words flagging this as
the one deliberately changed point from the earlier design). This retires
`lossChance` (Rare/Unique/Epic %) and `maxInsurancePerDeath` entirely —
both existed only to manage risk around a probabilistic system that no
longer exists. The old D7 problem (uncapped insurance could launder an
entire loadout) doesn't need re-solving under the new system: Stardust
itself is the natural, self-scaling budget constraint (a typical
depth-15-25 death affords 1-2 reclaims out of a possible 4, and fully
recovering a mixed-rarity 4-ability loadout costs roughly 4 Boss kills'
worth of Stardust at minimum) — no artificial cap needed on top.

`confirmSlots`/`depthPerConfirmSlot`/`maxConfirmSlots` are also retired:
they existed to gate *new* unlocks by depth-as-score, but under the new
design "how much you can recover" is governed entirely by how much
Stardust you earned (itself already depth-correlated via the Boss
cadence), so a separate score-derived slot count would be redundant.

## D9. Review found the Stardust redesign had its own new bug — fixed

A review pass over D8's redesign caught a real exploit introduced by it:
the original wording had **Swap** cost "the same" Stardust as **Reclaim**
— i.e., priced by the *lost* ability's rarity rather than the *candidate's*
rarity. That would let a lost Rare ability (cost 2) buy an Epic candidate
out of `runBossAbilityPool` for 2 Stardust instead of its own listed cost
of 4, silently breaking the "why this replaces the old system" paragraph's
own claim that Stardust scarcity is what keeps recovery bounded.

**Fixed**: Swap costs `stardustCostByRarity[candidate's rarity]`, always —
what you're *acquiring* sets the price, never what you're *replacing*.

The same review also flagged that "a candidate becomes unavailable to
every other pending entry the moment one entry claims it" was an outcome
claim without an implementation contract — if the buyback UI let multiple
lost-set entries be tentatively set to the same candidate before a single
batch "confirm," 2 entries could both land on it with nothing in the spec
saying how that resolves. **Fixed**: the doc now specifies lost-set
entries are resolved strictly one at a time, each choice committing
immediately (added to `unlockedAbilityIds` and removed from
`runBossAbilityPool` before the next entry is even presented) — closing
the race by construction rather than by an after-the-fact rule.

## D10. User simplification — no "swap for something new" at death, ever

The user corrected D8/D9's design directly: "Không có đổi abilities mới.
Vì chạy run khác chọn char và chọn abilities lại từ đầu. Nhưng có thêm
nhiều lựa chọn hơn do đã đổi được abilities từ run trước" — there is no
swap-for-a-different-ability decision at death at all. Getting more
choices in a future run isn't a separate reward mechanic; it's just what
naturally happens because the *next* character-select screen (which
already always runs from scratch, §11.1) sees whatever `unlockedAbilityIds`
looks like by then.

This retires the entire `runBossAbilityPool` concept from D8/D9, and with
it both bugs D9 fixed (the swap-cost-by-wrong-rarity bug and the
shared-candidate sequencing contract) — there's no candidate pool left to
have a cost-by-source ambiguity or a claim race over, since the game
designed them, not this doc, was the actual root cause: they only existed
to support Swap, and Swap no longer exists.

Rejected alternative (implicit in the correction, not proposed by the
user but worth logging as the thing this decision rules out): keeping
Boss-found candidates gated behind Stardust while removing only the
"swap to something else" framing (i.e., Stardust could still be spent to
unlock a Boss find directly, just not as a *replacement* for a lost
ability) — rejected because the user's own reasoning ("chọn char và chọn
abilities lại từ đầu... có thêm nhiều lựa chọn hơn") frames *all*
mid-run finds, Elite or Boss, as flowing into the same ordinary unlock
pool the same way, with Stardust's role narrowed to exactly one thing:
reclaiming what death took away.

**Decided, replacing D8's Elite/Boss split**: Elite **and** Boss ability
rolls both resolve identically — instant, free, permanent addition to
`unlockedAbilityIds` on a hit, no pool, no gate. Boss kills *additionally*
grant 1 Stardust unconditionally (unrelated to whether its own ability
roll hit). Stardust's sole purpose is now the death-flow "Reclaim" action
— pay `stardustCostByRarity[the lost ability's own rarity]` to re-add the
*exact* id a character just lost back to `unlockedAbilityIds`. No "Skip
to something else" option exists; the only choices per lost ability are
Reclaim or leave it lost.

This is a net simplification over D8/D9: no per-run pool field, no
candidate-sharing rules, no source-vs-target rarity ambiguity, no
sequencing contract to get right at implementation time — the reclaim
cost is unambiguous by construction (there's only ever 1 possible rarity
in play per lost-set entry: the lost ability's own).

## D11. User caught intra-tier power imbalance in the Common catalog — fixed by axis separation

User flagged, after reviewing the full catalog list: "Cùng tier nhưng có 1
số abilities có sức mạnh khác nhau. Hãy đảm bảo cân bằng" (same tier, but
some abilities have different power — make sure it's balanced). Auditing
all 4 tiers for same-axis collisions found the problem was entirely
confined to Common:

- `steady-hands` (`statBoost attack +3`) vs. `battle-instinct`
  (`statBoost attack +4`) — same axis, `battle-instinct` strictly better.
- `vital-spark` (`statBoost maxHp +20`) vs. `hardy-constitution`
  (`statBoost maxHp +30`) — same axis, `hardy-constitution` strictly
  better.
- `deep-reserves` (`statBoost maxMp +10`) vs. `focused-mind`
  (`statBoost maxMp +15`) — same axis, `focused-mind` strictly better.

Rare/Unique/Epic were already clean — each ability in those 3 tiers
already owns a distinct effect axis (verified by listing every tier's
effect kinds and confirming no repeats), so no changes were needed there.

**Why this is a real bug for Abilities specifically, not just a stylistic
nitpick**: the base game's own Artifact catalog has the exact same
same-axis-different-magnitude pattern within Common (`iron-gauntlet`
+3 attack alongside `sharp-claw` +4 attack, `charm-of-life` +20 maxHp
alongside `stone-of-endurance` +30 maxHp, etc.) and it's fine there,
because a run can eventually equip both across its 12 Artifact slots — the
"weaker" one still adds value on top of the stronger one. Abilities don't
have that: exactly 1 slot per character, permanently. A strictly-dominated
option in a single-pick catalog isn't a weaker choice, it's a choice that
never gets made — 3 of Common's 8 entries were effectively dead.

Rejected alternatives:
- **Equalize magnitudes within each pair** (e.g. make `steady-hands` also
  `attack +4`) — rejected: removes the dominance but leaves 2 abilities
  that do the literally identical thing under different names, which
  wastes catalog space in a different way (a "choice" between 2 identical
  options isn't a choice) and does nothing for the run's actual
  build diversity.
- **Bump the weaker one's magnitude above the stronger one** — rejected:
  just relocates the dominance to the other ability instead of removing
  it.

**Decided**: give each of the 3 dominated abilities a genuinely different
effect axis instead of a different number on the same axis, chosen to fit
their existing flavor text as closely as possible:
- `steady-hands` → `dodgeChance 3%` ("no wasted motion, no unnecessary
  hits taken" — precision reframed as evasion).
- `vital-spark` → `lifesteal 3%` ("pulls a little life back from every
  wound dealt" — a stubborn will to keep going, reframed as sustain
  through combat instead of a flat HP pool).
- `focused-mind` → `poisonOnHit chance 3%` ("finds the one precise,
  lingering weak point in any guard" — a mind sharp enough to place a
  hit that keeps hurting, rather than one that casts more spells).

None of these 3 effect kinds previously appeared at Common rarity in
either catalog (dodgeChance/lifesteal/poisonOnHit start at Rare on
Artifacts) — each was set to roughly half its Rare-tier Ability
counterpart, rounded to a clean number (3% against `featherstep-
training`'s 6%, `bloodletting`'s 5%, and `toxic-touch`'s 6%
respectively), the same "no same-tier reference exists, interpolate from
the nearest tier" approach already used for `executioners-instinct`'s
Unique-tier value — just applied downward (halving the tier above)
instead of upward (splitting the gap to the tier above).

Net result: all 4 tiers now have exactly 1 ability per effect axis within
that tier — no same-tier pick is ever strictly better than another,
by construction rather than by careful number-tuning that could drift out
of balance on the next edit.

## D12. D11's own magnitudes were called out as unverified — recomputed from real combat numbers

The user pushed back directly on D11's justification for the 3 new
Common values (dodgeChance/lifesteal/poisonOnHit, all set to 3%): "tránh
để việc thay đổi này chỉ là thay đổi cho có lệ" (don't let this be a
change made just for appearances) — specifically calling out the
reasoning "these effect kinds never appeared at Common before, so [we]
added them" as a justification for the *number chosen* (a uniform half of
each one's Rare-tier %), not just for *why a new axis was needed*. Fair
call: halving a percentage uniformly across 3 different effect kinds only
produces equal *value* if a percentage point is worth the same thing for
all 3, and it isn't in this combat system.

Redone from the game's actual damage formula rather than a borrowed
ratio: `mitigatedOffense(off, def) = off − off·def/(60+def) − def/30`
(`src/engine/resolver.ts`, `combat.defenseMitigationX/Y` in
`data/balance-config.json`), evaluated for a representative early fight —
a depth-2 Dungeon Rat (atk 19, def 3, `data/monsters.json`) against the
level-1 party-average character (atk 10, def 7, from `data/classes.json`
across all 6 classes), over an assumed ~4-round fight (the game's own
"quick victory" benchmark is 3 rounds — `03-survival-stats.md` — so 4
represents a typical, non-quick regular fight) with roughly 1 attack
thrown and 1 taken by the wearer per round.

This gives: damage taken/hit ≈16.8, damage dealt/hit ≈9.4, a poison proc's
full payout = 12 (`data/status-effects.json`, 4/turn × 3 turns). At the
original flat 3%, per-fight expected value was **2.01 (dodge) / 1.44
(poison) / 1.13 (lifesteal)** — lifesteal was quietly worth barely half of
dodge despite an identical-looking number, because the wearer's outgoing
damage (9.4) is much smaller than the incoming damage a dodge prevents
(16.8), so the same % delivers proportionally less value when it's a cut
of the smaller number. This asymmetry was invisible in D11's reasoning
because D11 never checked value, only that the axes were distinct.

Solving each effect's % for a shared ~2.0-per-fight EV target instead:
dodge ≈2.98% (rounds to the same 3% D11 already had — confirmed correct
by calculation this time, not by assumption), lifesteal ≈5.3%, poison
≈4.2%.

**Decided**: dodge stays **3%**, poison becomes **4%** (EV 1.92, within
5% of target), lifesteal becomes **4%** (EV 1.51, a real ~33% correction
from 1.13 — not the full ≈5.3% solved value, because that would tie or
exceed Rare's own `bloodletting` at 5%, breaking the one pattern every
other shared axis in the catalog follows: Rare strictly exceeds Common on
the same axis, e.g. attack 4<8, defense 3<8, maxHp 30<50, dodge 3<6).
Rejected alternatives:
- **Keep the uniform 3%** — rejected outright per the above: demonstrably
  not equal-value, the exact "cho có lệ" failure mode being corrected.
- **Use the fully solved 5.3% for lifesteal** — rejected because it
  breaks Common-strictly-under-Rare on a shared axis, the one convention
  every other pair in the catalog upholds; 4% is the highest value that
  both improves meaningfully on 3% and still respects that convention.

Explicitly logged as an approximation, not a claim of precision: it
depends on 1 chosen fight length and a simplified 1-hit-per-round
exposure rate, and the doc says so. What changed isn't that the numbers
are now "exactly right" — it's that they're now *falsifiable against the
game's real formula* and checked against each other, instead of being a
ratio inherited from a different tier's numbers that were never
themselves verified to be internally consistent (checking Rare's own
6%/5%/6% trio the same way shows it isn't perfectly EV-equal either — a
pre-existing property of the base Artifact catalog this doc inherited,
out of scope to fix here since Rare has no dominance problem, only a
softer value gap between viable, non-dead choices).
