# Battlefield Action Focus Implementation Plan (v2, after review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a round resolves, grey out every battlefield unit that is not part of the action being narrated, mark roles with icons, and pace the log by action ("session"), with a 50-line room log and a 500-line run log screen.

**Architecture:** The engine tags each log entry with a `LogSession` (who acted, who was attacked/debuffed/buffed/healed). The UI drives one `RevealQueue` clock; the battlefield highlight is read from the queue's current session in the same `render()` call that shows the log line, so the two cannot drift. Spec: `docs/specs/2026-10-07-battlefield-action-focus-design.md`.

**Tech Stack:** Bun, TypeScript (strict), OpenTUI (`@opentui/core`), `bun:test`.

## Global Constraints

- Sessions last at least **1.5 s**; log lines inside a session appear **0.1 s** apart; a session with more than 15 lines lasts `lines × 0.1 s`.
- Room log: **50** entries, cleared when the player enters another room (on the next log write or render, whichever comes first). Run log: **500** latest entries, in memory only (not saved).
- Full log opens with **`[l]`**, closes with `Esc`, scrolls with `↑`/`↓`. Inside the log screen only those three keys and `Ctrl+C` work; the footer advertises only `[Esc] Back   │   [Ctrl+C] Quit`.
- Icons are Unicode: sword `⚔`, shield `⛨`, buff `▲`, debuff `▼`, heal `✚`, support caster `⚚`. Blue (`#5b8fc9`) = party, red (`#c0392b`) = monster, **chosen by the side of the unit wearing the icon** (also for buff/heal glyphs).
- Icon band above the sprites: 1 icon row + 1 blank row (battlefield grows by 2 rows). Icons are centred over each unit's **sprite**, not its nominal slot.
- Debuff-only is decided **per skill**: a skill with a damage effect that reaches the opposing side shows `⛨` on every opposing target it names (including targets reached only by a debuff); a skill with no such damage shows `▼`. Missed targets still show `⛨`/`▼`.
- Caster icons: `⚔` if it attacked or debuffed, `⚚` if it buffed or healed; several glyphs sit side by side.
- A summon has no sprite: every id it would occupy in a session is its owner's id. Its immediate turn after being summoned belongs to the owner's session.
- Round-start/round-end ticks (DoT, stat-mod expiry, dying damage, artifact auto-damage) are **one actor-less session per block**, lighting only the units whose tick actually logged.
- Entries with no session (combat start, reward lines, toasts, `finalizeRound` messages) reveal at 0.1 s per line with no hold; the battlefield stays at normal colours.
- All game and doc text is English. Pacing constants live in `src/ui/`, not in `data/*.json` (UI timing, not balance).
- No hint in the footer for a key that does not work (`docs/developer-guide.md` §"Key hints").
- Before finishing: `bun test`, `bun run typecheck`, `bun run docs:sync --check` all pass.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/types.ts` (modify) | `LogSession`, `LogEntry.session`, `CombatState.activeSession` |
| `src/engine/logSession.ts` (create) | Build sessions: `unitId`, `runInSession`, `runTicksInSession`, `noteAffected`, `noteSkillTarget`, `noteBasicAttack` |
| `src/engine/combat.ts` (modify) | Wrap every actor turn and tick in a session; note targets |
| `src/engine/monsterAI.ts` (modify) | Note basic-attack and charge targets |
| `src/ui/revealQueue.ts` (create) | Pure clock: groups entries into sessions, `tick()`, `flush()`, `focus` |
| `src/ui/sprites.ts` (modify) | `spriteSlotLayout` (shared by sprite compositing and the icon band) |
| `src/ui/battlefieldFocus.ts` (create) | Pure helpers: `dimColor`, `dimSprite`, `unitFocus`, `focusedUnit`, `buildSideIconBand`, `blankIconBand` |
| `src/ui/layout.ts` (modify) | `ICON_BAND_ROWS`, taller `UNIT_BLOCK_HEIGHT` |
| `src/ui/screens/log.ts` (create) | `logLines()` shared by both logs |
| `src/ui/app.ts` (modify) | `RevealQueue`, room/run logs, focus rendering, full-log view, `[l]` key |
| `src/ui/state.ts`, `src/ui/keyHints.ts`, `data/strings.json` (modify) | `fullLog` UiState, `[l] Log` hint, strings |
| `docs/developer-guide.md` (modify) | Battlefield/Log sections, hint rules, file layout |
| `test/logSession.test.ts`, `test/revealQueue.test.ts`, `test/battlefieldFocus.test.ts`, `test/actionFocus.test.ts` (create), `test/keyHints.test.ts`, `test/ui.test.ts` (modify) | Tests |

---

### Task 0: Branch

- [ ] **Step 1: Create the working branch from `main`**

```bash
git switch -c feat/battlefield-action-focus
```

Expected: `Switched to a new branch 'feat/battlefield-action-focus'`. The spec and this plan are untracked files and come along; commit them in Task 1.

---

### Task 1: Engine session model

**Files:**
- Modify: `src/types.ts` (the `LogEntry`/`CombatState` block, lines ~717-757)
- Create: `src/engine/logSession.ts`
- Test: `test/logSession.test.ts`

**Interfaces:**
- Produces (used by Tasks 2, 4, 5):
  - `interface LogSession { id: number; actorId: Id | null; attackedIds: Id[]; debuffedIds: Id[]; buffedIds: Id[]; healedIds: Id[]; affectedIds: Id[] }`
  - `LogEntry.session?: LogSession`, `CombatState.activeSession?: LogSession`
  - `unitId(actor: Actor): Id`
  - `runInSession<T>(combat: CombatState, actorId: Id | null, body: () => T, affectedIds?: Id[]): T`
  - `noteAffected(combat: CombatState, actor: Actor): void`
  - `runTicksInSession(combat: CombatState, actors: Actor[], tick: (actor: Actor) => void): void`
  - `noteSkillTarget(combat: CombatState, source: Actor, target: Actor, effects: SkillEffect[], skillDealsDamage: boolean): void`
  - `noteBasicAttack(combat: CombatState, source: Actor, target: Actor): void`

- [ ] **Step 1: Write the failing test**

Create `test/logSession.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { startCombat } from "../src/engine/combat";
import { noteAffected, noteBasicAttack, noteSkillTarget, runInSession, runTicksInSession, unitId } from "../src/engine/logSession";
import type { Actor } from "../src/engine/resolver";
import type { SkillEffect } from "../src/types";
import { makeCtx, spawnInto } from "./helpers";

function setup() {
  const { ctx } = makeCtx(5);
  const goblin = spawnInto(ctx, "goblin");
  const goblin2 = spawnInto(ctx, "goblin");
  const combat = startCombat("r1", [goblin.id, goblin2.id], ctx, false);
  const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
  const acolyte = ctx.party.find((p) => p.classId === "acolyte")!;
  return { ctx, combat, goblin, goblin2, vanguard, acolyte };
}

const damage: SkillEffect = { kind: "damage", amount: 1 };
const heal: SkillEffect = { kind: "heal", amount: 5 };
const guardBuff: SkillEffect = { kind: "applyStatusEffect", statusEffectId: "guard", durationTurns: 2 };
const weakenDebuff: SkillEffect = { kind: "applyStatusEffect", statusEffectId: "weakened", durationTurns: 2 };

describe("unitId", () => {
  test("a summon is drawn as its owner; everyone else as themselves", () => {
    const { goblin, vanguard } = setup();
    const summon = { id: "s1", ownerId: vanguard.id } as unknown as Actor;
    expect(unitId(summon)).toBe(vanguard.id);
    expect(unitId(goblin)).toBe(goblin.id);
    expect(unitId(vanguard)).toBe(vanguard.id);
  });
});

describe("runInSession", () => {
  test("tags every entry logged by the body with one shared session whose id is the first tagged entry's index", () => {
    const { combat, vanguard } = setup();
    const before = combat.log.length;
    runInSession(combat, vanguard.id, () => {
      combat.log.push({ text: "a", kind: "info" });
      combat.log.push({ text: "b", kind: "info" });
    });
    const [a, b] = combat.log.slice(before);
    expect(a!.session).toBeDefined();
    expect(b!.session).toBe(a!.session);
    expect(a!.session!.actorId).toBe(vanguard.id);
    expect(a!.session!.id).toBe(before);
  });

  test("returns what the body returns", () => {
    const { combat, vanguard } = setup();
    expect(runInSession(combat, vanguard.id, () => 42)).toBe(42);
  });

  test("leaves no session behind when the body logs nothing, and clears the active session afterwards", () => {
    const { combat, vanguard } = setup();
    const before = combat.log.length;
    runInSession(combat, vanguard.id, () => {});
    expect(combat.log.length).toBe(before);
    expect(combat.activeSession).toBeUndefined();
  });

  test("clears the active session even when the body throws", () => {
    const { combat, vanguard } = setup();
    expect(() => runInSession(combat, vanguard.id, () => { throw new Error("boom"); })).toThrow("boom");
    expect(combat.activeSession).toBeUndefined();
  });

  test("a nested session keeps its own entries; the outer one does not overwrite them", () => {
    const { combat, vanguard, acolyte } = setup();
    runInSession(combat, vanguard.id, () => {
      combat.log.push({ text: "outer-1", kind: "info" });
      runInSession(combat, acolyte.id, () => combat.log.push({ text: "inner", kind: "info" }));
      combat.log.push({ text: "outer-2", kind: "info" });
    });
    const byText = (text: string) => combat.log.find((e) => e.text === text)!;
    expect(byText("outer-1").session!.actorId).toBe(vanguard.id);
    expect(byText("inner").session!.actorId).toBe(acolyte.id);
    expect(byText("outer-2").session!.actorId).toBe(vanguard.id);
    expect(byText("inner").session!.id).not.toBe(byText("outer-1").session!.id);
  });

  test("session ids stay distinct when the nested session logs before the outer one does", () => {
    const { combat, vanguard, acolyte } = setup();
    runInSession(combat, vanguard.id, () => {
      runInSession(combat, acolyte.id, () => combat.log.push({ text: "inner", kind: "info" }));
      combat.log.push({ text: "outer", kind: "info" });
    });
    const inner = combat.log.find((e) => e.text === "inner")!.session!;
    const outer = combat.log.find((e) => e.text === "outer")!.session!;
    expect(inner.id).not.toBe(outer.id);
    expect(outer.id).toBe(combat.log.findIndex((e) => e.text === "outer"));
  });

  test("an actor-less session carries the units it lights", () => {
    const { combat, goblin } = setup();
    runInSession(combat, null, () => combat.log.push({ text: "tick", kind: "info" }), [goblin.id]);
    expect(combat.log.at(-1)!.session).toMatchObject({ actorId: null, affectedIds: [goblin.id] });
  });
});

describe("runTicksInSession", () => {
  test("one session for the whole block, lighting only the units whose tick logged", () => {
    const { combat, goblin, goblin2, vanguard } = setup();
    runTicksInSession(combat, [goblin, goblin2, vanguard], (actor) => {
      if (actor !== goblin2) combat.log.push({ text: `tick ${actor.id}`, kind: "info" });
    });
    const entries = combat.log.filter((e) => e.text.startsWith("tick "));
    expect(entries).toHaveLength(2);
    expect(entries[1]!.session).toBe(entries[0]!.session);
    expect(entries[0]!.session).toMatchObject({ actorId: null, affectedIds: [goblin.id, vanguard.id] });
  });

  test("a block where nothing logged leaves nothing behind", () => {
    const { combat, goblin } = setup();
    const before = combat.log.length;
    runTicksInSession(combat, [goblin], () => {});
    expect(combat.log.length).toBe(before);
  });
});

describe("noteAffected", () => {
  test("adds a summon's owner, once", () => {
    const { combat, vanguard } = setup();
    const summon = { id: "s1", ownerId: vanguard.id } as unknown as Actor;
    runInSession(combat, null, () => {
      noteAffected(combat, summon);
      noteAffected(combat, vanguard);
      combat.log.push({ text: "x", kind: "info" });
    });
    expect(combat.log.at(-1)!.session!.affectedIds).toEqual([vanguard.id]);
  });
});

