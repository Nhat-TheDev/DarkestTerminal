# Elite/Boss Kits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared elite/boss kit with one data-declared kit per guard-room archetype, driven by a rules-aware monster AI, six new generic combat mechanics, and a difficulty curve that rises with `minFloor`.

**Architecture:** Monster AI moves from a flat weighted roll to filter → score → pick → target, with every rule declared on skills/archetypes in JSON (`src/engine/monsterAiRules.ts` holds the pure predicate/scoring logic, `src/engine/monsterAI.ts` the turn flow). New mechanics hook into existing choke points: damage in `resolveSkillEffect` (shell cap, tick immunity, reflect), summons in `applySkillEffects`'s override pass, targetability in the `livingMonsterRefs` family. Kits, statuses and tuning are pure data edits; a simulation test pins every archetype to its band.

**Tech Stack:** Bun, TypeScript (strict), `bun:test`, OpenTUI (UI only touched for one status-row line).

**Spec:** `docs/specs/elite-boss-kits.md`

## Global Constraints

- Every rebalanceable value lives in `data/*.json`; engine and loader code name no archetype or skill (`CLAUDE.md`, "Every stat/parameter ... lives in data/*.json").
- All game text and docs are English; descriptions match the established dark, spare voice — flavour only, no mechanics, numbers, or other skills by name (`02-monster.md`, "Writing `description` text").
- A renamed or new record's `id` is the kebab-case of its name; every reference is updated in the same change.
- No status effect or damage mechanic in more than 2 archetypes' kits; `summonMonster` is allow-listed (3); target shape (`targetCount`) is not counted.
- Docs tables mirroring JSON are regenerated with `bun run docs:sync`, never hand-typed; the spec carries no balance numbers.
- Only current-version saves load (`ALLOWED_LEGACY_SAVE_VERSIONS` is empty) — no migration code.
- Normal-tier monsters behave exactly as on `main`, down to RNG draw order. Skeleton Guard's base stats (`baseHp` 110, `baseAttack` 18, `baseDefense` 12, `baseSpeed` 4) and `actionWeights.normal` (`{"basicAttack": 100}`) never change in this branch, including during tuning.
- Finish with `bun test` and `bun run typecheck` green on the full suite.
- The spec and this plan are deleted in the final task, after their content is merged into the maintained docs.

## Review Focus

1. **A boss stunned (shell break, or a party stun) while charging a telegraph** — the release is delayed to its next unstunned turn, never lost, and the cooldown it committed is not committed twice. Pinned in Task 3 and Task 6.
2. **The summoner dies with adds alive, or the last player-side kill lands on the summoner mid-round** — adds fall in the same turn and the fight ends as a victory with no exp from the adds. Pinned in Task 4.
3. **Every enemy untargetable (Dragon airborne, solo)** — a queued single-target attack fizzles and refunds nothing it did not commit; AoE skips it; heals/buffs still resolve; the round still finishes. Pinned in Task 5.
4. **Reflect killing the attacker** — a character killed by riposte is marked dead, logged, and the round's wipe check sees it; reflect never chains back off another reflect. Pinned in Task 5.
5. **A save taken mid-fight** (boss charging, phase entered, shell broken, adds alive) — reloads and continues identically. Pinned in Task 8.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `src/types.ts` | New AI/mechanic fields on `SkillDefinition`, `SkillEffect`, `StatusEffectDefinition`, `MonsterArchetype`, `Monster` | 1 |
| `src/data/monsters.ts` | Load-time validation of every new field; shell + initial cooldowns on spawn | 1, 3, 6 |
| `src/engine/monsterAiRules.ts` (new) | Pure predicate evaluation and weight scoring | 2 |
| `src/engine/monsterAI.ts` | Turn flow: release → phase → filter → score → pick → target → act | 3 |
| `src/engine/combat.ts` | `summonMonster` override, orphan-add cleanup, targetable-monster pool | 4, 5 |
| `src/engine/resolver.ts` | `harmful`, reflect, shell cap / tick immunity / hit counting | 5, 6 |
| `src/engine/monsterShell.ts` (new) | Shell state machine | 6 |
| `src/engine/game.ts` | Enemy pool for the target picker | 5 |
| `src/engine/save.ts` | Validation of new `Monster` fields | 8 |
| `src/ui/app.ts` | Shell line in the monster status rows | 6 |
| `data/monster-skills.json`, `data/monsters.json`, `data/status-effects.json`, `data/balance-config.json`, `data/strings.json` | Kits, statuses, cap, strings | 3, 4, 5, 6, 7, 9 |
| `src/data/balanceConfig.ts` | Balance-config typing | 3, 4 |
| `tools/game-editor/{calc.ts,server.ts,index.html}` | Drop execute, preserve/edit new fields | 10 |
| `test/monster-ai-rules.test.ts` (new), `test/monster-skills.test.ts`, `test/monster-mechanics.test.ts` (new), `test/elite-boss-kits.test.ts` (new), `test/elite-boss-balance.test.ts` (new), `test/save.test.ts` | Tests | 2–9 |
| `docs/gameplay-decisions/02-monster.md`, `06-level-system.md`, `docs/technical-decisions.md`, `docs/developer-guide.md` | Docs | 11 |

---

### Task 1: Types and load-time validation

**Files:**
- Modify: `src/types.ts` (around `SkillEffectKind` at :8, `SkillEffect` ~:22, `SkillDefinition` ~:140, `StatusEffectDefinition` ~:260, `MonsterArchetype` :615, `Monster` :658)
- Modify: `src/data/monsters.ts` (`assertMonsterDataConsistent`)
- Test: `test/monsters.test.ts`

**Interfaces:**
- Produces (used by every later task):

```ts
// src/types.ts
export interface MonsterAiPredicate {
  selfHpBelowPercent?: number;
  selfHasStatusId?: Id;
  selfLacksStatusId?: Id;
  targetHasStatusId?: Id;
  targetLacksStatusId?: Id;
  targetHpBelowPercent?: number;
  targetsBelowHpPercent?: number;
  atLeast?: number;
  alliesFewerThan?: number;
}
export interface MonsterAiRule { if: MonsterAiPredicate; weightMultiplier: number }
export interface MonsterPhase { tier: MonsterTier; hpBelowPercent: number; weights: Record<string, number>; onEnterSkillId?: Id }
export interface MonsterShellDefinition {
  hitsToBreak: { min: number; max: number };
  hitDamageCapMaxHpPercent: number;
  breakStatusId: Id;
  breakDurationTurns: number;
  reformAfterOwnTurns: number;
}
export interface MonsterShellState { state: "intact" | "broken"; hitsLeft: number; ownTurnsSinceBreak: number }
```

- `SkillEffectKind` gains `"summonMonster"`; `SkillEffect` gains `monsterArchetypeId?: Id; count?: number`.
- `SkillDefinition` gains `aiCondition?: MonsterAiPredicate; aiRules?: MonsterAiRule[]; targetRules?: MonsterAiRule[]; telegraph?: boolean; chargeEffects?: SkillEffect[]; targetCount?: { min: number; max: number }; initialCooldownTurns?: number`.
- `StatusEffectDefinition` gains `harmful?: boolean; reflectDamagePercent?: number`.
- `MonsterArchetype` gains `phases?: MonsterPhase[]; targeting?: "random"; shell?: MonsterShellDefinition` (`executeSkillId` is removed in Task 3).
- `Monster` gains `skillCooldowns?: Record<Id, number>; skillUses?: Record<Id, number>; enteredPhaseIndexes?: number[]; charging?: { skillId: Id; targetIds: Id[] }; summonerId?: Id; shell?: MonsterShellState`.
- `assertMonsterKitConsistent(archetypes, skills)` exported from `src/data/monsters.ts`, called at load.

- [ ] **Step 1: Write the failing tests** in `test/monsters.test.ts`:

```ts
import { assertMonsterKitConsistent, MONSTER_ARCHETYPES, MONSTER_SKILLS } from "../src/data/monsters";

describe("assertMonsterKitConsistent", () => {
  const base = () => structuredClone(MONSTER_ARCHETYPES.find((a) => a.id === "skeleton-guard")!);
  const skill = (over: object) => ({ id: "x-skill", name: "X", description: "x", mpCost: 0, target: "singleEnemy", effects: [{ kind: "damage", amount: 1 }], slot: 0, unlockLevel: 1, ...over });

  test("the shipped catalog passes", () => {
    expect(() => assertMonsterKitConsistent(MONSTER_ARCHETYPES, MONSTER_SKILLS)).not.toThrow();
  });
  test("rejects a predicate naming an unknown status", () => {
    const s = skill({ aiCondition: { selfHasStatusId: "no-such-status" } });
    const a = { ...base(), skillIds: ["x-skill"], actionWeights: { normal: { basicAttack: 1 }, elite: { "x-skill": 1 }, boss: { "x-skill": 1 } } };
    expect(() => assertMonsterKitConsistent([a as any], [s as any])).toThrow(/no-such-status/);
  });
  test("rejects targetCount on a non-singleEnemy skill or with min > max", () => {
    const a = { ...base(), skillIds: ["x-skill"], actionWeights: { normal: { basicAttack: 1 }, elite: { "x-skill": 1 }, boss: { "x-skill": 1 } } };
    expect(() => assertMonsterKitConsistent([a as any], [skill({ target: "allEnemies", targetCount: { min: 2, max: 3 } }) as any])).toThrow(/targetCount/);
    expect(() => assertMonsterKitConsistent([a as any], [skill({ targetCount: { min: 3, max: 2 } }) as any])).toThrow(/targetCount/);
  });
  test("rejects a summon of a non-normal archetype", () => {
    const s = skill({ target: "self", effects: [{ kind: "summonMonster", monsterArchetypeId: "dragon", count: 1 }] });
    const a = { ...base(), skillIds: ["x-skill"], actionWeights: { normal: { basicAttack: 1 }, elite: { "x-skill": 1 }, boss: { "x-skill": 1 } } };
    expect(() => assertMonsterKitConsistent([a as any], [s as any])).toThrow(/dragon/);
  });
  test("rejects a phase weight key or onEnterSkillId outside skillIds, and a phase on a tier the archetype lacks", () => {
    const a = { ...base(), phases: [{ tier: "boss", hpBelowPercent: 50, weights: { "nope": 1 } }] };
    expect(() => assertMonsterKitConsistent([a as any], MONSTER_SKILLS)).toThrow(/nope/);
    const b = { ...base(), phases: [{ tier: "boss", hpBelowPercent: 50, weights: { basicAttack: 1 }, onEnterSkillId: "nope" }] };
    expect(() => assertMonsterKitConsistent([b as any], MONSTER_SKILLS)).toThrow(/nope/);
    const c = { ...structuredClone(MONSTER_ARCHETYPES.find((x) => x.id === "dungeon-rat")!), phases: [{ tier: "boss", hpBelowPercent: 50, weights: { basicAttack: 1 } }] };
    expect(() => assertMonsterKitConsistent([c as any], MONSTER_SKILLS)).toThrow(/phase/);
  });
  test("rejects a shell with min > max hits or an unknown break status", () => {
    const a = { ...base(), shell: { hitsToBreak: { min: 8, max: 6 }, hitDamageCapMaxHpPercent: 4, breakStatusId: "stunned", breakDurationTurns: 1, reformAfterOwnTurns: 2 } };
    expect(() => assertMonsterKitConsistent([a as any], MONSTER_SKILLS)).toThrow(/shell/);
    const b = { ...base(), shell: { hitsToBreak: { min: 6, max: 8 }, hitDamageCapMaxHpPercent: 4, breakStatusId: "nope", breakDurationTurns: 1, reformAfterOwnTurns: 2 } };
    expect(() => assertMonsterKitConsistent([b as any], MONSTER_SKILLS)).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run** `bun test test/monsters.test.ts` — expected FAIL: `assertMonsterKitConsistent` is not exported.

- [ ] **Step 3: Add the types** listed under *Interfaces* to `src/types.ts`, each with a one-line doc comment matching the file's style (e.g. `/** Monster skills only: the skill is a candidate only while this holds (\`monsterAiRules.ts\`). */`).

- [ ] **Step 4: Implement the validator** in `src/data/monsters.ts`, below `assertMonsterDataConsistent`:

```ts
import { STATUS_EFFECTS } from "./statusEffects";
import type { MonsterAiPredicate, MonsterAiRule } from "../types";

const PREDICATE_STATUS_FIELDS = ["selfHasStatusId", "selfLacksStatusId", "targetHasStatusId", "targetLacksStatusId"] as const;

