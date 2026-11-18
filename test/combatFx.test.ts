import { describe, expect, spyOn, test } from "bun:test";
import { COMBAT_FX, getBasicAttackVisual, getSkillAttackVisual, getStatusVisual, validateCombatFx } from "../src/data/combatFx";
import { applySkillEffects, commandedSkill, snapshotCombatants, startCombat, withBasicAttackOverride } from "../src/engine/combat";
import { runInSession } from "../src/engine/logSession";
import { applyStatusEffectToActor, expireStatusEffect, isHelpfulStatusEffect, resolveSkillEffect } from "../src/engine/resolver";
import { CLASSES, getSkill, getEffectiveSkill } from "../src/data/classes";
import { MONSTER_SKILLS, MONSTER_ARCHETYPES, spawnMonster } from "../src/data/monsters";
import { SUMMON_SKILLS, SUMMON_ARCHETYPES } from "../src/data/summons";
import { ITEMS } from "../src/data/items";
import { STATUS_EFFECTS } from "../src/data/statusEffects";
import type { LogEntry, SkillEffect } from "../src/types";
import { makeCtx, spawnInto } from "./helpers";
import { HIT_BEAT_TICKS, IMPACT_TICKS, RevealQueue } from "../src/ui/revealQueue";
import { paintCombatFx, type CombatFxAnchor } from "../src/ui/combatFx";
import { RGBA, type TextChunk, type TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { clearSlot, gameFromSave, loadSave, saveRun } from "../src/engine/save";
import { getRoom } from "../src/engine/dungeon";
import { spriteForMonster } from "../src/ui/sprites";

const background = (): TextChunk[][] => Array.from({ length: 20 }, () => [{ __isChunk: true, text: " ".repeat(113), bg: RGBA.fromHex("#171310") }]);
const anchor = (x: number, side: "party" | "monster"): CombatFxAnchor => ({ x, y: 7, side, sprite: { rows: ["AA.A", ".AA.", "AAAA"], palette: { A: "#778899" } } });

function fight() {
  const { ctx } = makeCtx(5);
  const target = spawnInto(ctx, "goblin");
  target.hp = target.maxHp = 10000;
  const source = ctx.party.find((c) => c.classId === "knight")!;
  const combat = startCombat("fx", [target.id], ctx, false);
  combat.log = [];
  return { ctx, source, target, combat };
}

describe("combat effect declarations", () => {
  test("melee, ranged, magic and item attacks have explicit styles", () => {
    expect(getSkillAttackVisual("slash")).toBe("slash");
    expect(getSkillAttackVisual("stab")).toBe("thrust");
    expect(getSkillAttackVisual("mace-strike")).toBe("blunt");
    expect(getSkillAttackVisual("fireball")).toBe("fireball");
    expect(getSkillAttackVisual("knife-throw")).toBe("knife");
    expect(getSkillAttackVisual("quick-shot")).toBe("arrow");
    expect(getSkillAttackVisual("pitch-bomb", true)).toBe("fire-flask");
    expect(getSkillAttackVisual("command")).toBeNull();
    expect(getSkillAttackVisual("slash", true)).toBeNull();
    expect(getBasicAttackVisual("monsters", "skeleton-archer")).toBe("arrow");
    expect(getBasicAttackVisual("monsters", "skeleton-warrior")).toBe("slash");
    expect(getBasicAttackVisual("summons", "stone-golem")).toBe("blunt");
  });

  test("rejects unknown content, unknown styles and invalid animation frames", () => {
    expect(() => validateCombatFx(COMBAT_FX)).not.toThrow();
    const unknown = structuredClone(COMBAT_FX);
    unknown.skills["missing-skill"] = "slash";
    expect(() => validateCombatFx(unknown)).toThrow("missing-skill");
    expect(() => validateCombatFx({ ...COMBAT_FX, flash: { ...COMBAT_FX.flash, frames: [] } })).toThrow();
    expect(() => validateCombatFx(JSON.parse(JSON.stringify({ ...COMBAT_FX, skills: { slash: "unknown" } })))).toThrow();
  });

  test("frame data rejects empty or uneven grids, missing palette colors and invalid offsets", () => {
    expect(COMBAT_FX.presets.thrust.frames).toBeArray();
    for (const patch of [{ rows: [] }, { rows: ["AA", "A"] }, { rows: ["?"] }, { offsetX: 0.5 }, { offsetY: NaN }]) {
      const file = structuredClone(COMBAT_FX);
      Object.assign(file.presets.thrust.frames[0]!, patch);
      expect(() => validateCombatFx(file)).toThrow();
    }
    const file = structuredClone(COMBAT_FX);
    file.presets.slash.frames = [];
    expect(() => validateCombatFx(file)).toThrow();
    const badColor = structuredClone(COMBAT_FX);
    badColor.presets.blunt.palette.A = "not-a-color";
    expect(() => validateCombatFx(badColor)).toThrow();
  });
});

describe("combat effect hit metadata", () => {
  test("the skill, rather than the actor's default weapon, selects the hit visual", () => {
    const { ctx, source, target, combat } = fight();
    for (const [id, visual] of [["slash", "slash"], ["stab", "thrust"], ["mace-strike", "blunt"], ["fireball", "fireball"], ["quick-shot", "arrow"]] as const) {
      combat.log = [];
      runInSession(combat, source.id, () => applySkillEffects({ ...getEffectiveSkill(getSkill(id), 1), alwaysHits: true }, source, [target], combat, ctx, combat.log));
      const hit = combat.log.find((e) => e.hit)?.hit;
      expect(hit).toMatchObject({ sourceId: source.id, targetId: target.id });
      expect(hit?.visual).toBe(visual);
    }
  });

  test("monster basics use their own style; ticks have no impact metadata", () => {
    const { source, target } = fight();
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "damage", amount: 2 }, target, source, { log, isCrit: false });
    expect(log.find((e) => e.hit)?.hit).toMatchObject({ sourceId: target.id, targetId: source.id, visual: "slash" });
    log.length = 0;
    resolveSkillEffect({ kind: "damage", amount: 2 }, source, source, { log, statusEffectName: "Poison" });
    expect(log.some((e) => e.hit)).toBe(false);
  });

  test("recording visual metadata does not consume RNG or alter damage", () => {
    const { source, target, ctx } = fight();
    const a = structuredClone(target), b = structuredClone(target);
    const rngBefore = ctx.rng.getState();
    const effect: SkillEffect = { kind: "damage", amount: 10 };
    const shown: LogEntry[] = [], hidden: LogEntry[] = [];
    resolveSkillEffect(effect, source, a, { log: shown, isCrit: false, attackVisual: "slash" });
    resolveSkillEffect(effect, source, b, { log: hidden, isCrit: false, attackVisual: null });
    expect(a).toEqual(b);
    expect(shown.map((e) => e.text)).toEqual(hidden.map((e) => e.text));
    expect(ctx.rng.getState()).toEqual(rngBefore);
  });

  test("a real cast uses the same damage and random stream with or without its visual", () => {
    const a = fight(), b = fight(), skill = { ...getSkill("slash"), alwaysHits: true };
    const visual = COMBAT_FX.basicAttacks.classes[a.source.classId]!;
    try {
      applySkillEffects(skill, a.source, [a.target], a.combat, a.ctx, a.combat.log);
      COMBAT_FX.basicAttacks.classes[a.source.classId] = null;
      applySkillEffects(skill, b.source, [b.target], b.combat, b.ctx, b.combat.log);
      expect(a.target.hp).toBe(b.target.hp);
      expect(a.ctx.rng.getState()).toEqual(b.ctx.rng.getState());
      expect(a.combat.log.map((e) => e.text)).toEqual(b.combat.log.map((e) => e.text));
      expect(a.combat.log.find((e) => e.hit)?.hit?.visual).toBe("slash");
      expect(b.combat.log.find((e) => e.hit)?.hit?.visual).toBeUndefined();
    } finally {
      COMBAT_FX.basicAttacks.classes[a.source.classId] = visual;
    }
  });

  test("a character's own basic attack reads its declared basic style", () => {
    const { ctx, source, target, combat } = fight();
    const visual = COMBAT_FX.basicAttacks.classes[source.classId]!;
    try {
      COMBAT_FX.basicAttacks.classes[source.classId] = null;
      applySkillEffects({ ...getSkill("slash"), alwaysHits: true }, source, [target], combat, ctx, combat.log);
      expect(combat.log.find((e) => e.hit)?.hit?.visual).toBeUndefined();
    } finally {
      COMBAT_FX.basicAttacks.classes[source.classId] = visual;
    }
  });

  test("missed casts never enqueue a weapon or impact effect", () => {
    const { ctx, source, target, combat } = fight();
    source.survival.fear = 100;
    ctx.rng.next = () => 0;
    runInSession(combat, source.id, () => applySkillEffects(getSkill("slash"), source, [target], combat, ctx, combat.log));
    expect(combat.log.some((e) => e.hit)).toBe(false);
    const queue = new RevealQueue();
    queue.enqueue(combat.log);
    while (queue.active) {
      queue.tick();
      expect(queue.attackFrames).toEqual([]);
    }
  });
});