describe("noteSkillTarget / noteBasicAttack", () => {
  function noted(effects: SkillEffect[], targetSide: "enemy" | "ally", skillDealsDamage = effects.some((e) => e.kind === "damage")) {
    const { combat, vanguard, acolyte, goblin } = setup();
    const target = targetSide === "enemy" ? goblin : acolyte;
    runInSession(combat, vanguard.id, () => {
      noteSkillTarget(combat, vanguard, target, effects, skillDealsDamage);
      combat.log.push({ text: "x", kind: "info" });
    });
    return { session: combat.log.at(-1)!.session!, target };
  }

  test("damage on an opponent is an attack", () => {
    const { session, target } = noted([damage], "enemy");
    expect(session.attackedIds).toEqual([target.id]);
    expect(session.debuffedIds).toEqual([]);
  });

  test("non-damage on an opponent, from a skill with no damage, is a debuff", () => {
    const { session, target } = noted([weakenDebuff], "enemy");
    expect(session.debuffedIds).toEqual([target.id]);
    expect(session.attackedIds).toEqual([]);
  });

  test("a debuff on an opponent from a skill that deals damage elsewhere still counts as an attack", () => {
    const { session, target } = noted([weakenDebuff], "enemy", true);
    expect(session.attackedIds).toEqual([target.id]);
    expect(session.debuffedIds).toEqual([]);
  });

  test("damage plus a debuff on the same opponent counts only as an attack", () => {
    const { session, target } = noted([damage, weakenDebuff], "enemy");
    expect(session.attackedIds).toEqual([target.id]);
    expect(session.debuffedIds).toEqual([]);
  });

  test("a heal on a same-side target is a heal; a helpful status is a buff", () => {
    expect(noted([heal], "ally").session.healedIds).toHaveLength(1);
    const buffed = noted([guardBuff], "ally");
    expect(buffed.session.buffedIds).toEqual([buffed.target.id]);
    expect(buffed.session.healedIds).toEqual([]);
  });

  test("a harmful effect on a same-side target (self-cost) is not noted", () => {
    const { session } = noted([weakenDebuff, damage], "ally");
    expect(session.buffedIds).toEqual([]);
    expect(session.attackedIds).toEqual([]);
  });

  test("a negative combat-stat change on an opponent is a debuff, a positive one on an ally a buff", () => {
    expect(noted([{ kind: "modifyCombatStat", combatStat: "defense", amount: -5 }], "enemy").session.debuffedIds).toHaveLength(1);
    expect(noted([{ kind: "modifyCombatStat", combatStat: "attack", amount: 5 }], "ally").session.buffedIds).toHaveLength(1);
  });

  test("a summon effect alone names no one", () => {
    const { session } = noted([{ kind: "summon" }], "enemy", false);
    expect(session.debuffedIds).toEqual([]);
    expect(session.attackedIds).toEqual([]);
  });

  test("noteBasicAttack records an attack on the target", () => {
    const { combat, goblin, vanguard } = setup();
    runInSession(combat, goblin.id, () => {
      noteBasicAttack(combat, goblin, vanguard);
      combat.log.push({ text: "x", kind: "info" });
    });
    expect(combat.log.at(-1)!.session!.attackedIds).toEqual([vanguard.id]);
  });

  test("a summon target is recorded as its owner", () => {
    const { combat, goblin, vanguard } = setup();
    const summon = { id: "s1", ownerId: vanguard.id, hp: 5, name: "Totem" } as unknown as Actor;
    runInSession(combat, goblin.id, () => {
      noteBasicAttack(combat, goblin, summon);
      combat.log.push({ text: "x", kind: "info" });
    });
    expect(combat.log.at(-1)!.session!.attackedIds).toEqual([vanguard.id]);
  });

  test("notes outside any session are ignored", () => {
    const { combat, goblin, vanguard } = setup();
    expect(() => noteBasicAttack(combat, goblin, vanguard)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test test/logSession.test.ts`
Expected: FAIL — `Cannot find module '../src/engine/logSession'`.

- [ ] **Step 3: Add the types**

In `src/types.ts`, replace the `LogEntry` interface and add the session type just above it:

```ts
/**
 * One actor's action (or one actor-less tick block) as the battlefield should present it. Every
 * `LogEntry` produced by the action shares the same object, so the UI can group consecutive
 * entries by `id` and light exactly the units named here. All ids are battlefield unit ids — a
 * summon is recorded as its owner, since it has no sprite of its own.
 */
export interface LogSession {
  /** Index in `CombatState.log` of the first entry this session tagged: unique within a combat, stable across a save round trip. */
  id: number;
  actorId: Id | null;
  /** Opposing-side targets of a skill that deals damage, hit or missed. */
  attackedIds: Id[];
  /** Opposing-side targets of a skill with no damage (debuff-only). */
  debuffedIds: Id[];
  buffedIds: Id[];
  healedIds: Id[];
  /** Actor-less sessions only (DoT tick, dying damage, artifact auto-damage): units to light, no icons. */
  affectedIds: Id[];
}

export interface LogEntry {
  text: string;
  kind: LogEntryKind;
  snapshot?: CombatantSnapshot[];
  partySnapshot?: PartyStateSnapshot;
  session?: LogSession;
}
```

and in `CombatState`, after `roundStartPartySnapshot?: PartyStateSnapshot;` add:

```ts
  /** Transient: the session being built while an actor's turn runs (see `runInSession`). */
  activeSession?: LogSession;
```

- [ ] **Step 4: Write the implementation**

Create `src/engine/logSession.ts`:

```ts
import type { CombatState, Id, LogSession, SkillEffect } from "../types";
import { getStatusEffect } from "../data/statusEffects";
import { isHelpfulStatusEffect, isPlayerSide, isSummon, type Actor } from "./resolver";

/** The battlefield unit an actor is drawn as: a summon has no sprite of its own, so it stands for its owner. */
export function unitId(actor: Actor): Id {
  return isSummon(actor) ? actor.ownerId : actor.id;
}

function addUnique(list: Id[], id: Id): void {
  if (!list.includes(id)) list.push(id);
}

/** What a non-damage effect means for a unit on the caster's own side, or `null` when it is a cost/drawback rather than help. */
function sameSideRole(effect: SkillEffect): "healed" | "buffed" | null {
  switch (effect.kind) {
    case "heal":
    case "restoreMp":
      return "healed";
    case "removeStatusEffect":
      return "buffed";
    case "applyStatusEffect":
      return effect.statusEffectId && isHelpfulStatusEffect(getStatusEffect(effect.statusEffectId)) ? "buffed" : null;
    case "modifyCombatStat":
      return (effect.amount ?? 0) > 0 ? "buffed" : null;
    case "modifyStat":
      // Fear is the one survival stat where a higher number is worse.
      return (effect.amount ?? 0) * (effect.stat === "fear" ? -1 : 1) > 0 ? "buffed" : null;
    default:
      return null;
  }
}

/**
 * Records which role `target` plays in the running session, from the effects that apply to it.
 * `skillDealsDamage` is a property of the whole skill, not of this target: a skill that hits one
 * enemy and debuffs all of them is an attack on all of them. Called before accuracy rolls, so a
 * missed or dodged target is still shown as targeted.
 */
export function noteSkillTarget(combat: CombatState, source: Actor, target: Actor, effects: SkillEffect[], skillDealsDamage: boolean): void {
  const session = combat.activeSession;
  if (!session) return;
  const id = unitId(target);
  if (isPlayerSide(source) !== isPlayerSide(target)) {
    if (skillDealsDamage && effects.length > 0) addUnique(session.attackedIds, id);
    else if (effects.some((e) => e.kind !== "summon")) addUnique(session.debuffedIds, id);
    return;
  }
  for (const effect of effects) {
    const role = sameSideRole(effect);
    if (role === "healed") addUnique(session.healedIds, id);
    else if (role === "buffed") addUnique(session.buffedIds, id);
  }
}

/** A plain attack (a monster's or summon's basic attack, a charge, an on-hit AoE) has no skill to read effects from. */
export function noteBasicAttack(combat: CombatState, source: Actor, target: Actor): void {
  noteSkillTarget(combat, source, target, [{ kind: "damage" }], true);
}

/** Lights `actor` in the running session without giving it an icon (DoT tick, dying damage, artifact auto-damage). */
export function noteAffected(combat: CombatState, actor: Actor): void {
  if (combat.activeSession) addUnique(combat.activeSession.affectedIds, unitId(actor));
}

/**
 * Runs `body` and tags every log entry it adds with one shared `LogSession`. Entries already tagged
 * by a nested session keep theirs. A body that logs nothing leaves no session behind. The session's
 * id is the index of the first entry it actually tags, so nested sessions can never collide.
 */
export function runInSession<T>(combat: CombatState, actorId: Id | null, body: () => T, affectedIds: Id[] = []): T {
  const outer = combat.activeSession;
  const start = combat.log.length;
  const session: LogSession = { id: -1, actorId, attackedIds: [], debuffedIds: [], buffedIds: [], healedIds: [], affectedIds: [...affectedIds] };
  combat.activeSession = session;
  let result: T;
  try {
    result = body();
  } finally {
    combat.activeSession = outer;
  }
  session.debuffedIds = session.debuffedIds.filter((id) => !session.attackedIds.includes(id));
  for (let i = start; i < combat.log.length; i++) {
    const entry = combat.log[i];
    if (!entry || entry.session) continue;
    if (session.id < 0) session.id = i;
    entry.session = session;
  }
  return result;
}

/**
 * One actor-less session for a whole block of per-unit ticks (DoT, stat-mod expiry): units whose
 * tick logged nothing stay grey, and the block costs one hold on screen rather than one per unit.
 */
export function runTicksInSession(combat: CombatState, actors: Actor[], tick: (actor: Actor) => void): void {
  runInSession(combat, null, () => {
    for (const actor of actors) {
      const before = combat.log.length;
      tick(actor);
      if (combat.log.length > before) noteAffected(combat, actor);
    }
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test test/logSession.test.ts`
Expected: PASS. If `weakened`/`guard` ids are missing, look up a debuff-only and a helpful id in `data/status-effects.json` and use those.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit** (only once the user has approved executing this plan)

```bash
git add docs/specs src/types.ts src/engine/logSession.ts test/logSession.test.ts
git commit -m "Add LogSession model and session builder"
```

---

### Task 2: Tag sessions in combat resolution

**Files:**
- Modify: `src/engine/combat.ts` (`runArtifactAutoDamage` ~294-315, `tryTriggerOverwatch` ~323-346, `resolveRound` ~347-418, `applyOnHitAoeDamage` ~547-567, `runSummonTurn` basic attack ~965-973, `applySkillEffects` override loop ~1023 and main loop ~1041, `triggerSummonDeathBurst` ~845-862)
- Modify: `src/engine/monsterAI.ts` (`runMonsterTurn`: boss charge ~71-76, basic attack ~100-110, imports)
- Test: `test/logSession.test.ts` (append)

The immediate turn of a freshly summoned minion (`runCharacterTurn`, `combat.ts` ~483) is **not** wrapped: it logs into its owner's session, and its notes (the minion's targets) land there too.

**Interfaces:**
- Consumes: everything produced by Task 1.
- Produces: after any `resolveRound`, every entry written by an actor's turn or a tick carries `session`; combat start, reward lines and `finalizeRound` messages carry none.

- [ ] **Step 1: Write the failing integration tests**

Append to `test/logSession.test.ts`. Merge these into the file's imports: `import { applySkillEffects, queueAction, resolveRound, startCombat } from "../src/engine/combat";` (replacing the existing `startCombat`-only import), `import { Game } from "../src/engine/game";`, `import { spawnMonster } from "../src/data/monsters";`, `import type { CombatantRef, SkillDefinition } from "../src/types";`.

```ts
function skill(partial: Pick<SkillDefinition, "target" | "effects"> & Partial<SkillDefinition>): SkillDefinition {
  return { id: "t-skill", name: "Test", description: "", mpCost: 0, slot: 1, unlockLevel: 1, isUltimate: true, ...partial };
}

describe("applySkillEffects notes its targets", () => {
  test("single-target attack", () => {
    const { ctx, combat, vanguard, goblin } = setup();
    runInSession(combat, vanguard.id, () => applySkillEffects(skill({ target: "singleEnemy", effects: [damage] }), vanguard, [goblin], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ actorId: vanguard.id, attackedIds: [goblin.id], buffedIds: [], healedIds: [] });
  });

  test("area attack lists every enemy", () => {
    const { ctx, combat, vanguard, goblin, goblin2 } = setup();
    runInSession(combat, vanguard.id, () => applySkillEffects(skill({ target: "allEnemies", effects: [damage] }), vanguard, [goblin, goblin2], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session!.attackedIds).toEqual([goblin.id, goblin2.id]);
  });

  test("a missed attack still marks the target", () => {
    const { ctx, combat, vanguard, goblin } = setup();
    goblin.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 2 });
    ctx.rng.next = () => 0; // every accuracy roll fails against blinded's 60% penalty
    runInSession(combat, goblin.id, () =>
      applySkillEffects(skill({ target: "singleEnemy", effects: [damage], isUltimate: false }), goblin, [vanguard], combat, ctx, combat.log)
    );
    const entry = combat.log.at(-1)!;
    expect(entry.text.toLowerCase()).toContain("miss");
    expect(entry.session!.attackedIds).toEqual([vanguard.id]);
  });

  test("buff, heal and debuff-only", () => {
    const { ctx, combat, vanguard, acolyte, goblin } = setup();
    vanguard.hp = Math.max(1, vanguard.maxHp - 10);
    runInSession(combat, acolyte.id, () => applySkillEffects(skill({ target: "singleAlly", effects: [guardBuff] }), acolyte, [vanguard], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ actorId: acolyte.id, buffedIds: [vanguard.id] });
    runInSession(combat, acolyte.id, () => applySkillEffects(skill({ target: "singleAlly", effects: [heal] }), acolyte, [vanguard], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ healedIds: [vanguard.id], buffedIds: [] });
    runInSession(combat, acolyte.id, () => applySkillEffects(skill({ target: "singleEnemy", effects: [weakenDebuff] }), acolyte, [goblin], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ debuffedIds: [goblin.id], attackedIds: [] });
  });

  test("a skill that damages one enemy and debuffs all of them is an attack on all of them", () => {
    const { ctx, combat, vanguard, goblin, goblin2 } = setup();
    const sweep = skill({ target: "singleEnemy", effects: [damage, { ...weakenDebuff, target: "allEnemies" }] });
    runInSession(combat, vanguard.id, () => applySkillEffects(sweep, vanguard, [goblin], combat, ctx, combat.log));
    const session = combat.log.at(-1)!.session!;
    expect(session.attackedIds).toEqual(expect.arrayContaining([goblin.id, goblin2.id]));
    expect(session.debuffedIds).toEqual([]);
  });

  test("a skill with relation-scoped effects splits heal and damage by side", () => {
    const { ctx, combat, acolyte, vanguard, goblin } = setup();
    vanguard.hp = Math.max(1, vanguard.maxHp - 10);
    const purify = skill({
      target: "allAlliesAndEnemies",
      effects: [
        { kind: "heal", amount: 5, appliesToRelation: "ally" },
        { kind: "damage", amount: 1, appliesToRelation: "enemy" },
      ],
    });
    runInSession(combat, acolyte.id, () => applySkillEffects(purify, acolyte, [vanguard, goblin], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ healedIds: [vanguard.id], attackedIds: [goblin.id] });
  });
});

describe("resolveRound tags what a round logs", () => {
  function fight(seed = 11) {
    const { ctx } = makeCtx(seed);
    const rats = [spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat")];
    for (const r of rats) {
      r.maxHp = r.hp = 50000;
      r.attack = 0;
    }
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    return { ctx, combat, rats };
  }

  test("a quiet round leaves no entry without a session (apart from combat start)", () => {
    const { ctx, combat } = fight();
    resolveRound(combat, ctx);
    expect(combat.phase).toBe("command");
    expect(combat.log.slice(1).filter((e) => !e.session)).toEqual([]);
  });

  test("a monster's basic attack is its own session naming exactly one party member", () => {
    const { ctx, combat, rats } = fight();
    for (const r of rats) r.attack = 30;
    resolveRound(combat, ctx);
    const attacks = combat.log.filter((e) => e.session && rats.some((r) => r.id === e.session!.actorId));
    expect(attacks.length).toBeGreaterThan(0);
    for (const e of attacks) expect(e.session!.attackedIds).toHaveLength(1);
  });

  test("combat start and reward lines carry no session", () => {
    const game = new Game(102);
    const monster = spawnMonster("dungeon-rat", 1);
    monster.hp = monster.maxHp = 1;
    monster.attack = 0;
    const room = game.state.floor.rooms.find((r) => r.id === game.state.currentRoomId)!;
    room.monsterIds = [monster.id];
    game.ctx.monsters.push(monster);
    game.state.combat = startCombat(room.id, [monster.id], game.ctx, false);
    const attacker = game.state.party[0]!;
    game.queue({ kind: "character", id: attacker.id }, attacker.unlockedSkillIds[0]!, [{ kind: "monster", id: monster.id }]);
    game.resolve();
    const log = game.state.combat!.log;
    expect(log[0]!.session).toBeUndefined();
    expect(log.find((e) => e.text.includes("EXP"))!.session).toBeUndefined();
    const turn = log.filter((e) => e.session?.actorId === attacker.id);
    expect(turn.length).toBeGreaterThan(0);
    expect(new Set(turn.map((e) => e.session)).size).toBe(1);
    expect(turn[0]!.session!.attackedIds).toEqual([monster.id]);
  });

  test("a DoT tick is an actor-less session lighting the poisoned unit", () => {
    const { ctx } = makeCtx(8);
    const goblin = spawnInto(ctx, "goblin");
    goblin.activeStatusEffects.push({ statusEffectId: "poisoned", turnsRemaining: 2 });
    const combat = startCombat("r1", [goblin.id], ctx, false);
    const before = combat.log.length;
    resolveRound(combat, ctx);
    const tick = combat.log.slice(before).find((e) => e.session?.actorId === null);
    expect(tick).toBeDefined();
    expect(tick!.session!.affectedIds).toContain(goblin.id);
  });

  test("stat-mod expiries across several units share one actor-less session", () => {
    const { ctx, combat } = fight();
    const buffed = ctx.party.slice(0, 2);
    for (const c of buffed) c.activeStatusEffects.push({ statusEffectId: "guard", turnsRemaining: 1 });
    resolveRound(combat, ctx);
    const expiries = combat.log.filter((e) => e.text.includes("expires"));
    expect(expiries.length).toBeGreaterThanOrEqual(2);
    expect(new Set(expiries.map((e) => e.session)).size).toBe(1);
    expect(expiries[0]!.session!.actorId).toBeNull();
    expect(expiries[0]!.session!.affectedIds).toEqual(expect.arrayContaining(buffed.map((c) => c.id)));
  });

  test("dying damage is one actor-less session lighting the living party", () => {
    const { ctx, combat } = fight();
    resolveRound(combat, ctx, 1, 0);
    const tick = combat.log.find((e) => e.text.includes("from Dying"))!;
    expect(tick.session!.actorId).toBeNull();
    expect(tick.session!.affectedIds).toHaveLength(ctx.party.length);
  });

  test("artifact auto-damage is one actor-less session lighting the bearer and its target", () => {
    const { ctx, combat } = fight();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.equippedArtifactIds.push("thunder-totem");
    resolveRound(combat, ctx);
    const hit = combat.log.find((e) => e.text.includes("Thunder Totem"))!;
    expect(hit.session!.actorId).toBeNull();
    expect(hit.session!.affectedIds).toContain(mage.id);
    expect(hit.session!.affectedIds).toHaveLength(2);
  });

  test("an Overwatch shot is the watcher's own session, ahead of the monster's turn", () => {
    const { ctx, combat, rats } = fight();
    const archer = ctx.party.find((p) => p.classId === "archer")!;
    archer.activeStatusEffects.push({ statusEffectId: "overwatched", turnsRemaining: 2 });
    resolveRound(combat, ctx);
    const shot = combat.log.find((e) => e.text.includes("Overwatch"))!;
    expect(shot.session!.actorId).toBe(archer.id);
    expect(rats.map((r) => r.id)).toContain(shot.session!.attackedIds[0]);
  });

  test("a summon is never named in a session, and its owner's turn stays one session", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 75;
    summoner.unlockedSkillIds.push("summoner-totem-recall");
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    queueAction(combat, self, "summoner-totem-recall", [self], ctx);
    resolveRound(combat, ctx);
    resolveRound(combat, ctx); // the totem takes its own turn now
    const totem = ctx.summons.find((s) => s.archetypeId === "recall-totem")!;
    const named = combat.log.flatMap((e) =>
      e.session ? [e.session.actorId, ...e.session.attackedIds, ...e.session.debuffedIds, ...e.session.buffedIds, ...e.session.healedIds, ...e.session.affectedIds] : []
    );
    expect(named).not.toContain(totem.id);
    expect(combat.log.slice(1).filter((e) => !e.session)).toEqual([]);
    const cast = combat.log.filter((e) => e.session?.actorId === summoner.id);
    expect(cast.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bun test test/logSession.test.ts`
Expected: the new tests FAIL (`session` undefined / empty id lists).

- [ ] **Step 3: Note targets in `applySkillEffects`**

In `src/engine/combat.ts` add to the imports:

```ts
import { noteAffected, noteBasicAttack, noteSkillTarget, runInSession, runTicksInSession, unitId } from "./logSession";
```

Near the top of `applySkillEffects`, right after the `isOverrideEffect`/`overrideEffects` constants are defined, add:

```ts
  // A property of the whole skill (not of one target): damage that reaches the opposing side makes every opposing target an attack target.
  const skillDealsDamage = (skill.effects ?? []).some((e) => e.kind === "damage" && e.appliesToRelation !== "ally");
```

In the override-effect loop, immediately after `if (effect.excludesSummonTargets && isSummon(resolved)) continue;` add:

```ts
        noteSkillTarget(combat, source, resolved, [effect], skillDealsDamage);
```

In the main loop, change

```ts
  for (const target of targets) {
    const isEnemyFacing = isPlayerSide(source) !== isPlayerSide(target);
    if (isEnemyFacing && !skill.isUltimate
```

to

```ts
  for (const target of targets) {
    const isEnemyFacing = isPlayerSide(source) !== isPlayerSide(target);
    // Before the accuracy roll: a missed or dodged target is still the one the action was aimed at.
    noteSkillTarget(
      combat,
      source,
      target,
      (skill.effects ?? []).filter((e) => !isOverrideEffect(e) && (!e.appliesToRelation || (e.appliesToRelation === "ally") === isPlayerSide(target))),
      skillDealsDamage
    );
    if (isEnemyFacing && !skill.isUltimate
```

(keep the rest of that `if` line exactly as it was).

- [ ] **Step 4: Replace `resolveRound`**

Replace the whole `resolveRound` function (`export function resolveRound(...) {` through its closing `}` right before `export function hasStunningStatus`) with:

```ts
export function resolveRound(combat: CombatState, ctx: EngineContext, floorDepth = 1, satiety = 100): void {
  combat.phase = "resolution";
  combat.turnQueue = buildTurnQueue(combat, ctx);
  combat.activeTurnIndex = 0;
  combat.roundStartSnapshot = snapshotCombatants(combat, ctx);

  const combatActors = () => combat.combatants.map((c) => getActorByRef(c.ref, ctx));

  let blockStart = combat.log.length;
  runTicksInSession(combat, combatActors(), (actor) => {
    if (isActorAlive(actor)) tickDotEffects(actor, { log: combat.log });
  });
  runInSession(combat, null, () => pruneDeadSummons(combat, ctx, combat.log));
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));

  blockStart = combat.log.length;
  runArtifactAutoDamage(combat, ctx);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));

  const actedRefs: CombatantRef[] = [];
  for (const ref of combat.turnQueue) {
    const actor = getActorByRef(ref, ctx);
    if (!isActorAlive(actor)) continue;

    const eligibleSpecial = specialStatusSnapshot(actor);
    blockStart = combat.log.length;
    runInSession(combat, unitId(actor), () => {
      if (ref.kind === "character") {
        runCharacterTurn(ref, combat, ctx);
        actedRefs.push(ref);
      } else if (ref.kind === "summon") {
        runSummonTurn(ref, combat, ctx);
      } else if (!tryTriggerOverwatch(ref, combat, ctx)) {
        runMonsterTurn(ref, combat, ctx);
      }
      if (isActorAlive(actor)) tickSpecialEffects(actor, eligibleSpecial, { log: combat.log });
      pruneDeadSummons(combat, ctx, combat.log);
    });
    tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));

    if (isCombatOver(combat, ctx)) break;
  }

  if (isCombatOver(combat, ctx)) {
    // Combat ended before some queued characters got to act — refund what was pre-committed for them.
    for (const queued of combat.queuedActions) {
      if (queued.actor.kind !== "character") continue;
      if (actedRefs.some((ref) => refEquals(ref, queued.actor))) continue;
      const actor = getActorByRef(queued.actor, ctx) as Character;
      if (!isActorAlive(actor)) continue;
      refundQueuedAction(queued, ctx);
    }
  }

  if (!isCombatOver(combat, ctx)) {
    blockStart = combat.log.length;
    runTicksInSession(combat, combatActors(), (actor) => {
      if (isActorAlive(actor)) tickStatModEffects(actor, { log: combat.log });
    });
    for (const c of ctx.party) {
      if (!c.isAlive) continue;
      for (const skillId of Object.keys(c.cooldownsRemaining)) {
        if (c.cooldownsRemaining[skillId]! > 0) c.cooldownsRemaining[skillId]! -= 1;
      }
    }
    for (const c of ctx.party) applyRoundFear(c, floorDepth);
    if (isPartyDying(satiety)) {
      runInSession(combat, null, () => applyDyingDamage(ctx.party, combat.log), ctx.party.filter((c) => c.isAlive).map((c) => c.id));
    }
    tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));
  }

  blockStart = combat.log.length;
  finalizeRound(combat, ctx);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));
}
```

Before pasting, diff it against the current function: apart from the `runInSession`/`runTicksInSession` wrappers the two must be identical line for line (`finalizeRound` and its `tagLogRange` at the end stay, the refund block stays, the cooldown and `applyRoundFear` loops stay).

- [ ] **Step 5: The other places a turn narrates units**

`runArtifactAutoDamage` — replace the whole function with (one actor-less session for the block; the bearer and the target are lit, no icons):

```ts
function runArtifactAutoDamage(combat: CombatState, ctx: EngineContext): void {
  runInSession(combat, null, () => {
    for (const character of ctx.party) {
      if (!character.isAlive) continue;
      for (const { effect, sourceName } of autoDamageEntries(character)) {
        const alive = livingMonsterRefs(combat, ctx);
        if (alive.length === 0) return;
        const target = getActorByRef(ctx.rng.pick(alive), ctx) as Monster;
        noteAffected(combat, character);
        noteAffected(combat, target);
        if (effect.offenseMultiplierPercent !== undefined) {
          const base = characterBaseStats(character);
          resolveSkillEffect(
            { kind: "damage", amount: effect.amount, offenseMultiplierPercent: effect.offenseMultiplierPercent },
            character,
            target,
            { log: combat.log, isMagic: effect.isMagic, skillName: sourceName, offensiveStatOverride: effect.isMagic ? base.magicPower : base.attack }
          );
          continue;
        }
        target.hp = Math.max(0, target.hp - effect.amount);
        combat.log.push({ text: t("combat.artifactAutoDamage", { character: character.name, amount: effect.amount, target: target.name }), kind: "attack" });
      }
    }
  });
}
```

(Compare against the current body: the logic is unchanged — only the session wrapper, the two `noteAffected` calls and `return` replacing the old early `return` inside the wrapper.)

`tryTriggerOverwatch` — the shot is the watcher's own action, narrated before the monster's turn. Replace everything after `const active = ...;` with:

```ts
  return runInSession(combat, watcher.id, () => {
    const target = getActorByRef(monsterRef, ctx) as Monster;
    if (!isActorAlive(target)) {
      expireStatusEffect(watcher, active, { log: combat.log });
      return false;
    }
    // Before the accuracy roll: a missed shot still marks its target.
    noteBasicAttack(combat, watcher, target);
    if (!rollHits(watcher, () => ctx.rng.next())) {
      expireStatusEffect(watcher, active, { log: combat.log });
      combat.log.push({ text: t("combat.overwatchMiss", { actor: watcher.name, target: target.name }), kind: "info" });
      return false;
    }
    // Expired only after the shot resolves, not before — `overwatched`'s rank-scaled attack bonus
    // (§1.12.2/data/status-effects.json) is the interrupt's only source of rank progression, so it
    // needs to still be active while this damage is computed.
    combat.log.push({ text: t("combat.overwatchHit", { actor: watcher.name, target: target.name }), kind: "attack" });
    resolveSkillEffect({ kind: "damage", amount: 0 }, watcher, target, { log: combat.log });
    expireStatusEffect(watcher, active, { log: combat.log });
    return true;
  });
```

`applyOnHitAoeDamage` — inside `for (const ref of livingMonsterRefs(combat, ctx)) { const enemy = getActorByRef(ref, ctx);` add `noteBasicAttack(combat, source, enemy);` on the line after `const enemy = ...`.

`triggerSummonDeathBurst` — the burst is the owner's action, not part of whatever turn killed the summon (a monster's turn would otherwise show shields on its own side). Wrap everything after `if (targets.length === 0) return;` in `runInSession(combat, summon.ownerId, () => { ... });`, and inside `for (const target of targets) {` add `noteBasicAttack(combat, summon, target);` as its first line.

`expireSummonIfDone` — right after its early return for a summon that is not done yet, add `noteAffected(combat, summon);` so the owner is lit by the "expired" line in whichever session it lands (a DoT-prune session would otherwise light nobody).

`runSummonTurn` — in the basic-attack branch, right after `const target = getActorByRef(ctx.rng.pick(enemies), ctx) as Monster;` add `noteBasicAttack(combat, summon, target);`.

`src/engine/monsterAI.ts` — add `import { noteBasicAttack } from "./logSession";`; in the boss charge branch, right after the `combat.log.push({ text: t("combat.bossExecuteCharge", ...) })` line add `noteBasicAttack(combat, actor, target);`; in the basic-attack path, right after `const target = pickMonsterTarget(actor, livingChars, ctx.rng);` add `noteBasicAttack(combat, actor, target);`.

- [ ] **Step 6: Run the tests**

Run: `bun test test/logSession.test.ts`
Expected: PASS. If a test fails on a data assumption (a status that does not tick/expire the way the test expects, a log text that differs), adjust the test's data — not the engine — and keep the assertion's intent. In particular: `guard` must be a stat-mod status that expires at round end; if not, pick one from `data/status-effects.json` whose category is `statMod`.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS. Existing combat tests must be unaffected: only a new optional field and extra bookkeeping, no RNG draws, no reordering of log pushes.

- [ ] **Step 8: Commit** (only once the user has approved executing this plan)

```bash
git add src/engine/combat.ts src/engine/monsterAI.ts test/logSession.test.ts
git commit -m "Tag combat log entries with action sessions"
```

---

### Task 3: Reveal queue (the single clock)

**Files:**
- Create: `src/ui/revealQueue.ts`
- Test: `test/revealQueue.test.ts`

**Interfaces:**
- Consumes: `LogEntry`, `LogSession` from `src/types.ts`.
- Produces (used by Task 5):
  - `REVEAL_TICK_MS = 100`, `SESSION_MIN_TICKS = 15`
  - `class RevealQueue { enqueue(entries: LogEntry[]): void; get active(): boolean; get focus(): LogSession | null; tick(): LogEntry[]; flush(): LogEntry[] }`

- [ ] **Step 1: Write the failing test**

Create `test/revealQueue.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { RevealQueue, SESSION_MIN_TICKS } from "../src/ui/revealQueue";
import type { LogEntry, LogSession } from "../src/types";

function session(id: number): LogSession {
  return { id, actorId: "a", attackedIds: [], debuffedIds: [], buffedIds: [], healedIds: [], affectedIds: [] };
}
function entries(prefix: string, count: number, s?: LogSession): LogEntry[] {
  return Array.from({ length: count }, (_, i) => ({ text: `${prefix}${i}`, kind: "info" as const, session: s }));
}
/** Runs ticks until the queue is idle; returns, per tick, what became visible and which session was lit. */
function drain(queue: RevealQueue, maxTicks = 500) {
  const steps: { texts: string[]; focus: number | null }[] = [];
  let guard = 0;
  while (queue.active && guard++ < maxTicks) {
    const shown = queue.tick();
    steps.push({ texts: shown.map((e) => e.text), focus: queue.focus?.id ?? null });
  }
  return steps;
}

describe("RevealQueue", () => {
  test("the first line of a session appears on the first tick, in the same step as its highlight", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 3, session(1)));
    const [first] = drain(q);
    expect(first).toEqual({ texts: ["a0"], focus: 1 });
  });

  test("lines of one session are 1 tick (0.1 s) apart", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 3, session(1)));
    const steps = drain(q);
    expect(steps.slice(0, 3).map((s) => s.texts)).toEqual([["a0"], ["a1"], ["a2"]]);
  });

  test("a session holds for 15 ticks (1.5 s) before the next one starts", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 2, session(1)), ...entries("b", 1, session(2))]);
    const steps = drain(q);
    const indexOfB = steps.findIndex((s) => s.texts.includes("b0"));
    expect(indexOfB).toBe(SESSION_MIN_TICKS); // tick 16 (index 15): 1.5 s after a0
    expect(steps[indexOfB]!.focus).toBe(2);
    expect(steps[indexOfB - 1]!.focus).toBe(1); // highlight of session 1 still on until then
  });

  test("the highlight ends in the tick after the hold, not before", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 1, session(1)));
    const steps = drain(q);
    expect(steps).toHaveLength(SESSION_MIN_TICKS + 1);
    expect(steps[SESSION_MIN_TICKS - 1]!.focus).toBe(1);
    expect(steps[SESSION_MIN_TICKS]!.focus).toBeNull();
    expect(q.active).toBe(false);
  });

  test("a session with more than 15 lines lasts one tick per line and loses nothing", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 20, session(1)), ...entries("b", 1, session(2))]);
    const steps = drain(q);
    expect(steps.flatMap((s) => s.texts).filter((t) => t.startsWith("a"))).toHaveLength(20);
    expect(steps.findIndex((s) => s.texts.includes("b0"))).toBe(20);
  });

  test("entries without a session reveal at 0.1 s per line, with no highlight and no hold", () => {
    const q = new RevealQueue();
    q.enqueue(entries("n", 3));
    const steps = drain(q);
    expect(steps).toEqual([
      { texts: ["n0"], focus: null },
      { texts: ["n1"], focus: null },
      { texts: ["n2"], focus: null },
    ]);
    expect(q.active).toBe(false);
  });

  test("a session followed by plain lines: the plain lines start after the hold, unhighlighted", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 1, session(1)), ...entries("n", 1)]);
    const steps = drain(q);
    const i = steps.findIndex((s) => s.texts.includes("n0"));
    expect(i).toBe(SESSION_MIN_TICKS);
    expect(steps[i]!.focus).toBeNull();
  });

  test("consecutive entries sharing a session id are one session even if the objects differ (save round trip)", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 1, session(1)), ...entries("b", 1, session(1))]);
    const steps = drain(q);
    expect(steps.slice(0, 2).map((s) => s.focus)).toEqual([1, 1]);
    expect(steps.findIndex((s) => s.texts.includes("b0"))).toBe(1);
  });

  test("flush hands back every unrevealed line in order and leaves the queue idle with no highlight", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 3, session(1)), ...entries("b", 2, session(2))]);
    expect(q.tick().map((e) => e.text)).toEqual(["a0"]);
    expect(q.flush().map((e) => e.text)).toEqual(["a1", "a2", "b0", "b1"]);
    expect(q.active).toBe(false);
    expect(q.focus).toBeNull();
    expect(q.tick()).toEqual([]);
  });

  test("lines enqueued while a reveal is running join the end of the queue", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 1, session(1)));
    q.tick();
    q.enqueue(entries("n", 1));
    const steps = drain(q);
    expect(steps.findIndex((s) => s.texts.includes("n0"))).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bun test test/revealQueue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/ui/revealQueue.ts`:

```ts
import type { LogEntry, LogSession } from "../types";