function assertPredicate(where: string, p: MonsterAiPredicate | undefined): void {
  if (!p) return;
  for (const field of PREDICATE_STATUS_FIELDS) {
    const id = p[field];
    if (id !== undefined && !STATUS_EFFECTS.some((s) => s.id === id)) throw new Error(`${where}: ${field} "${id}" is not a status in data/status-effects.json`);
  }
}

function assertRules(where: string, rules: MonsterAiRule[] | undefined): void {
  for (const [i, rule] of (rules ?? []).entries()) {
    if (!(rule.weightMultiplier >= 0)) throw new Error(`${where}[${i}]: weightMultiplier must be >= 0`);
    assertPredicate(`${where}[${i}].if`, rule.if);
  }
}

export function assertMonsterKitConsistent(archetypes: MonsterArchetype[], skills: SkillDefinition[]): void {
  const byId = new Map(skills.map((s) => [s.id, s]));
  for (const skill of skills) {
    const where = `data/monster-skills.json: "${skill.id}"`;
    assertPredicate(`${where} aiCondition`, skill.aiCondition);
    assertRules(`${where} aiRules`, skill.aiRules);
    assertRules(`${where} targetRules`, skill.targetRules);
    if (skill.targetCount) {
      const { min, max } = skill.targetCount;
      if (skill.target !== "singleEnemy" || !(min >= 1 && min <= max)) throw new Error(`${where}: targetCount needs target "singleEnemy" and 1 <= min <= max`);
    }
    for (const effect of [...(skill.effects ?? []), ...(skill.chargeEffects ?? [])]) {
      if (effect.kind !== "summonMonster") continue;
      const summoned = archetypes.find((a) => a.id === effect.monsterArchetypeId);
      if (!summoned || !summoned.roles.includes("normal")) throw new Error(`${where}: summonMonster "${effect.monsterArchetypeId}" must be an archetype with role "normal"`);
      if (!(effect.count !== undefined && effect.count >= 1)) throw new Error(`${where}: summonMonster needs count >= 1`);
    }
  }
  for (const archetype of archetypes) {
    const where = `data/monsters.json: "${archetype.id}"`;
    const declared = new Set(archetype.skillIds);
    for (const [i, phase] of (archetype.phases ?? []).entries()) {
      if (!archetype.roles.includes(phase.tier)) throw new Error(`${where}: phase ${i} is for tier "${phase.tier}", which is not in its roles`);
      for (const key of Object.keys(phase.weights)) {
        if (key !== "basicAttack" && !declared.has(key)) throw new Error(`${where}: phase ${i} weight key "${key}" is not in its skillIds`);
      }
      if (phase.onEnterSkillId !== undefined && !declared.has(phase.onEnterSkillId)) throw new Error(`${where}: phase ${i} onEnterSkillId "${phase.onEnterSkillId}" is not in its skillIds`);
    }
    if (archetype.shell) {
      const { hitsToBreak, breakStatusId } = archetype.shell;
      if (!(hitsToBreak.min >= 1 && hitsToBreak.min <= hitsToBreak.max)) throw new Error(`${where}: shell hitsToBreak needs 1 <= min <= max`);
      if (!STATUS_EFFECTS.some((s) => s.id === breakStatusId)) throw new Error(`${where}: shell breakStatusId "${breakStatusId}" is not a status`);
    }
    for (const id of archetype.skillIds) if (!byId.has(id)) throw new Error(`${where}: skill "${id}" is not in data/monster-skills.json`);
  }
}

assertMonsterKitConsistent(MONSTER_ARCHETYPES, MONSTER_SKILLS);
```

Check `src/data/statusEffects.ts` does not import `src/data/monsters.ts` (it must not, or this creates a cycle); it exports `STATUS_EFFECTS` already (`tools/game-editor/calc.ts:29` imports it).

- [ ] **Step 5: Run** `bun test test/monsters.test.ts` and `bun run typecheck` — expected PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/data/monsters.ts test/monsters.test.ts
git commit -m "Declare the monster AI and mechanic fields and validate them at load"
```

---

### Task 2: Predicate evaluation and scoring

**Files:**
- Create: `src/engine/monsterAiRules.ts`
- Test: `test/monster-ai-rules.test.ts`

**Interfaces:**
- Consumes: `MonsterAiPredicate`, `MonsterAiRule` (Task 1); `statusSatisfiesRequirement(activeId, requiredId)` from `src/data/statusEffects.ts:21`; `Actor` from `src/engine/resolver.ts`.
- Produces:

```ts
export interface AiView { self: Monster; enemies: Actor[]; allies: Monster[] } // allies excludes self
export function predicateHolds(p: MonsterAiPredicate, view: AiView, candidate?: Actor): boolean;
export function scoreWeight(weight: number, rules: MonsterAiRule[] | undefined, view: AiView, candidate?: Actor): number;
```

Semantics: every field present must hold. `target*` fields test `candidate` when given, otherwise "any living enemy matches". `targetsBelowHpPercent` counts enemies under the percentage and needs `atLeast` (default 1). `alliesFewerThan` compares `view.allies.length`. Status fields match a rank family through `statusSatisfiesRequirement`.

- [ ] **Step 1: Write the failing tests** in `test/monster-ai-rules.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { predicateHolds, scoreWeight, type AiView } from "../src/engine/monsterAiRules";
import { spawnMonster } from "../src/data/monsters";
import { makeCtx } from "./helpers";

function view(): AiView {
  const { ctx } = makeCtx(1);
  const self = spawnMonster("skeleton-guard", 1, { tier: "boss" });
  return { self, enemies: ctx.party.slice(0, 4), allies: [] };
}
const status = (id: string) => ({ statusEffectId: id, turnsRemaining: 2 });

describe("predicateHolds", () => {
  test("selfHpBelowPercent", () => {
    const v = view();
    v.self.hp = v.self.maxHp * 0.6;
    expect(predicateHolds({ selfHpBelowPercent: 50 }, v)).toBe(false);
    v.self.hp = v.self.maxHp * 0.4;
    expect(predicateHolds({ selfHpBelowPercent: 50 }, v)).toBe(true);
  });
  test("self status, matching the rank family", () => {
    const v = view();
    expect(predicateHolds({ selfHasStatusId: "guard" }, v)).toBe(false);
    v.self.activeStatusEffects.push(status("guard-iii"));
    expect(predicateHolds({ selfHasStatusId: "guard" }, v)).toBe(true);
    expect(predicateHolds({ selfLacksStatusId: "guard" }, v)).toBe(false);
  });
  test("target status: candidate vs any enemy", () => {
    const v = view();
    v.enemies[2]!.activeStatusEffects.push(status("bleeding"));
    expect(predicateHolds({ targetHasStatusId: "bleeding" }, v)).toBe(true);
    expect(predicateHolds({ targetHasStatusId: "bleeding" }, v, v.enemies[0])).toBe(false);
    expect(predicateHolds({ targetHasStatusId: "bleeding" }, v, v.enemies[2])).toBe(true);
    expect(predicateHolds({ targetLacksStatusId: "bleeding" }, v, v.enemies[2])).toBe(false);
  });
  test("targetHpBelowPercent and targetsBelowHpPercent/atLeast", () => {
    const v = view();
    v.enemies[0]!.hp = v.enemies[0]!.maxHp * 0.3;
    expect(predicateHolds({ targetHpBelowPercent: 40 }, v, v.enemies[0])).toBe(true);
    expect(predicateHolds({ targetHpBelowPercent: 40 }, v, v.enemies[1])).toBe(false);
    expect(predicateHolds({ targetsBelowHpPercent: 50, atLeast: 2 }, v)).toBe(false);
    v.enemies[1]!.hp = v.enemies[1]!.maxHp * 0.3;
    expect(predicateHolds({ targetsBelowHpPercent: 50, atLeast: 2 }, v)).toBe(true);
  });
  test("alliesFewerThan", () => {
    const v = view();
    expect(predicateHolds({ alliesFewerThan: 1 }, v)).toBe(true);
    v.allies.push(spawnMonster("goblin", 1));
    expect(predicateHolds({ alliesFewerThan: 1 }, v)).toBe(false);
  });
  test("every field must hold", () => {
    const v = view();
    v.self.hp = v.self.maxHp * 0.4;
    expect(predicateHolds({ selfHpBelowPercent: 50, selfHasStatusId: "guard" }, v)).toBe(false);
  });
});

describe("scoreWeight", () => {
  test("multiplies every matching rule and ignores the rest", () => {
    const v = view();
    v.self.hp = v.self.maxHp * 0.4;
    const rules = [
      { if: { selfHpBelowPercent: 50 }, weightMultiplier: 3 },
      { if: { selfHasStatusId: "guard" }, weightMultiplier: 0.5 },
      { if: {}, weightMultiplier: 2 },
    ];
    expect(scoreWeight(10, rules, v)).toBe(60);
    expect(scoreWeight(10, undefined, v)).toBe(10);
  });
});
```

- [ ] **Step 2: Run** `bun test test/monster-ai-rules.test.ts` — expected FAIL: module not found.

- [ ] **Step 3: Implement** `src/engine/monsterAiRules.ts`:

```ts
import type { Id, Monster, MonsterAiPredicate, MonsterAiRule } from "../types";
import { statusSatisfiesRequirement } from "../data/statusEffects";
import type { Actor } from "./resolver";

/** What a monster's AI rules can see on its turn. `allies` never includes the acting monster itself. */
export interface AiView {
  self: Monster;
  enemies: Actor[];
  allies: Monster[];
}

function hasStatus(actor: Actor, id: Id): boolean {
  return actor.activeStatusEffects.some((s) => statusSatisfiesRequirement(s.statusEffectId, id));
}

function hpPercent(actor: Actor): number {
  return (actor.hp / actor.maxHp) * 100;
}

/** Every field present must hold. `target*` fields test `candidate` when one is given, otherwise any living enemy. */
export function predicateHolds(p: MonsterAiPredicate, view: AiView, candidate?: Actor): boolean {
  const pool = candidate ? [candidate] : view.enemies;
  if (p.selfHpBelowPercent !== undefined && !(hpPercent(view.self) < p.selfHpBelowPercent)) return false;
  if (p.selfHasStatusId !== undefined && !hasStatus(view.self, p.selfHasStatusId)) return false;
  if (p.selfLacksStatusId !== undefined && hasStatus(view.self, p.selfLacksStatusId)) return false;
  if (p.targetHasStatusId !== undefined && !pool.some((a) => hasStatus(a, p.targetHasStatusId!))) return false;
  if (p.targetLacksStatusId !== undefined && !pool.some((a) => !hasStatus(a, p.targetLacksStatusId!))) return false;
  if (p.targetHpBelowPercent !== undefined && !pool.some((a) => hpPercent(a) < p.targetHpBelowPercent!)) return false;
  if (p.targetsBelowHpPercent !== undefined && view.enemies.filter((a) => hpPercent(a) < p.targetsBelowHpPercent!).length < (p.atLeast ?? 1)) return false;
  if (p.alliesFewerThan !== undefined && !(view.allies.length < p.alliesFewerThan)) return false;
  return true;
}

export function scoreWeight(weight: number, rules: MonsterAiRule[] | undefined, view: AiView, candidate?: Actor): number {
  return (rules ?? []).reduce((w, rule) => (predicateHolds(rule.if, view, candidate) ? w * rule.weightMultiplier : w), weight);
}
```

