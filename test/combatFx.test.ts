import { describe, expect, test } from "bun:test";
import { COMBAT_FX, getBasicAttackVisual, getSkillAttackVisual, validateCombatFx } from "../src/data/combatFx";
import { applySkillEffects, snapshotCombatants, startCombat } from "../src/engine/combat";
import { runInSession } from "../src/engine/logSession";
import { resolveSkillEffect } from "../src/engine/resolver";
import { getSkill, getEffectiveSkill } from "../src/data/classes";
import type { LogEntry, SkillEffect } from "../src/types";
import { makeCtx, spawnInto } from "./helpers";
import { HIT_BEAT_TICKS, IMPACT_TICKS, RevealQueue } from "../src/ui/revealQueue";
import { paintCombatFx, type CombatFxAnchor } from "../src/ui/combatFx";
import { RGBA, type TextChunk } from "@opentui/core";
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
  test("melee skills have explicit styles while projectiles, magic and items have none", () => {
    expect(getSkillAttackVisual("slash")).toBe("slash");
    expect(getSkillAttackVisual("stab")).toBe("thrust");
    expect(getSkillAttackVisual("mace-strike")).toBe("blunt");
    for (const id of ["fireball", "knife-throw", "quick-shot", "summon-golem", "command"]) expect(getSkillAttackVisual(id)).toBeNull();
    expect(getSkillAttackVisual("slash", true)).toBeNull();
    expect(getBasicAttackVisual("monsters", "skeleton-archer")).toBeNull();
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
    for (const [id, visual] of [["slash", "slash"], ["stab", "thrust"], ["mace-strike", "blunt"], ["fireball", undefined], ["quick-shot", undefined]] as const) {
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
    setup.resize(180, 45);
    await setup.renderOnce();
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