/** One reveal step. Every pacing number below is a multiple of it. */
export const REVEAL_TICK_MS = 100;
/** A session stays on screen at least this many ticks: 15 × 100 ms = 1.5 s. */
export const SESSION_MIN_TICKS = 15;

interface Group {
  entries: LogEntry[];
  session: LogSession | null;
  /** Ticks the group occupies, counting the tick that shows its first line. */
  span: number;
}

/** Consecutive entries with the same session id form one group; consecutive session-less entries form one too. */
function toGroups(entries: LogEntry[]): Group[] {
  const groups: Group[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.session?.id === entry.session?.id) last.entries.push(entry);
    else groups.push({ entries: [entry], session: entry.session ?? null, span: 0 });
  }
  for (const group of groups) group.span = group.session ? Math.max(SESSION_MIN_TICKS, group.entries.length) : group.entries.length;
  return groups;
}

/**
 * The single clock behind the log reveal and the battlefield highlight. `tick()` is called once per
 * REVEAL_TICK_MS; what it returns is exactly what became visible in that step, and `focus` is the
 * session those lines belong to — read both in the same render and the screen cannot drift from the log.
 */
export class RevealQueue {
  private groups: Group[] = [];
  private current: Group | null = null;
  private shown = 0;
  private ticks = 0;

