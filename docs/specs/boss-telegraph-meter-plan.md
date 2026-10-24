# Boss Telegraph Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the boss telegraph's weighted roll and one-turn charge with a visible 3–5 diamond meter that fills one icon per boss turn and releases the telegraph on the turn it fills, and rebalance boss damage to the agreed rules.

**Architecture:** An archetype names its telegraph and meter length in data (`bossTelegraph`); a monster carries its filled count (`telegraphMeter`) in place of today's `charging`. `combat.ts` fills the meter at the start of every boss turn (before an Overwatch shot can take the turn); `takeMonsterTurn` releases on a full meter unless the boss is stunned or silenced. The Monsters panel draws the meter under the boss's HP.

**Tech Stack:** Bun, TypeScript (strict), OpenTUI, `bun test`.

**Spec:** `docs/specs/boss-telegraph-meter.md` (read it first; this plan argues from it).

## Global Constraints

- Branch `feat/boss-telegraph-meter` (cut from `release/version-v1.2.0`), worked in this worktree; commit here.
- Commit messages: one plain imperative sentence as subject (repo style, e.g. "Show a boss's telegraph meter under its HP"), a short body; author `Nguyen Doan Quoc Nhat <quocnhatthedev@gmail.com>`; no `Co-Authored-By` or any agent trailer (repo `CLAUDE.md`).
- Everything tunable lives in `data/*.json`; the engine names no archetype or skill. All game and doc text is English.
- Meter lengths (from the spec): Skeleton Guard 5, Giant Spider 4, Zombie Knight 5, Vampire Lord 4, Dark Knight 3, Lich 5, Ancient Golem 5, Dragon 4, The Founder 4. Orc Chieftain and Void Amalgamation get no meter. Elites never get one.
- Icons: empty `◇`, filled `◆`.
- Damage rules: a telegraph scales at 190%–280% of attack plus a flat amount (low-attack bosses at the low end with a larger flat and a status); every other elite/boss damaging skill at most 170% plus a flat; multi-hit and area skills sit lower in range.
- One-shots allowed at every band, but `test/elite-boss-balance.test.ts` keeps "the party wins every simulated fight" (win rate 1).
- Saves from `OLDEST_LOADABLE_SAVE_VERSION` (1.1.0) on still load.
- Done means: `bun run typecheck`, `bun test` (the two known `elite-boss-balance` failures must be gone by Task 4), `bun run docs:sync --check` all pass.
- `docs/specs/*` stay uncommitted (transient); Task 5 folds them into the gameplay docs and deletes them.

## Review Focus

- A boss stunned several turns in a row with a full meter: the meter stays at its length (never overflows) and it releases on the first turn it can act.
- A save taken while a boss's meter is part-filled or full: reloading keeps the count, the panel shows it, and the release lands on the same turn it would have.
- A release when the only targetable characters are airborne/stealthed or dead except one: single-target release takes whoever is targetable; an area release hits every targetable character; nothing throws.
- The boss enters a phase on the same turn its meter fills: the release still happens that turn (release is resolved before phase entry, as today).
- The reveal animation: the meter shown during a round's reveal follows the snapshot (no jump ahead of the log).

---

### Task 1: Data model, loader validation, save and migration

**Files:**
- Modify: `src/types.ts` (`MonsterArchetype`, `Monster`, `CombatantSnapshot`), `src/data/monsters.ts` (validation), `data/monsters.json`, `data/monster-skills.json`, `src/engine/save.ts` (`isSaveMonstersValid`), `src/engine/migration.ts` (`migrateMonsters`)
- Test: `test/elite-boss-kits.test.ts`, `test/save.test.ts`

**Interfaces:**
- Produces:
  - `MonsterArchetype.bossTelegraph?: { skillId: Id; meterLength: number }`
  - `Monster.telegraphMeter?: number` (filled icons; absent = 0). `Monster.charging` is removed.
  - `CombatantSnapshot.telegraphMeter?: number` (monsters only)
  - `getBossTelegraph(archetype: MonsterArchetype): { skillId: Id; meterLength: number } | undefined` exported from `src/data/monsters.ts`