- [ ] **Step 4: Run** `bun test test/monster-ai-rules.test.ts` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/monsterAiRules.ts test/monster-ai-rules.test.ts
git commit -m "Evaluate monster AI predicates and score weights from data"
```

---

### Task 3: Turn flow — cooldowns, telegraph, phases, multi-target, random targeting

Replaces `executeSkillId` with `telegraph`. The old kits are converted mechanically so the suite stays green until Task 7 rewrites them.

**Files:**
- Modify: `src/engine/monsterAI.ts` (whole file)
- Modify: `src/data/monsters.ts` (`spawnMonster`, remove `EXECUTE_COOLDOWN_TURNS`, drop `executeSkillId` from `assertMonsterDataConsistent`)
- Modify: `src/types.ts` (remove `executeSkillId`, `executeCooldownTurns`, `isChargingExecute`, `executeTargetId`; update the `executeBonus` comment at :159 to drop its reference to the removed field)
- Modify: `src/data/balanceConfig.ts:8`, `data/balance-config.json` (remove `combat.executeCooldownTurns`)
- Modify: `data/monster-skills.json`, `data/monsters.json` (mechanical conversion)
- Modify: `data/strings.json` (replace `combat.bossExecuteCharge`/`combat.bossExecuteRelease`)
- Modify: `tools/game-editor/calc.ts:7,104,273,512`, `tools/game-editor/server.ts:55`, `tools/game-editor/index.html:1095,1731,2617,2676,2692` (minimal removal so the editor still loads; Task 10 adds editing)
- Test: `test/monster-skills.test.ts` (rewrite)

**Interfaces:**
- Consumes: `AiView`, `predicateHolds`, `scoreWeight` (Task 2).
- Produces: `runMonsterTurn(ref, combat, ctx)` (same signature); exported `advanceMonsterCooldowns(actor: Monster): void` and `monsterAiView(actor: Monster, combat: CombatState, ctx: EngineContext): AiView` for Tasks 4 and 6.

**Strings** (exact render):
- `combat.telegraphCharge`: `{{actor}} gathers itself for {{skill}}, aimed at {{targets}}!`
- `combat.telegraphChargeAoe`: `{{actor}} gathers itself for {{skill}}!`
- `combat.telegraphRelease`: `{{actor}} unleashes {{skill}}!`
- `combat.monsterPhase`: `{{actor}} stops holding anything back.`
- `combat.monsterSkillOnTargets`: `{{actor}} uses {{skill}} on {{targets}}.`
- `combat.targetListJoiner`: ` and ` — target names joined with `, ` and the last pair with this (e.g. `Vanguard, Mage and Acolyte`).

- [ ] **Step 0: Lock in the normal-tier Skeleton Guard before touching the engine.** This step runs on the branch as it is now (engine identical to `main`).

Add to `test/helpers.ts`:

```ts
import { queueAction, resolveRound, livingCharacterRefs, isCombatOver } from "../src/engine/combat";

/** A normal-tier Skeleton Guard against the default party: `rounds` rounds, or until the fight ends. `lowHp` starts it under the defensive low-HP threshold. */
export function runNormalSkeletonGuardFight(seed: number, rounds: number, lowHp = false) {
  const { ctx } = makeCtx(seed);
  const guard = spawnMonster("skeleton-guard", 1);
  guard.maxHp = 5000;
  guard.hp = lowHp ? 400 : 5000;
  ctx.monsters.push(guard);
  const combat = startCombat("r1", [guard.id], ctx, false);
  for (let r = 0; r < rounds && !isCombatOver(combat, ctx); r++) {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    combat.queuedActions = [];
    combat.phase = "command";
  }
  return { guard, log: combat.log.map((l) => l.text) };
}
```

(Check how `test/combat-ranks.test.ts` advances multiple rounds; if it resets `queuedActions`/`phase` differently, copy that instead.)

Capture the `main` behaviour once, to the scratchpad (not committed):

```bash
bun -e 'import { runNormalSkeletonGuardFight } from "./test/helpers"; const out = []; for (let s = 0; s < 30; s++) for (const low of [false, true]) out.push(runNormalSkeletonGuardFight(s, 8, low).log); await Bun.write(process.env.SCRATCH + "/normal-skeleton-guard-main.json", JSON.stringify(out));'
```

(`SCRATCH` = this session's scratchpad directory.) Then create `test/normal-skeleton-guard.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { getArchetype, getMonsterSkill } from "../src/data/monsters";
import { runNormalSkeletonGuardFight } from "./helpers";

describe("normal-tier Skeleton Guard keeps its plain behaviour", () => {
  const kitNames = () => getArchetype("skeleton-guard").skillIds.map((id) => getMonsterSkill(id).name);

  test("only ever basic-attacks, at full and at low HP", () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const lowHp of [false, true]) {
        const { guard, log } = runNormalSkeletonGuardFight(seed, 8, lowHp);
        const own = log.filter((l) => l.startsWith(guard.name));
        for (const name of kitNames()) expect(own.some((l) => l.includes(name))).toBe(false);
      }
    }
  });
  test("never gains guard-room state", () => {
    const { guard } = runNormalSkeletonGuardFight(3, 8, true);
    expect(guard.skillCooldowns === undefined || Object.keys(guard.skillCooldowns).length === 0).toBe(true);
    expect(guard.charging).toBeUndefined();
    expect(guard.shell).toBeUndefined();
    expect(guard.enteredPhaseIndexes).toBeUndefined();
  });
  test("base stats and normal weights are unchanged", () => {
    const a = getArchetype("skeleton-guard");
    expect([a.baseHp, a.baseAttack, a.baseDefense, a.baseSpeed]).toEqual([110, 18, 12, 4]);
    expect(a.actionWeights?.normal).toEqual({ basicAttack: 100 });
  });
});
```

Run `bun test test/normal-skeleton-guard.test.ts` — expected PASS now (it pins current behaviour). It must still pass after every later task.

- [ ] **Step 1: Mechanical data conversion.** For each of the 11 archetypes in `data/monsters.json`: remove `executeSkillId`, append that id to `skillIds`, and add it to `actionWeights.boss` with weight `100` (it is gated by its cooldown, so a high weight means "fires whenever ready"). In `data/monster-skills.json`, on each `boss-execute-*` skill add `"telegraph": true, "cooldownTurns": 4, "initialCooldownTurns": 3` (4 = the old 3 cooldown turns + the release turn). Remove `combat.executeCooldownTurns` from `data/balance-config.json` and `src/data/balanceConfig.ts`.

- [ ] **Step 2: Write the failing tests.** Rewrite `test/monster-skills.test.ts`. Keep its `queueTrivialActions` helper and the normal-tier Skeleton Guard test. Test skills are injected by pushing onto `MONSTER_SKILLS` and an archetype clone onto `MONSTER_ARCHETYPES` inside a `withFixture` helper that removes them in `finally`. Spawn uses the fixture id.

```ts
import { MONSTER_SKILLS, MONSTER_ARCHETYPES, spawnMonster } from "../src/data/monsters";
import { runMonsterTurn, advanceMonsterCooldowns } from "../src/engine/monsterAI";

function withFixture(skills: any[], archetypeOver: any, body: () => void) {
  const base = structuredClone(MONSTER_ARCHETYPES.find((a) => a.id === "giant-spider")!);
  const archetype = { ...base, id: "fixture-boss", skillIds: skills.map((s) => s.id), ...archetypeOver };
  MONSTER_SKILLS.push(...skills);
  MONSTER_ARCHETYPES.push(archetype);
  try { body(); } finally {
    for (const s of skills) MONSTER_SKILLS.splice(MONSTER_SKILLS.findIndex((x) => x.id === s.id), 1);
    MONSTER_ARCHETYPES.splice(MONSTER_ARCHETYPES.findIndex((a) => a.id === "fixture-boss"), 1);
  }
}
const sk = (id: string, over: object = {}) => ({ id, name: id, description: "x", mpCost: 0, target: "singleEnemy", effects: [{ kind: "damage", amount: 1 }], slot: 0, unlockLevel: 1, ...over });

function bossFight(seed = 1) {
  const { ctx } = makeCtx(seed);
  const boss = spawnMonster("fixture-boss", 1, { tier: "boss" });
  boss.maxHp = 100000; boss.hp = 100000;
  ctx.monsters.push(boss);
  const combat = startCombat("r1", [boss.id], ctx, true);
  const turn = () => runMonsterTurn({ kind: "monster", id: boss.id }, combat, ctx);
  return { ctx, boss, combat, turn };
}
```

Tests (each inside `withFixture`):
1. *cooldown*: skill `a` (`cooldownTurns: 2`, weight 100, basicAttack 1). Turn 1 uses `a`; turn 2 cannot (log has no `a` line); turn 3 can again. Assert via `boss.skillCooldowns`.
2. *initialCooldownTurns*: `a` with `initialCooldownTurns: 2` is unavailable on turns 1–2 and available on turn 3.
3. *usesPerCombat*: `a` with `usesPerCombat: 1` fires once in 10 turns.
4. *aiCondition*: `a` with `aiCondition: { selfHpBelowPercent: 50 }` never fires at full HP across 20 turns; fires after `boss.hp = boss.maxHp * 0.4`.
5. *aiRules*: weights `{ basicAttack: 50, a: 50 }`, `a.aiRules = [{ if: { selfHpBelowPercent: 50 }, weightMultiplier: 0 }]` — at 40% HP, 30 turns never use `a`.
6. *targetRules*: `a.targetRules = [{ if: { targetHasStatusId: "bleeding" }, weightMultiplier: 1000 }]`; give one party member `bleeding`; over 20 turns, ≥ 18 of `a`'s hits land on that member.
7. *telegraph*: `t` (`telegraph: true`, `cooldownTurns: 4`). Turn 1 logs `telegraphCharge`, deals no damage, sets `boss.charging.targetIds` to one id. Turn 2 logs `telegraphRelease` and damages exactly that id. `boss.charging` is cleared; `skillCooldowns[t]` ticks from the charge turn.
8. *telegraph re-pick*: kill the locked target between turns; turn 2 hits a living member.
9. *telegraph + stun*: after the charge, push `{ statusEffectId: "stunned", turnsRemaining: 1 }` onto the boss; turn 2 logs the stun skip and `boss.charging` is still set; after `tickSpecialEffects` removes the stun, turn 3 releases.
10. *chargeEffects*: `t.chargeEffects = [{ kind: "applyStatusEffect", statusEffectId: "guard", durationTurns: 1 }]` — after the charge turn the boss has `guard`.
11. *phase*: `phases: [{ tier: "boss", hpBelowPercent: 50, weights: { b: 1 }, onEnterSkillId: "p" }]`. At 40% HP, turn 1 logs `monsterPhase` and uses `p`; following turns use only `b`; `p` is never used again; `enteredPhaseIndexes` is `[0]`.
12. *targetCount*: `a.targetCount = { min: 3, max: 3 }` hits 3 distinct members; with 2 members alive it hits 2.
13. *targeting random*: `targeting: "random"`, one party member with aggro 10000 — over 200 basic attacks, that member takes < 50% of hits.

- [ ] **Step 3: Run** `bun test test/monster-skills.test.ts` — expected FAIL (fields ignored, `executeSkillId` gone from data).

- [ ] **Step 4: Rewrite `src/engine/monsterAI.ts`.** Keep imports, the stunned branch, the normal-tier defensive branch and the basic-attack tail unchanged. Replace the rest:

```ts
import { predicateHolds, scoreWeight, type AiView } from "./monsterAiRules";
import { livingMonsterRefs } from "./combat";

type Targetable = Character | Summon;
type MonsterAction = Id | null;

export function monsterAiView(actor: Monster, combat: CombatState, ctx: EngineContext): AiView {
  const enemies = livingPlayerSideEnemyFacingRefs(combat, ctx).map((r) => getActorByRef(r, ctx));
  const allies = livingMonsterRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Monster).filter((m) => m.id !== actor.id);
  return { self: actor, enemies, allies };
}

/** Counted at the end of each of the monster's own turns, stunned or not — the same once-per-turn pace a character's cooldowns run at. */
export function advanceMonsterCooldowns(actor: Monster): void {
  for (const id of Object.keys(actor.skillCooldowns ?? {})) {
    if (actor.skillCooldowns![id]! > 0) actor.skillCooldowns![id]! -= 1;
  }
}

function currentWeights(archetype: MonsterArchetype, actor: Monster): Record<string, number> | undefined {
  let weights = archetype.actionWeights?.[actor.tier];
  for (const [i, phase] of (archetype.phases ?? []).entries()) {
    if (phase.tier === actor.tier && actor.enteredPhaseIndexes?.includes(i)) weights = phase.weights;
  }
  return weights;
}

function phaseToEnter(archetype: MonsterArchetype, actor: Monster): number | undefined {
  const i = (archetype.phases ?? []).findIndex(
    (p, idx) => p.tier === actor.tier && !actor.enteredPhaseIndexes?.includes(idx) && (actor.hp / actor.maxHp) * 100 < p.hpBelowPercent
  );
  return i === -1 ? undefined : i;
}

function skillReady(skill: SkillDefinition, actor: Monster, view: AiView): boolean {
  if ((actor.skillCooldowns?.[skill.id] ?? 0) > 0) return false;
  if (skill.usesPerCombat !== undefined && (actor.skillUses?.[skill.id] ?? 0) >= skill.usesPerCombat) return false;
  return !skill.aiCondition || predicateHolds(skill.aiCondition, view);
}

function pickMonsterAction(archetype: MonsterArchetype, actor: Monster, view: AiView, rng: Rng): MonsterAction {
  const weights = currentWeights(archetype, actor);
  if (!weights) return null;
  const candidates: [MonsterAction, number][] = [];
  for (const [key, weight] of Object.entries(weights)) {
    if (!weight || weight <= 0) continue;
    if (key === "basicAttack") {
      candidates.push([null, weight]);
      continue;
    }
    const skill = getMonsterSkill(key);
    if (!skillReady(skill, actor, view)) continue;
    const scored = scoreWeight(weight, skill.aiRules, view);
    if (scored > 0) candidates.push([key, scored]);
  }
  if (candidates.length === 0) return null;
  return rng.weightedPick(candidates, ([, w]) => w)[0];
}