  enqueue(entries: LogEntry[]): void {
    this.groups.push(...toGroups(entries));
  }

  /** True from the first queued line until the last session's hold has run out. */
  get active(): boolean {
    return this.current !== null || this.groups.length > 0;
  }

  /** The session whose participants are lit right now, or null (nothing revealing, or session-less lines showing). */
  get focus(): LogSession | null {
    return this.current?.session ?? null;
  }

  tick(): LogEntry[] {
    if (this.current && this.ticks >= this.current.span) this.current = null;
    if (!this.current) {
      const next = this.groups.shift();
      if (!next) return [];
      this.current = next;
      this.shown = 0;
      this.ticks = 0;
    }
    const revealed: LogEntry[] = [];
    if (this.shown < this.current.entries.length) revealed.push(this.current.entries[this.shown++]!);
    this.ticks++;
    // Lines with no session have nothing to hold: the group ends with its last line.
    if (!this.current.session && this.shown >= this.current.entries.length) this.current = null;
    return revealed;
  }

  /** Skip: returns every line not yet revealed and leaves the queue idle. */
  flush(): LogEntry[] {
    const rest = [...(this.current ? this.current.entries.slice(this.shown) : []), ...this.groups.flatMap((g) => g.entries)];
    this.current = null;
    this.groups = [];
    this.shown = 0;
    this.ticks = 0;
    return rest;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test test/revealQueue.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit** (only once the user has approved executing this plan)

```bash
git add src/ui/revealQueue.ts test/revealQueue.test.ts
git commit -m "Add session-paced reveal queue"
```

---

### Task 4: Focus helpers, icon band, taller frame

**Files:**
- Modify: `src/ui/sprites.ts` (`compositeSpriteRow`, ~145-155: extract the layout)
- Modify: `src/ui/layout.ts` (line 10)
- Create: `src/ui/battlefieldFocus.ts`
- Test: `test/battlefieldFocus.test.ts`

**Interfaces:**
- Produces (used by Task 5):
  - `spriteSlotLayout(sprites: Sprite[], slotWidth: number, gap: number): { starts: number[]; canvasWidth: number }` (`sprites.ts`; `starts` already include the left shift applied when a sprite is wider than its slot)
  - `ICON_BAND_ROWS = 2` (layout), `UNIT_BLOCK_HEIGHT` now includes it
  - `type UnitSide = "party" | "monster"`, `interface FocusIcon { glyph: string; color: string }`, `interface UnitFocus { dim: boolean; icons: FocusIcon[] }`
  - `FOCUS_GLYPH`, `FOCUS_COLOR`
  - `unitFocus(id: Id, side: UnitSide, session: LogSession | null): UnitFocus`
  - `interface BattlefieldUnit { sprite: Sprite; label: string; labelColor: string; statusText: string; statusColor: string; icons: FocusIcon[] }`
  - `focusedUnit(unit: Omit<BattlefieldUnit, "icons">, focus: UnitFocus): BattlefieldUnit`
  - `buildSideIconBand(icons: FocusIcon[][], sprites: Sprite[], slotWidth: number, gap: number): TextChunk[][]` (`ICON_BAND_ROWS` lines, each as wide as the sprite canvas)
  - `blankIconBand(width: number): TextChunk[][]`
  - `dimColor(hex: string): string`, `dimSprite(sprite: Sprite): Sprite`

- [ ] **Step 1: Write the failing test**

Create `test/battlefieldFocus.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { FOCUS_COLOR, FOCUS_GLYPH, blankIconBand, buildSideIconBand, dimColor, dimSprite, focusedUnit, unitFocus } from "../src/ui/battlefieldFocus";
import { ICON_BAND_ROWS, SLOT_GAP, SLOT_WIDTH, UNIT_BLOCK_HEIGHT } from "../src/ui/layout";
import { MAX_BOSS_HEIGHT, compositeSpriteRow, spriteSlotLayout } from "../src/ui/sprites";
import type { LogSession } from "../src/types";

function session(partial: Partial<LogSession>): LogSession {
  return { id: 1, actorId: null, attackedIds: [], debuffedIds: [], buffedIds: [], healedIds: [], affectedIds: [], ...partial };
}
const glyphs = (icons: { glyph: string }[]) => icons.map((i) => i.glyph);
const textOf = (line: { text: string }[]) => line.map((c) => c.text).join("");

describe("dimColor", () => {
  test("turns a colour into a darker grey", () => {
    const grey = dimColor("#c0392b");
    expect(grey).toMatch(/^#([0-9a-f]{2})\1\1$/);
    expect(parseInt(grey.slice(1, 3), 16)).toBeLessThan(0xc0);
  });
  test("leaves anything that is not #rrggbb alone", () => {
    expect(dimColor("transparent")).toBe("transparent");
  });
});

describe("dimSprite", () => {
  test("greys every palette entry and keeps the rows", () => {
    const sprite = { rows: ["AB"], palette: { A: "#ff0000", B: "#00ff00" } };
    const dimmed = dimSprite(sprite);
    expect(dimmed.rows).toEqual(sprite.rows);
    for (const color of Object.values(dimmed.palette)) expect(color).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });
});

describe("unitFocus", () => {
  test("no session: nothing is dimmed, no icons", () => {
    expect(unitFocus("a", "party", null)).toEqual({ dim: false, icons: [] });
  });

  test("a bystander is dimmed and has no icons", () => {
    expect(unitFocus("z", "party", session({ actorId: "a", attackedIds: ["m1"] }))).toEqual({ dim: true, icons: [] });
  });

  test("attacker gets a sword in its own side's colour, target a shield in the target's side colour", () => {
    const s = session({ actorId: "p1", attackedIds: ["m1"] });
    expect(unitFocus("p1", "party", s)).toEqual({ dim: false, icons: [{ glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.party }] });
    expect(unitFocus("m1", "monster", s)).toEqual({ dim: false, icons: [{ glyph: FOCUS_GLYPH.shield, color: FOCUS_COLOR.monster }] });
  });

  test("a monster attacking the party: red sword, blue shields", () => {
    const s = session({ actorId: "m1", attackedIds: ["p1", "p2"] });
    expect(unitFocus("m1", "monster", s).icons[0]).toEqual({ glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.monster });
    expect(unitFocus("p2", "party", s).icons[0]).toEqual({ glyph: FOCUS_GLYPH.shield, color: FOCUS_COLOR.party });
  });

  test("debuff-only: caster has a sword, target the debuff glyph instead of a shield", () => {
    const s = session({ actorId: "p1", debuffedIds: ["m1"] });
    expect(glyphs(unitFocus("p1", "party", s).icons)).toEqual([FOCUS_GLYPH.sword]);
    expect(glyphs(unitFocus("m1", "monster", s).icons)).toEqual([FOCUS_GLYPH.debuff]);
  });

  test("buff and heal glyphs take the colour of the side wearing them", () => {
    const s = session({ actorId: "m1", buffedIds: ["m2"] });
    expect(unitFocus("m2", "monster", s).icons).toEqual([{ glyph: FOCUS_GLYPH.buff, color: FOCUS_COLOR.monster }]);
    expect(unitFocus("m1", "monster", s).icons).toEqual([{ glyph: FOCUS_GLYPH.support, color: FOCUS_COLOR.monster }]);
  });

  test("buff and heal: caster has the support glyph, targets the buff / heal glyph", () => {
    const s = session({ actorId: "p1", buffedIds: ["p2"], healedIds: ["p3"] });
    expect(glyphs(unitFocus("p1", "party", s).icons)).toEqual([FOCUS_GLYPH.support]);
    expect(glyphs(unitFocus("p2", "party", s).icons)).toEqual([FOCUS_GLYPH.buff]);
    expect(glyphs(unitFocus("p3", "party", s).icons)).toEqual([FOCUS_GLYPH.heal]);
  });

  test("a unit with several roles shows every glyph, caster glyphs first", () => {
    const selfBuff = session({ actorId: "p1", buffedIds: ["p1"] });
    expect(glyphs(unitFocus("p1", "party", selfBuff).icons)).toEqual([FOCUS_GLYPH.support, FOCUS_GLYPH.buff]);
    const hitAndBuff = session({ actorId: "p1", attackedIds: ["m1"], buffedIds: ["p1"] });
    expect(glyphs(unitFocus("p1", "party", hitAndBuff).icons)).toEqual([FOCUS_GLYPH.sword, FOCUS_GLYPH.support, FOCUS_GLYPH.buff]);
  });

  test("an actor-less tick lights its units without icons", () => {
    const s = session({ affectedIds: ["m1"] });
    expect(unitFocus("m1", "monster", s)).toEqual({ dim: false, icons: [] });
    expect(unitFocus("p1", "party", s).dim).toBe(true);
  });

  test("a debuff glyph is not shown for a unit that was also attacked", () => {
    const s = session({ actorId: "p1", attackedIds: ["m1"], debuffedIds: ["m1"] });
    expect(glyphs(unitFocus("m1", "monster", s).icons)).toEqual([FOCUS_GLYPH.shield]);
  });
});

describe("focusedUnit", () => {
  const unit = { sprite: { rows: ["A"], palette: { A: "#ff0000" } }, label: "VG", labelColor: "#5b7fa6", statusText: "10/10", statusColor: "#5fa85f" };
  test("a lit unit keeps its colours and gains its icons", () => {
    const icons = [{ glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.party }];
    expect(focusedUnit(unit, { dim: false, icons })).toEqual({ ...unit, icons });
  });
  test("a dimmed unit has grey sprite, label and status", () => {
    const dimmed = focusedUnit(unit, { dim: true, icons: [] });
    expect(dimmed.labelColor).toBe(dimColor(unit.labelColor));
    expect(dimmed.statusColor).toBe(dimColor(unit.statusColor));
    expect(dimmed.sprite.palette["A"]).toBe(dimColor("#ff0000"));
  });
});

describe("spriteSlotLayout", () => {
  const wide = { rows: ["A".repeat(14)], palette: { A: "#ff0000" } };
  const normal = { rows: ["A".repeat(13)], palette: { A: "#ff0000" } };

  test("matches where compositeSpriteRow really draws each sprite", () => {
    const { starts, canvasWidth } = spriteSlotLayout([wide, normal], SLOT_WIDTH, SLOT_GAP);
    expect(starts).toEqual([0, 16]); // the 14-wide first sprite pushes the whole row right by 1
    const row = compositeSpriteRow([wide, normal], SLOT_WIDTH, 1, SLOT_GAP)[0]!;
    expect(row).toHaveLength(canvasWidth);
  });
});

describe("icon band", () => {
  const sword = { glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.party };
  const wide = { rows: ["A".repeat(14)], palette: { A: "#ff0000" } };
  const normal = { rows: ["A".repeat(13)], palette: { A: "#ff0000" } };

  test("is ICON_BAND_ROWS lines as wide as the sprite canvas, icons on the first, second blank", () => {
    const band = buildSideIconBand([[sword], []], [normal, normal], SLOT_WIDTH, SLOT_GAP);
    const { canvasWidth } = spriteSlotLayout([normal, normal], SLOT_WIDTH, SLOT_GAP);
    expect(band).toHaveLength(ICON_BAND_ROWS);
    expect(textOf(band[0]!)).toHaveLength(canvasWidth);
    expect(textOf(band[1]!)).toBe(" ".repeat(canvasWidth));
  });

  test("icons sit over the middle of each sprite, also for a sprite wider than its slot", () => {
    const band = buildSideIconBand([[sword], [sword]], [wide, normal], SLOT_WIDTH, SLOT_GAP);
    const { starts } = spriteSlotLayout([wide, normal], SLOT_WIDTH, SLOT_GAP);
    const line = textOf(band[0]!);
    expect(line.indexOf(FOCUS_GLYPH.sword)).toBe(starts[0]! + 7);
    expect(line.lastIndexOf(FOCUS_GLYPH.sword)).toBe(starts[1]! + 6);
  });

  test("several icons stay centred on the sprite", () => {
    const icons = [FOCUS_GLYPH.support, FOCUS_GLYPH.buff, FOCUS_GLYPH.heal].map((glyph) => ({ glyph, color: FOCUS_COLOR.party }));
    const line = textOf(buildSideIconBand([icons], [normal], SLOT_WIDTH, SLOT_GAP)[0]!);
    expect(line.trim()).toBe(`${FOCUS_GLYPH.support}${FOCUS_GLYPH.buff}${FOCUS_GLYPH.heal}`);
    expect(line.indexOf(FOCUS_GLYPH.buff)).toBe(6);
  });

  test("blankIconBand pads a block that has no units", () => {
    const band = blankIconBand(30);
    expect(band).toHaveLength(ICON_BAND_ROWS);
    expect(band.every((line) => textOf(line) === " ".repeat(30))).toBe(true);
  });
});

describe("layout", () => {
  test("the unit block makes room for the icon band", () => {
    expect(ICON_BAND_ROWS).toBe(2);
    expect(UNIT_BLOCK_HEIGHT).toBe(ICON_BAND_ROWS + MAX_BOSS_HEIGHT + 3);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bun test test/battlefieldFocus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Extract the sprite layout**

In `src/ui/sprites.ts`, add above `compositeSpriteRow`:

```ts
/**
 * Where each sprite starts on a row of `sprites`, one slot each. A sprite wider than its slot pushes
 * the whole row right so nothing starts at a negative column; `starts` already include that shift.
 */
export function spriteSlotLayout(sprites: Sprite[], slotWidth: number, gap: number): { starts: number[]; canvasWidth: number } {
  const rawStarts = sprites.map((sprite, i) => i * (slotWidth + gap) + Math.floor((slotWidth - spriteWidth(sprite)) / 2));
  const shift = -Math.min(0, ...rawStarts);
  const ends = sprites.map((sprite, i) => rawStarts[i]! + spriteWidth(sprite));
  return { starts: rawStarts.map((s) => s + shift), canvasWidth: Math.max(...ends) + shift };
}
```

and in `compositeSpriteRow` replace

```ts
  const starts = sprites.map((sprite, i) => {
    const nominalStart = i * (slotWidth + gap);
    const offset = Math.floor((slotWidth - spriteWidth(sprite)) / 2);
    return nominalStart + offset;
  });
  const ends = sprites.map((sprite, i) => starts[i]! + spriteWidth(sprite));
  const shift = -Math.min(0, ...starts);
  const canvasWidth = Math.max(...ends) + shift;
```

with

```ts
  const { starts, canvasWidth } = spriteSlotLayout(sprites, slotWidth, gap);
```

and replace `const canvasStart = starts[i]! + shift;` with `const canvasStart = starts[i]!;`.

- [ ] **Step 4: Layout constants**

In `src/ui/layout.ts` replace

```ts
export const UNIT_BLOCK_HEIGHT = MAX_BOSS_HEIGHT + 3;
```

with

```ts
/** Rows reserved above the sprites for role icons: one icon row plus one blank row, so an icon never touches a sprite. */
export const ICON_BAND_ROWS = 2;
export const UNIT_BLOCK_HEIGHT = ICON_BAND_ROWS + MAX_BOSS_HEIGHT + 3;
```

- [ ] **Step 5: Write the helpers**

Create `src/ui/battlefieldFocus.ts`:

```ts
import type { TextChunk } from "@opentui/core";
import type { Id, LogSession } from "../types";
import { ICON_BAND_ROWS } from "./layout";
import { spriteSlotLayout, spriteWidth, type Sprite } from "./sprites";
import { colorChunk, plainChunk } from "./theme";

export type UnitSide = "party" | "monster";

export interface FocusIcon {
  glyph: string;
  color: string;
}

export interface UnitFocus {
  dim: boolean;
  icons: FocusIcon[];
}

export const FOCUS_GLYPH = { sword: "⚔", shield: "⛨", buff: "▲", debuff: "▼", heal: "✚", support: "⚚" } as const;

/** Blue is the player's side, red the enemy's — by the side of the unit wearing the icon, whoever attacks. */
export const FOCUS_COLOR: Record<UnitSide, string> = { party: "#5b8fc9", monster: "#c0392b" };

/** Share of the original brightness a bystander keeps. */
const DIM_FACTOR = 0.55;

export function dimColor(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const grey = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * DIM_FACTOR);
  const h = grey.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

export function dimSprite(sprite: Sprite): Sprite {
  return { rows: sprite.rows, palette: Object.fromEntries(Object.entries(sprite.palette).map(([key, color]) => [key, dimColor(color)])) };
}

/** Who is lit and what each lit unit wears in `session`. With no session everyone is shown normally. */
export function unitFocus(id: Id, side: UnitSide, session: LogSession | null): UnitFocus {
  if (!session) return { dim: false, icons: [] };
  const color = FOCUS_COLOR[side];
  const icon = (glyph: string): FocusIcon => ({ glyph, color });
  const icons: FocusIcon[] = [];

  if (session.actorId === id) {
    if (session.attackedIds.length > 0 || session.debuffedIds.length > 0) icons.push(icon(FOCUS_GLYPH.sword));
    if (session.buffedIds.length > 0 || session.healedIds.length > 0) icons.push(icon(FOCUS_GLYPH.support));
  }
  const attacked = session.attackedIds.includes(id);
  if (attacked) icons.push(icon(FOCUS_GLYPH.shield));
  else if (session.debuffedIds.includes(id)) icons.push(icon(FOCUS_GLYPH.debuff));
  if (session.buffedIds.includes(id)) icons.push(icon(FOCUS_GLYPH.buff));
  if (session.healedIds.includes(id)) icons.push(icon(FOCUS_GLYPH.heal));

  const participates =
    session.actorId === id ||
    attacked ||
    session.debuffedIds.includes(id) ||
    session.buffedIds.includes(id) ||
    session.healedIds.includes(id) ||
    session.affectedIds.includes(id);
  return { dim: !participates, icons };
}

export interface BattlefieldUnit {
  sprite: Sprite;
  label: string;
  labelColor: string;
  statusText: string;
  statusColor: string;
  icons: FocusIcon[];
}

export function focusedUnit(unit: Omit<BattlefieldUnit, "icons">, focus: UnitFocus): BattlefieldUnit {
  if (!focus.dim) return { ...unit, icons: focus.icons };
  return { ...unit, sprite: dimSprite(unit.sprite), labelColor: dimColor(unit.labelColor), statusColor: dimColor(unit.statusColor), icons: focus.icons };
}

/**
 * The `ICON_BAND_ROWS` rows above a side's sprites: each unit's icons centred over the middle of its
 * own sprite (not its nominal slot — a wide sprite or a boss sits off the slot grid), the rest blank.
 * As wide as the sprite canvas, so it lines up with the sprite rows below it.
 */
export function buildSideIconBand(icons: FocusIcon[][], sprites: Sprite[], slotWidth: number, gap: number): TextChunk[][] {
  const { starts, canvasWidth } = spriteSlotLayout(sprites, slotWidth, gap);
  const cells: (FocusIcon | null)[] = new Array(canvasWidth).fill(null);
  icons.forEach((unitIcons, i) => {
    const centre = starts[i]! + Math.floor(spriteWidth(sprites[i]!) / 2);
    const left = centre - Math.floor((unitIcons.length - 1) / 2);
    unitIcons.forEach((icon, k) => {
      const x = left + k;
      if (x >= 0 && x < canvasWidth) cells[x] = icon;
    });
  });
  const iconRow = cells.map((cell) => (cell ? colorChunk(cell.glyph, cell.color) : plainChunk(" ")));
  return [iconRow, ...Array.from({ length: ICON_BAND_ROWS - 1 }, () => [plainChunk(" ".repeat(canvasWidth))])];
}

/** The same band for a block that has no units (campfire, chest, event, empty room). */
export function blankIconBand(width: number): TextChunk[][] {
  return Array.from({ length: ICON_BAND_ROWS }, () => [plainChunk(" ".repeat(width))]);
}
```

- [ ] **Step 6: Run the tests**

Run: `bun test test/battlefieldFocus.test.ts test/sprites.test.ts`
Expected: PASS (the sprite refactor is behaviour-preserving, so the existing sprite tests stay green).

- [ ] **Step 7: Commit** (only once the user has approved executing this plan)

```bash
git add src/ui/battlefieldFocus.ts src/ui/layout.ts src/ui/sprites.ts test/battlefieldFocus.test.ts
git commit -m "Add battlefield focus helpers and icon band"
```

(`bun test` as a whole may fail between here and Task 5 step 10 because the layout constant is 2 rows taller; that is expected and handled there.)

---

### Task 5: Wire the reveal, focus and room/run logs into `App`

**Files:**
- Create: `src/ui/screens/log.ts`
- Modify: `src/ui/app.ts` (imports ~2-65, fields ~95-105, constructor ~106, `logInfo` ~240, `handleKey` ~346, `reportUnusable`/`pushToast` ~513-521, `render` ~541-635, `renderLogContent`/`scheduleReveal`/`flushPendingReveal` ~637-678, `buildSideBlock` ~733, `renderBattlefield` ~800-858)
- Modify: `test/keyHints.test.ts`, `test/ui.test.ts` (terminal heights)
- Test: `test/actionFocus.test.ts`

**Interfaces:**
- Consumes: `RevealQueue`, `REVEAL_TICK_MS` (Task 3); `unitFocus`, `focusedUnit`, `buildSideIconBand`, `blankIconBand`, `BattlefieldUnit` (Task 4); `LogSession` (Task 1).
- Produces:
  - `logLines(entries: LogEntry[]): TextChunk[][]` in `src/ui/screens/log.ts` (used again in Task 6)
  - `new App(renderer, game?, options?: { autoReveal?: boolean })`
  - `App.tickReveal(): void` (what the timer does; tests call it)
  - debug getters `debugRoomLog`, `debugRunLog`, `debugFocus`, `debugRevealActive`, `debugDisplaySnapshot`, `debugLastRender: { revealing: boolean; focusId: number | null; logTailSessionId: number | null }`

- [ ] **Step 1: Write the shared log renderer**

Create `src/ui/screens/log.ts`:

```ts
import type { TextChunk } from "@opentui/core";
import type { LogEntry } from "../../types";
import { LOG_KIND_STYLE, colorChunk } from "../theme";

/** One styled line per entry — the room log box and the full-log screen render the same way. */
export function logLines(entries: LogEntry[]): TextChunk[][] {
  return entries.map((entry) => {
    const style = LOG_KIND_STYLE[entry.kind];
    return [colorChunk(`${style.icon} `, style.color), colorChunk(entry.text, style.color)];
  });
}
```

- [ ] **Step 2: Raise the heights of the tests that the 2 extra rows would clip**

The battlefield grows by 2 rows, so a 45-row terminal leaves the body panels 3 content rows. In `test/keyHints.test.ts` change every `height: 45` to `height: 47` (the `createTestRenderer` calls at lines ~102, 150, 179, 210, 227), and in `test/ui.test.ts` change the `character info screen` test's `height: 45` (line ~223) to `height: 47`. Leave the `height: 40` tests alone (they never assert on panel text).

- [ ] **Step 3: Write the failing App-level tests**

Create `test/actionFocus.test.ts`. It uses the manual clock (`autoReveal: false`) and a 4-character party (the default party is all 9 classes: 36 key presses per round and sprites wider than 130 columns):

```ts
import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { CLASSES } from "../src/data/classes";
import { getRoom } from "../src/engine/dungeon";
import { startCombat } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import { FOCUS_GLYPH } from "../src/ui/battlefieldFocus";

const PARTY = CLASSES.slice(0, 4).map((c) => c.id);
const count = (frame: string, glyph: string) => frame.split(glyph).length - 1;

/** An app standing at the first command prompt of a fight against 2 sturdy goblins, reveal clock under test control. */
async function openFight(options: { goblinAttack?: number; partyHp?: number } = {}) {
  const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 62 });
  const game = new Game(7, PARTY);
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  const goblins = [spawnMonster("goblin", 1), spawnMonster("goblin", 1)];
  for (const g of goblins) {
    g.hp = g.maxHp = 500;
    if (options.goblinAttack !== undefined) g.attack = options.goblinAttack;
    game.ctx.monsters.push(g);
  }
  if (options.partyHp !== undefined) for (const c of game.state.party) c.hp = options.partyHp;
  room.monsterIds = goblins.map((g) => g.id);
  room.cleared = false;
  game.state.combat = startCombat(room.id, room.monsterIds, game.ctx, false);
  const app = new App(renderer, game, { autoReveal: false });
  await renderOnce();
  // `startCombat` logs a "combat started" line, which the first render queues for reveal: drain it,
  // or `playRound` would see a reveal already running and never play the round.
  while (app.debugRevealActive) app.tickReveal();
  await renderOnce();
  return { app, mockInput, renderOnce, captureCharFrame, game };
}
type Fight = Awaited<ReturnType<typeof openFight>>;