describe("combat effect replay", () => {
  test("long authored flashes finish after the final hit before fear feedback begins", () => {
    const original = COMBAT_FX.flash.frames;
    try {
      COMBAT_FX.flash.frames = Array.from({ length: 20 }, () => original[0]!);
      const { combat, source, target } = fight();
      const first = { targetId: target.id, amount: 4 }, last = { targetId: target.id, amount: 5 };
      runInSession(combat, source.id, () => combat.log.push({ text: "one", kind: "attack", hit: first }, { text: "two", kind: "attack", hit: last }));
      combat.log[0]!.session!.fearChangedIds.push(source.id);
      const queue = new RevealQueue(), ages: number[] = [];
      queue.enqueue(combat.log);
      while (queue.active) {
        queue.tick();
        const frames = queue.attackFrames.filter((f) => f.impactAge >= 0);
        for (const frame of frames) if (frame.hit === last) ages.push(frame.impactAge);
        if (queue.fearBeat) expect(frames).toEqual([]);
      }
      expect(ages).toEqual(Array.from({ length: 20 }, (_, i) => i));
    } finally {
      COMBAT_FX.flash.frames = original;
    }
  });

  test("the JSON flash frame count determines its replay lifetime", () => {
    const original = COMBAT_FX.flash.frames;
    try {
      COMBAT_FX.flash.frames = [original[0]!, original[0]!, original[0]!];
      const { combat, source, target } = fight();
      runInSession(combat, source.id, () => combat.log.push({ text: "hit", kind: "attack", hit: { sourceId: source.id, targetId: target.id, amount: 4, visual: "slash" } }));
      const queue = new RevealQueue();
      queue.enqueue(combat.log);
      for (let i = 0; i <= IMPACT_TICKS + 2; i++) queue.tick();
      expect(queue.attackFrames[0]?.impactAge).toBe(2);
      queue.tick();
      expect(queue.attackFrames).toEqual([]);
    } finally {
      COMBAT_FX.flash.frames = original;
    }
  });

  test("prepares a hit before impact, flashes only at impact, then clears on flush", () => {
    const { combat, source, target } = fight();
    runInSession(combat, source.id, () => combat.log.push({ text: "hit", kind: "attack", hit: { sourceId: source.id, targetId: target.id, amount: 4, visual: "slash" } }));
    const queue = new RevealQueue();
    queue.enqueue(combat.log);
    queue.tick();
    expect(queue.attackFrames[0]).toMatchObject({ progress: 0, impactAge: -IMPACT_TICKS });
    for (let i = 1; i <= IMPACT_TICKS; i++) queue.tick();
    expect(queue.attackFrames[0]).toMatchObject({ progress: 1, impactAge: 0 });
    for (let i = 0; i < COMBAT_FX.flash.frames.length; i++) queue.tick();
    expect(queue.attackFrames).toEqual([]);
    queue.flush();
    expect(queue.attackFrames).toEqual([]);
  });

  test("AoE and multi-hit cues use each target's beat without repeating its last hit", () => {
    const { combat, source } = fight();
    runInSession(combat, source.id, () => {
      for (const targetId of ["a", "a", "b"]) combat.log.push({ text: "hit", kind: "attack", hit: { sourceId: source.id, targetId, amount: 4, visual: "thrust" } });
    });
    const queue = new RevealQueue();
    queue.enqueue(combat.log);
    for (let i = 0; i <= IMPACT_TICKS; i++) queue.tick();
    expect(queue.attackFrames.filter((f) => f.impactAge === 0).map((f) => f.hit.targetId)).toEqual(["a", "b"]);
    for (let i = 0; i < HIT_BEAT_TICKS; i++) queue.tick();
    expect(queue.attackFrames.filter((f) => f.impactAge === 0).map((f) => f.hit.targetId)).toEqual(["a"]);
  });

  test("old hit entries remain readable and a miss creates no effect", () => {
    const { combat, source } = fight();
    runInSession(combat, source.id, () => combat.log.push({ text: "miss", kind: "info" }));
    const queue = new RevealQueue();
    queue.enqueue(combat.log);
    queue.tick();
    expect(queue.attackFrames).toEqual([]);
    queue.flush();
    queue.enqueue([{ ...combat.log[0]!, hit: { amount: 5, targetId: "old" } }]);
    for (let i = 0; i <= IMPACT_TICKS; i++) queue.tick();
    expect(queue.attackFrames[0]?.hit).toEqual({ amount: 5, targetId: "old" });
  });
});

