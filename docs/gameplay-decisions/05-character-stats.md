# §5. How character stats work and grow

*(section 5 of `00-index.md`)*

Sections 1-4 (`01-class-skill.md`, `02-monster.md`, `03-survival-stats.md`, `04-fear-combat.md`) already defined the effects of `fear`/`hunger`/`thirst`, of `attack`/`defense` (via the damage formula in `docs/technical-decisions.md` §3), of `aggro` (targeting, `02-monster.md` section 2), and of `speed` (turn order, `docs/technical-decisions.md` §2). What's still missing: **how HP/MP work**, and **how stats change when a character levels up**.

### HP
- HP hitting 0 (from any source — combat damage, hunger/thirst depletion from `03-survival-stats.md` section 3, or a status effect's `perTurnEffects`) → `Character.isAlive = false` **immediately**. True permadeath (per section 1.2 of the main design doc): no effect, skill, or item can revive a character once `isAlive = false`.
- If this happens mid-fight, the character that just died is skipped when `turnQueue` reaches its next turn (the skip handling already exists in `docs/technical-decisions.md` §2 — no extra logic needed).
- Monster hp ≤ 0 → no longer counts as a valid target/turn (`isActorAlive` returns `false`); there's no separate `isAlive` field for monsters (monsters don't have narrative permadeath — they simply vanish from the fight in practice, even though the entry stays in `CombatState.combatants`).

### MP
- Not having enough MP to cover a skill's `mpCost` → that skill is **not selectable** at the action-selection step (validated by the caller/UI, the same way `usesPerCombat` is checked before the resolver is invoked — `docs/technical-decisions.md` §3); the resolver never encounters an insufficient-MP case.
- MP does **not** auto-regenerate per action the way hunger/thirst auto-deplete — it only increases via a skill/item with a `restoreMp` effect, partially through the rest room (50% when choosing "Eat & Drink", 10% when choosing "Chat" — `03-survival-stats.md`, "Rest room" section), or fully refills on level-up (see below).

### Growth by level
- Level is shared across the whole party (no per-character XP tracking). Source of level gain: EXP accumulated from killing monsters — see `06-level-system.md` **§6.9**, kept separate from the dungeon floor level (§6.10). Max level is **100**; the full growth formula is in `06-level-system.md` §6.
- `aggro` and `speed` **do not** grow with level — they stay at `baseAggro`/`baseSpeed` for the whole game.
- On every level-up: current `hp`/`mp` are reset to **full (= the new maxHp/maxMp)**. Level-up trigger: "enough EXP to level up" (`06-level-system.md` §6.9) — leveling is not tied to descending a floor.