- [ ] **Step 1: Write failing tests** in `test/elite-boss-kits.test.ts`, replacing "no two telegraphs share a cadence, and only Orc Chieftain and Void Amalgamation have none":
  - `"every boss-tier telegraph is driven by bossTelegraph and by no action weight"`: for each archetype, every `telegraph: true` skill in `skillIds` equals `bossTelegraph.skillId`; that id appears in no `actionWeights` tier and no `phases[].weights`; archetypes without `bossTelegraph` are exactly `["orc-chieftain", "void-amalgamation"]` among boss roles.
  - `"meter lengths are 3 to 5 and differ within a band"`: lengths are integers in 3..5; using the band lists from `test/elite-boss-balance.test.ts` (`BANDS[i].ids`), two bosses in the same band never share `meterLength`; expect the exact map from Global Constraints.
  - Update `"a telegraph aimed by a status tag is aimed only at the tagged"` to read the telegraph from `bossTelegraph` (its assertions about `targetRules` stay).
  In `test/save.test.ts`: `"a monster saved mid-charge under the old charging field loads with a full meter"` (write a save whose guard monster has `charging: { skillId: "overhead-cut", targetIds: [] }`, load via `gameFromSave`, expect `telegraphMeter === 5` and no `charging`), and `"a negative or fractional telegraphMeter fails validation"`.
- [ ] **Step 2:** Run `bun test test/elite-boss-kits.test.ts test/save.test.ts` — expect the new tests to FAIL.
- [ ] **Step 3: Implement.** Add the types. In `src/data/monsters.ts` validate on load: `bossTelegraph.skillId` is in `skillIds`, is a `telegraph` skill, the archetype has role `boss`, `meterLength` is a positive integer, and no `actionWeights`/`phases` weights name a telegraph skill (throw with the existing `data/monsters.json: "<id>" …` message style). Data: add `bossTelegraph` to the nine archetypes with the lengths above; remove each telegraph id from `actionWeights.boss` and every phase's `weights`; remove `cooldownTurns` and `initialCooldownTurns` from the nine telegraph skills. `isSaveMonstersValid`: drop the `charging` checks, accept `telegraphMeter` only as a non-negative integer. `migrateMonsters`: a monster with `charging` gets `telegraphMeter = getBossTelegraph(archetype)?.meterLength ?? 0` and `charging` deleted.
- [ ] **Step 4:** Run `bun test test/elite-boss-kits.test.ts test/save.test.ts` and `bun run typecheck` — PASS (engine code still referencing `charging` is fixed in Task 2; if typecheck needs it to compile, stub the removed branch to a no-op and leave a failing test for Task 2 rather than keeping `charging`).
- [ ] **Step 5: Commit** — "Name each boss's telegraph and meter length in data".

### Task 2: The meter in the engine

**Files:**
- Modify: `src/engine/monsterAI.ts` (`takeMonsterTurn`, `useMonsterSkill`, `releaseCharge` → `releaseTelegraph`, `pickTargets`), `src/engine/combat.ts` (monster branch of the turn loop, snapshot at ~431)
- Test: Create `test/telegraph-meter.test.ts`

**Interfaces:**
- Consumes: `getBossTelegraph`, `Monster.telegraphMeter` (Task 1).
- Produces: `fillTelegraphMeter(actor: Monster): void` exported from `src/engine/monsterAI.ts`; snapshot carries `telegraphMeter`.

