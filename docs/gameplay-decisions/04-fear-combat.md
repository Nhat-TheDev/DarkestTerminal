# §4. Fear feeds back into combat — yes, but capped, with ways to escape it

*(section 4 of `00-index.md`)*

**Fear does affect combat performance**, applied per the tiers in `03-survival-stats.md` section 3. The effect is **capped at tier 4**. Active tools exist to lower fear: Acolyte's skills, items, the rest room.

**Source of truth for every number below**: the functions in `src/engine/resolver.ts` (`getFearTier`, `getFearAccuracyPenalty`, `getFearDamagePenalty`, `rollLosesControl`) and `src/engine/combat.ts` (`ultimateEffectivenessMultiplier`). None of this is exposed through `data/balance-config.json` — it's hardcoded alongside the fear-tier boundaries themselves, so read the functions directly rather than trusting numbers copied into this doc.

| Fear tier | Combat effect |
|---|---|
| Calm | No effect |
| Uneasy | Accuracy of skills targeting enemies drops (`getFearAccuracyPenalty`) |
| Panicked | Accuracy drops further, damage dealt also drops (`getFearAccuracyPenalty`/`getFearDamagePenalty`) |
| Broken | Each turn has a chance of "losing control" — skipping the turn entirely, equivalent to being stunned (`rollLosesControl`); the rest of the time it acts normally, at the same accuracy/damage penalty as Panicked |

Tier 4 (Broken) is the maximum — it does not get worse as fear climbs further.

### 4.1 Per-target accuracy rolls (AoE) + ultimates that always hit but scale down with fear

The table above is the **default rule for ordinary skills** (single-target or AoE), applied in 2 cases:

- **Single-target skills** (`singleEnemy`, or the "enemy" half when the player chooses an enemy for a two-sided skill like Purify): accuracy is rolled once for the whole skill — unchanged from before.
- **AoE skills targeting enemies** (`allEnemies`, or the "enemy" half of a two-sided skill like Divine Descent): accuracy is rolled **separately for each enemy** in the target list — one enemy can be hit while another dodges within the same use of the skill. The "ally" half of a two-sided skill (heal/buff) does not roll accuracy at all, keeping the old rule intact (fear only affects "skills targeting enemies").
- **Ultimate skills** (the skill in slot 5, `isUltimate: true`): **entirely bypass** both the accuracy roll and the damage-reduction rule from the table above — an ultimate always succeeds. Instead, its **effectiveness** (the `amount` value of every `damage`/`heal` effect in the skill) is multiplied by a coefficient looked up from `ultimateEffectivenessMultiplier(fear)` (`src/engine/combat.ts`), keyed off the caster's fear tier, **before** being plugged into the normal damage/healing formula — the multiplier decreases tier over tier, read the function for the current values.

  Technical note: this requires a field marking "this is an ultimate" distinct from `usesPerCombat` — see `docs/technical-decisions.md` §4.
