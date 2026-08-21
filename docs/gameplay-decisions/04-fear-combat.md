# §4. Fear feeds back into combat — yes, but capped, with ways to escape it

*(section 4 of `00-index.md`)*

**Fear does affect combat performance**, applied per the tiers in `03-survival-stats.md` section 3. The effect is **capped at tier 4**. Active tools exist to lower fear: Acolyte's skills, items, the rest room.

| Fear tier | Combat effect |
|---|---|
| Calm (0-39) | No effect |
| Uneasy (40-69) | Accuracy of skills targeting enemies drops by 10% |
| Panicked (70-99) | Accuracy drops by 20%, damage dealt drops by 15% |
| Broken (100) | Each turn has a 25% chance of "losing control" — skipping the turn entirely (equivalent to being stunned); the remaining 75% acts normally (no further accuracy/damage penalty beyond the Panicked tier) |

Tier 4 is the maximum — it does not get worse as fear climbs further.

### 4.1 Per-target accuracy rolls (AoE) + ultimates that always hit but scale down with fear

The table above is the **default rule for ordinary skills** (single-target or AoE), applied in 2 cases:

- **Single-target skills** (`singleEnemy`, or the "enemy" half when the player chooses an enemy for a two-sided skill like Purify): accuracy is rolled once for the whole skill — unchanged from before.
- **AoE skills targeting enemies** (`allEnemies`, or the "enemy" half of a two-sided skill like Divine Descent): accuracy is rolled **separately for each enemy** in the target list — one enemy can be hit while another dodges within the same use of the skill. The "ally" half of a two-sided skill (heal/buff) does not roll accuracy at all, keeping the old rule intact (fear only affects "skills targeting enemies").
- **Ultimate skills** (the skill in slot 5, `isUltimate: true`, `cooldownTurns: 5`): **entirely bypass** both the accuracy roll and the 15% damage reduction from the table above — an ultimate always succeeds. Instead, its **effectiveness** (the `amount` value of every `damage`/`heal` effect in the skill) is multiplied by a coefficient based on the caster's fear tier, **before** being plugged into the normal damage/healing formula:

  | Fear tier | Ultimate effectiveness multiplier |
  |---|---|
  | Calm (0-39) | 100% |
  | Uneasy (40-69) | 90% |
  | Panicked (70-99) | 75% |
  | Broken (100) | 60% |

  Technical note: this requires a field marking "this is an ultimate" distinct from `usesPerCombat` — see `docs/technical-decisions.md` §4.