/** Walks the command phase (Fight → first skill → first target) until the round resolves and the reveal starts. */
async function playRound(fight: Fight) {
  let guard = 0;
  while (!fight.app.debugRevealActive && guard++ < 6 * PARTY.length + 10) {
    const kind = fight.app.debugUiState.kind;
    fight.mockInput.pressKey(kind === "skillDetail" ? "RETURN" : "1");
    await fight.renderOnce();
  }
  expect(fight.app.debugRevealActive).toBe(true);
}

async function pressEscape(fight: Fight) {
  fight.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 100)); // a lone Esc is held back briefly to tell it from an escape sequence
  await fight.renderOnce();
}

describe("battlefield and log stay in step", () => {
  test("every render shows the session of the newest visible log line, and the icons of that session", async () => {
    const fight = await openFight();
    await playRound(fight);
    let guard = 0;
    while (fight.app.debugRevealActive && guard++ < 400) {
      const last = fight.app.debugLastRender;
      if (last.revealing) expect(last.focusId).toBe(last.logTailSessionId);
      const frame = fight.captureCharFrame();
      const focus = fight.app.debugFocus;
      expect(count(frame, FOCUS_GLYPH.shield)).toBe(focus?.attackedIds.length ?? 0);
      expect(count(frame, FOCUS_GLYPH.debuff)).toBe(focus?.debuffedIds.length ?? 0);
      fight.app.tickReveal();
      await fight.renderOnce();
    }
    expect(guard).toBeLessThan(400);
  }, 30000);

  test("at least one session shows a shield, and the frame with it also shows that session's log line", async () => {
    const fight = await openFight();
    await playRound(fight);
    let sawShield = false;
    let guard = 0;
    while (fight.app.debugRevealActive && guard++ < 400) {
      const focus = fight.app.debugFocus;
      if (focus && focus.attackedIds.length > 0) {
        sawShield = true;
        const newest = fight.app.debugRoomLog.at(-1)!;
        expect(newest.session?.id).toBe(focus.id);
        expect(fight.captureCharFrame()).toContain(newest.text.slice(0, 20));
      }
      fight.app.tickReveal();
      await fight.renderOnce();
    }
    expect(sawShield).toBe(true);
  }, 30000);

  test("skipping reveals every line and drops the highlight in one step", async () => {
    const fight = await openFight();
    await playRound(fight);
    fight.mockInput.pressKey("1"); // any key skips
    await fight.renderOnce();
    expect(fight.app.debugRevealActive).toBe(false);
    expect(fight.app.debugFocus).toBeNull();
    expect(fight.captureCharFrame()).not.toContain(FOCUS_GLYPH.shield);
    expect(fight.app.debugRoomLog.length).toBe(fight.game.state.combat!.log.length);
  }, 30000);

  test("when the last session's hold ends the round is over for the screen too", async () => {
    const fight = await openFight();
    await playRound(fight);
    let guard = 0;
    while (fight.app.debugRevealActive && guard++ < 400) {
      fight.app.tickReveal();
      await fight.renderOnce();
    }
    expect(fight.app.debugFocus).toBeNull();
    expect(fight.captureCharFrame()).not.toContain("Revealing");
  }, 30000);

  test("a quicksave during the reveal does not rewind HP, MP or coins to the start of the round", async () => {
    const fight = await openFight();
    await playRound(fight);
    for (let i = 0; i < 20 && fight.app.debugRevealActive; i++) fight.app.tickReveal();
    const before = fight.app.debugDisplaySnapshot;
    fight.mockInput.pressKey("s");
    await fight.renderOnce();
    if (fight.app.debugRevealActive) expect(fight.app.debugDisplaySnapshot).toBe(before);
  }, 30000);

  test("the round that wipes the party is still narrated, although the combat is already gone", async () => {
    const fight = await openFight({ goblinAttack: 9999, partyHp: 1 });
    await playRound(fight);
    expect(fight.game.state.combat).toBeNull();
    let guard = 0;
    while (fight.app.debugRevealActive && guard++ < 600) {
      fight.app.tickReveal();
      await fight.renderOnce();
    }
    expect(fight.app.debugRoomLog.some((e) => e.text.includes("party has fallen"))).toBe(true);
  }, 30000);

  test("a save loaded mid-fight does not replay the rounds already played", async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 130, height: 62 });
    const game = new Game(7, PARTY);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const goblin = spawnMonster("goblin", 1);
    goblin.hp = goblin.maxHp = 500;
    game.ctx.monsters.push(goblin);
    room.monsterIds = [goblin.id];
    game.state.combat = startCombat(room.id, [goblin.id], game.ctx, false);
    for (const c of game.state.party) game.queue({ kind: "character", id: c.id }, c.unlockedSkillIds[0]!, [{ kind: "monster", id: goblin.id }]);
    game.resolve();
    expect(game.state.combat!.phase).toBe("command");
    const app = new App(renderer, game, { autoReveal: false });
    await renderOnce();
    expect(app.debugRevealActive).toBe(false);
    expect(app.debugRoomLog).toEqual([]);
  }, 30000);
});