/** The aggro weighting an `aiPattern` targets by, computed once over the whole living pool. */
function aggroWeight(actor: Monster, living: Targetable[]): (c: Targetable) => number {
  if (actor.aiPattern !== "opportunistic") return (c) => Math.max(1, c.aggro);
  const aggros = living.map((c) => c.aggro);
  const mirror = Math.max(...aggros) + Math.min(...aggros);
  return (c) => Math.max(1, mirror - c.aggro);
}

/** Distinct targets, picked one at a time from the weighted pool. `targetCount` absent = one. */
function pickTargets(skill: SkillDefinition | null, archetype: MonsterArchetype, actor: Monster, living: Targetable[], view: AiView, rng: Rng): Targetable[] {
  const count = skill?.targetCount ? rng.int(skill.targetCount.min, skill.targetCount.max) : 1;
  const base = aggroWeight(actor, living);
  const pool = [...living];
  const picked: Targetable[] = [];
  while (picked.length < count && pool.length > 0) {
    const next = archetype.targeting === "random" ? rng.pick(pool) : rng.weightedPick(pool, (c) => scoreWeight(base(c), skill?.targetRules, view, c));
    picked.push(next);
    pool.splice(pool.indexOf(next), 1);
  }
  return picked;
}

function resolveMonsterSkillTargets(skill: SkillDefinition, archetype: MonsterArchetype, actor: Monster, living: Targetable[], view: AiView, rng: Rng): Actor[] {
  if (skill.target === "self") return [actor];
  if (skill.target === "allEnemies") return living;
  if (skill.target === "allAllies") return [actor, ...view.allies];
  return pickTargets(skill, archetype, actor, living, view, rng);
}

function joinNames(actors: Actor[]): string {
  const names = actors.map((a) => a.name);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")}${t("combat.targetListJoiner")}${names[names.length - 1]}`;
}

function monsterSkillLogLine(actor: Monster, skill: SkillDefinition, targets: Actor[]): string {
  if (skill.target === "allEnemies") return t("combat.monsterSkillAoe", { actor: actor.name, skill: skill.name });
  if (skill.target === "self" || skill.target === "allAllies") return t("combat.useSkillPlain", { actor: actor.name, skill: skill.name });
  return t("combat.monsterSkillOnTargets", { actor: actor.name, skill: skill.name, targets: joinNames(targets) });
}

function commitSkill(actor: Monster, skill: SkillDefinition): void {
  if (skill.cooldownTurns) actor.skillCooldowns = { ...actor.skillCooldowns, [skill.id]: skill.cooldownTurns };
  if (skill.usesPerCombat !== undefined) actor.skillUses = { ...actor.skillUses, [skill.id]: (actor.skillUses?.[skill.id] ?? 0) + 1 };
}

function useMonsterSkill(skill: SkillDefinition, archetype: MonsterArchetype, actor: Monster, living: Targetable[], view: AiView, combat: CombatState, ctx: EngineContext): void {
  const targets = resolveMonsterSkillTargets(skill, archetype, actor, living, view, ctx.rng);
  commitSkill(actor, skill);
  if (skill.telegraph) {
    actor.charging = { skillId: skill.id, targetIds: skill.target === "singleEnemy" ? targets.map((a) => a.id) : [] };
    if (skill.chargeEffects?.length) applySkillEffects({ ...skill, target: "self", effects: skill.chargeEffects }, actor, [actor], combat, ctx, combat.log);
    combat.log.push({
      text: skill.target === "singleEnemy"
        ? t("combat.telegraphCharge", { actor: actor.name, skill: skill.name, targets: joinNames(targets) })
        : t("combat.telegraphChargeAoe", { actor: actor.name, skill: skill.name }),
      kind: "info",
    });
    if (targets[0] && targets[0] !== actor) noteBasicAttack(combat, actor, targets[0]);
    return;
  }
  combat.log.push({ text: monsterSkillLogLine(actor, skill, targets), kind: skill.target === "self" || skill.target === "allAllies" ? "info" : "attack" });
  applySkillEffects(skill, actor, targets, combat, ctx, combat.log);
}

function releaseCharge(archetype: MonsterArchetype, actor: Monster, living: Targetable[], view: AiView, combat: CombatState, ctx: EngineContext): void {
  const skill = getMonsterSkill(actor.charging!.skillId);
  let targets: Actor[] = actor.charging!.targetIds.map((id) => living.find((c) => c.id === id)).filter((c): c is Targetable => c !== undefined);
  if (skill.target !== "singleEnemy") targets = resolveMonsterSkillTargets(skill, archetype, actor, living, view, ctx.rng);
  else if (targets.length === 0) targets = pickTargets(skill, archetype, actor, living, view, ctx.rng);
  actor.charging = undefined;
  combat.log.push({ text: t("combat.telegraphRelease", { actor: actor.name, skill: skill.name }), kind: "attack" });
  applySkillEffects(skill, actor, targets, combat, ctx, combat.log);
}
```

`runMonsterTurn` becomes:

```ts
export function runMonsterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Monster;
  try {
    takeMonsterTurn(actor, combat, ctx);
  } finally {
    advanceMonsterCooldowns(actor);
  }
}

function takeMonsterTurn(actor: Monster, combat: CombatState, ctx: EngineContext): void {
  if (hasStunningStatus(actor)) { /* existing stun log + noteLostTurn, unchanged */ return; }
  const living = livingPlayerSideEnemyFacingRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Targetable);
  if (living.length === 0) return;
  const archetype = getArchetype(actor.archetypeId);
  const view = monsterAiView(actor, combat, ctx);

  if (actor.charging) return releaseCharge(archetype, actor, living, view, combat, ctx);

  const phase = phaseToEnter(archetype, actor);
  if (phase !== undefined) {
    actor.enteredPhaseIndexes = [...(actor.enteredPhaseIndexes ?? []), phase];
    combat.log.push({ text: t("combat.monsterPhase", { actor: actor.name }), kind: "info" });
    const onEnter = archetype.phases![phase]!.onEnterSkillId;
    if (onEnter !== undefined) return useMonsterSkill(getMonsterSkill(onEnter), archetype, actor, living, view, combat, ctx);
  }

  // A defensive monster low on HP reaches for its own self-heal / self-buff, but only one its
  // current tier's weights name (a weight of 0 still counts: Zombie keeps Regeneration at 0 so it
  // fires only here). Skeleton Guard's skillIds hold guard-room self buffs its normal weights never
  // name, so the normal-tier Skeleton Guard never reaches them.
  if (actor.tier === "normal" && archetype.aiPattern === "defensive" && actor.hp < actor.maxHp * BALANCE.combat.defensiveLowHpThresholdFraction) {
    const tierWeights = currentWeights(archetype, actor) ?? {};
    const selfSkillId = archetype.skillIds.find((id) => id in tierWeights && getMonsterSkill(id).target === "self");
    if (selfSkillId !== undefined && ctx.rng.chance(BALANCE.combat.defensiveLowHpSkillChance)) {
      const skill = getMonsterSkill(selfSkillId);
      combat.log.push({ text: t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }), kind: "info" });
      applySkillEffects(skill, actor, [actor], combat, ctx, combat.log);
      return;
    }
  }

  const skillId = pickMonsterAction(archetype, actor, view, ctx.rng);
  if (skillId !== null) return useMonsterSkill(getMonsterSkill(skillId), archetype, actor, living, view, combat, ctx);

  const [target] = pickTargets(null, archetype, actor, living, view, ctx.rng);
  /* existing basic-attack tail, on `target!` */
}
```

The basic-attack target pick must consume the RNG exactly as before (one `weightedPick` over the same weights, in the same pool order): `normal-skeleton-guard.test.ts` and the Task 12 log comparison depend on it. Delete `pickAggroWeighted`, `pickInverseAggroWeighted` and `pickMonsterTarget` (replaced by `aggroWeight`/`pickTargets`), keeping the docstring on the mirroring rule by moving it onto `aggroWeight`. The circular import with `./combat` already exists (`getActorByRef` etc.), so adding `livingMonsterRefs` to it adds no new cycle.

- [ ] **Step 5: Spawn-time state** in `spawnMonster` (`src/data/monsters.ts`): drop `executeCooldownTurns`/`isChargingExecute`, and for elite/boss tier set initial cooldowns:

```ts
const skillCooldowns = tier === "normal"
  ? undefined
  : Object.fromEntries(archetype.skillIds.map(getMonsterSkill).filter((s) => s.initialCooldownTurns).map((s) => [s.id, s.initialCooldownTurns!]));
```

Remove `EXECUTE_COOLDOWN_TURNS` and the `executeSkillId` branch in `assertMonsterDataConsistent` (the loop becomes `for (const id of archetype.skillIds) getMonsterSkill(id);`).

- [ ] **Step 6: Strings** — replace the two `combat.bossExecute*` keys with the six keys above, in `data/strings.json`.

- [ ] **Step 7: Game editor, minimal.** In `calc.ts` remove the `EXECUTE_COOLDOWN_TURNS` import and the `executeCooldownTurns` field at :104. Set `execute` (:273) to `archetype.skillIds.map(getMonsterSkill).find((s) => s.telegraph) ?? null` and reword the :512 hint to read the skill's own `cooldownTurns`. In `server.ts:55` drop `"executeCooldownTurns"`. In `index.html` drop the execute select/field (:2617, :2676, :2692), the `executeCooldownTurns` balance key (:1731), and reword :1095 to read the telegraph skill's `cooldownTurns`.

- [ ] **Step 8: Run** `bun test` and `bun run typecheck` — expected PASS, including `test/normal-skeleton-guard.test.ts` and the existing Zombie/Skeleton Warrior low-HP self-skill tests. Fix `[AGENT_INTRODUCED]` failures only.

- [ ] **Step 9: Commit**

```bash
git add -A src data tools test
git commit -m "Run elite/boss turns through data-declared cooldowns, telegraphs, phases and target rules"
```

---

### Task 4: Monster summoning

**Files:**
- Modify: `src/engine/combat.ts` (`applySkillEffects` override pass ~:1139–1185; `resolveRound` prune calls :425, :445)
- Modify: `data/balance-config.json` + `src/data/balanceConfig.ts` (`combat.maxSummonedMonsters`: `2`)
- Modify: `data/strings.json` (`combat.monsterSummoned`: `{{actor}} calls up {{summon}}.`; `combat.summonedMonsterFalls`: `{{summon}} comes apart without {{actor}}.`)
- Test: `test/monster-mechanics.test.ts` (new)

**Interfaces:**
- Consumes: `spawnMonster(archetypeId, depth)`; `Monster.summonerId`.
- Produces: `dismissOrphanedMonsterSummons(combat, ctx, log): void` (exported, for tests).

- [ ] **Step 1: Write the failing tests** in `test/monster-mechanics.test.ts`. Use the same `withFixture`/`sk`/`bossFight` helpers as Task 3; copy them into this file so it is self-contained.
1. A self skill `{ kind: "summonMonster", monsterArchetypeId: "goblin", count: 3 }`: after one boss turn, exactly `maxSummonedMonsters` goblins are in `ctx.monsters` and `combat.combatants`, each with `summonerId === boss.id` and `expReward === 0`, and `combat.log` has one `monsterSummoned` line per add.
2. Casting again at the cap adds none.
3. The adds act from the next `resolveRound` (they appear in `combat.turnQueue`).
4. `boss.hp = 0`, then `dismissOrphanedMonsterSummons(combat, ctx, combat.log)`: every add has `hp === 0` and one `summonedMonsterFalls` line each.
5. Full round: a party that kills the summoner while adds are alive ends with `combat.outcome === "victory"` in that same `resolveRound` (set the boss to 1 HP and queue party attacks on it).
6. `Game` exp: through `test/helpers`' `makeCtx` + a `Game`-level check is heavy; instead assert `room.monsterIds` never contains an add id after a summon (adds are not room monsters), which is what `game.ts:550`/`:562` read for exp and loot.

- [ ] **Step 2: Run** `bun test test/monster-mechanics.test.ts` — expected FAIL.

- [ ] **Step 3: Implement** in `src/engine/combat.ts`:

```ts
function spawnMonsterSummons(effect: SkillEffect, summoner: Monster, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  const alive = livingMonsterRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Monster).filter((m) => m.summonerId === summoner.id);
  const count = Math.min(effect.count ?? 1, BALANCE.combat.maxSummonedMonsters - alive.length);
  for (let i = 0; i < count; i++) {
    const add = spawnMonster(effect.monsterArchetypeId!, ctx.floorDepth ?? 1);
    add.summonerId = summoner.id;
    add.expReward = 0;
    ctx.monsters.push(add);
    combat.combatants.push({ ref: { kind: "monster", id: add.id }, speed: add.speed });
    log.push({ text: t("combat.monsterSummoned", { actor: summoner.name, summon: add.name }), kind: "info" });
  }
}

