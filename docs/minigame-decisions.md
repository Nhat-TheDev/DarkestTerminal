# Mini-game — Future direction (not yet implemented)

**Not present in the current code.** This document is a reference spec for
when the mini-game is built, and does not describe the current state of the
game — see `../design-doc.md`, section "Future direction".
**Related**: `./design-doc.md` items 1.7, 1.8

---

## 1. Boss-fight ↔ mini-game relationship

Decision: **the boss fight is NOT fully replaced by a mini-game** — it remains a normal turn-based combat (turn queue, skills, items just like regular combat), the mini-game only cuts in as **a brief interrupting "phase"**, in keeping with the `GameMode.miniGame.reason: "bossPhase"` already present in the data model.

Mechanic:
- Every boss has 1 or more **HP thresholds that trigger a phase** (e.g. 50% HP). When the boss's HP hits a threshold, combat pauses (the existing turn queue isn't lost — `CombatState` is preserved), and `GameMode` switches to `{ kind: "miniGame", reason: "bossPhase" }`.
- The mini-game used for the phase: **Magic Tiles** by default (already simplified enough to be safely used broadly — see item 1.8 in the main design doc), but the `miniGameId` field on `SkillEffect`/the boss config still allows assigning a different game for variety.
- Winning the phase: `MiniGameResult.maxCombo` converts into direct damage to the boss (see the combo formula in section 2) — counted as one "hit" outside the turn queue, costing no one a turn.
- Losing the phase: no insta-kill, no turn lost — just `fear += 15` for the whole party (same as losing a normal mini-game, `gameplay-decisions/03-survival-stats.md` section 3), then turn-based combat resumes normally from exactly where it left off.
- Each HP threshold triggers the phase **exactly once** (to avoid spamming the mini-game repeatedly if the boss's HP oscillates around the threshold due to healing/lifesteal).

---

## 2. Magic Tiles — specific numbers

Principle (already settled in design doc 1.8): tune for the average player's expectations, without needing to maintain an unbroken combo to win.

| Variable | Used for curing debuffs | Used for boss phase |
|---|---|---|
| Round duration | 20 seconds | 30 seconds |
| Tile spawn rate (gap between 2 tiles) | starts at 700ms, decreases with floor depth down to a floor of 400ms (`spawnIntervalMs = max(400, 700 - floorDepth * 15)`) | fixed at 500ms (harder than the default debuff-cure, independent of floor) |
| Target score | `targetScore = round(duration_seconds * 1.2)` → 24 points | `round(30 * 1.2)` → 36 points |

- Each tile hit = **+1 point** (binary, not graded — already settled in 1.8).
- **Combo**: every 5 consecutive hits without a miss increases the multiplier by an additional **+0.1x**, capped at **2.0x** (i.e. a max combo of 50 consecutive hits). Missing 1 tile → combo resets to 0, but **points already scored are not deducted** (the win condition only looks at total score, not combo).
- The end-of-round combo multiplier (`maxCombo` converted into a multiplier, e.g. combo 20 → 1.4x) multiplies into:
  - Debuff-cure effectiveness (e.g. reducing the remaining `durationTurns` of a status effect proportionally to the multiplier) when used for debuff-curing.
  - Damage dealt to the boss when used for a boss phase: `bossDamage = baseBossPhaseDamage * comboMultiplier`, with `baseBossPhaseDamage` being a balancing constant specific to each boss (not fixed here).
- Win/lose: reaching `targetScore` within `duration` = win (maps to `MiniGameResult.won = true`), running out of time without enough score = lose (`won = false`, `fearDelta = +15`).

---

## 3. Magic Tiles — live progress UI

- **Score bar**: a horizontal progress bar at the top of the mini-game screen, showing `score / targetScore` (e.g. "14 / 24"), updated immediately on every hit — not waiting for a periodic tick.
- **Time bar**: a thin progress bar just below the score bar, counting down from `duration` to 0, sharing the same `performance.now()` as the tile-spawn logic (already settled in the architecture — to avoid desync).
- **Combo counter**: a number displayed in a corner, only **flashing** (highlighted for 1 frame) each time the combo hits a multiple of 5 (i.e. each time the multiplier increases by another 0.1x).
- Redrawing these 3 components happens within the same mini-game tick loop (real-time, fixed tick — per the settled dual-loop architecture), with no separate redraw outside that flow.

---

## 4. Snake / Tetris / Brick Breaker — specific mechanics

All 3 follow the same win/lose framework: meeting the condition within the time limit = win; running out of time or dying partway = lose (`fearDelta = +15`, same as Magic Tiles). There's no hit-combo like Magic Tiles — these are 3 simpler "binary eval" games.

### Snake
- Grid-based, fixed tick (300ms/tick at standard difficulty, decreasing with floor depth down to a floor of 180ms, similar to how Magic Tiles scales).
- Win condition: eat **N = 8 food** within **25 seconds**.
- Lose condition: hitting a wall or biting your own tail — lose immediately (doesn't wait for time to run out), no extra "lives".

### Tetris
- Standard 10x20 grid, fall speed increases over the course of the round (independent of floor — the game's own inherent difficulty already varies enough).
- Win condition: clear **4 lines** within **40 seconds**.
- Lose condition: blocks stack to the top of the grid (standard Tetris game-over) or time runs out without 4 lines cleared.

### Brick Breaker
- Paddle moves continuously while holding the left/right key, using the Kitty keyboard key-release event to stop the paddle the instant the key is released (solving exactly the technical issue already raised in design doc 1.7).
- Win condition: break **60% of all bricks** within **35 seconds**.
- Number of lives (ball falling past the paddle): **3 lives**; running out of lives before reaching 60%, or running out of time, = lose.