describe("terminal combat effect painting", () => {
  test("JSON frame pixels, colors and offsets fully determine a weapon's appearance", () => {
    expect(COMBAT_FX.presets.thrust.frames).toBeArray();
    const original = COMBAT_FX.presets.thrust;
    try {
      COMBAT_FX.presets.thrust = {
        palette: { A: "#123456", B: "#abcdef" },
        frames: [{ offsetX: -2, offsetY: -1, rows: ["A."] }, { offsetX: 1, offsetY: 1, rows: [".B"] }],
      };
      for (const reverse of [false, true]) {
        const target = anchor(50, "monster"), sign = reverse ? -1 : 1;
        const anchors = new Map([["source", anchor(reverse ? 90 : 5, "party")], ["target", target]]);
        const hit = { sourceId: "source", targetId: "target", amount: 8, visual: "thrust" as const };
        const first = paintCombatFx(background(), anchors, [{ hit, progress: 0, impactAge: -5 }]);
        const last = paintCombatFx(background(), anchors, [{ hit, progress: 1, impactAge: -1 }]);
        expect(first[7]![52 - 2 * sign]!.bg?.equals(RGBA.fromHex("#123456"))).toBe(true);
        expect(last[9]![52 + 2 * sign]!.bg?.equals(RGBA.fromHex("#abcdef"))).toBe(true);
      }
    } finally {
      COMBAT_FX.presets.thrust = original;
    }
  });

  test("JSON flash frames choose tint or transparency independently for each side", () => {
    expect(COMBAT_FX.flash.frames).toBeArray();
    const original = COMBAT_FX.flash.frames;
    try {
      COMBAT_FX.flash.frames = [{ partyColor: "#123456", monsterColor: "#abcdef" }, { partyColor: null, monsterColor: null }];
      for (const [side, color] of [["party", "#123456"], ["monster", "#abcdef"]] as const) {
        const anchors = new Map([["target", anchor(20, side)]]), hit = { targetId: "target", amount: 8 }, base = background();
        expect(paintCombatFx(base, anchors, [{ hit, progress: 1, impactAge: 0 }])[7]![20]!.bg?.equals(RGBA.fromHex(color))).toBe(true);
        expect(paintCombatFx(base, anchors, [{ hit, progress: 1, impactAge: 1 }])).toEqual(base);
      }
    } finally {
      COMBAT_FX.flash.frames = original;
    }
  });

  test("all three attacks animate in both directions, remain in bounds and leave base rows unchanged", () => {
    for (const reverse of [false, true]) {
      const anchors = new Map([["source", anchor(reverse ? 75 : 5, reverse ? "monster" : "party")], ["target", anchor(reverse ? 5 : 75, reverse ? "party" : "monster")]]);
      for (const visual of ["thrust", "slash", "blunt"] as const) {
        const base = background(), before = structuredClone(base.map((r) => r.map((c) => c.text)));
        const hit = { sourceId: "source", targetId: "target", amount: 8, visual };
        const early = paintCombatFx(base, anchors, [{ hit, progress: 0, impactAge: -5 }]);
        const late = paintCombatFx(base, anchors, [{ hit, progress: 1, impactAge: -1 }]);
        expect(early).not.toEqual(late);
        expect(base.map((r) => r.map((c) => c.text))).toEqual(before);
        expect(late.every((r) => r.reduce((n, c) => n + c.text.length, 0) === 113)).toBe(true);
        expect(late[0]).toEqual(base[0]);
        expect(late[18]).toEqual(base[18]);
      }
    }
  });

  test("damage flashes only opaque sprite cells, not empty cells, labels or overkill", () => {
    const base = background(), unit = anchor(20, "party"), anchors = new Map([["target", unit]]);
    const hit = { targetId: "target", amount: 8 };
    const painted = paintCombatFx(base, anchors, [{ hit, progress: 1, impactAge: 0 }]);
    expect(painted[7]![20]!.bg?.equals(RGBA.fromHex(COMBAT_FX.flash.frames[0]!.partyColor!))).toBe(true);
    expect(painted[7]![22]!.bg?.equals(RGBA.fromHex("#171310"))).toBe(true);
    expect(painted[18]).toBe(base[18]);
    expect(paintCombatFx(base, anchors, [{ hit: { ...hit, overkill: 8 }, progress: 1, impactAge: 0 }])).toEqual(base);
    expect(paintCombatFx(base, anchors, [])).toBe(base);
    expect(paintCombatFx(base, new Map(), [{ hit, progress: 1, impactAge: 0 }])).toEqual(base);
  });
});