/** A summoned monster does not outlive the monster that called it, so killing the summoner always ends the fight. */
export function dismissOrphanedMonsterSummons(combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  for (const ref of livingMonsterRefs(combat, ctx)) {
    const add = getActorByRef(ref, ctx) as Monster;
    if (add.summonerId === undefined) continue;
    const summoner = ctx.monsters.find((m) => m.id === add.summonerId);
    if (summoner && isActorAlive(summoner)) continue;
    add.hp = 0;
    log.push({ text: t("combat.summonedMonsterFalls", { summon: add.name, actor: summoner?.name ?? "" }), kind: "death" });
  }
}
```

In `applySkillEffects`, extend `isOverrideEffect` with `|| e.kind === "summonMonster"`, resolve its target as `effect.target ?? "self"` like `summon`, and in the override loop add before the `summon` branch:

```ts
if (effect.kind === "summonMonster") {
  if (isMonster(source)) spawnMonsterSummons(effect, source, combat, ctx, log);
  continue;
}
```

Call `dismissOrphanedMonsterSummons(combat, ctx, combat.log)` right after each `pruneDeadSummons` call in `resolveRound` (after the DoT session and after each actor turn), before the `isCombatOver` check. Import `spawnMonster` from `../data/monsters` and `isMonster` from `./resolver` if not already imported. `src/engine/resolver.ts`'s `resolveSkillEffect` has no case for `summonMonster`; add `case "summonMonster": return 0;` next to `case "summon"` with the same comment shape.

- [ ] **Step 4: Run** `bun test test/monster-mechanics.test.ts` and `bun run typecheck` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/combat.ts src/engine/resolver.ts src/data/balanceConfig.ts data/balance-config.json data/strings.json test/monster-mechanics.test.ts
git commit -m "Let monsters summon adds that fall with their summoner"
```

---

### Task 5: Harmful tags, reflect, monster-side untargetable

**Files:**
- Modify: `src/engine/resolver.ts` (`isHelpfulStatusEffect` :9; `damage` case :213–258)
- Modify: `src/engine/combat.ts` (:147–176 targetable pool + `autoResolveTargets`; `resolveExecutionTargets` :574–601; enemy-facing callers :336, :627, :963, :1067, :1094)
- Modify: `src/engine/game.ts:330-333` (`livingEnemyRefs`)
- Modify: `data/strings.json` (`combat.statusReflectDamage`: `{{attacker}} takes {{amount}} damage turned back by {{bearer}}.`)
- Test: `test/monster-mechanics.test.ts`, `test/resolver.test.ts`

**Interfaces:**
- Produces: `livingTargetableMonsterRefs(combat, ctx): CombatantRef[]` and `isUntargetable(actor: Actor): boolean` exported from `combat.ts`.

- [ ] **Step 1: Write the failing tests.**
- `test/resolver.test.ts`: a fixture status `{ id: "fixture-mark", perTurnEffects: [], harmful: true }` (push onto `STATUS_EFFECTS`, remove in `finally`) is not helpful; `removeStatusEffect` with no id on a character carrying it plus `guard` removes `fixture-mark` and keeps `guard`.
- `test/resolver.test.ts`: a monster carrying a fixture status with `reflectDamagePercent: 50` takes a 40-damage hit from a character, and the character loses 20 HP with one `statusReflectDamage` line. A DoT tick on that monster reflects nothing. A reflect that brings the character to 0 sets `isAlive = false` and logs `resolver.defeated`. Two reflect-bearing actors hitting each other produce exactly one reflect line per hit (no chain).
- `test/monster-mechanics.test.ts`: a boss carrying a fixture `untargetable` status:
  - is absent from `livingTargetableMonsterRefs` and from `autoResolveTargets("allEnemies", partyRef, ...)`;
  - a queued `singleEnemy` attack on it, with it the only monster, resolves as a fizzle (no damage line for it, no throw), while a queued self-buff still applies;
  - with a second, targetable monster present, the attack redirects to that one;
  - a party member with `overwatched` does not fire at the untargetable boss when the boss acts: no overwatch line, the boss's turn is not interrupted, and the watcher still carries `overwatched` afterwards.

- [ ] **Step 2: Run** `bun test test/resolver.test.ts test/monster-mechanics.test.ts` — expected FAIL.

- [ ] **Step 3: Implement.**

`isHelpfulStatusEffect`: first line `if (def.harmful) return false;`.

In the `damage` case, after `target.hp = Math.max(0, target.hp - finalDamage);` and the existing log/death lines, add before the lifesteal block:

```ts
if (!isSelfTick && finalDamage > 0) reflectDamage(target, source, finalDamage, ctx);
```

with, below `resolveSkillEffect`:

```ts
/** Statuses that turn part of a direct hit back on whoever landed it. Applied straight to HP, never through resolveSkillEffect, so a reflect can never be reflected again. */
function reflectDamage(bearer: Actor, attacker: Actor, damage: number, ctx: ResolveContext): void {
  const percent = bearer.activeStatusEffects.reduce((sum, s) => sum + (getStatusEffect(s.statusEffectId).reflectDamagePercent ?? 0), 0);
  const amount = Math.round((damage * percent) / 100);
  if (amount <= 0 || attacker === bearer) return;
  attacker.hp = Math.max(0, attacker.hp - amount);
  ctx.log.push({ text: t("combat.statusReflectDamage", { attacker: nameOf(attacker), amount, bearer: nameOf(bearer) }), kind: "attack" });
  if (attacker.hp <= 0 && isCharacter(attacker)) attacker.isAlive = false;
  if (attacker.hp <= 0) ctx.log.push({ text: t("resolver.defeated", { target: nameOf(attacker) }), kind: "death" });
}
```

In `combat.ts`, extract the predicate at :155 into `export function isUntargetable(actor: Actor): boolean` (used by `livingPlayerSideEnemyFacingRefs` too), and add:

```ts
/** `livingMonsterRefs` minus any monster currently `untargetable` — what the party can aim at. `isCombatOver` keeps using `livingMonsterRefs`: an airborne monster is still in the fight. */
export function livingTargetableMonsterRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return livingMonsterRefs(combat, ctx).filter((ref) => !isUntargetable(getActorByRef(ref, ctx)));
}
```

In `tryTriggerOverwatch` (:368), right after reading the target, return `false` without expiring the watcher's status when `isUntargetable(target)`: the shot stays primed. Use it in `autoResolveTargets` for the player side's `allEnemies` and the enemy half of `allAlliesAndEnemies`, and at :336, :627, :963, :1067, :1094 (artifact auto-damage, on-hit AoE, summon death burst, summon targeting). In `resolveExecutionTargets`, a `singleEnemy`/`singleAllyOrEnemy` original that is alive **and** targetable is kept; otherwise pick from `livingTargetableMonsterRefs` or fizzle; the final AoE branch filters out untargetable monsters before the empty check. `Game.livingEnemyRefs` returns `livingTargetableMonsterRefs`.

- [ ] **Step 4: Run** `bun test` and `bun run typecheck` — expected PASS (the picker test in `test/targetPicker.test.ts` must stay green).

- [ ] **Step 5: Commit**

```bash
git add src/engine/resolver.ts src/engine/combat.ts src/engine/game.ts data/strings.json test/resolver.test.ts test/monster-mechanics.test.ts
git commit -m "Add harmful tags, damage reflect and untargetable monsters"
```

---

### Task 6: Breakable shell