describe("room log", () => {
  test("keeps at most 50 entries", async () => {
    const fight = await openFight();
    for (let i = 0; i < 80; i++) fight.app.pushToast(`note ${i}`);
    fight.app.tickReveal(); // the first tick renders, which queues the toasts
    for (let i = 0; i < 200 && fight.app.debugRevealActive; i++) fight.app.tickReveal();
    await fight.renderOnce();
    expect(fight.app.debugRoomLog.length).toBe(50);
    expect(fight.app.debugRoomLog.at(-1)!.text).toBe("note 79");
  }, 30000);

  test("walking into another room clears it but keeps the line that announces the new room", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 130, height: 62 });
    const game = new Game(7, PARTY);
    game.state.combat = null;
    const app = new App(renderer, game, { autoReveal: false });
    await renderOnce();
    app.logInfo("left over from the first room");
    expect(app.debugRoomLog.map((e) => e.text)).toContain("left over from the first room");

    mockInput.pressKey("1"); // move through the first exit
    await renderOnce();
    for (let i = 0; i < 50 && app.debugRevealActive; i++) app.tickReveal();
    const texts = app.debugRoomLog.map((e) => e.text);
    expect(texts).not.toContain("left over from the first room");
    expect(texts).toContain(game.state.message);
  }, 30000);
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `bun test test/actionFocus.test.ts`
Expected: FAIL — `App` constructor takes no options / the debug getters do not exist.

- [ ] **Step 5: App — imports, constants, fields, constructor**

In `src/ui/app.ts`:

1. Add imports (next to the other `./` imports):

```ts
import { RevealQueue, REVEAL_TICK_MS } from "./revealQueue";
import { unitFocus, focusedUnit, buildSideIconBand, blankIconBand, type BattlefieldUnit } from "./battlefieldFocus";
import { logLines } from "./screens/log";
```

and add `LogSession` to the existing `import type { Character, Monster, Id, LogEntry, CombatantSnapshot, PartyStateSnapshot, ... } from "../types"` list.

2. Replace

```ts
const LOG_HISTORY_SIZE = 20;
const LOG_REVEAL_INTERVAL_MS = 800;
```

with

```ts
const ROOM_LOG_SIZE = 50;
const RUN_LOG_SIZE = 500;
```

3. Replace the two fields `private logHistory: LogEntry[] = [];` and `private pendingReveal: LogEntry[] = [];` with:

```ts
  private roomLog: LogEntry[] = [];
  private roomLogFloor: Floor | null = null;
  private roomLogRoomId: Id | null = null;
  private runLog: LogEntry[] = [];
  private reveal = new RevealQueue();
  private autoReveal: boolean;
  private lastRender = { revealing: false, focusId: null as number | null, logTailSessionId: null as number | null };
```

(keep `revealTimer`, `displaySnapshot`, `displayPartySnapshot`).

4. Change the constructor signature to

```ts
  constructor(private renderer: CliRenderer, game?: Game, options: { autoReveal?: boolean } = {}) {
    this.autoReveal = options.autoReveal ?? true;
    this.game = game ?? new Game();
```

5. Next to `debugGame`, add:

```ts
  get debugRoomLog(): LogEntry[] {
    return this.roomLog;
  }

  get debugRunLog(): LogEntry[] {
    return this.runLog;
  }

  get debugFocus(): LogSession | null {
    return this.reveal.focus;
  }

  get debugRevealActive(): boolean {
    return this.reveal.active;
  }

  get debugDisplaySnapshot(): CombatantSnapshot[] | null {
    return this.displaySnapshot;
  }

  get debugLastRender() {
    return this.lastRender;
  }
```

- [ ] **Step 6: App — logs and the reveal clock**

Replace `logInfo`:

```ts
  logInfo(text: string): void {
    this.appendLog([{ text, kind: "info" }]);
  }
```

In `reportUnusable` and `pushToast`, change the `else this.logHistory.push({ text: ..., kind: "info" });` branches to `else this.appendLog([{ text: ..., kind: "info" }]);`.

Replace `renderLogContent`, `scheduleReveal` and `flushPendingReveal` with:

```ts
  /** The room log belongs to one room: the first thing written (or rendered) after the player changes room starts it afresh. */
  private syncRoomLog(): void {
    const s = this.game.state;
    if (s.floor !== this.roomLogFloor || s.currentRoomId !== this.roomLogRoomId) {
      this.roomLogFloor = s.floor;
      this.roomLogRoomId = s.currentRoomId;
      this.roomLog = [];
    }
  }

  private appendLog(entries: LogEntry[]): void {
    this.syncRoomLog();
    this.roomLog.push(...entries);
    this.runLog.push(...entries);
    if (this.roomLog.length > ROOM_LOG_SIZE) this.roomLog.splice(0, this.roomLog.length - ROOM_LOG_SIZE);
    if (this.runLog.length > RUN_LOG_SIZE) this.runLog.splice(0, this.runLog.length - RUN_LOG_SIZE);
  }

  private renderLogContent(): void {
    if (this.roomLog.length === 0) {
      this.log.content = this.game.state.message;
      return;
    }
    this.log.content = joinLines(logLines(this.roomLog));
  }

  /** Makes lines visible: they enter the logs and the HP/MP/coin snapshots they carry become the displayed state. */
  private applyRevealed(entries: LogEntry[]): void {
    if (entries.length === 0) return;
    this.appendLog(entries);
    for (const entry of entries) {
      if (entry.snapshot) this.displaySnapshot = entry.snapshot;
      if (entry.partySnapshot) this.displayPartySnapshot = entry.partySnapshot;
    }
  }

  /** Called only when lines were queued on an idle queue: shows the first line immediately, then lets the timer carry on. */
  private startReveal(): void {
    this.applyRevealed(this.reveal.tick());
    this.scheduleRevealTick();
  }

  private scheduleRevealTick(): void {
    if (!this.autoReveal || this.revealTimer !== null || !this.reveal.active) return;
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      this.tickReveal();
    }, REVEAL_TICK_MS);
  }

  /** One reveal step: the log line, the HP/MP snapshot and the battlefield highlight all move together, in this single render. */
  tickReveal(): void {
    this.applyRevealed(this.reveal.tick());
    this.scheduleRevealTick();
    this.render();
  }

  private flushPendingReveal(): void {
    if (!this.reveal.active) return;
    if (this.revealTimer !== null) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    this.applyRevealed(this.reveal.flush());
    this.render();
  }
```

Replace the skip check in `handleKey`:

```ts
    if (this.pendingReveal.length > 0) {
      this.flushPendingReveal();
      return;
    }
```

with

```ts
    if (this.reveal.active) {
      this.flushPendingReveal();
      return;
    }
```

- [ ] **Step 7: App — `render()`**

At the top of `render()`, directly after `const room = getRoom(s.floor, s.currentRoomId);`, add `this.syncRoomLog();`. (The existing `roomHistory` block further down stays where it is.)

Replace the reveal bookkeeping (from `const combatLog = s.combat?.log ?? null;` through `const revealing = this.pendingReveal.length > 0;`) with:

```ts
    const combat = s.combat;
    const fresh: LogEntry[] = [];
    // The combat whose round-start state a fresh reveal starts from: normally the current one, but the
    // round that wipes the party ends the combat before this render runs.
    let revealSource = combat;
    if (combat !== this.observedCombat) {
      // Whatever the previous combat logged after the last line this screen saw still has to be narrated.
      const finished = this.observedCombat;
      if (finished && finished.log.length > this.lastLogLength) {
        fresh.push(...finished.log.slice(this.lastLogLength));
        revealSource = finished;
      }
      this.observedCombat = combat;
      this.lastLogLength = 0;
      this.displaySnapshot = null;
      this.displayPartySnapshot = null;
      // A save loaded mid-fight arrives with its resolved rounds already in the log: the player saw them
      // before saving, so they are not replayed.
      if (combat && combat.phase === "command" && combat.log.some((e) => e.snapshot !== undefined)) this.lastLogLength = combat.log.length;
    }
    if (combat && combat.log.length > this.lastLogLength) {
      fresh.push(...combat.log.slice(this.lastLogLength));
      this.lastLogLength = combat.log.length;
    }
    if (fresh.length > 0) {
      // Only a fresh reveal starts from the round-start state and takes its first step now. Lines queued
      // behind a running reveal (a toast, a quicksave) neither rewind HP/MP/coins nor add a tick.
      const wasIdle = !this.reveal.active;
      if (wasIdle) {
        const fromRound = fresh.some((e) => e.snapshot !== undefined);
        this.displaySnapshot = fromRound ? (revealSource?.roundStartSnapshot ?? null) : null;
        this.displayPartySnapshot = fromRound ? (revealSource?.roundStartPartySnapshot ?? null) : null;
      }
      this.reveal.enqueue(fresh);
      if (wasIdle) this.startReveal();
    }
    const revealing = this.reveal.active;
    const focus = this.reveal.focus;
```

This replaces the `observedCombatLog: LogEntry[] | null` field with `private observedCombat: CombatState | null = null;` (add `CombatState` to the `../types` import).

Keep the lines that follow it (`const hpOverride = ...`, `const partyOverride = ...`) unchanged.

Pass the focus to the battlefield:

```ts
    this.battlefield.content = joinLines(this.renderBattlefield(hpOverride, focus));
```

and at the very end of `render()`, after `this.renderLogContent();`, record what this render actually used (tests compare them):

```ts
    this.lastRender = { revealing, focusId: focus?.id ?? null, logTailSessionId: this.roomLog.at(-1)?.session?.id ?? null };
```

- [ ] **Step 8: App — battlefield rendering**

Change `buildSideBlock` to take units with icons and prepend the band, centred on each sprite:

```ts
  private buildSideBlock(units: BattlefieldUnit[]): TextChunk[][] {
    const sprites = units.map((u) => u.sprite);
    const iconBand = buildSideIconBand(
      units.map((u) => u.icons),
      sprites,
      SLOT_WIDTH,
      SLOT_GAP
    );
    const spritePart = compositeSpriteRow(sprites, SLOT_WIDTH, MAX_BOSS_HEIGHT, SLOT_GAP);
    const metaPart = mergeBlocksHorizontally(
      units.map((u) => this.buildUnitMeta(u.label, u.labelColor, u.statusText, u.statusColor)),
      SLOT_GAP
    );
    return [...iconBand, ...spritePart, ...metaPart];
  }
```

Replace `renderBattlefield`'s signature:

```ts
  private renderBattlefield(hpOverride: Map<Id, CombatantSnapshot> | null = null, focus: LogSession | null = null): TextChunk[][] {
```

Party units:

```ts
    const partyUnits = s.party.map((c) => {
      const view = hpOverride?.get(c.id);
      const hp = view?.hp ?? c.hp;
      const maxHp = c.maxHp;
      const isAlive = view?.isAlive ?? c.isAlive;
      const style = CLASS_STYLE[c.classId] ?? { abbr: "??", color: PALETTE.dim };
      const lens = unitFocus(c.id, "party", focus);
      if (!isAlive) return focusedUnit({ sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: t("ui.fallen"), statusColor: PALETTE.dead }, lens);
      return focusedUnit({ sprite: spriteForClass(c.classId), label: style.abbr, labelColor: style.color, statusText: `${hp}/${maxHp}`, statusColor: hpColorFor(hp, maxHp) }, lens);
    });
    const partyBlock = this.buildSideBlock(partyUnits);
```

Enemy units (inside the `else` of `monsterCombatants.length === 0`):

```ts
        const enemyUnits = monsterCombatants.map((combatant) => {
          const m = getActorByRef(combatant.ref, this.game.ctx) as Monster;
          const view = hpOverride?.get(m.id);
          const hp = view?.hp ?? m.hp;
          const style = monsterStyle(m);
          const lens = unitFocus(m.id, "monster", focus);
          if (hp <= 0) return focusedUnit({ sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: t("ui.defeated"), statusColor: PALETTE.dead }, lens);
          return focusedUnit({ sprite: spriteForMonster(m.archetypeId, m.tier), label: style.abbr, labelColor: style.color, statusText: `${hp}/${m.maxHp}`, statusColor: hpColorFor(hp, m.maxHp) }, lens);
        });
        enemyBlock = this.buildSideBlock(enemyUnits);
```

Every other enemy-side block (cleared, campfire, chest, event, empty room) has no units; give it a blank band so both sides stay the same height. Right after the `if/else if/else` chain that assigns `enemyBlock`, add:

```ts
    if (!(s.combat && s.combat.combatants.some((c) => c.ref.kind === "monster"))) {
      enemyBlock = [...blankIconBand(EMPTY_ENEMY_WIDTH), ...enemyBlock];
    }
```

The "VS" divider must stay in the middle of the sprite area, not of the whole block. In the divider loop replace `i === Math.floor(UNIT_BLOCK_HEIGHT / 2)` with `i === ICON_BAND_ROWS + Math.floor((UNIT_BLOCK_HEIGHT - ICON_BAND_ROWS) / 2)` and add `ICON_BAND_ROWS` to the `./layout` import.

Then remove the now-unused imports if the linter flags them (`LOG_KIND_STYLE`, `type Sprite`); TypeScript does not (`noUnusedLocals` is off).

- [ ] **Step 9: Run the new tests**

Run: `bun test test/actionFocus.test.ts`
Expected: PASS. If a frame assertion fails only because a glyph is clipped, raise the test renderer height in `openFight` rather than loosening the assertion. If `⛨` is counted twice because the frame also draws it elsewhere, check that no other string in `data/strings.json` contains it.

- [ ] **Step 10: Whole suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS. Any other test that now fails because panels lost 2 rows (text at the bottom of a panel missing from a captured frame): raise that test's terminal height by 2. Do not change assertions.

- [ ] **Step 11: Look at it in the real TUI**

Follow the `tui-testing` skill (tmux workflow): start the game (`bun run start`), enter a fight. Confirm: bystanders turn grey, icons sit in the band above the sprites with a blank row between icon and sprite and are centred over wide sprites and bosses, each of ⚔ ⛨ ▲ ▼ ✚ ⚚ occupies one cell, and the highlight changes with the log line. The glyphs ⛨ ▲ ▼ ⚚ are East-Asian-Ambiguous width: if any renders double-width or as emoji in the user's terminal, swap it in `FOCUS_GLYPH` (`src/ui/battlefieldFocus.ts`) and re-run `bun test test/battlefieldFocus.test.ts test/actionFocus.test.ts`. Tune `DIM_FACTOR` by eye.

- [ ] **Step 12: Commit** (only once the user has approved executing this plan)

```bash
git add src/ui test
git commit -m "Pace the log by action and focus the battlefield on it"
```

---

### Task 6: Full run log screen and `[l]` key

**Files:**
- Modify: `src/ui/state.ts` (UiState union), `src/ui/keyHints.ts`, `data/strings.json`, `src/ui/app.ts`
- Modify: `test/keyHints.test.ts` (expected global strings)
- Test: `test/actionFocus.test.ts` (append)

**Interfaces:**
- Consumes: `logLines` (Task 5), `runLog`/`appendLog` (Task 5).
- Produces: `UiState` variant `{ kind: "fullLog"; previous: UiState }`; global hint `[l] Log`; inside `fullLog` the globals shrink to `[Ctrl+C] Quit`.

- [ ] **Step 1: Update the expected global hints and add the new tests (failing first)**

In `test/keyHints.test.ts` change these expectations (find them by their text):

- `globalHints("room")`: `"[b] Party   [l] Log   [q] Save   [s] Quicksave   [Ctrl+C] Quit"`
- `globalHints("saveMenu")`: `"[l] Log   [s] Quicksave   [Ctrl+C] Quit"`
- `globalHints("gameover")`: `"[l] Log   [Ctrl+C] Quit"`
- `globalHints("characterInfo")`: `"[l] Log   [q] Save   [s] Quicksave   [Ctrl+C] Quit"`
- `globalHints("room", false)`: `"[l] Log   [q] Save   [s] Quicksave   [Ctrl+C] Quit"`
- `composeFooter("[1-9] Action", "pickAction", false)`: `"[1-9] Action   │   [b] Party   [l] Log   [q] Save   [s] Quicksave   [Ctrl+C] Quit"`
- `composeFooter("", "gameover", false)`: `"[l] Log   [Ctrl+C] Quit"`