test("App paints the impact and removes it even when the battlefield base is cached", async () => {
  const setup = await createTestRenderer({ width: 150, height: 45 });
  try {
    const game = new Game(7, ["knight", "mage", "rogue", "acolyte"]);
    game.state.pendingGatekeeper = false;
    const target = spawnInto(game.ctx, "goblin");
    target.hp = target.maxHp = 1000;
    const source = game.state.party[0]!;
    const combat = startCombat(game.state.currentRoomId, [target.id], game.ctx, false);
    game.state.combat = combat;
    const app = new App(setup.renderer, game, { autoReveal: false });
    await setup.renderOnce();
    combat.roundStartSnapshot = snapshotCombatants(combat, game.ctx);
    runInSession(combat, source.id, () => applySkillEffects({ ...getSkill("slash"), alwaysHits: true }, source, [target], combat, game.ctx, combat.log), { snapshot: () => snapshotCombatants(combat, game.ctx) });
    app.tickReveal();
    for (let i = 0; i < IMPACT_TICKS; i++) app.tickReveal();
    await setup.renderOnce();
    const flash = RGBA.fromHex(COMBAT_FX.flash.frames[0]!.monsterColor!);
    const count = () => setup.captureSpans().lines.reduce((sum, row) => sum + row.spans.filter((s) => s.bg.equals(flash)).reduce((n, s) => n + s.width, 0), 0);
    expect(count()).toBeGreaterThan(0);
    for (let i = 0; i < COMBAT_FX.flash.frames.length; i++) app.tickReveal();
    await setup.renderOnce();
    expect(count()).toBe(0);
    while (app.debugRevealActive) app.tickReveal();
    await setup.renderOnce();
    expect(count()).toBe(0);
    const battlefield = setup.renderer.root.findDescendantById("battlefield") as TextRenderable;
    const writeBattlefield = spyOn(battlefield["textBuffer"], "setStyledText");
    for (let i = 0; i < 20; i++) app.tickReveal();
    const idleWrites = writeBattlefield.mock.calls.length;
    setup.resize(180, 45);
    await setup.renderOnce();
    const resizeWrites = writeBattlefield.mock.calls.length - idleWrites;
    writeBattlefield.mockRestore();
    expect(idleWrites).toBe(0);
    expect(resizeWrites).toBe(1);
    expect(count()).toBe(0);
    const beforeDeath = snapshotCombatants(combat, game.ctx);
    source.hp = 1;
    combat.roundStartSnapshot = beforeDeath.map((s) => s.id === source.id ? { ...s, hp: 1 } : s);
    runInSession(combat, target.id, () => resolveSkillEffect({ kind: "damage", amount: 10000 }, target, source, { log: combat.log, isCrit: false }), { snapshot: () => snapshotCombatants(combat, game.ctx) });
    app.tickReveal();
    for (let i = 0; i < IMPACT_TICKS; i++) app.tickReveal();
    await setup.renderOnce();
    const red = RGBA.fromHex(COMBAT_FX.flash.frames[0]!.partyColor!);
    expect(setup.captureSpans().lines.some((row) => row.spans.some((s) => s.bg.equals(red)))).toBe(true);
    for (let i = 0; i < COMBAT_FX.flash.frames.length; i++) app.tickReveal();
    await setup.renderOnce();
    expect(setup.captureSpans().lines.some((row) => row.spans.some((s) => s.bg.equals(red)))).toBe(false);
    expect(source.isAlive).toBe(false);
    setup.mockInput.pressKey("space");
    await setup.renderOnce();
    expect(app.debugRevealActive).toBe(false);
    expect(setup.captureSpans().lines.some((row) => row.spans.some((s) => s.bg.equals(red)))).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("a summoned unit receives its hit flash on its owner's sprite", async () => {
  const setup = await createTestRenderer({ width: 150, height: 45 });
  try {
    const game = new Game(7, ["knight", "mage", "summoner", "acolyte"]);
    game.state.pendingGatekeeper = false;
    const target = spawnInto(game.ctx, "goblin");
    const owner = game.state.party[2]!;
    const combat = startCombat(game.state.currentRoomId, [target.id], game.ctx, false);
    game.state.combat = combat;
    const summon = applySkillEffects(getEffectiveSkill(getSkill("summon-golem"), 1), owner, [owner], combat, game.ctx, combat.log)!;
    expect(summon.ownerId).toBe(owner.id);
    const app = new App(setup.renderer, game, { autoReveal: false });
    while (app.debugRevealActive) app.tickReveal();
    combat.roundStartSnapshot = snapshotCombatants(combat, game.ctx);
    runInSession(combat, target.id, () => resolveSkillEffect({ kind: "damage", amount: 1 }, target, summon, { log: combat.log, isCrit: false }), { snapshot: () => snapshotCombatants(combat, game.ctx) });
    app.tickReveal();
    for (let i = 0; i < IMPACT_TICKS; i++) app.tickReveal();
    await setup.renderOnce();
    const red = RGBA.fromHex(COMBAT_FX.flash.frames[0]!.partyColor!);
    expect(setup.captureSpans().lines.some((row) => row.spans.some((s) => s.bg.equals(red)))).toBe(true);
    setup.mockInput.pressKey("space");
    await setup.renderOnce();
    expect(app.debugRevealActive).toBe(false);
    expect(setup.captureSpans().lines.some((row) => row.spans.some((s) => s.bg.equals(red)))).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("a multi-hit kill keeps the living sprite between hits but never revives it for pure overkill", async () => {
  const setup = await createTestRenderer({ width: 150, height: 45 });
  try {
    const game = new Game(7, ["knight", "mage", "rogue", "acolyte"]);
    game.state.pendingGatekeeper = false;
    const target = spawnInto(game.ctx, "goblin"), source = game.state.party[0]!;
    target.hp = target.maxHp = 20;
    const combat = startCombat(game.state.currentRoomId, [target.id], game.ctx, false);
    game.state.combat = combat;
    const app = new App(setup.renderer, game, { autoReveal: false });
    combat.roundStartSnapshot = snapshotCombatants(combat, game.ctx);
    const hit = { sourceId: source.id, targetId: target.id, amount: 10, visual: "thrust" as const };
    runInSession(combat, source.id, () => {
      target.hp = 0;
      combat.log.push({ text: "first", kind: "attack", hit }, { text: "fatal", kind: "attack", hit }, { text: "overkill", kind: "attack", hit: { ...hit, overkill: 10 } });
    }, { snapshot: () => snapshotCombatants(combat, game.ctx) });
    const sprite = spriteForMonster(target.archetypeId, target.tier);
    const head = [...sprite.rows[0]!].find((c) => c !== ".")!;
    const color = RGBA.fromHex(sprite.palette[head]!);
    const hasBody = () => setup.captureSpans().lines.some((row) => {
      let x = 0;
      return row.spans.some((span) => { const from = x; x += span.width; return from < 112 && x > 70 && span.bg.equals(color); });
    });
    app.tickReveal();
    for (let i = 0; i < IMPACT_TICKS + COMBAT_FX.flash.frames.length; i++) app.tickReveal();
    await setup.renderOnce();
    expect(hasBody()).toBe(true);
    for (let i = 0; i < HIT_BEAT_TICKS; i++) app.tickReveal();
    await setup.renderOnce();
    expect(hasBody()).toBe(false);
    for (let i = 0; i < HIT_BEAT_TICKS; i++) app.tickReveal();
    await setup.renderOnce();
    expect(hasBody()).toBe(false);
  } finally {
    setup.renderer.destroy();
  }
});

test("a mid-fight save keeps hit metadata and old logs still load without replaying", async () => {
  const setup = await createTestRenderer({ width: 150, height: 45 });
  try {
    const game = new Game(7, ["knight", "mage", "rogue", "acolyte"]);
    game.currentSaveSlot = "slot5";
    game.state.pendingGatekeeper = false;
    const target = spawnInto(game.ctx, "goblin");
    target.hp = target.maxHp = 1000;
    getRoom(game.state.floor, game.state.currentRoomId).monsterIds = [target.id];
    const source = game.state.party[0]!;
    const combat = startCombat(game.state.currentRoomId, [target.id], game.ctx, false);
    game.state.combat = combat;
    runInSession(combat, source.id, () => applySkillEffects({ ...getSkill("slash"), alwaysHits: true }, source, [target], combat, game.ctx, combat.log), { snapshot: () => snapshotCombatants(combat, game.ctx) });
    saveRun(game);
    const saved = loadSave("slot5");
    expect(saved.state.combat!.log.find((e) => e.hit)?.hit?.visual).toBe("slash");
    const old = structuredClone(saved);
    for (const e of old.state.combat!.log) if (e.hit) { delete e.hit.sourceId; delete e.hit.visual; }
    const restored = gameFromSave(old, "slot5");
    const app = new App(setup.renderer, restored, { autoReveal: false });
    await setup.renderOnce();
    expect(app.debugRevealActive).toBe(false);
  } finally {
    setup.renderer.destroy();
    clearSlot("slot5");
  }
});

describe("healing and status outcome effects", () => {
  test("heals and mana restoration cue only the actual amount restored", () => {
    const { source } = fight();
    const log: LogEntry[] = [];
    source.hp = source.maxHp;
    resolveSkillEffect({ kind: "heal", amount: 10 }, source, source, { log, isCrit: false });
    expect(log.at(-1)?.effect).toBeUndefined();
    source.hp -= 3;
    resolveSkillEffect({ kind: "heal", amount: 10 }, source, source, { log, isCrit: false });
    expect(log.at(-1)?.effect).toMatchObject({ targetId: source.id, visual: "heal" });
    source.mp = source.maxMp - 2;
    resolveSkillEffect({ kind: "restoreMp", amount: 10 }, source, source, { log });
    expect(log.at(-1)?.effect).toMatchObject({ targetId: source.id, visual: "mana" });
    resolveSkillEffect({ kind: "restoreMp", amount: 10 }, source, source, { log });
    expect(log.at(-1)?.effect).toBeUndefined();
  });

  test("successful status application and refresh cue the target; natural expiry is not a cleanse", () => {
    const { source, target } = fight();
    const log: LogEntry[] = [];
    applyStatusEffectToActor(target, "weakened", 2, { log });
    expect(log.at(-1)?.effect).toMatchObject({ targetId: target.id, visual: getStatusVisual("weakened", false) });
    applyStatusEffectToActor(target, "weakened", 2, { log });
    expect(log.at(-1)?.effect).toMatchObject({ targetId: target.id });
    expireStatusEffect(target, target.activeStatusEffects[0]!, { log });
    expect(log.at(-1)?.effect).toBeUndefined();
    resolveSkillEffect({ kind: "removeStatusEffect" }, source, target, { log });
    expect(log.at(-1)?.effect).toBeUndefined();
    applyStatusEffectToActor(target, "weakened", 2, { log });
    resolveSkillEffect({ kind: "removeStatusEffect" }, source, target, { log });
    expect(log.at(-1)?.effect).toMatchObject({ targetId: target.id, visual: "cleanse" });
    applyStatusEffectToActor(source, "fortify", 2, { log });
    expect(log.at(-1)?.effect).toMatchObject({ targetId: source.id });
    resolveSkillEffect({ kind: "removeStatusEffect", statusEffectId: "fortify" }, target, source, { log });
    expect(log.at(-1)?.effect).toMatchObject({ targetId: source.id, visual: "dispel" });
  });

  test("successful support cues replay once per target and visual and finish before fear", () => {
    const { combat, source } = fight();
    const effect = { targetId: source.id, visual: "heal" };
    runInSession(combat, source.id, () => combat.log.push({ text: "heal", kind: "heal", effect }, { text: "same heal", kind: "heal", effect }));
    combat.log[0]!.session!.fearChangedIds.push(source.id);
    const queue = new RevealQueue();
    queue.enqueue(combat.log);
    for (let i = 0; i <= IMPACT_TICKS; i++) queue.tick();
    expect(queue.supportFrames).toHaveLength(1);
    const duration = COMBAT_FX.presets.heal!.ticks!;
    for (let i = 1; i < duration; i++) { queue.tick(); expect(queue.supportFrames).toHaveLength(1); }
    queue.tick();
    expect(queue.supportFrames).toEqual([]);
    queue.flush();
    expect(queue.supportFrames).toEqual([]);
  });

  test("projectile positions follow source-to-target distance in both directions", () => {
    for (const reverse of [false, true]) {
      const anchors = new Map([["source", anchor(reverse ? 80 : 10, "party")], ["target", anchor(reverse ? 10 : 80, "monster")]]);
      const config = structuredClone(COMBAT_FX);
      config.presets.arrow = { placement: "projectile", palette: { A: "#123456" }, frames: [{ offsetX: 0, offsetY: 0, rows: ["A"] }] };
      const hit = { targetId: "target", sourceId: "source", amount: 10, visual: "arrow" };
      const paintedX = (p: number) => paintCombatFx(background(), anchors, [{ hit, progress: p, impactAge: -1 }], 0, config)[8]!.findIndex((cell) => cell.bg?.equals(RGBA.fromHex("#123456")));
      expect(paintedX(0)).toBe((reverse ? 80 : 10) + 2);
      expect(paintedX(0.5)).toBe(47);
      expect(paintedX(1)).toBe((reverse ? 10 : 80) + 2);
    }
  });
});

test("catalog visuals accept explicit choices and supported game defaults", () => {
  const defaults = structuredClone(COMBAT_FX);
  delete defaults.skills.slash;
  defaults.skills.fireball = null;
  delete defaults.statuses.weakened;
  delete defaults.basicAttacks.classes.mage;
  defaults.basicAttacks.classes.knight = null;
  defaults.items["pitch-bomb"] = null;
  for (const file of [COMBAT_FX, defaults]) {
    expect(() => validateCombatFx(file)).not.toThrow();
    for (const skill of [...CLASSES.flatMap((c) => c.skills), ...MONSTER_SKILLS, ...SUMMON_SKILLS]) {
      const visual = file.skills[skill.id];
      if (visual != null) expect(file.presets[visual]).toBeDefined();
    }
    for (const item of ITEMS) {
      const visual = file.items[item.id];
      if (visual != null) expect(file.presets[visual]).toBeDefined();
    }
    for (const [kind, catalog] of [["classes", CLASSES], ["monsters", MONSTER_ARCHETYPES], ["summons", SUMMON_ARCHETYPES]] as const) {
      for (const entry of catalog) {
        const visual = file.basicAttacks[kind][entry.id];
        if (visual != null) expect(file.presets[visual]).toBeDefined();
      }
    }
    for (const status of STATUS_EFFECTS) {
      const visual = file.statuses[status.id] ?? file.outcomes[isHelpfulStatusEffect(status) ? "buff" : "debuff"];
      expect(file.presets[visual]).toBeDefined();
    }
  }
});

test("an immune status and a resisted debuff do not emit success cues", () => {
  const { source, combat, ctx } = fight();
  const immune = spawnInto(ctx, "swamp-slime");
  resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, source, immune, { log: combat.log });
  expect(combat.log.some((entry) => entry.effect)).toBe(false);
  const resisted = spawnInto(ctx, "goblin");
  const skill = { ...getSkill("breach"), effects: [{ kind: "applyStatusEffect" as const, statusEffectId: "weakened", chance: 0 }], alwaysHits: true };
  combat.log = [];
  applySkillEffects(skill, source, [resisted], combat, ctx, combat.log);
  expect(combat.log.some((entry) => entry.effect)).toBe(false);
});

test("a Command and a replaced basic attack preserve the executed visual identity", () => {
  const { source, target, combat, ctx } = fight();
  const owner = ctx.party.find((c) => c.classId === "summoner") ?? source;
  const summon = applySkillEffects(getEffectiveSkill(getSkill("summon-golem"), 1), owner, [owner], combat, ctx, combat.log)!;
  const command = commandedSkill(getSkill("command"), summon, "rock-throw");
  combat.log = [];
  applySkillEffects({ ...command, alwaysHits: true }, owner, [target], combat, ctx, combat.log);
  expect(combat.log.find((entry) => entry.hit)?.hit?.visual).toBe("rock");
  applyStatusEffectToActor(source, "cleansing-light", 2, { log: [] });
  const basic = withBasicAttackOverride(getSkill("slash"), source);
  combat.log = [];
  applySkillEffects({ ...basic, alwaysHits: true }, source, [target], combat, ctx, combat.log);
  expect(combat.log.find((entry) => entry.hit)?.hit?.visual).toBe("holy");
});

test("support effects follow their originating hit beat and do not replay before it", () => {
  const { combat, source, target } = fight();
  const effect = { targetId: source.id, visual: "heal" };
  runInSession(combat, source.id, () => combat.log.push(
    { text: "first", kind: "attack", hit: { targetId: target.id, amount: 1 } },
    { text: "second", kind: "attack", hit: { targetId: target.id, amount: 1 } },
    { text: "lifesteal", kind: "heal", effect },
  ));
  const queue = new RevealQueue(); queue.enqueue(combat.log);
  for (let i = 0; i <= IMPACT_TICKS; i++) queue.tick();
  expect(queue.supportFrames).toEqual([]);
  for (let i = 0; i < HIT_BEAT_TICKS; i++) queue.tick();
  expect(queue.supportFrames).toMatchObject([{ effect, age: 0 }]);
});

test("support painting is visible on opaque or empty cells but never mutates the cached battlefield", () => {
  const base = background(), before = structuredClone(base.map((row) => row.map((cell) => cell.text)));
  const anchors = new Map([["ally", anchor(20, "party")]]);
  const config = structuredClone(COMBAT_FX);
  config.presets.heal = { phase: "impact", ticks: 3, palette: { A: "#123456" }, frames: [{ offsetX: 0, offsetY: 0, rows: ["A"] }] };
  const painted = paintCombatFx(base, anchors, [], 0, config, [{ effect: { targetId: "ally", visual: "heal" }, age: 0 }]);
  expect(painted[8]![22]!.bg?.equals(RGBA.fromHex("#123456"))).toBe(true);
  expect(base.map((row) => row.map((cell) => cell.text))).toEqual(before);
  expect(paintCombatFx(base, anchors, [], 0, config, [{ effect: { targetId: "ally", visual: "heal" }, age: 3 }])).toEqual(base);
});

test.each(["vampiric-fang", "bloodthirsty-blade", "reapers-covenant"])("artifact recovery from %s receives an actual heal cue", (artifactId) => {
  const { source, target, combat, ctx } = fight();
  source.equippedArtifactIds.push(artifactId);
  source.hp = 1;
  target.hp = 1;
  runInSession(combat, source.id, () => applySkillEffects({ ...getSkill("slash"), effects: [{ kind: "damage", amount: 100 }], alwaysHits: true }, source, [target], combat, ctx, combat.log));
  const heals = combat.log.filter((entry) => entry.kind === "heal");
  expect(heals.length).toBeGreaterThan(0);
  expect(heals.every((entry) => entry.effect?.targetId === source.id && entry.effect.visual === COMBAT_FX.outcomes.heal)).toBe(true);
});

test("breaking a shell on a later hit schedules its debuff at that hit", () => {
  const { source, combat, ctx } = fight();
  const target = spawnMonster("ancient-golem", 1, { tier: "boss" });
  ctx.monsters.push(target);
  target.hp = target.maxHp = 10000;
  target.shell = { state: "intact", hitsLeft: 2, ownTurnsSinceBreak: 0 };
  runInSession(combat, source.id, () => {
    resolveSkillEffect({ kind: "damage", amount: 10 }, source, target, { log: combat.log, isCrit: false });
    resolveSkillEffect({ kind: "damage", amount: 10 }, source, target, { log: combat.log, isCrit: false });
  });
  const queue = new RevealQueue(); queue.enqueue(combat.log);
  for (let i = 0; i <= IMPACT_TICKS; i++) queue.tick();
  expect(queue.supportFrames).toEqual([]);
  for (let i = 0; i < HIT_BEAT_TICKS; i++) queue.tick();
  expect(queue.supportFrames.some((frame) => frame.effect.visual === getStatusVisual("stunned", false))).toBe(true);
});

test("Breach vulnerability has a debuff visual rather than a positive buff", () => {
  for (const id of ["breached", "breached-ii", "breached-iii"]) expect(getStatusVisual(id, false)).toBe(COMBAT_FX.outcomes.debuff);
});

test("a lower-rank status at the higher rank's cap has no success cue", () => {
  const { target } = fight();
  const log: LogEntry[] = [];
  applyStatusEffectToActor(target, "poisoned-iii", 3, { log });
  const before = structuredClone(target.activeStatusEffects);
  log.length = 0;
  applyStatusEffectToActor(target, "poisoned", 3, { log });
  expect(target.activeStatusEffects).toEqual(before);
  expect(log.some((entry) => entry.effect)).toBe(false);
});

test("an automatic passive threshold exit is not an explicit dispel", () => {
  const { ctx, target, combat } = fight();
  const source = new Game(7, ["viking", "mage", "rogue", "acolyte"]).state.party[0]!;
  source.level = 35;
  source.hp = source.maxHp;
  applyStatusEffectToActor(source, "bloodrage-iii", 99, { log: [] });
  applySkillEffects({ ...getSkill("axe-slash"), alwaysHits: true }, source, [target], combat, ctx, combat.log);
  expect(source.activeStatusEffects.some((s) => s.statusEffectId.startsWith("bloodrage"))).toBe(false);
  expect(combat.log.some((entry) => entry.effect?.visual === COMBAT_FX.outcomes.dispel)).toBe(false);
});

test("damage type mappings reject missing or misspelled keys", () => {
  const draft = JSON.parse(JSON.stringify(COMBAT_FX));
  draft.damageTypes.hloy = draft.damageTypes.holy;
  delete draft.damageTypes.holy;
  expect(() => validateCombatFx(draft)).toThrow();
});

test("beam tiles repeat native pixels and transparency, mirror, and clip the final tile", () => {
  const config = structuredClone(COMBAT_FX);
  config.presets.lightning = { placement: "beam", palette: { A: "#123456", B: "#234567", C: "#345678" }, frames: [{ offsetX: 0, offsetY: 0, rows: ["ABC", "C.A"] }] };
  for (const distance of [0, 1, 2, 3, 4, 19, 60]) for (const reverse of [false, true]) {
    const source = anchor(reverse ? 5 + distance : 5, "party"), target = anchor(reverse ? 5 : 5 + distance, "monster");
    const base = background(), anchors = new Map([["source", source], ["target", target]]);
    const result = paintCombatFx(base, anchors, [{ hit: { sourceId: "source", targetId: "target", amount: 8, visual: "lightning" }, progress: 0, impactAge: -1 }], 0, config);
    const at = (x: number, y: number) => result[y]!.flatMap((chunk) => Array.from(chunk.text, () => chunk.bg))[x];
    const sign = reverse ? -1 : 1;
    for (let step = 0; step <= distance; step++) for (const [row, pattern] of ["ABC", "C.A"].entries()) {
      const key = pattern[step % 3]!;
      expect(at(source.x + 2 + sign * step, 8 + row)?.equals(RGBA.fromHex(key === "." ? "#171310" : config.presets.lightning.palette[key]!))).toBe(true);
    }
    expect(at(source.x + 2 + sign * (distance + 1), 8)?.equals(RGBA.fromHex("#171310"))).toBe(true);
    expect(base[8]).toHaveLength(1);
  }
});

test("authored beam segments have matching edges and no empty columns at every frame", () => {
  for (const preset of Object.values(COMBAT_FX.presets).filter((p) => p.placement === "beam")) for (const frame of preset.frames) {
    expect(frame.rows.map((row) => row[0])).toEqual(frame.rows.map((row) => row.at(-1)));
    for (let x = 0; x < frame.rows[0]!.length; x++) expect(frame.rows.some((row) => row[x] !== ".")).toBe(true);
  }
});