**Files:**
- Create: `src/engine/monsterShell.ts`
- Modify: `src/engine/resolver.ts` (`damage` case), `src/engine/combat.ts` (`startCombat`: roll shells), `src/engine/monsterAI.ts` (`runMonsterTurn`'s `finally`)
- Modify: `src/ui/app.ts:1083-1093` (shell line), `data/strings.json`
- Test: `test/monster-mechanics.test.ts`

**Strings** (exact render):
- `combat.shellBreaks`: `{{actor}}'s shell cracks open.`
- `combat.shellReforms`: `{{actor}}'s shell closes over again.`
- `ui.shellIntact`: `Shell ({{hits}} hits)` — e.g. `  Shell (5 hits)`, in the status-row colour of a buff.
- `ui.shellBroken`: `Shell broken` — in the debuff colour.

**Interfaces:**
- Produces:

```ts
export function formShell(monster: Monster, rng: Rng): void;                       // sets intact + rolled hitsLeft, if the archetype declares a shell
export function shellAdjustedDamage(target: Actor, damage: number, isTick: boolean): number;
export function noteShellHit(target: Actor, ctx: ResolveContext): void;            // counts a direct hit; breaks on the last one
export function advanceShellAfterOwnTurn(monster: Monster, rng: Rng, ctx: ResolveContext): void;
```

- [ ] **Step 1: Write the failing tests** (fixture archetype with `shell: { hitsToBreak: { min: 3, max: 3 }, hitDamageCapMaxHpPercent: 5, breakStatusId: "stunned", breakDurationTurns: 1, reformAfterOwnTurns: 2 }`, boss with 1000 maxHp):
1. After `startCombat`, `boss.shell` is `{ state: "intact", hitsLeft: 3, ownTurnsSinceBreak: 0 }`.
2. A 400-damage direct hit deals 50 (5% of 1000) and leaves `hitsLeft === 2`.
3. A burning tick on the intact shell deals 0.
4. A `hitCountRange: { min: 3, max: 3 }` character skill breaks it in one cast. An `allEnemies` skill against the boss and an add counts one hit for the boss.
5. On break: `state === "broken"`, the boss has `stunned`, one `shellBreaks` line; the next direct hit is uncapped and ticks deal damage.
6. Reform: with the boss broken, run its own turn twice (`runMonsterTurn` twice, the first stunned). After the second, `state === "intact"`, `hitsLeft === 3`, one `shellReforms` line; every harmful status (e.g. pre-applied `burning`, `weakened`) is gone and a pre-applied helpful one (`empower`) is still there.
7. Charging + break: the boss charges a telegraph, then its shell breaks; its next turn is the stun skip, `charging` is kept, and the turn after releases.
8. A character whose artifact reflects damage is hit by the intact-shell boss: the reflected amount is capped at the shell's share of max HP and `hitsLeft` does not change.
9. UI: `test/ui.test.ts`-style render of the monster panel shows `Shell (3 hits)` for an intact shell and `Shell broken` after a break (follow how existing UI tests build an `App` and read the panel text).

- [ ] **Step 2: Run** `bun test test/monster-mechanics.test.ts` — expected FAIL.

- [ ] **Step 3: Implement** `src/engine/monsterShell.ts`:

```ts
import type { Monster } from "../types";
import { getArchetype } from "../data/monsters";
import { getStatusEffect } from "../data/statusEffects";
import { t } from "../data/strings";
import type { Rng } from "./rng";
import { applyStatusEffectToActor, expireStatusEffect, isHelpfulStatusEffect, isMonster, type Actor, type ResolveContext } from "./resolver";

function shellOf(monster: Monster) {
  return monster.tier === "normal" ? undefined : getArchetype(monster.archetypeId).shell;
}

export function formShell(monster: Monster, rng: Rng): void {
  const def = shellOf(monster);
  if (!def) return;
  monster.shell = { state: "intact", hitsLeft: rng.int(def.hitsToBreak.min, def.hitsToBreak.max), ownTurnsSinceBreak: 0 };
}

/** An intact shell caps a direct hit at a share of max HP and turns a status tick away entirely. */
export function shellAdjustedDamage(target: Actor, damage: number, isTick: boolean): number {
  if (!isMonster(target) || target.shell?.state !== "intact") return damage;
  if (isTick) return 0;
  const cap = Math.max(1, Math.round((target.maxHp * shellOf(target)!.hitDamageCapMaxHpPercent) / 100));
  return Math.min(damage, cap);
}

export function noteShellHit(target: Actor, ctx: ResolveContext): void {
  if (!isMonster(target) || target.shell?.state !== "intact") return;
  target.shell.hitsLeft -= 1;
  if (target.shell.hitsLeft > 0) return;
  const def = shellOf(target)!;
  target.shell = { state: "broken", hitsLeft: 0, ownTurnsSinceBreak: 0 };
  ctx.log.push({ text: t("combat.shellBreaks", { actor: target.name }), kind: "info" });
  applyStatusEffectToActor(target, def.breakStatusId, def.breakDurationTurns, ctx);
}

/** Counts the monster's own turns since breaking (the stunned one included); on the configured one the shell re-forms and every debuff on it falls away. */
export function advanceShellAfterOwnTurn(monster: Monster, rng: Rng, ctx: ResolveContext): void {
  if (monster.shell?.state !== "broken") return;
  monster.shell.ownTurnsSinceBreak += 1;
  if (monster.shell.ownTurnsSinceBreak < shellOf(monster)!.reformAfterOwnTurns) return;
  for (const active of [...monster.activeStatusEffects]) {
    if (!isHelpfulStatusEffect(getStatusEffect(active.statusEffectId))) expireStatusEffect(monster, active, ctx);
  }
  formShell(monster, rng);
  ctx.log.push({ text: t("combat.shellReforms", { actor: monster.name }), kind: "info" });
}
```

Export `applyStatusEffectToActor` from `resolver.ts` if it is not already (it is called inside the file; check its export). Check `src/data/monsters.ts` does not import `src/engine/*` (it must not), so `monsterShell.ts` → `data/monsters` adds no cycle.

In the `damage` case of `resolveSkillEffect`: replace `const finalDamage = raceMultiplier === 0 ? 0 : Math.max(1, rawDamage);` with

```ts
const isStatusTick = isSelfTick && ctx.statusEffectName !== undefined;
const finalDamage = shellAdjustedDamage(target, raceMultiplier === 0 ? 0 : Math.max(1, rawDamage), isStatusTick);
```

and right after `target.hp = ...` add `if (!isSelfTick) noteShellHit(target, ctx);`. A multi-hit calls `resolveSkillEffect` once per hit, so each hit counts. An area skill calls it once per target, so the shell bearer counts one.

`applyArtifactReflectDamage` (`src/engine/combatHooks.ts:28`): compute `const reflected = shellAdjustedDamage(attacker, Math.round(damageDealt * (percent / 100)), false);` so an intact shell caps it; do not call `noteShellHit` there.

`startCombat`: after building `combatants`, `for (const id of monsterIds) formShell(ctx.monsters.find((m) => m.id === id)!, ctx.rng);`.

`runMonsterTurn`'s `finally`: after `advanceMonsterCooldowns(actor)`, call `advanceShellAfterOwnTurn(actor, ctx.rng, { log: combat.log })`.

UI (`src/ui/app.ts`, after the status-effect loop for monster `m`): if `m.shell`, push one line: `colorChunk(t("ui.shellIntact", { hits: m.shell.hitsLeft }), PALETTE.mp)` when intact, `colorChunk(t("ui.shellBroken"), PALETTE.fearPanic)` when broken, with the same `plainChunk("  ")` indent. Check whether `hpOverride` snapshots also need `shell` (they carry `activeStatusEffects` for the reveal); if the reveal replays per-step state, add `shell` to `CombatantSnapshot` the same way `activeStatusEffects` is carried.

- [ ] **Step 4: Run** `bun test` and `bun run typecheck` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/monsterShell.ts src/engine/resolver.ts src/engine/combat.ts src/engine/combatHooks.ts src/engine/monsterAI.ts src/ui/app.ts data/strings.json test/monster-mechanics.test.ts test/ui.test.ts
git commit -m "Give monsters a breakable shell that re-forms and sheds debuffs"
```

---

### Task 7: New statuses and the eleven kits

**Files:**
- Modify: `data/status-effects.json`, `data/monster-skills.json`, `data/monsters.json`
- Test: `test/elite-boss-kits.test.ts` (new); update `test/monster-roles.test.ts` / `test/monster-skills.test.ts` only where they named removed skill ids

- [ ] **Step 1: Write the failing data tests** in `test/elite-boss-kits.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { MONSTER_ARCHETYPES, getMonsterSkill } from "../src/data/monsters";
import type { SkillEffect } from "../src/types";

const GUARDS = MONSTER_ARCHETYPES.filter((a) => a.roles.includes("boss"));
const SUMMON_ALLOWED = new Set(["summonMonster"]);

function mechanicsOf(skillIds: string[]): Set<string> {
  const out = new Set<string>();
  const add = (e: SkillEffect) => {
    if (e.kind === "applyStatusEffect") [e.statusEffectId!, ...(e.alsoApplyStatusEffectIds ?? [])].forEach((id) => out.add(`status:${id}`));
    if (e.kind === "summonMonster") out.add("summonMonster");
    if (e.kind === "modifyStat" && e.stat === "fear") out.add("fear");
    if (e.kind === "removeStatusEffect") out.add("removeStatus");
    if (e.lifestealPercent) out.add("lifesteal");
    if (e.hitCountRange) out.add("multiHit");
    if (e.ignoreDefensePercent) out.add("ignoreDefense");
    if (e.critChance) out.add("crit");
    if (e.scalesWithStatusStacks) out.add("stackScaling");
  };
  for (const id of skillIds) {
    const s = getMonsterSkill(id);
    [...(s.effects ?? []), ...(s.chargeEffects ?? [])].forEach(add);
    if (s.executeBonus) out.add("executeBonus");
  }
  return out;
}

describe("elite/boss kits", () => {
  test("no mechanic appears in more than 2 archetypes (summonMonster allow-listed)", () => {
    const users = new Map<string, string[]>();
    for (const a of GUARDS) for (const m of mechanicsOf(a.skillIds)) users.set(m, [...(users.get(m) ?? []), a.id]);
    const over = [...users].filter(([m, ids]) => ids.length > 2 && !SUMMON_ALLOWED.has(m));
    expect(over).toEqual([]);
  });
  test("every elite skill is in the boss kit, and no telegraph or phase is reachable at elite tier", () => {
    for (const a of GUARDS.filter((g) => g.roles.includes("elite"))) {
      const elite = Object.keys(a.actionWeights!.elite!).filter((k) => k !== "basicAttack");
      const boss = new Set(Object.keys(a.actionWeights!.boss!));
      for (const id of elite) expect(boss.has(id)).toBe(true);
      for (const id of elite) expect(getMonsterSkill(id).telegraph ?? false).toBe(false);
    }
  });
  test("no two telegraphs share a cadence, and only Orc Chieftain and Void Amalgamation have none", () => {
    const cadences = new Map<string, string>();
    const without: string[] = [];
    for (const a of GUARDS) {
      const telegraphs = a.skillIds.map(getMonsterSkill).filter((s) => s.telegraph);
      if (telegraphs.length === 0) without.push(a.id);
      for (const s of telegraphs) {
        const key = `${s.cooldownTurns}/${s.initialCooldownTurns ?? 0}`;
        expect(cadences.get(key)).toBeUndefined();
        cadences.set(key, a.id);
      }
    }
    expect(without.sort()).toEqual(["orc-chieftain", "void-amalgamation"]);
  });
  test("Orc Chieftain's phase summon always has room under the cap", () => {
    const call = getMonsterSkill("call-the-warband");
    expect(call.aiCondition?.alliesFewerThan).toBe(1);
  });
  test("no old shared-kit skill remains", () => {
    for (const a of GUARDS) for (const id of a.skillIds) expect(id).not.toMatch(/^(elite-strike|elite-cleave|boss-debuff|boss-execute)-/);
  });
  test("kit sizes match the spec", () => {
    const size = (id: string, tier: "elite" | "boss") => {
      const a = MONSTER_ARCHETYPES.find((x) => x.id === id)!;
      const keys = new Set(Object.keys(a.actionWeights![tier]!).filter((k) => k !== "basicAttack"));
      for (const p of a.phases ?? []) if (p.tier === tier) { Object.keys(p.weights).filter((k) => k !== "basicAttack").forEach((k) => keys.add(k)); if (p.onEnterSkillId) keys.add(p.onEnterSkillId); }
      return keys.size;
    };
    const expected: Record<string, [number | null, number]> = {
      "skeleton-guard": [2, 4], "giant-spider": [2, 5], "dragon": [2, 5], "zombie-knight": [2, 4], "dark-knight": [2, 6],
      "orc-chieftain": [2, 5], "vampire-lord": [2, 4], "void-amalgamation": [2, 4], "ancient-golem": [2, 4], "lich": [2, 5], "the-founder": [null, 6],
    };
    for (const [id, [elite, boss]] of Object.entries(expected)) {
      if (elite !== null) expect(size(id, "elite")).toBe(elite);
      expect(size(id, "boss")).toBe(boss);
    }
  });
});
```

(Counts include phase `onEnterSkillId` skills: Dark Knight 5 + *Second Salute*, Orc 4 + *Gets Up*, Lich 4 + *Unhurried*, Golem 3 + *Crumbling Shell*, Dragon 4 + *Old Fire Wakes*, Spider 4 + *Into the Rafters*, Founder 4 + 2 phase skills.)

- [ ] **Step 2: Run** `bun test test/elite-boss-kits.test.ts` — expected FAIL.

- [ ] **Step 3: Add statuses** to `data/status-effects.json`:

```json
{"id": "challenged", "name": "Challenged", "description": "Singled out. Draws more of the enemy's attention while it lasts.", "perTurnEffects": [{"kind": "modifyCombatStat", "combatStat": "aggro", "amount": 30}], "harmful": true},
{"id": "marked", "name": "Marked", "description": "A name set down to be struck out. Does nothing on its own.", "perTurnEffects": [], "harmful": true},
{"id": "withered", "name": "Withered", "description": "Lowers max HP while it lasts.", "perTurnEffects": [{"kind": "modifyCombatStat", "combatStat": "maxHp", "amount": -20, "minPercent": -10}]},
{"id": "riposte", "name": "Riposte", "description": "Turns part of every direct hit back on whoever landed it.", "perTurnEffects": [], "reflectDamagePercent": 40},
{"id": "airborne", "name": "Airborne", "description": "Out of reach of every attack while it lasts.", "perTurnEffects": [], "untargetable": true}
```

- [ ] **Step 4: Replace the 44 old `elite-*`/`boss-*` skills** in `data/monster-skills.json` with the kits below. Every skill carries `"mpCost": 0, "slot": 0, "unlockLevel": 1`. Numbers are starting values; Task 9 tunes them. `st(id, dur, chance?)` below means `{"kind": "applyStatusEffect", "statusEffectId": id, "durationTurns": dur[, "chance": chance]}`; `dmg(n, …)` means `{"kind": "damage", "amount": n, …}`; `fear(n)` means `{"kind": "modifyStat", "stat": "fear", "amount": n}`. Expand them to literal JSON.

| id | name | target | effects | AI fields | description |
|---|---|---|---|---|---|
| `hold-the-line` | Hold the Line | self | st(guard-iii,2) | cd 3; aiRules [selfHpBelowPercent 50 → ×3] | Sets its feet on the worn ring and stops giving ground. |
| `shield-bash` | Shield Bash | singleEnemy | dmg(18); st(enfeebled,2,0.5) | — | The shield edge, driven into the forearm that was raised to stop it. |
| `riposte-stance` | Riposte Stance | self | st(riposte,1) | cd 3 | The blade comes back to the guard and waits there for something to answer. |
| `overhead-cut` | Overhead Cut | singleEnemy | dmg(55, ignoreDefensePercent 40) | telegraph; cd 5; icd 4 | The weapon goes up to full height and stays there over one head. |
| `web-barrage` | Web Barrage | singleEnemy | dmg(10); st(webbed,2,0.6) | targetCount 2–3; cd 2; targetRules [targetLacksStatusId webbed → ×3] | Strands thrown in loose handfuls, at whoever is still moving freely. |
| `venom-bite` | Venom Bite | singleEnemy | dmg(22); st(poisoned-ii,3) | targetRules [targetHasStatusId webbed → ×3] | It goes for what the web is already holding still. |
| `cocoon` | Cocoon | singleEnemy | dmg(30); st(stunned,1); st(poisoned-iii,3) | telegraph; cd 4; icd 2; targetRules [webbed → ×4] | It turns the caught one over and over until there is nothing left to struggle with. |
| `feed` | Feed | singleEnemy | dmg(24) + `executeBonus` {hpPercentThreshold 40, bonusDamagePercent 60} | targetRules [targetHasStatusId poisoned → ×3; targetHpBelowPercent 40 → ×2] | It takes its time over the one that has stopped fighting back. |
| `into-the-rafters` | Into the Rafters | self | st(smoke-cover-ii,3) | (phase onEnter) | It is overhead now, in the part of the dark the torch never reaches. |
| `claw-rake` | Claw Rake | singleEnemy | dmg(14, hitCountRange 1–2) | — | A claw brought down like a roof coming in, and sometimes the other one after it. |
| `dragon-fire-breath` | Fire Breath | allEnemies | dmg(10); st(burning,2,0.5) | cd 2; aiRules [targetsBelowHpPercent 50, atLeast 2 → ×2] | One long sweep of flame that reaches the walls on either side. |
| `brand` | Brand | singleEnemy | dmg(12); st(burning-vulnerable,3) | targetRules [targetHasStatusId burning → ×4] | It breathes on the burn already there, slowly, until it takes. |
| `inferno` | Inferno | allEnemies | dmg(34) | telegraph; cd 5; icd 3; chargeEffects [st(airborne,1)] | It climbs out of reach, and the air at the top of the room starts to glow. |
| `old-fire-wakes` | Old Fire Wakes | self | st(empower,99) | (phase onEnter) | The heat comes off it in a new way, from somewhere it had kept closed. |
| `diseased-blade` | Diseased Blade | singleEnemy | dmg(24); st(enfeebled,2) | — | The edge is black with what has been growing on it, and the arm it opens goes slack. |
| `guard-position` | Guard Position | self | st(guard-ii,2) | cd 3 | The next position in the sequence, taken correctly, as it always is. |
| `undying` | Undying | self | {"kind":"heal","amount":0,"maxHpPercent":35} | usesPerCombat 1; aiCondition {selfHpBelowPercent 30} | It goes down, and then it is getting up, in no hurry about it. |
| `rotting-embrace` | Rotting Embrace | singleEnemy | dmg(50); st(agony,3) | telegraph; cd 4; icd 3 | Both arms open, the way a guard opens to let someone in close. |
| `salute` | Salute | singleEnemy | st(challenged,3); fear(8) | cd 4; aiRules [targetHasStatusId challenged → ×0.2]; targetRules [targetLacksStatusId challenged → ×5] | It turns to one of you and raises the blade to its face. |
| `measured-cut` | Measured Cut | singleEnemy | dmg(26, critChance 0.25) | targetRules [challenged → ×5] | Exactly as much as the opening allows, and the opening was its own. |
| `parry-stance` | Parry Stance | self | st(fortify,2) | cd 3 | The blade comes across the body and the whole of it closes behind. |
| `dread-presence` | Dread Presence | allEnemies | fear(6) | cd 3 | It stands without moving, and every one of you feels where it is looking. |
| `abyssal-judgment` | Abyssal Judgment | singleEnemy | dmg(60); st(stunned,1) | telegraph; cd 3; icd 2; aiCondition {targetHasStatusId challenged}; targetRules [challenged → ×8] | The salute again, slower, and then what the salute was for. |
| `second-salute` | Second Salute | singleEnemy | st(challenged,3); fear(8) | targetRules [targetLacksStatusId challenged → ×5] (phase onEnter) | It lowers the blade, looks at the rest of you, and chooses again. |
| `skullsplitter` | Skullsplitter | singleEnemy | dmg(28) + executeBonus {30, 70} | targetRules [targetHpBelowPercent 30 → ×3] | Brought down on whoever is already on one knee. |
| `call-the-warband` | Call the Warband | self | {"kind":"summonMonster","monsterArchetypeId":"goblin","count":1} | cd 2; aiCondition {alliesFewerThan 1} | It does not get up. It shouts, and something smaller comes running. |
| `war-cry` | War Cry | allAllies | st(rallied-ii,2) | cd 3; aiRules [alliesFewerThan 1 → ×0.2] | A roar the whole warband answers, louder each time. |
| `rout` | Rout | singleEnemy | dmg(16); st(weakened,2) | targetCount 2–3; targetRules [targetHpBelowPercent 50 → ×2] | It wades through the line at whoever looks ready to break. |
| `gets-up` | Gets Up | self | st(bloodrage,99); {"kind":"summonMonster","monsterArchetypeId":"orc-brute","count":1} | (phase onEnter) | Now it gets up. |
| `crimson-talon` | Crimson Talon | singleEnemy | dmg(20); st(bleeding,3) | — | A single nail, drawn across the throat with care. |
| `drink` | Drink | singleEnemy | dmg(16, lifestealPercent 60, scalesWithStatusStacks {bleeding, 20}) | targetRules [targetHasStatusId bleeding → ×5] | It goes where the blood is already coming, and stays a while. |
| `bat-swarm` | Bat Swarm | self | {"kind":"summonMonster","monsterArchetypeId":"vampire-bat","count":2} | cd 3; aiCondition {alliesFewerThan 2}; aiRules [selfHpBelowPercent 50 → ×3] | It opens its coat, and the dark inside it comes apart into wings. |
| `final-draught` | Final Draught | singleEnemy | dmg(45, lifestealPercent 100) | telegraph; cd 3; icd 3; targetRules [bleeding → ×6] | It has decided which of you it will finish, and it lets you see it decide. |
| `grasping-remnants` | Grasping Remnants | singleEnemy | dmg(14); st(shredded,3) | targetCount 2–3 | Several of the parts reach out at once, each for someone different. |
| `unravelling-tide` | Unravelling Tide | allEnemies | dmg(12); st(corroded,2,0.5) | — | It spills across the floor and what it touches comes loose at the seams. |
| `old-work` | Old Work | self | st(regeneration,3) | cd 3 | One of the parts goes back to what it used to do, and what it used to do was mend. |
| `subsume` | Subsume | singleEnemy | dmg(40, lifestealPercent 50) | cd 3 | It folds over one of you, and comes back up a little larger. |
| `stoneshear` | Stoneshear | singleEnemy | dmg(34) | — | A slab of a fist, swung through where you were standing. |
| `tremor` | Tremor | allEnemies | dmg(12); st(slowed,2) | — | Its weight comes down and the floor carries it to everyone. |
| `sealing-blow` | Sealing Blow | singleEnemy | dmg(75) | telegraph; cd 6; icd 4 | Both arms go up to close a door that is no longer there. |
| `crumbling-shell` | Crumbling Shell | self | st(empower,99) | (phase onEnter) | Pieces of it come away, and what is underneath moves faster. |
| `withering-touch` | Withering Touch | singleEnemy | dmg(22); st(withered,3) | — | One dry hand, laid flat, and the years go out of whatever it touches. |
| `raise-the-dead` | Raise the Dead | self | summonMonster skeleton 1; summonMonster skeleton-mage 1 | cd 3; aiCondition {alliesFewerThan 2} | It says something to the floor, and the floor gives back what it was holding. |
| `ledger-mark` | Ledger Mark | singleEnemy | st(marked,4) | cd 3; targetRules [targetLacksStatusId marked → ×5] | It looks at one of you for exactly as long as it takes to write something down. |
| `name-struck-out` | Name Struck Out | singleEnemy | dmg(65); {"kind":"removeStatusEffect","statusEffectId":"marked"} | telegraph; cd 3; icd 1; aiCondition {targetHasStatusId marked}; targetRules [targetHasStatusId marked → ×8] | Regards one of them the way a clerk regards a line about to be crossed through. |
| `unhurried` | Unhurried | allEnemies | st(marked,4); summonMonster skeleton 3 | (phase onEnter) | It stops trying to be quick about any of this. |
| `paid-in-full` | Paid In Full | singleEnemy | dmg(20) | targetCount 2–3 | Ropes of tissue snap out of the dark, one for each of you it can reach. |
| `the-same-price` | The Same Price | allEnemies | dmg(16, ignoreDefensePercent 100) | — | Every rope lashes out at once, and none of you is struck harder than the rest. |
| `whats-left-listening` | What's Left Listening | singleEnemy | dmg(22); st(blinded,2); fear(8) | — | Something in the dark looks back at one of you, and afterwards the eyes are slow to answer. |
| `everything-you-asked-for` | Everything You Asked For | singleEnemy | dmg(70, ignoreDefensePercent 40) | telegraph; cd 4; icd 4 | Draws every rope in toward a single spot on the floor, and waits for someone to be standing on it. |
| `hung-lower` | Hung Lower | self | st(knitting-ii,99) | (phase onEnter) | It lets itself down a little further into the light, and what hangs there begins to close. |
| `the-last-of-it` | The Last of It | allEnemies | fear(12) | (phase onEnter) | The ropes go slack. What hangs there now is smaller than it was, and it is not trying to keep any of it. |

(`cd` = `cooldownTurns`, `icd` = `initialCooldownTurns`. Telegraph cadences are all distinct: Skeleton Guard 5/4, Spider 4/2, Dragon 5/3, Zombie 4/3, Dark Knight 3/2, Vampire 3/3, Golem 6/4, Lich 3/1, Founder 4/4. *Call the Warband* keeps at most one Goblin up so *Gets Up*'s Orc Brute always fits under the cap. `the-same-price`, `whats-left-listening`, `everything-you-asked-for` keep the Founder's existing names, so reuse their current description text where it is unchanged.)

Check every existing id the table assumes exists: `guard-iii`, `enfeebled`, `webbed`, `poisoned-ii`, `poisoned-iii`, `smoke-cover-ii`, `burning`, `burning-vulnerable`, `empower`, `guard-ii`, `agony`, `fortify`, `rallied-ii`, `weakened`, `bloodrage`, `bleeding`, `shredded`, `corroded`, `regeneration`, `slowed`, `blinded`, `knitting-ii`, `stunned` (statuses) and `goblin`, `orc-brute`, `vampire-bat`, `skeleton`, `skeleton-mage` (archetypes). The loader from Task 1 throws on any miss.

- [ ] **Step 5: Wire the archetypes** in `data/monsters.json`. `skillIds` = every skill in that archetype's rows above. `actionWeights.normal` for Skeleton Guard stays `{"basicAttack": 100}`. Weights (`basicAttack` first):

| archetype | elite | boss | phases | other |
|---|---|---|---|---|
| skeleton-guard | 30 / hold 30 / bash 40 | 20 / hold 20 / bash 30 / riposte 15 / overhead 100 | — | — |
| giant-spider | 30 / web 35 / venom 35 | 20 / web 25 / venom 25 / feed 15 / cocoon 100 | boss <40%: 15 / venom 35 / feed 30 / cocoon 100, onEnter `into-the-rafters` | — |
| dragon | 40 / claw 35 / breath 25 | 25 / claw 25 / breath 20 / brand 15 / inferno 100 | boss <50%: 20 / claw 20 / breath 30 / brand 10 / inferno 100, onEnter `old-fire-wakes` | — |
| zombie-knight | 40 / blade 35 / guard 25 | 25 / blade 25 / guard 15 / undying 60 / embrace 100 | — | — |
| dark-knight | 30 / salute 30 / cut 40 | 20 / salute 15 / cut 25 / parry 15 / dread 10 / judgment 100 | boss <50%: same weights, onEnter `second-salute` | — |
| orc-chieftain | 35 / skull 35 / call 30 | 20 / skull 25 / call 15 / war-cry 15 / rout 25 | boss <50%: 15 / skull 40 / call 10 / war-cry 15 / rout 20, onEnter `gets-up` | — |
| vampire-lord | 35 / talon 40 / drink 25 | 20 / talon 25 / drink 25 / swarm 15 / draught 100 | boss <40%: 15 / talon 20 / drink 75 / swarm 15 / draught 100 | — |
| void-amalgamation | 40 / grasp 35 / tide 25 | 25 / grasp 25 / tide 20 / old-work 15 / subsume 15 | — | `"targeting": "random"` |
| ancient-golem | 40 / stone 35 / tremor 25 | 30 / stone 30 / tremor 20 / sealing 100 | boss <50%: 20 / stone 30 / tremor 15 / sealing 100, onEnter `crumbling-shell` | `"shell": {"hitsToBreak": {"min": 6, "max": 8}, "hitDamageCapMaxHpPercent": 4, "breakStatusId": "stunned", "breakDurationTurns": 1, "reformAfterOwnTurns": 2}` |
| lich | 35 / touch 35 / raise 30 | 20 / touch 20 / raise 15 / mark 20 / struck 100 | boss <50%: same weights, onEnter `unhurried` | — |
| the-founder | — | 15 / paid 25 / price 20 / listening 25 / everything 100 | boss <60%: same weights, onEnter `hung-lower`; boss <25%: 10 / paid 20 / price 15 / listening 40 / everything 100, onEnter `the-last-of-it` | — |

Phases are listed in the order they are entered (the engine applies the last entered phase's weights).

- [ ] **Step 6: Run** `bun test` and `bun run typecheck`. Update `test/monster-skills.test.ts` / `test/monster-roles.test.ts` lines that named removed ids (e.g. "the-founder carries the full strike/cleave/execute/debuff kit") to assert the new kit instead. Expected PASS.

- [ ] **Step 7: Tone pass.** Read every new description against `02-monster.md` "Writing `description` text" and the existing voice in `data/monster-skills.json`; strip anything that names a mechanic, number or other skill, and any slop/cringe. Run the `anti-slop` skill on the list if available.

- [ ] **Step 8: Commit**

```bash
git add data/status-effects.json data/monster-skills.json data/monsters.json test/elite-boss-kits.test.ts test/monster-skills.test.ts test/monster-roles.test.ts
git commit -m "Give every elite and boss its own kit"
```

---

### Task 8: Save round-trip of the new monster state

**Files:**
- Modify: `src/engine/save.ts` (combat/monster validation around :172–220)
- Test: `test/save.test.ts`

- [ ] **Step 1: Write the failing test** in `test/save.test.ts`, following the file's existing save/load pattern: a boss mid-charge (`charging` set), with `enteredPhaseIndexes: [0]`, `skillCooldowns`, `skillUses`, a broken `shell`, and one add with `summonerId`. Save, load, and assert deep equality of `ctx.monsters` and `state.combat.combatants`. Then corrupt each field in turn (`shell.state = "cracked"`, `charging.skillId = "nope"`, `skillCooldowns.x = -1`, `summonerId` pointing at no monster) and assert the load is rejected.

- [ ] **Step 2: Run** `bun test test/save.test.ts` — expected FAIL on the corruption cases.

- [ ] **Step 3: Implement** in the monster validation of `src/engine/save.ts`: `shell` absent or `{state ∈ {intact, broken}, hitsLeft/ownTurnsSinceBreak non-negative integers}`; `charging` absent or `skillId` a known monster skill and `targetIds` strings; `skillCooldowns`/`skillUses` values non-negative integers; `enteredPhaseIndexes` non-negative integers; `summonerId` absent or the id of a monster in the saved list. Use the file's existing helpers (`existsInCatalog`, `Number.isInteger` checks).

- [ ] **Step 4: Run** `bun test test/save.test.ts` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/save.ts test/save.test.ts
git commit -m "Validate charging, phase, shell and summon state in saves"
```

---

### Task 9: Difficulty curve — simulation test and tuning

**Files:**
- Create: `test/elite-boss-balance.test.ts`
- Modify (tuning): `data/monster-skills.json`, `data/monsters.json` (weights, amounts, cooldowns; guard-only `baseHp`/`baseAttack`/`baseDefense`)

**Interfaces:**
- Consumes: `simulateLevelByDepth` (`tools/game-editor/calc.ts:531`), `previewSkillDamage` (`calc.ts:366`), `monsterBalancePoints` (`calc.ts:64`), `createCharacter(id, name, cls, level)` (`src/engine/party.ts:67`), `spawnMonster`, `startCombat`, `queueAction`, `resolveRound`, `checkSkillUsable`, `autoResolveTargets`, `livingTargetableMonsterRefs`, `FOUNDER_FLOOR_DEPTH` (`src/data/endings.ts:44`), `BOSS_FLOOR_INTERVAL`.

- [ ] **Step 1: Write the test.** Constants at the top (the targets live here, not in docs):

```ts
const BANDS = [
  { ids: ["skeleton-guard", "giant-spider"], dpr: { elite: [5, 7], boss: [6, 8] }, rounds: { elite: [4, 6], boss: [6, 9] }, telegraphCap: 0.45 },
  { ids: ["zombie-knight", "orc-chieftain", "vampire-lord"], dpr: { elite: [6, 8], boss: [7, 9] }, rounds: { elite: [5, 8], boss: [8, 11] }, telegraphCap: 0.55 },
  { ids: ["dark-knight", "void-amalgamation", "lich"], dpr: { elite: [7, 9], boss: [8, 10] }, rounds: { elite: [6, 9], boss: [10, 13] }, telegraphCap: 0.65 },
  { ids: ["ancient-golem", "dragon"], dpr: { elite: [8, 10], boss: [9, 11] }, rounds: { elite: [7, 10], boss: [12, 15] }, telegraphCap: 0.75 },
  { ids: ["the-founder"], dpr: { boss: [9, 11] }, rounds: { boss: [15, 19] }, telegraphCap: 0.8 },
] as const;
const PARTIES = [["vanguard", "mage", "acolyte", "archer"], ["viking", "rogue", "plague-doctor", "summoner"], ["vanguard", "ninja", "mage", "rogue"]];
const SEEDS = 6;
```

Harness, per archetype × tier × party × seed:
- depth: elite = `max(1, minFloor)`; boss = the first multiple of `BOSS_FLOOR_INTERVAL` ≥ that depth; Founder = `FOUNDER_FLOOR_DEPTH`.
- level: `simulateLevelByDepth(20, maxDepth)[depth - 1].avgLevel`, computed once.
- party: `createCharacter` at that level; context `{ party, monsters: [boss], summons: [], rng: new Rng(seed), inventory: {} }`; `startCombat(..., isBossFight: tier === "boss")`.
- party policy each round: for each living character, the last affordable, ready skill (`checkSkillUsable` returns null) whose target is `singleEnemy` or `allEnemies`; target = the boss if targetable, else the first ref from `livingTargetableMonsterRefs`, else skip; no heals, no items — so party HP lost per round is damage taken.
- per round record `Σ hp before − Σ hp after` over living party (clamped at 0) as a share of the party's total max HP; stop at victory, defeat, or 40 rounds.
- metrics: mean damage share per round (DPR %) and mean rounds to finish, across parties and seeds.

Assertions:
1. Every archetype × tier sits inside its band's `dpr` and `rounds` ranges.
2. Band means rise strictly from band to band, for both metrics.
3. For every boss-tier damaging skill: `previewSkillDamage` (max hit count, crit multiplier when `critChance` is set) against the lowest-HP / lowest-defense class at that level is `< telegraphCap × minHp` for telegraphs, and `< minHp` for every skill.
4. `monsterBalancePoints` of every guard-only archetype is within `24 ± 1` (the Founder excluded).

Print a `console.table` of all metrics (useful while tuning; keep it behind `if (process.env.BALANCE_REPORT)`).

- [ ] **Step 2: Run** `BALANCE_REPORT=1 bun test test/elite-boss-balance.test.ts` — expected FAIL with the starting values; read the table.

- [ ] **Step 3: Tune** data only, in this order, re-running after each change:
  1. Durability first, so mechanics have time to show: Spider moves points from `baseAttack` to `baseHp`; Golem drops `baseDefense` (its shell carries durability) and gains `baseHp`/`baseAttack`; Founder drops `baseDefense`. Keep Balance Points in band (assertion 4). Skeleton Guard is triple-role — leave its base stats and `actionWeights.normal` alone (`test/normal-skeleton-guard.test.ts` fails otherwise); tune its elite/boss weights and kit instead. Keep every telegraph cadence distinct while tuning.
  2. Damage share next, through skill `amount`s and weights.
  3. Telegraph caps last, through telegraph `amount`/`ignoreDefensePercent`.
  If a band's `rounds` range is unreachable with skills in play (the spec flags the basic-attack proxy), shift that band's `rounds` range in the test constants, keeping the ordering assertion green, and say so in the final report.

- [ ] **Step 4: Run** `bun test` and `bun run typecheck` — expected PASS. The balance test must finish in reasonable time; if it exceeds ~30 s, lower `SEEDS` to 4.

- [ ] **Step 5: Commit**

```bash
git add test/elite-boss-balance.test.ts data/monster-skills.json data/monsters.json
git commit -m "Tune every elite and boss to a difficulty curve that rises with depth"
```

---

### Task 10: Game editor

**Files:**
- Modify: `tools/game-editor/index.html` (monster form `collect()` ~:2683; monster-skill form), `tools/game-editor/calc.ts`

- [ ] **Step 1:** In both CRUD `collect()` functions, start from the entry being edited so fields the form does not render are kept: `const out = { ...entry, id: ..., name: ..., ... }` and `delete out.<field>` where an optional rendered field is cleared (today they are added with `if (x.value) out.x = ...`; make each clear branch delete instead).
- [ ] **Step 2:** Add one `<textarea>` per form, labelled "AI & mechanics (JSON)", holding the entry's `phases`/`targeting`/`shell` (monster) or `aiCondition`/`aiRules`/`targetRules`/`telegraph`/`chargeEffects`/`targetCount`/`cooldownTurns`/`initialCooldownTurns`/`usesPerCombat` (skill). It is parsed with `JSON.parse` on collect, merged into `out`, and a parse error throws the form's existing error. The server-side loader validation (Task 1) rejects bad values on save.
- [ ] **Step 3:** In `calc.ts`'s monster kit preview, list phase weights under the tier they belong to and label telegraph skills by their `cooldownTurns`.
- [ ] **Step 4:** Run `bun run game-editor`, open it, edit and save Dragon without touching the JSON box, and confirm `git diff data/monsters.json` is empty; edit one weight inside the JSON box, save, and confirm the diff is just that weight. Revert.
- [ ] **Step 5: Commit**

```bash
git add tools/game-editor
git commit -m "Keep and edit elite/boss AI fields in the game editor"
```

---

### Task 11: Docs merge and cleanup

**Files:**
- Modify: `docs/gameplay-decisions/06-level-system.md` §6.12, `docs/gameplay-decisions/02-monster.md` ("AI patterns", "Guard-room archetypes"), `docs/technical-decisions.md` §5, `docs/developer-guide.md` (combat section, if it describes the Finishing Blow)
- Delete: `docs/specs/elite-boss-kits.md`, `docs/specs/elite-boss-kits-plan.md`

- [ ] **Step 1:** Rewrite §6.12 around the per-archetype kits: the AI turn flow, predicates, telegraph, phases, the six mechanics, and the difficulty bands described in words (Part 4 of the spec). Remove every mention of Strike/Cleave/Debuff/Finishing Blow as shared roles, `executeSkillId` and `executeCooldownTurns`.
- [ ] **Step 2:** In `02-monster.md`, replace the guard-room paragraph's "own elite/boss skill kit (`skillIds` + `executeSkillId`)" wording, and the `defensive` note that names "Zombie Knight, Dark Knight, Skeleton Guard own no self-targeted skill" (now false — check it against the data and describe the current state).
- [ ] **Step 3:** In `technical-decisions.md` §5, replace the execute bullets with the new fields (`aiCondition`, `aiRules`, `targetRules`, `telegraph`, `chargeEffects`, `targetCount`, `initialCooldownTurns`, `phases`, `targeting`, `shell`, `summonMonster`, `reflectDamagePercent`, `harmful`) and where each is resolved.
- [ ] **Step 4:** Run `bun run docs:sync`, then `bun run docs:sync --check` and `bun run docs:sync --coverage`; commit the rewritten generated tables. Fix any hand-copied number the coverage pass flags in the text you wrote.
- [ ] **Step 5:** Delete both spec files; `grep -rn "elite-boss-kits" docs` returns nothing.
- [ ] **Step 6:** Run `bun test` and `bun run typecheck` — expected PASS.
- [ ] **Step 7: Commit**

```bash
git add -A docs
git commit -m "Document per-monster elite and boss kits"
```

---

### Task 12: In-game verification

- [ ] **Step 1:** Use the `tui-testing` skill, and `bun run dump-save` to build saves at: floor 5 boss (Skeleton Guard), floor 40 boss (Orc Chieftain), floor 90 boss (Ancient Golem), floor 100 boss (Dragon).
- [ ] **Step 2:** In each, play rounds until you have seen and captured: a telegraph charge and release line; a phase line; Orc summoning two adds that fit on the battlefield next to the boss with no wrapped or clipped sprite; `Shell (n hits)` → `Shell broken` → re-form; Dragon `Airborne` in the status row with the target picker offering no Dragon.
- [ ] **Step 3: Normal-tier Skeleton Guard against `main`.** Re-run the Task 3 Step 0 capture into `normal-skeleton-guard-branch.json` and compare:

```bash
bun -e 'import { runNormalSkeletonGuardFight } from "./test/helpers"; const out = []; for (let s = 0; s < 30; s++) for (const low of [false, true]) out.push(runNormalSkeletonGuardFight(s, 8, low).log); await Bun.write(process.env.SCRATCH + "/normal-skeleton-guard-branch.json", JSON.stringify(out));'
cmp "$SCRATCH/normal-skeleton-guard-main.json" "$SCRATCH/normal-skeleton-guard-branch.json"
```

Expected: no output (identical). Any difference is a regression to fix, not to accept.
- [ ] **Step 4:** Fix anything wrong (each fix with a test where the engine is involved), re-run `bun test` and `bun run typecheck`, commit with a message naming the fix.