and add:

```ts
  test("the log screen offers only the quit key: nothing but Esc, ↑/↓ and Ctrl+C works inside it", () => {
    expect(globalHints("fullLog")).toBe("[Ctrl+C] Quit");
  });
```

Append to `test/actionFocus.test.ts`:

```ts
describe("run log screen", () => {
  test("[l] opens the full run log, Esc returns, and the footer never offers [l] inside it", async () => {
    const fight = await openFight();
    fight.mockInput.pressKey("l");
    await fight.renderOnce();
    expect(fight.app.debugUiState.kind).toBe("fullLog");
    const frame = fight.captureCharFrame();
    expect(frame).toContain("Run log");
    expect(frame).toContain("[Esc] Back");
    expect(frame).not.toContain("[l] Log");

    await pressEscape(fight);
    expect(fight.app.debugUiState.kind).not.toBe("fullLog");
    expect(fight.captureCharFrame()).toContain("[l] Log");
  }, 30000);

  test("opened in the middle of a reveal, Esc closes the log and leaves the reveal running", async () => {
    const fight = await openFight();
    await playRound(fight);
    fight.mockInput.pressKey("l");
    await fight.renderOnce();
    expect(fight.app.debugUiState.kind).toBe("fullLog");
    await pressEscape(fight);
    expect(fight.app.debugUiState.kind).not.toBe("fullLog");
    expect(fight.app.debugRevealActive).toBe(true);
  }, 30000);

  test("keys that would save are swallowed inside the log screen", async () => {
    const fight = await openFight();
    fight.mockInput.pressKey("l");
    await fight.renderOnce();
    const before = fight.app.debugRunLog.length;
    for (const key of ["s", "q", "b", "1"]) {
      fight.mockInput.pressKey(key);
      await fight.renderOnce();
    }
    expect(fight.app.debugUiState.kind).toBe("fullLog");
    expect(fight.app.debugRunLog.length).toBe(before);
  }, 30000);

  test("keeps the latest 500 entries of the run, across rooms", async () => {
    const fight = await openFight();
    for (let i = 0; i < 600; i++) fight.app.pushToast(`entry ${i}`);
    fight.app.tickReveal(); // the first tick renders, which queues the toasts
    for (let i = 0; i < 1000 && fight.app.debugRevealActive; i++) fight.app.tickReveal();
    expect(fight.app.debugRunLog).toHaveLength(500);
    expect(fight.app.debugRunLog.at(-1)!.text).toBe("entry 599");
    expect(fight.app.debugRunLog[0]!.text).toBe("entry 100");
  }, 30000);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `bun test test/keyHints.test.ts test/actionFocus.test.ts`
Expected: FAIL (hints lack `[l] Log`; `fullLog` is not a UiState kind).

- [ ] **Step 3: State, strings, hints**

`src/ui/state.ts` — add to the `UiState` union (next to `saveMenu`):

```ts
  | { kind: "fullLog"; previous: UiState }
```

`data/strings.json` — add (near `ui.hintSave`/`ui.panelLog`):

```json
  "ui.hintLog": "[l] Log",
  "ui.panelFullLog": "Run log - latest {{count}} (↑/↓ to scroll)",
  "ui.fullLogEmpty": "Nothing has happened yet.",
```

`src/ui/keyHints.ts` — extend the lists and `globalHints`. Add `"fullLog"` to `NO_SAVE_KINDS` and `NO_QUICKSAVE_KINDS`, add `const NO_LOG_KINDS: readonly UiState["kind"][] = ["fullLog"];` below them, and put the log hint after the party hint:

```ts
export function globalHints(kind: UiState["kind"], allowPartyInfo: boolean = true): string {
  return joinHints(
    allowPartyInfo && PARTY_INFO_KINDS.includes(kind) ? t("ui.hintParty") : null,
    NO_LOG_KINDS.includes(kind) ? null : t("ui.hintLog"),
    NO_SAVE_KINDS.includes(kind) ? null : t("ui.hintSave"),
    NO_QUICKSAVE_KINDS.includes(kind) ? null : t("ui.hintQuicksave"),
    t("ui.hintQuit")
  );
}
```

- [ ] **Step 4: App — the full-log view and the key**

In `src/ui/app.ts`:

1. Fields: add `private chrome: BoxRenderable[]; private fullLogBox: BoxRenderable; private fullLogText: TextRenderable; private fullLogScroll: ScrollBoxRenderable; private fullLogJustOpened = false;`

2. Constructor — the header/progress/battlefield/body/log boxes are local consts. After `this.root.add(logBox);` and **before** the footer is created, add:

```ts
    this.chrome = [headerBox, progressBox, battlefieldBox, body, logBox];

    this.fullLogBox = new BoxRenderable(renderer, { id: "full-log-box", ...panel, flexGrow: 1, title: t("ui.panelFullLog", { count: RUN_LOG_SIZE }), visible: false });
    this.fullLogScroll = new ScrollBoxRenderable(renderer, {
      id: "full-log-scroll",
      width: "100%",
      height: "100%",
      scrollX: false,
      scrollY: true,
      stickyScroll: true,
      stickyStart: "bottom",
    });
    this.fullLogText = new TextRenderable(renderer, { id: "full-log", content: "", fg: PALETTE.dim });
    this.fullLogScroll.add(this.fullLogText);
    this.fullLogBox.add(this.fullLogScroll);
    this.root.add(this.fullLogBox);
```

3. `handleKey` — directly after the `Ctrl+C` check, add the whole log-screen handling. It sits before every other global key and before the reveal-skip check, so inside the log screen `q`/`s`/`b`/digits are swallowed (the screen's footer advertises only `Esc`, so nothing else may act) and `Esc` closes the screen even while a reveal is running:

```ts
    if (this.ui.kind === "fullLog") {
      if (key.name === "escape") {
        this.ui = this.ui.previous;
        this.render();
      } else if (this.fullLogScroll.handleKeyPress(key)) {
        this.render();
      }
      return;
    }
```

and after the quicksave (`key.name === "s"`) block, before the `if (this.reveal.active)` skip check, add the opener (`l` sits before the skip check on purpose: the footer advertises `[l] Log` during a reveal too, so it must work there; assign `this.ui` directly, as `saveMenu` does, so the list page is not reset):

```ts
    if (key.name === "l") {
      this.ui = { kind: "fullLog", previous: this.ui };
      this.fullLogJustOpened = true;
      this.render();
      return;
    }
```

4. `handleKey`'s big `switch (this.ui.kind)` — add `case "fullLog":` next to `case "gameover":` (`break;`). (`goBack` needs no `fullLog` case: Esc is handled above.)

5. `render()` — right after the `const focus = this.reveal.focus;` line add:

```ts
    const inFullLog = this.ui.kind === "fullLog";
    for (const box of this.chrome) box.visible = !inFullLog;
    this.fullLogBox.visible = inFullLog;
    if (inFullLog) {
      this.fullLogText.content = this.runLog.length === 0 ? t("ui.fullLogEmpty") : joinLines(logLines(this.runLog));
      if (this.fullLogJustOpened) {
        this.fullLogJustOpened = false;
        this.fullLogScroll.scrollTop = this.fullLogScroll.scrollHeight;
      }
      this.footer.content = joinLines([highlightKeyHints(composeFooter(t("ui.footerBackOnly"), this.ui.kind, false))]);
      return;
    }
```

6. `renderMain()` add `case "fullLog": return "";` and `renderFooter()` add `case "fullLog": return t("ui.footerBackOnly");` (both keep their `switch` exhaustive).

- [ ] **Step 5: Run the tests**

Run: `bun test test/keyHints.test.ts test/actionFocus.test.ts`
Expected: PASS. The key-hint grammar tests iterate every `ui.hint*` string and require `[key] Label`, so `[l] Log` is covered.

- [ ] **Step 6: Full suite, typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Check in the real TUI**

Per the `tui-testing` skill: press `l` on several screens (room, mid-combat, mid-reveal, game over). The log screen opens at the bottom of the log (if it opens at the top, the `scrollTop = scrollHeight` line needs to run after the next layout pass — move it into a `setTimeout(() => ..., 0)` followed by `this.render()`); `↑`/`↓` scroll; `Esc` returns to the screen you came from; a running reveal keeps going underneath; `s`/`q` do nothing inside the log; the footer never shows `[l] Log` while it is open.

- [ ] **Step 8: Commit** (only once the user has approved executing this plan)

```bash
git add src data test
git commit -m "Add the full run log screen on [l]"
```

---

### Task 7: Docs and final verification

**Files:**
- Modify: `docs/developer-guide.md`
- Delete (after the docs absorb it): `docs/specs/2026-10-07-battlefield-action-focus-design.md`, `docs/specs/2026-10-07-battlefield-action-focus-plan.md`

- [ ] **Step 1: Update the developer guide**

In `docs/developer-guide.md`:

1. Battlefield section (line ~133): change `**at least ~45-50\nlines tall**` to `**at least ~47-52\nlines tall**` (the icon band adds 2 rows), and add a paragraph after the "Below each sprite are 2 lines of text" paragraph:

```
Above the sprites sits a 2-row **icon band** (`ICON_BAND_ROWS`, `src/ui/layout.ts`): one
row of role icons, one blank row, so an icon never touches a sprite; each unit's icons are
centred over its own sprite (`spriteSlotLayout`, `src/ui/sprites.ts`). While a round resolves,
every unit outside the action being narrated is rendered grey (`dimColor`/`dimSprite`,
`src/ui/battlefieldFocus.ts`) and the participants wear icons — ⚔ attacker (also the caster of
a debuff-only skill), ⛨ attacked (hit or missed), ▼ debuffed by a skill with no damage,
▲ buffed, ✚ healed, ⚚ caster of a buff/heal. Blue marks the party, red the monsters, by the
side of the unit wearing the icon. Who those units are comes from `LogEntry.session`
(`LogSession`, built in `src/engine/logSession.ts` and attached by `resolveRound`); a summon is
recorded as its owner because it has no sprite. Round-start and round-end ticks (DoT, stat-mod
expiry, dying damage, artifact auto-damage) are one actor-less session per block that lights the
units whose tick logged, without icons.
```

2. Replace the **Log** bullet (lines ~145-151) with:

```
- **Log**: 8 lines tall, scrollable (`↑`/`↓`, `ScrollBoxRenderable`, sticks to the bottom).
  The box shows the **room log** — the latest 50 entries, cleared when the player enters
  another room. `[l]` opens the **run log** on its own screen (`fullLog`): the latest 500
  entries of the run, in memory only (a loaded save starts empty); only `Esc`, `↑`/`↓` and
  `Ctrl+C` work inside it. Combat rounds are revealed **by action**: each actor's turn is one
  session that stays on screen at least 1.5 s, its lines appear 0.1 s apart (a session with more
  than 15 lines lasts one tick per line), and lines with no session (combat start, rewards, toasts)
  appear at 0.1 s each with no hold. One clock drives everything (`RevealQueue`,
  `src/ui/revealQueue.ts`): each tick adds the log line, the HP/MP/coin snapshot it carries and the
  battlefield highlight in a single `App.render()`, so the screen can never be ahead of or behind
  the log. Any key skips straight to the end of the reveal, in one render.
```

3. Key hints R4 block (line ~208): `6. globals     [b] Party   [l] Log   [q] Save   [s] Quicksave   [Ctrl+C] Quit`.

4. R5 paragraph: change "`[q]`, `[s]`, `[b]` and `[Ctrl+C]` are handled centrally" to "`[q]`, `[s]`, `[b]`, `[l]` and `[Ctrl+C]`", and add: "On the log screen itself only `[Ctrl+C]` remains in the global group: `App.handleKey` swallows every other key there, so no save hint is shown."

5. File layout list: in the `ui/` section add `ui/revealQueue.ts`, `ui/battlefieldFocus.ts`, and `engine/logSession.ts` one-liners in the same format as their neighbours, and add `log` to the `ui/screens/` list.

- [ ] **Step 2: Docs sync**

Run: `bun run docs:sync --check`
Expected: no drift (these edits contain no data-mirrored numbers; 1.5 s / 0.1 s / 50 / 500 are UI constants, not `data/*.json`). If it flags one of them, restate it in words as the guide's "Docs sync" section prescribes.

- [ ] **Step 3: Remove the transient specs**

The spec and plan are transient (`docs/specs` convention): the lasting content now lives in the developer guide. Skip this step if the user wants to keep them until after review.

```bash
rm docs/specs/2026-10-07-battlefield-action-focus-design.md docs/specs/2026-10-07-battlefield-action-focus-plan.md
```

- [ ] **Step 4: Final verification**

Run: `bun test && bun run typecheck && bun run docs:sync --check`
Expected: all PASS. Then one last pass in the real TUI: a fight with a Mage (single target), a monster that attacks all, an Acolyte heal, a debuff-only skill, an Archer Overwatch, a poisoned unit — each shows the right icons in the same frame as its first log line; a quicksave mid-reveal does not move any HP number; a party wipe still plays out its last round before the game-over screen takes over the log.

- [ ] **Step 5: Self-review the tone of new strings**

`data/strings.json` additions are neutral UI labels (`[l] Log`, "Run log - latest 500 (↑/↓ to scroll)", "Nothing has happened yet."). Check they match the spare tone of the neighbouring strings; reword if not.

- [ ] **Step 6: Commit** (only once the user has approved executing this plan)

```bash
git add docs
git commit -m "Document the action-focused battlefield and run log"
```