- [ ] **Step 1: Write failing tests** in `test/telegraph-meter.test.ts` (build a boss fight the way `test/memory.test.ts`'s `winGuardFight` or `test/elite-boss-kits.test.ts` set one up; drive turns with `runMonsterTurn`/`resolveRound` as those tests do):
  - `"a boss with meter N releases its telegraph on its N-th turn and the meter is empty after"` (Skeleton Guard, N = 5: turns 1–4 never log `combat.telegraphRelease`, turn 5 does, `telegraphMeter` is 0 after).
  - `"a stunned turn still fills an icon and moves the release to the next turn"` (stun on turn 5: no release, meter stays 5; turn 6 releases).
  - `"an Overwatch interrupt on the full turn fills nothing more and delays the release"` (meter stays at length; next turn releases).
  - `"a silenced boss with a full meter basic-attacks and releases on its next unsilenced turn"`.
  - `"a provoked boss releases its single-target telegraph on whoever provoked it"` and `"Interpose takes the release for its ward"`.
  - `"Dark Knight with nobody challenged releases on a target chosen by normal targeting"` (assert a taunt's `targetPull` changes the picked target over seeds) and `"Dark Knight releases on the challenged character when one exists"`.
  - `"Dragon is airborne from the turn before its release through the release"` (chargeEffects resolve on the turn the meter reaches length − 1; `airborne` still active on the release turn).
  - `"the meter never exceeds its length across consecutive stuns"`.
  - `"a confused boss's release is never turned onto its own side"` (spec keeps today's rule).
  - `"the meter starts empty when the fight starts"`.
- [ ] **Step 2:** Run `bun test test/telegraph-meter.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
  - `fillTelegraphMeter(actor)`: for a boss-tier monster whose archetype has `bossTelegraph`, `telegraphMeter = min(meterLength, (telegraphMeter ?? 0) + 1)`; when it becomes `meterLength − 1`, resolve the telegraph skill's `chargeEffects` on the boss (existing `applySkillEffects` self call) and log `combat.telegraphCharge`-style warning text (reuse or rename the existing string). Call it in `combat.ts` before `tryTriggerOverwatch`, so interrupted and stunned turns fill.
  - `takeMonsterTurn`: after the stun check and before phase entry, if the meter is full and the boss is not silenced, call `releaseTelegraph` and return; a silenced boss falls through to its basic attack (the existing silenced path). Remove the old `charging` release and the telegraph branch of `useMonsterSkill` (a telegraph is never picked from weights any more).
  - `releaseTelegraph`: resolve targets now — area: `resolveMonsterSkillTargets`; single: `pickTargets` (which already honours `provoked`) then `interceptAll`; log `combat.telegraphRelease`; `applySkillEffects`; set `telegraphMeter = 0`. Ignore the skill's `aiCondition` at release.
  - `pickTargets`: when every candidate's scored weight is 0 (a tag rule with nobody tagged), weight by the base targeting (`base(c)`, aggro and `targetPull` included) instead of falling back to a uniform pick.
  - Snapshot (`combat.ts` ~431): copy `telegraphMeter` for monsters.
- [ ] **Step 4:** Run `bun test test/telegraph-meter.test.ts test/elite-boss-kits.test.ts` and `bun run typecheck` — PASS. Then `bun test` — only `test/elite-boss-balance.test.ts` may still fail.
- [ ] **Step 5: Commit** — "Fill a boss's telegraph meter each turn and release it when full".

### Task 3: Show the meter in the Monsters panel

**Files:**
- Modify: `src/ui/app.ts` (`renderMonsterLines`), `data/strings.json`
- Test: `test/ui.test.ts`

**Interfaces:**
- Consumes: `Monster.telegraphMeter`, `CombatantSnapshot.telegraphMeter`, `getBossTelegraph`.
- Produces: strings `ui.telegraphMeterFilled` = `"◆"`, `ui.telegraphMeterEmpty` = `"◇"`.

- [ ] **Step 1: Write failing tests** in `test/ui.test.ts`: `"a boss shows its telegraph meter under its HP, filled icons first"` (Skeleton Guard boss with `telegraphMeter = 3`, 150x45 frame contains `◆◆◆◇◇` on the line after its HP bar); `"elites and meterless bosses show no meter"` (an elite Skeleton Guard and an Orc Chieftain boss: no `◇`/`◆` in the Monsters panel).
- [ ] **Step 2:** Run `bun test test/ui.test.ts -t "telegraph meter"` — FAIL.
- [ ] **Step 3: Implement** a line `"  " + filled.repeat(n) + empty.repeat(length − n)` right after the HP line, reading `hpOverride?.get(m.id)?.telegraphMeter ?? m.telegraphMeter ?? 0`; filled icons in `PALETTE.fearPanic`, empty in `PALETTE.dim`.
- [ ] **Step 4:** Run the UI tests and `bun run typecheck` — PASS.
- [ ] **Step 5: Commit** — "Show a boss's telegraph meter under its HP".

### Task 4: Rebalance boss damage and the balance test

**Files:**
- Modify: `data/monster-skills.json`, `data/status-effects.json` only if a duration must change (prefer the skill effect's `durationTurns`), `test/elite-boss-balance.test.ts`
- Test: `test/elite-boss-balance.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 behaviour (the simulation runs the real engine).

- [ ] **Step 1: Rewrite the test's rules first.** Remove `telegraphCap` from `BANDS` and the telegraph-cap assertion. Add `"boss skills follow the damage rules"`: for every elite/boss archetype in `BANDS`, each damaging skill's `offenseMultiplierPercent` is within 190–280 if it is that boss's `bossTelegraph` skill, else ≤ 170. Keep "no non-telegraph skill reaches the lowest-HP class's max HP" (drop the telegraph from that check — one-shots are allowed) and keep win rate 1.
- [ ] **Step 2:** Run `bun test test/elite-boss-balance.test.ts` — the new rule test FAILS on current data.
- [ ] **Step 3: Apply the starting values** (from the design-time trial; tune flat/status before percentage):
  - Telegraphs: `overhead-cut` 190%+60 and `weakened` 2 turns; `cocoon` 190%+40; `rotting-embrace` 200%+60; `abyssal-judgment` 200%+70; `sealing-blow` 210%+90 plus an effect `{ "kind": "applyStatusEffect", "statusEffectId": "stunned", "durationTurns": 1, "target": "allEnemies" }` (damage stays on one target); `inferno` 190%+40 and `burning` 3 turns, with its `airborne` charge effect lasting through the release turn (`durationTurns` 2); `final-draught` 240%+45; `everything-you-asked-for` 250%+70; `name-struck-out` 280%+65.
  - Other skills: `diseased-blade` 170%+50; `measured-cut` 170%+50; `stoneshear` 170%+70; `tremor` 110%+20.
- [ ] **Step 4: Tune the bands.** Run `BALANCE_REPORT=1 bun test test/elite-boss-balance.test.ts` and adjust flats/statuses until win rate is 1 everywhere and the rule test passes; then propose re-fitted `dpr`/`rounds` ranges per band from the report (each row inside its band with headroom, band means still ordered). **Checkpoint: show the user the report and the proposed bands before writing them; do not commit until they agree.**
- [ ] **Step 5:** Write the agreed bands; run `bun test` and `bun run typecheck` — PASS (no `elite-boss-balance` failures left). Run `bun run docs:sync` and keep what it rewrites.
- [ ] **Step 6: Commit** — "Rebalance boss telegraphs and heavy skills to the new damage rules".

### Task 5: Editor, docs, and folding the spec

**Files:**
- Modify: `tools/game-editor/index.html` (`AI_MONSTER_KEYS` add `"bossTelegraph"`; remove `initialCooldownTurns` from `AI_SKILL_KEYS` if no other skill uses it; rewrite the telegraph hint at ~1110 and the `(telegraph, cooldown …)` tag at ~1088 to describe the meter), `tools/game-editor/server.ts` if its `telegraphNote` describes the old cooldown, `docs/gameplay-decisions/06-level-system.md` ("How an elite or boss turn is chosen" steps 1 and 7, the kit rule on cadence → "two bosses in the same band never share a meter length", the kit table rows that mention a telegraph's timing), `docs/gameplay-decisions/02-monster.md`, `docs/gameplay-decisions/01-class-skill.md` ("Silence", Interpose, `provoked` against a telegraph), `docs/developer-guide.md` (Monsters panel description), `src/types.ts` comment on `silences` (~406)
- Delete: `docs/specs/boss-telegraph-meter.md`, `docs/specs/boss-telegraph-meter-plan.md` (after their content is folded)

- [ ] **Step 1:** Update the editor and the docs to the built behaviour (no balance numbers typed by hand; reference data ids or describe in words).
- [ ] **Step 2:** Run `bun run docs:sync --check`, `bun test`, `bun run typecheck` — PASS. Open the game editor once (`bun run game-editor`) and confirm a boss's AI card shows `bossTelegraph` and the new hint.
- [ ] **Step 3:** Play the real TUI in tmux (`tui-testing` skill) with a dev save at a boss room: the meter fills one icon per boss turn, a stun delays the release, silence turns the release into a basic attack, the Golem's release stuns the whole party.
- [ ] **Step 4: Commit** — "Describe the boss telegraph meter in the docs and the editor".
