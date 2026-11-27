import { describe, expect, spyOn, test } from "bun:test";
import { COMBAT_FX, getBasicAttackVisual, getReactionVisual, validateEffectAnimation, getStatusVisual, validateCombatFx } from "../src/data/combatFx";
import { applySkillEffects, autoResolveTargets, commandedSkill, queueAction, queueCommand, resolveRound, snapshotCombatants, spawnAdditionalSummon, startCombat, withBasicAttackOverride } from "../src/engine/combat";
import { noteDotEffect, noteSkillTarget, runInSession, runTicksInSession } from "../src/engine/logSession";
import { applyStatusEffectToActor, expireStatusEffect, isHelpfulStatusEffect, resolveSkillEffect, tickDotEffects } from "../src/engine/resolver";
import { CLASSES, getSkill, getEffectiveSkill } from "../src/data/classes";
import { MONSTER_SKILLS, MONSTER_ARCHETYPES, spawnMonster } from "../src/data/monsters";
import { SUMMON_SKILLS, SUMMON_ARCHETYPES, getSummonArchetype } from "../src/data/summons";
import { ITEMS } from "../src/data/items";
import { ARTIFACTS } from "../src/data/artifacts";
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
import { MIN_TERMINAL_WIDTH, SLOT_GAP, SLOT_WIDTH, UNIT_BLOCK_HEIGHT } from "../src/ui/layout";
import { spriteForClass, spriteForMonster, spriteForSummon } from "../src/ui/sprites";

const summonLabel = (summon: { archetypeId: string }): string => getSummonArchetype(summon.archetypeId).abbr;

test("reaction selection preserves explicit null and per-status tick fallback", () => {
  expect(getReactionVisual("damageOverTime", "hexed", "poisoned")).toBe("hexed");
  expect(getReactionVisual("damageOverTime", null, "poisoned")).toBeNull();
  expect(getReactionVisual("damageOverTime", undefined, "poisoned")).toBe(COMBAT_FX.statuses.poisoned!);
  expect(getReactionVisual("woundOnHit")).toBe("deep-wound");
});

test("every damaging status tick emits an overlay without a direct hit", () => {
  for (const status of STATUS_EFFECTS.filter((entry) => entry.perTurnEffects.some((effect) => effect.kind === "damage"))) {
    const { source } = fight();
    source.hp = source.maxHp = 10000;
    const log: LogEntry[] = [];
    applyStatusEffectToActor(source, status.id, 3, { log });
    log.length = 0;
    tickDotEffects(source, { log });
    const damage = log.find((entry) => entry.kind === "attack");
    expect(damage?.hit).toBeUndefined();
    expect(damage?.effect).toMatchObject({ targetId: source.id, visual: status.perTurnEffects.find((e) => e.kind === "damage")!.animation });
    expect(damage?.effect?.damage).toBeGreaterThan(0);
  }
});

test("damage ticks respect No effect and do not animate when no HP was lost", () => {
  const { source } = fight(), log: LogEntry[] = [];
  resolveSkillEffect({ kind: "damage", amount: 5, animation: null }, source, source, { log, statusEffectName: "Poisoned" });
  expect(log.some((entry) => entry.effect || entry.hit)).toBe(false);
  source.hp = 0;
  log.length = 0;
  resolveSkillEffect({ kind: "damage", amount: 5, animation: "hexed" }, source, source, { log, statusEffectName: "Hexed" });
  expect(log.some((entry) => entry.effect || entry.hit)).toBe(false);
});

test("wound and reflected damage emit separate cues on the actual recipients", () => {
  const { source, target } = fight();
  const log: LogEntry[] = [];
  source.hp = source.maxHp = 10000;
  applyStatusEffectToActor(target, "deep-wound", 3, { log });
  applyStatusEffectToActor(target, "riposte", 3, { log });
  log.length = 0;
  resolveSkillEffect({ kind: "damage", amount: 100, offenseMultiplierPercent: 0 }, source, target, { log, isCrit: false });
  expect(log.filter((e) => e.hit)).toHaveLength(1);
  expect(log.filter((e) => e.effect).map((e) => [e.effect!.targetId, e.effect!.visual])).toEqual([[target.id, "deep-wound"], [source.id, "reflect"]]);
  expect(log.filter((e) => e.effect).every((e) => e.effect!.damage! > 0)).toBe(true);
});

test("damage overlays keep lethal recipients alive visually and queue in result order", () => {
  const { ctx, source, target, combat } = fight();
  runInSession(combat, source.id, () => {
    combat.log.push({ text: "first", kind: "attack", effect: { targetId: target.id, sourceId: source.id, visual: "hexed", damage: 5 } });
    combat.log.push({ text: "second", kind: "attack", effect: { targetId: target.id, sourceId: source.id, visual: "deep-wound", damage: 5 } });
  }, { snapshot: () => snapshotCombatants(combat, ctx) });
  const queue = new RevealQueue();
  queue.enqueue(combat.log);
  const shown: string[] = [];
  for (let i = 0; queue.active && i < 200; i++) {
    queue.tick();
    for (const frame of queue.supportFrames) {
      if (frame.age === 0) shown.push(frame.effect.visual);
      expect(queue.receivingDamageIds.has(target.id)).toBe(true);
    }
  }
  expect(shown).toEqual(["hexed", "deep-wound"]);
  expect(queue.receivingDamageIds.size).toBe(0);
  queue.flush();
  expect(queue.supportFrames).toEqual([]);
});

test("counterattacks, area follow-ups and Venomcraft keep their own impact visual", () => {
  const { ctx, source, target, combat } = fight();
  source.hp = source.maxHp = 10000;
  applyStatusEffectToActor(source, "engaged", 3, { log: combat.log });
  combat.log = [];
  applySkillEffects({ ...getSkill("slash"), alwaysHits: true }, target, [source], combat, ctx, combat.log);
  expect(combat.log.some((entry) => entry.hit?.visual === "counter" && entry.hit.sourceId === source.id && entry.hit.targetId === target.id)).toBe(true);
  applyStatusEffectToActor(source, "storm-empowered", 3, { log: combat.log });
  combat.log = [];
  applySkillEffects({ ...getSkill("slash"), alwaysHits: true }, source, [target], combat, ctx, combat.log);
  expect(combat.log.some((entry) => entry.hit?.visual === "storm" && entry.hit.sourceId === source.id)).toBe(true);
  const rogue = ctx.party.find((entry) => entry.classId === "rogue")!;
  rogue.level = 35;
  applyStatusEffectToActor(target, "poisoned", 3, { log: combat.log });
  combat.log = [];
  applySkillEffects({ ...getSkill("stab"), alwaysHits: true }, rogue, [target], combat, ctx, combat.log);
  expect(combat.log.some((entry) => entry.hit?.visual === "poison" && entry.hit.sourceId === rogue.id)).toBe(true);
});

test("automatic damage covers scaled and flat damage without changing its target", () => {
  const artifact = ARTIFACTS.find((entry) => entry.id === "thunder-totem")!;
  const effect = artifact.effects.find((entry) => entry.kind === "autoDamage")!;
  if (effect.kind !== "autoDamage") throw new Error("autoDamage fixture");
  const original = effect.offenseMultiplierPercent;
  try {
    for (const scaled of [true, false]) {
      effect.offenseMultiplierPercent = scaled ? original : undefined;
      const { ctx, source, target, combat } = fight();
      source.equippedArtifactIds = [artifact.id];
      resolveRound(combat, ctx);
      expect(combat.log.some((entry) => scaled ? entry.hit?.visual === "storm" && entry.hit.targetId === target.id : entry.effect?.visual === "storm" && entry.effect.targetId === target.id && entry.effect.damage! > 0)).toBe(true);
    }
  } finally { effect.offenseMultiplierPercent = original; }
});

test("Afterimage only animates a successfully spawned passive clone", () => {
  const { ctx, target, combat } = fight();
  const ninja = ctx.party.find((entry) => entry.classId === "ninja")!;
  ninja.level = 35;
  spawnAdditionalSummon({ kind: "summon", summonCastId: "shadow-clone" }, ninja, combat, ctx, combat.log);
  const chance = spyOn(ctx.rng, "chance").mockReturnValue(true);
  try {
    combat.log = [];
    applySkillEffects({ ...getSkill("kunai-strike"), alwaysHits: true }, ninja, [target], combat, ctx, combat.log);
    expect(ctx.summons.filter((entry) => entry.fromPassive)).toHaveLength(1);
    expect(combat.log.filter((entry) => entry.effect?.visual === "smoke").map((entry) => entry.effect!.targetId)).toEqual([ninja.id]);
    combat.log = [];
    applySkillEffects({ ...getSkill("kunai-strike"), alwaysHits: true }, ninja, [target], combat, ctx, combat.log);
    expect(combat.log.some((entry) => entry.effect?.visual === "smoke")).toBe(false);
  } finally { chance.mockRestore(); }
});

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
  test("secondary reaction defaults and dedicated presets are authored", () => {
    expect(COMBAT_FX.reactions).toEqual({ damageOverTime: "impact", woundOnHit: "deep-wound", reflectDamage: "reflect", counterAttack: "counter", onHitAoeDamage: "impact", bonusDamage: "impact", autoDamage: "impact", passiveSummon: "summon" });
    for (const id of ["reflect", "counter", "hexed", "deep-wound"]) {
      expect(COMBAT_FX.presets[id]).toMatchObject({ placement: "target", phase: "impact", ticks: 5 });
      expect(COMBAT_FX.presets[id]!.frames).toHaveLength(5);
    }
    expect(COMBAT_FX.presets.hexed!.frames.map((f) => f.rows)).not.toEqual(COMBAT_FX.presets.debuff!.frames.map((f) => f.rows));
    expect(COMBAT_FX.presets["deep-wound"]!.frames.map((f) => f.rows)).not.toEqual(COMBAT_FX.presets.bleed!.frames.map((f) => f.rows));
  });

  test("reaction defaults reject missing keys, unknown keys and approach presets", () => {
    const draft = structuredClone(COMBAT_FX);
    const unknown = { ...draft, reactions: { ...draft.reactions, unknown: "impact" } };
    expect(() => validateCombatFx(unknown)).toThrow();
    draft.reactions = { ...draft.reactions, reflectDamage: "slash" };
    expect(() => validateCombatFx(draft)).toThrow();
    draft.reactions = { ...COMBAT_FX.reactions, reflectDamage: null };
    expect(() => validateCombatFx(draft)).not.toThrow();
    delete (draft.reactions as Partial<typeof draft.reactions>).reflectDamage;
    expect(() => validateCombatFx(draft)).toThrow();
  });

  test("Overwatch follows the configured basic attack, including null, without changing damage or RNG", () => {
    const basic = getSkill("quick-shot").effects![0]!;
    const original = basic.animation;
    const results: { hp: number; rng: number }[] = [];
    try {
      for (const animation of ["arrow", "fireball", null]) {
        basic.animation = animation;
        const { ctx } = makeCtx();
        ctx.rng.chance = () => true;
        const archer = ctx.party.find((actor) => actor.classId === "archer")!;
        const target = spawnInto(ctx, "dungeon-rat");
        target.hp = target.maxHp = 999; target.attack = 0;
        const combat = startCombat("overwatch-fx", [target.id], ctx, false);
        const self = { kind: "character" as const, id: archer.id };
        queueAction(combat, self, "overwatch", [self], ctx);
        resolveRound(combat, ctx);
        const hit = combat.log.find((entry) => entry.hit?.targetId === target.id)?.hit;
        expect(hit).toBeDefined();
        expect(hit?.sourceId).toBe(archer.id);
        expect(hit?.visual).toBe(animation ?? undefined);
        expect(target.hp).toBeLessThan(999);
        results.push({ hp: target.hp, rng: ctx.rng.getState() });
      }
    } finally {
      basic.animation = original;
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  test("a missed Overwatch shot does not emit an attack animation", () => {
    const { ctx } = makeCtx();
    const archer = ctx.party.find((actor) => actor.classId === "archer")!;
    const target = spawnInto(ctx, "dungeon-rat");
    target.hp = target.maxHp = 999; target.attack = 0;
    const combat = startCombat("overwatch-miss", [target.id], ctx, false);
    applyStatusEffectToActor(archer, "overwatched", 1, { log: combat.log });
    archer.speed = 0;
    archer.survival.fear = 100;
    ctx.rng.next = () => 0;
    resolveRound(combat, ctx);
    expect(combat.log.some((entry) => entry.text.includes("misses") && entry.text.includes("Overwatch"))).toBe(true);
    expect(combat.log.some((entry) => entry.hit?.sourceId === archer.id)).toBe(false);
    expect(target.hp).toBe(999);
  });

  test("skill visuals match physical actions and rank families keep consistent support animations", () => {
    const assignments: Record<string, string[]> = {
      "heavy-charge": ["impact", "stun"], "smoke-bomb": ["smoke", "haste"], "shadow-strike": ["smoke", "thrust"],
      "rigged-game": ["card", "fear"], "overwatch": ["focus"],
      "acid-spit": ["acid-spit", "poison"], "stoneshear": ["impact"], "shield-bash": ["impact", "debuff"],
      "sealing-blow": ["impact", "stun"], "rotting-embrace": ["impact", "burn"],
      "maul": ["claw", "bleed"], "claw-rake": ["claw"], "crimson-talon": ["claw", "bleed"], "blood-drain": ["blood-drain"],
      "raise-the-dead": ["summon", "summon"],
    };
    const skills = [...CLASSES.flatMap((entry) => entry.skills), ...MONSTER_SKILLS];
    for (const [id, expected] of Object.entries(assignments)) {
      const skill = skills.find((entry) => entry.id === id)!;
      for (const owner of skill.ranks ?? [skill]) expect(owner.effects?.map((effect) => effect.animation)).toEqual(expected);
    }
    for (const rank of getSkill("poison-coat").ranks!) {
      for (const effect of rank.effects ?? []) if (effect.statusEffectId?.startsWith("venom-edge")) expect(effect.animation).toBe("buff");
    }
    for (const id of ["venom-edge", "venom-edge-ii"]) expect(getStatusVisual(id, true)).toBe("buff");
    for (const id of ["overwatched", "overwatched-ii", "overwatched-iii"]) expect(getStatusVisual(id, true)).toBe("focus");
    for (const id of ["stealthed", "stealthed-ii", "stealthed-iii"]) expect(getStatusVisual(id, true)).toBe("smoke");
    for (const id of ["summon-goblin", "summon-spirit", "summon-golem", "totem-recall", "summon-hellfire-imp"]) {
      for (const rank of getSkill(id).ranks!) expect(rank.effects?.find((effect) => effect.kind === "summon")?.animation).toBe("summon");
    }
  });

  test("bite skills use jaws for damage and keep their status animations", () => {
    for (const id of ["bite", "poison-bite", "quick-bite", "venom-bite", "feed", "drink", "final-draught"]) {
      const skill = MONSTER_SKILLS.find((entry) => entry.id === id)!;
      expect(skill.effects?.find((effect) => effect.kind === "damage")?.animation).toBe("bite");
      for (const effect of skill.effects ?? []) if (effect.kind === "applyStatusEffect") expect(effect.animation).toBe("poison");
      const { ctx, combat, source, target } = fight();
      source.hp = source.maxHp = 10000;
      applySkillEffects({ ...skill, alwaysHits: true }, target, [source], combat, ctx, combat.log);
      expect(combat.log.find((entry) => entry.hit)?.hit).toMatchObject({ targetId: source.id, visual: "bite" });
    }
  });

  test("self-destruct queues an explosion on every AOE target", () => {
    const { ctx, combat, target } = fight();
    const targets = ctx.party.slice(0, 3);
    for (const actor of targets) actor.hp = actor.maxHp = 10000;
    const skill = MONSTER_SKILLS.find((entry) => entry.id === "self-destruct")!;
    expect(skill.effects?.every((effect) => effect.animation === "explosion")).toBe(true);
    runInSession(combat, target.id, () => applySkillEffects({ ...skill, alwaysHits: true }, target, targets, combat, ctx, combat.log));
    const hits = combat.log.flatMap((entry) => entry.hit ? [entry.hit] : []);
    expect(hits).toHaveLength(targets.length);
    expect(hits.every((hit) => hit.visual === "explosion")).toBe(true);
    const expected = new Set(targets.map((actor) => actor.id));
    expect(target.hp).toBe(0);
    expect(new Set(hits.map((hit) => hit.targetId))).toEqual(expected);
    const queue = new RevealQueue(); queue.enqueue(combat.log);
    const animated = new Set<string>();
    for (let tick = 0; queue.active && tick < 200; tick++) {
      queue.tick();
      for (const frame of queue.attackFrames) if (frame.impactAge === 0 && frame.hit.visual === "explosion") animated.add(frame.hit.targetId);
    }
    expect(queue.active).toBe(false);
    expect(animated).toEqual(expected);
  });

  test.each(["explosion", "bite", "acid-spit", "impact", "claw", "smoke", "card", "summon"])("%s renders every JSON frame in both directions", (visual) => {
    const preset = COMBAT_FX.presets[visual]!;
    expect(preset.frames).toHaveLength(5);
    expect(() => validateCombatFx(COMBAT_FX)).not.toThrow();
    for (const [index, frame] of preset.frames.entries()) for (const reverse of [false, true]) {
      const source = anchor(reverse ? 70 : 20, "party"), target = anchor(reverse ? 20 : 70, "monster");
      source.y = target.y = 10;
      const impactAge = preset.phase === "impact" ? index : -1;
      const result = paintCombatFx(background(), new Map([["source", source], ["target", target]]), [{ hit: { sourceId: "source", targetId: "target", amount: 8, visual }, progress: index / 4, impactAge }]);
      const pixels = result.map((row) => row.flatMap((chunk) => Array.from(chunk.text, () => chunk.bg)));
      const sign = reverse ? -1 : 1;
      const x = preset.placement === "projectile" ? source.x + 2 + (target.x - source.x) * index / 4 : target.x + 2;
      for (const [dy, row] of frame.rows.entries()) for (const [dx, key] of [...row].entries()) if (key !== ".") {
        expect(pixels[12 + frame.offsetY - frame.rows.length + 1 + dy]![Math.round(x + sign * (frame.offsetX + dx))]?.equals(RGBA.fromHex(preset.palette[key]!))).toBe(true);
      }
    }
  });

  test("class basic attacks read their effect animation without a duplicate mapping", () => {
    expect(Object.hasOwn(COMBAT_FX.basicAttacks, "classes")).toBe(false);
    for (const entry of CLASSES) {
      const effect = entry.skills.find((skill) => skill.slot === 0)?.effects?.find((effect) => effect.kind === "damage");
      expect(effect).toBeDefined();
      expect(getBasicAttackVisual("classes", entry.id)).toBe(effect!.animation ?? null);
      const original = effect!.animation;
      try {
        effect!.animation = "fireball";
        expect(getBasicAttackVisual("classes", entry.id)).toBe("fireball");
        effect!.animation = null;
        expect(getBasicAttackVisual("classes", entry.id)).toBeNull();
      } finally {
        effect!.animation = original;
      }
    }
    expect(getBasicAttackVisual("classes", "missing-class")).toBeNull();
    expect(() => validateCombatFx({ ...COMBAT_FX, basicAttacks: { ...COMBAT_FX.basicAttacks, classes: {} } } as typeof COMBAT_FX)).toThrow("unknown catalog classes");
  });

  test("melee, ranged, magic and item attacks have explicit styles", () => {
    expect(getSkill("slash").effects?.[0]?.animation).toBe("slash");
    expect(getSkill("stab").effects?.[0]?.animation).toBe("thrust");
    expect(getSkill("mace-strike").effects?.[0]?.animation).toBe("blunt");
    expect(getSkill("fireball").effects?.[0]?.animation).toBe("fireball");
    expect(getSkill("knife-throw").effects?.[0]?.animation).toBe("knife");
    expect(getSkill("quick-shot").effects?.[0]?.animation).toBe("arrow");
    expect(COMBAT_FX.items["pitch-bomb"]).toBe("fire-flask");
    expect(getSkill("command").effects?.[0]?.animation).toBeNull();
    expect(COMBAT_FX.items.slash ?? null).toBeNull();
    expect(getBasicAttackVisual("monsters", "skeleton-archer")).toBe("arrow");
    expect(getBasicAttackVisual("monsters", "skeleton-warrior")).toBe("slash");
    expect(getBasicAttackVisual("summons", "stone-golem")).toBe("blunt");
  });

  test("rejects unknown content, unknown styles and invalid animation frames", () => {
    expect(() => validateCombatFx(COMBAT_FX)).not.toThrow();
    const unknown = structuredClone(COMBAT_FX);
    unknown.items["missing-item"] = "slash";
    expect(() => validateCombatFx(unknown)).toThrow("missing-item");
    expect(() => validateCombatFx({ ...COMBAT_FX, flash: { ...COMBAT_FX.flash, frames: [] } })).toThrow();
    expect(() => validateEffectAnimation({ kind: "damage", animation: "unknown" })).toThrow();
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

  test("a real cast uses the same damage and random stream with or without its effect animation", () => {
    const a = fight(), b = fight(), skill = { ...getSkill("slash"), alwaysHits: true };
    applySkillEffects(skill, a.source, [a.target], a.combat, a.ctx, a.combat.log);
    applySkillEffects({ ...skill, effects: skill.effects!.map((effect) => ({ ...effect, animation: null })) }, b.source, [b.target], b.combat, b.ctx, b.combat.log);
    expect(a.target.hp).toBe(b.target.hp);
    expect(a.ctx.rng.getState()).toEqual(b.ctx.rng.getState());
    expect(a.combat.log.map((e) => e.text)).toEqual(b.combat.log.map((e) => e.text));
    expect(a.combat.log.find((e) => e.hit)?.hit?.visual).toBe("slash");
    expect(b.combat.log.find((e) => e.hit)?.hit?.visual).toBeUndefined();
  });

  test("a character's basic attack uses its effect animation instead of the old class mapping", () => {
    const { ctx, source, target, combat } = fight();
    applySkillEffects({ ...getSkill("slash"), alwaysHits: true, effects: [{ kind: "damage", amount: 1, animation: "fireball" }] }, source, [target], combat, ctx, combat.log);
    expect(combat.log.find((e) => e.hit)?.hit?.visual).toBe("fireball");
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
  test("animation frame bottoms share the sprite baseline across heights, placements and directions", () => {
    for (const placement of ["target", "projectile", "beam", "support"] as const) for (const reverse of [false, true]) {
      for (const height of [5, 10, 15]) for (const frameHeight of [1, 4]) for (const offsetY of [-2, 0, 2]) {
        const config = structuredClone(COMBAT_FX);
        config.presets.thrust = {
          placement: placement === "support" ? "target" : placement, phase: placement === "support" ? "impact" : "approach",
          palette: { A: "#123456" }, frames: [{ offsetX: 0, offsetY, rows: Array(frameHeight).fill("A") }],
        };
        const source = { ...anchor(reverse ? 70 : 10, "party"), y: 5, sprite: { rows: Array(10).fill("AAAA"), palette: { A: "#ffffff" } } };
        const target = { ...anchor(reverse ? 10 : 70, "monster"), y: 15 - height, sprite: { rows: Array(height).fill("AAAA"), palette: { A: "#ffffff" } } };
        const hit = { sourceId: "source", targetId: "target", amount: 8, visual: "thrust" };
        const anchors = new Map([["source", source], ["target", target]]);
        for (const progress of [0, 0.5, 1]) {
          const rows = paintCombatFx(background(), anchors, placement === "support" ? [] : [{ hit, progress, impactAge: -1 }], 0, config,
            placement === "support" ? [{ effect: { targetId: "target", visual: "thrust" }, age: 0 }] : []);
          const paintedRows = rows.flatMap((row, y) => row.some((cell) => cell.bg?.equals(RGBA.fromHex("#123456"))) ? [y] : []);
          expect(paintedRows).toEqual(Array.from({ length: frameHeight }, (_, y) => 14 + offsetY - frameHeight + 1 + y));
        }
      }
    }
  });

  test("transparent bottom rows remain part of the animation frame height", () => {
    const config = structuredClone(COMBAT_FX);
    config.presets.thrust = { palette: { A: "#123456" }, frames: [{ offsetX: 0, offsetY: 0, rows: ["A", ".", "."] }] };
    const rows = paintCombatFx(background(), new Map([["source", anchor(10, "party")], ["target", anchor(70, "monster")]]),
      [{ hit: { sourceId: "source", targetId: "target", amount: 8, visual: "thrust" }, progress: 1, impactAge: -1 }], 0, config);
    expect(rows[7]![72]!.bg?.equals(RGBA.fromHex("#123456"))).toBe(true);
    expect(rows[9]!.flatMap((chunk) => Array.from(chunk.text, () => chunk.bg))[72]?.equals(RGBA.fromHex("#171310"))).toBe(true);
  });

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
        expect(first[8]![52 - 2 * sign]!.bg?.equals(RGBA.fromHex("#123456"))).toBe(true);
        expect(last[10]![52 + 2 * sign]!.bg?.equals(RGBA.fromHex("#abcdef"))).toBe(true);
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

  test.each(["attack", "support", "flash"])("%s effects preserve overlapping icons and damage text while painting empty cells", (mode) => {
    const config = structuredClone(COMBAT_FX);
    config.presets.thrust = { phase: "impact", palette: { A: "#123456" }, frames: [{ offsetX: -3, offsetY: 0, rows: ["AAAAAA"] }] };
    config.flash.frames = [{ partyColor: "#123456", monsterColor: "#123456" }];
    const base = background(), text = " ".repeat(20) + "⛨ -5!" + " ".repeat(88);
    base[7] = [{ __isChunk: true, text, fg: RGBA.fromHex("#ffeecc"), bg: RGBA.fromHex("#171310") }];
    const target: CombatFxAnchor = { x: 20, y: 7, side: "monster", sprite: { rows: ["AAAAAA"], palette: { A: "#ffffff" } } };
    const anchors = new Map([["source", anchor(0, "party")], ["target", target]]);
    const hit = { sourceId: "source", targetId: "target", amount: 5, visual: mode === "flash" ? undefined : "thrust" };
    const painted = paintCombatFx(base, anchors, mode === "support" ? [] : [{ hit, progress: 1, impactAge: 0 }], 0, config,
      mode === "support" ? [{ effect: { targetId: "target", visual: "thrust" }, age: 0 }] : []);
    expect(painted[7]!.map((cell) => cell.text).join("")).toBe(text);
    for (const x of [20, 22, 23, 24]) {
      expect(painted[7]![x]!.fg?.equals(RGBA.fromHex("#ffeecc"))).toBe(true);
      expect(painted[7]![x]!.bg?.equals(RGBA.fromHex("#171310"))).toBe(true);
    }
    expect(painted[7]![21]!.bg?.equals(RGBA.fromHex("#123456"))).toBe(true);
    expect(base[7]![0]!.text).toBe(text);
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

test("a lethal damage overlay retains the living monster silhouette until its final frame", async () => {
  const setup = await createTestRenderer({ width: 150, height: 45 });
  try {
    const game = new Game(7, ["knight", "mage", "rogue", "acolyte"]);
    game.state.pendingGatekeeper = false;
    const target = spawnInto(game.ctx, "goblin");
    target.hp = 1;
    const combat = startCombat(game.state.currentRoomId, [target.id], game.ctx, false);
    game.state.combat = combat;
    const app = new App(setup.renderer, game, { autoReveal: false });
    await setup.renderOnce();
    combat.roundStartSnapshot = snapshotCombatants(combat, game.ctx);
    runInSession(combat, null, () => resolveSkillEffect({ kind: "damage", amount: 5, animation: "hexed" }, target, target, { log: combat.log, statusEffectName: "Hexed" }), { cause: "dot", snapshot: () => snapshotCombatants(combat, game.ctx) });
    const green = RGBA.fromHex(spriteForMonster("goblin", "normal").palette.G!);
    const bodyCells = () => setup.captureSpans().lines.reduce((n, row) => n + row.spans.filter((span) => span.bg.equals(green)).reduce((sum, span) => sum + span.width, 0), 0);
    app.tickReveal();
    for (let i = 0; i < IMPACT_TICKS; i++) app.tickReveal();
    await setup.renderOnce();
    expect(bodyCells()).toBeGreaterThan(0);
    expect(target.hp).toBe(0);
    while (app.debugRevealActive) app.tickReveal();
    await setup.renderOnce();
    expect(bodyCells()).toBe(0);
    setup.resize(180, 45);
    await setup.renderOnce();
    expect(bodyCells()).toBe(0);
  } finally { setup.renderer.destroy(); }
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

async function summonBattlefield() {
  const setup = await createTestRenderer({ width: 150, height: 45 });
  const game = new Game(7, ["knight", "mage", "summoner", "acolyte"]);
  game.state.pendingGatekeeper = false;
  const enemy = spawnInto(game.ctx, "goblin");
  const owner = game.state.party[2]!;
  const combat = startCombat(game.state.currentRoomId, [enemy.id], game.ctx, false);
  game.state.combat = combat;
  const spawn = (skillId: string) => spawnAdditionalSummon(getSkill(skillId).ranks![0]!.effects!.find((effect) => effect.kind === "summon")!, owner, combat, game.ctx, [])!;
  const golem = spawn("summon-golem");
  const app = new App(setup.renderer, game, { autoReveal: false });
  while (app.debugRevealActive) app.tickReveal();
  const battlefield = () => {
    const rows = setup.captureCharFrame().split("\n");
    const start = rows.findIndex((row) => row.includes("─Battlefield")) + 1;
    return rows.slice(start, start + UNIT_BLOCK_HEIGHT).map((row) => row.split("│")[1] ?? "").join("\n");
  };
  const colors = (color: string) => {
    const rgba = RGBA.fromHex(color);
    const rows = setup.captureCharFrame().split("\n");
    const top = rows.findIndex((row) => row.includes("─Battlefield")) + 1;
    const left = rows[top - 1]!.indexOf("─Battlefield") - 1;
    const slotLeft = left + 2 + Math.floor((setup.renderer.width - MIN_TERMINAL_WIDTH) / 2) + 2 * (SLOT_WIDTH + SLOT_GAP);
    return setup.captureSpans().lines.slice(top, top + UNIT_BLOCK_HEIGHT).reduce((sum, row) => {
      let x = 0;
      return sum + row.spans.reduce((count, span) => {
        const from = x;
        x += span.width;
        return count + (span.bg.equals(rgba) ? Math.max(0, Math.min(x, slotLeft + SLOT_WIDTH) - Math.max(from, slotLeft)) : 0);
      }, 0);
    }, 0);
  };
  const replay = (actorId: string, body: () => void, summonActorId?: string) => {
    combat.roundStartSnapshot = snapshotCombatants(combat, game.ctx);
    runInSession(combat, actorId, body, { summonActorId, snapshot: () => snapshotCombatants(combat, game.ctx) });
    app.tickReveal();
  };
  const tick = async (count: number) => {
    for (let i = 0; i < count; i++) app.tickReveal();
    await setup.renderOnce();
  };
  const skip = async () => {
    setup.mockInput.pressKey("space");
    await setup.renderOnce();
  };
  return { setup, game, combat, enemy, owner, golem, spawn, app, battlefield, colors, replay, tick, skip };
}

test("a summoned unit receives its hit flash on its own silhouette and clears it on resize and skip", async () => {
  const { setup, combat, enemy, owner, golem, app, battlefield, colors, replay, tick, skip } = await summonBattlefield();
  try {
    const flash = COMBAT_FX.flash.frames[0]!.partyColor!;
    const sprite = spriteForSummon(golem.archetypeId);
    const damage = { kind: "damage", amount: 3, offenseMultiplierPercent: 0, ignoreDefensePercent: 100, animation: null } as const;
    replay(owner.id, () => resolveSkillEffect(damage, owner, enemy, { log: combat.log, isCrit: false }));
    await tick(0);
    expect(battlefield()).toContain("SM ♙");
    expect(battlefield()).not.toContain(summonLabel(golem));
    await skip();
    replay(enemy.id, () => {
      noteSkillTarget(combat, enemy, golem, [damage], true);
      resolveSkillEffect(damage, enemy, golem, { log: combat.log, isCrit: false });
    });
    await tick(IMPACT_TICKS);
    expect(battlefield()).toContain(summonLabel(golem));
    expect(battlefield()).toContain(`${golem.hp}/${golem.maxHp}`);
    expect(battlefield()).toContain("-3");
    expect(colors(flash)).toBe(sprite.rows.join("").replaceAll(".", "").length);
    setup.resize(180, 45);
    await tick(0);
    expect(battlefield()).toContain(summonLabel(golem));
    expect(colors(flash)).toBe(sprite.rows.join("").replaceAll(".", "").length);
    await skip();
    expect(app.debugRevealActive).toBe(false);
    expect(battlefield()).toContain("SM ♙");
    expect(battlefield()).toContain(`${owner.hp}/${owner.maxHp}`);
    expect(colors(flash)).toBe(0);
  } finally {
    setup.renderer.destroy();
  }
});

test("summon attacks, healing and missed incoming attacks display the participating summon", async () => {
  const { setup, game, combat, enemy, owner, golem, spawn, app, battlefield, colors, replay, tick, skip } = await summonBattlefield();
  try {
    enemy.hp = enemy.maxHp = 1000;
    const rock = { kind: "damage", amount: 3, offenseMultiplierPercent: 0, animation: "rock" } as const;
    replay(owner.id, () => resolveSkillEffect(rock, golem, enemy, { log: combat.log, isCrit: false }), golem.id);
    await tick(0);
    expect(battlefield()).toContain(summonLabel(golem));
    const golemSprite = spriteForSummon(golem.archetypeId);
    const golemColor = golemSprite.palette[golemSprite.rows.join("").replaceAll(".", "")[0]!]!;
    expect(colors(golemColor)).toBeGreaterThan(0);
    await skip();
    const spirit = spawn("summon-spirit");
    const ally = game.state.party[0]!;
    ally.hp -= 7;
    spirit.hp = 5;
    replay(owner.id, () => {
      resolveSkillEffect({ kind: "heal", amount: 5 }, spirit, ally, { log: combat.log, isCrit: false });
      resolveSkillEffect({ kind: "heal", amount: 5 }, spirit, spirit, { log: combat.log, isCrit: false });
    }, spirit.id);
    await tick(IMPACT_TICKS);
    expect(battlefield()).toContain(summonLabel(spirit));
    expect(battlefield()).toContain("+5");
    expect(battlefield()).toContain(`${ally.maxHp - 2}/${ally.maxHp}`);
    expect(Object.values(COMBAT_FX.presets.heal!.palette).some((color) => colors(color) > 0)).toBe(true);
    while (app.debugRevealActive) app.tickReveal();
    await tick(0);
    expect(battlefield()).toContain("SM ♙♙");
    owner.hp -= 8;
    ally.hp -= 5;
    const allyAfter = ally.hp + 5;
    replay(owner.id, () => {
      resolveSkillEffect({ kind: "heal", amount: 5 }, spirit, owner, { log: combat.log, isCrit: false });
      resolveSkillEffect({ kind: "heal", amount: 5 }, spirit, ally, { log: combat.log, isCrit: false });
    }, spirit.id);
    await tick(0);
    expect(battlefield()).toContain(summonLabel(spirit));
    await tick(IMPACT_TICKS);
    expect(battlefield()).toContain("SM ♙♙");
    expect(battlefield()).toContain(`${owner.maxHp - 3}/${owner.maxHp}`);
    expect(battlefield()).toContain("+5");
    await tick(COMBAT_FX.presets.heal!.ticks!);
    expect(battlefield()).toContain(summonLabel(spirit));
    expect(battlefield()).toContain(`${allyAfter}/${ally.maxHp}`);
    await skip();

    applyStatusEffectToActor(enemy, "blinded", 2, { log: [] });
    game.ctx.rng.next = () => 0;
    replay(enemy.id, () => applySkillEffects({ ...getSkill("slash"), alwaysHits: false, effects: [rock] }, enemy, [spirit], combat, game.ctx, combat.log));
    await tick(IMPACT_TICKS);
    expect(battlefield()).toContain(summonLabel(spirit));
    expect(battlefield()).toContain("miss");
    expect(combat.log.at(-1)?.hit).toBeUndefined();
    expect(combat.log.at(-1)?.session).toMatchObject({ actorId: enemy.id, missedIds: [owner.id], summonIds: [owner.id], summonParticipantIds: [spirit.id] });
    expect(combat.log.at(-1)?.session?.summonActorId).toBeUndefined();
    await skip();
  } finally {
    setup.renderer.destroy();
  }
});

test("same-owner summon and owner hits use separate silhouettes and markers through the last actual hit", async () => {
  const { setup, combat, enemy, owner, golem, spawn, battlefield, colors, replay, tick } = await summonBattlefield();
  try {
    const goblin = spawn("summon-goblin");
    golem.hp = 10;
    const flash = COMBAT_FX.flash.frames[0]!.partyColor!;
    const area = { kind: "damage", amount: 5, offenseMultiplierPercent: 0, ignoreDefensePercent: 100, animation: null } as const;
    const hit = (target: typeof golem | typeof owner, amount: number, unapplied?: true) => {
      noteSkillTarget(combat, enemy, target, [area], true);
      resolveSkillEffect({ ...area, amount }, enemy, target, { log: combat.log, isCrit: false, unapplied });
    };
    replay(enemy.id, () => {
      hit(golem, 4);
      hit(golem, 7);
      hit(golem, 8, true);
      hit(goblin, 5);
      hit(owner, 6);
    });
    const silhouette = (sprite: ReturnType<typeof spriteForSummon>) => sprite.rows.join("").replaceAll(".", "").length;
    await tick(IMPACT_TICKS);
    expect(battlefield()).toContain(summonLabel(golem));
    expect(battlefield()).toContain(`6/${golem.maxHp}`);
    expect(battlefield()).toContain("-4");
    expect(colors(flash)).toBe(silhouette(spriteForSummon(golem.archetypeId)));
    await tick(HIT_BEAT_TICKS);
    expect(battlefield()).toContain(summonLabel(golem));
    expect(battlefield()).toContain("-7");
    expect(colors(flash)).toBe(silhouette(spriteForSummon(golem.archetypeId)));

    for (let i = 0; i < 60 && !battlefield().includes(summonLabel(goblin)); i++) await tick(1);
    expect(battlefield()).toContain(summonLabel(goblin));
    expect(battlefield()).toContain(`${goblin.maxHp}/${goblin.maxHp}`);
    for (let i = 0; i < 25 && colors(flash) === 0; i++) await tick(1);
    expect(battlefield()).toContain("-5");
    expect(colors(flash)).toBe(silhouette(spriteForSummon(goblin.archetypeId)));

    for (let i = 0; i < 25 && !battlefield().includes("SM ♙"); i++) await tick(1);
    expect(battlefield()).toContain("SM ♙");
    for (let i = 0; i < 25 && colors(flash) === 0; i++) await tick(1);
    expect(battlefield()).toContain("-6");
    expect(colors(flash)).toBe(silhouette(spriteForClass(owner.classId)));
  } finally {
    setup.renderer.destroy();
  }
});

test("owner and summon damage ticks each get their own shared slot readout", async () => {
  const { setup, game, combat, owner, golem, app, battlefield, tick } = await summonBattlefield();
  try {
    combat.roundStartSnapshot = snapshotCombatants(combat, game.ctx);
    runTicksInSession(combat, [owner, golem], (unit) => {
      noteDotEffect(combat, unit, "damage");
      resolveSkillEffect({ kind: "damage", amount: unit === owner ? 2 : 4 }, unit, unit, { log: combat.log, statusEffectName: "Poisoned", isCrit: false });
    }, { cause: "dot", snapshot: () => snapshotCombatants(combat, game.ctx) });
    app.tickReveal();
    await tick(IMPACT_TICKS);
    expect(battlefield()).toContain("SM ♙");
    expect(battlefield()).toContain("-2");
    await tick(HIT_BEAT_TICKS);
    expect(battlefield()).toContain(summonLabel(golem));
    expect(battlefield()).toContain("-4");
    expect(battlefield()).not.toContain("-2");
  } finally {
    setup.renderer.destroy();
  }
});

test.each([false, true])("a multi-hit kill keeps the living sprite until the fatal hit, including intervening support=%s", async (support) => {
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
      combat.log.push({ text: "first", kind: "attack", hit });
      if (support) combat.log.push({ text: "burn", kind: "debuff", effect: { targetId: target.id, visual: "burn" } });
      combat.log.push({ text: "fatal", kind: "attack", hit }, { text: "overkill", kind: "attack", hit: { ...hit, overkill: 10 } });
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
    const gap = support ? IMPACT_TICKS + COMBAT_FX.flash.frames.length + COMBAT_FX.presets.burn!.ticks! : HIT_BEAT_TICKS;
    for (let i = 0; i < gap; i++) app.tickReveal();
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

  test("successful support cues each replay separately and finish before fear", () => {
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
    expect(queue.supportFrames).toMatchObject([{ effect, age: 0 }]);
    expect(queue.fearBeat).toBe(false);
    for (let i = 0; i < duration; i++) queue.tick();
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
      const paintedX = (p: number) => paintCombatFx(background(), anchors, [{ hit, progress: p, impactAge: -1 }], 0, config)[9]!.findIndex((cell) => cell.bg?.equals(RGBA.fromHex("#123456")));
      expect(paintedX(0)).toBe((reverse ? 80 : 10) + 2);
      expect(paintedX(0.5)).toBe(47);
      expect(paintedX(1)).toBe((reverse ? 10 : 80) + 2);
    }
  });
});

test("catalog visuals accept explicit choices and supported game defaults", () => {
  const defaults = structuredClone(COMBAT_FX);
  delete defaults.statuses.weakened;
  delete defaults.basicAttacks.monsters["skeleton-archer"];
  defaults.basicAttacks.monsters["skeleton-warrior"] = null;
  defaults.items["pitch-bomb"] = null;
  for (const file of [COMBAT_FX, defaults]) {
    expect(() => validateCombatFx(file)).not.toThrow();
    for (const skill of [...CLASSES.flatMap((c) => c.skills), ...MONSTER_SKILLS, ...SUMMON_SKILLS]) {
      for (const effect of [...(skill.effects ?? []), ...(skill.chargeEffects ?? []), ...(skill.ranks ?? []).flatMap((rank) => rank.effects ?? [])]) {
        expect(Object.hasOwn(effect, "animation")).toBe(true);
        expect(() => validateEffectAnimation(effect, file)).not.toThrow();
      }
    }
    for (const item of ITEMS) {
      const visual = file.items[item.id];
      if (visual != null) expect(file.presets[visual]).toBeDefined();
    }
    for (const [kind, catalog] of [["monsters", MONSTER_ARCHETYPES], ["summons", SUMMON_ARCHETYPES]] as const) {
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

test("Battle Ballad keeps the owner in the slot when its effects exclude the summon", () => {
  const { ctx } = makeCtx(5);
  const owner = ctx.party.find((character) => character.classId === "summoner")!;
  const jester = ctx.party.find((character) => character.classId === "jester")!;
  jester.level = 25;
  jester.unlockedSkillIds.push("battle-ballad");
  jester.mp = 100;
  const enemy = spawnInto(ctx, "dungeon-rat");
  enemy.hp = enemy.maxHp = 5000;
  const combat = startCombat("ballad-summon-target", [enemy.id], ctx, false);
  const summonEffect = getSkill("summon-goblin").ranks![0]!.effects!.find((effect) => effect.kind === "summon")!;
  const goblin = spawnAdditionalSummon(summonEffect, owner, combat, ctx, [])!;
  const jesterRef = { kind: "character", id: jester.id } as const;
  const targets = autoResolveTargets("allAllies", jesterRef, combat, ctx)!;
  expect(targets).toContainEqual({ kind: "summon", id: goblin.id });
  expect(queueAction(combat, jesterRef, "battle-ballad", targets, ctx)).toBeNull();
  resolveRound(combat, ctx);

  const session = combat.log.find((entry) => entry.text.includes("uses Battle Ballad"))!.session!;
  expect(session.buffedIds).toContain(owner.id);
  expect(session.summonIds).toContain(owner.id);
  const queue = new RevealQueue();
  queue.enqueue(combat.log.filter((entry) => entry.session?.id === session.id), new Map([[goblin.id, owner.id]]));
  const occupants = new Set<string>();
  while (queue.active) {
    queue.tick();
    occupants.add(queue.slotOccupant(owner.id));
  }
  expect([...occupants]).toEqual([owner.id]);
  expect(session.summonParticipantIds).toBeUndefined();
});

test("a summon enters its slot only when the interrupted area attack reaches it", () => {
  const { ctx, source: knight, target: enemy, combat } = fight();
  enemy.hp = enemy.maxHp = 5000;
  const owner = ctx.party.find((character) => character.classId === "summoner")!;
  const summonEffect = getSkill("summon-goblin").ranks![0]!.effects!.find((effect) => effect.kind === "summon")!;
  const goblin = spawnAdditionalSummon(summonEffect, owner, combat, ctx, [])!;
  applyStatusEffectToActor(knight, "engaged", 2, { log: [] });
  const snapshot = () => snapshotCombatants(combat, ctx);
  const before = snapshot();
  runInSession(combat, enemy.id, () => {
    combat.log.push({ text: "Area attack", kind: "attack" });
    applySkillEffects({
      ...getSkill("slash"), target: "allEnemies", alwaysHits: true,
      effects: [{ kind: "damage", amount: 5, offenseMultiplierPercent: 0, ignoreDefensePercent: 100, animation: null }],
    }, enemy, [knight, goblin], combat, ctx, combat.log);
  }, { snapshot });

  const knightHit = combat.log.find((entry) => entry.hit?.targetId === knight.id);
  const goblinHit = combat.log.find((entry) => entry.hit?.targetId === goblin.id);
  expect(knightHit?.session?.actorId).toBe(enemy.id);
  expect(goblinHit?.session).toBe(knightHit?.session);
  const queue = new RevealQueue();
  queue.enqueue(combat.log, new Map([[goblin.id, owner.id]]), before);
  const runs: { actorId: string | null; occupants: Set<string> }[] = [];
  let previous = queue.focus;
  while (queue.active) {
    queue.tick();
    const session = queue.focus;
    if (!session) continue;
    if (session !== previous) runs.push({ actorId: session.actorId, occupants: new Set() });
    runs.at(-1)!.occupants.add(queue.slotOccupant(owner.id));
    previous = session;
  }
  expect(runs.map(({ actorId, occupants }) => [actorId, [...occupants]])).toEqual([
    [enemy.id, [owner.id]],
    [knight.id, [owner.id]],
    [enemy.id, [goblin.id]],
  ]);
});

test("summoning and Command log the acting summon separately from its owner", () => {
  const { ctx } = makeCtx(5);
  const owner = ctx.party.find((character) => character.classId === "summoner")!;
  owner.level = 25;
  owner.unlockedSkillIds.push("summon-goblin", "command");
  owner.mp = 100;
  ctx.rng.next = () => 0.5;
  const enemy = spawnInto(ctx, "dungeon-rat");
  enemy.hp = enemy.maxHp = 5000;
  const combat = startCombat("summon-session-identity", [enemy.id], ctx, false);
  const ownerRef = { kind: "character", id: owner.id } as const;
  const enemyRef = { kind: "monster", id: enemy.id } as const;

  expect(queueAction(combat, ownerRef, "summon-goblin", [ownerRef], ctx)).toBeNull();
  resolveRound(combat, ctx);
  const goblin = ctx.summons.find((summon) => summon.ownerId === owner.id)!;
  const cast = combat.log.find((entry) => entry.effect?.visual === "summon")!;
  expect(cast.session?.actorId).toBe(owner.id);
  expect(cast.session?.summonActorId).toBeUndefined();
  expect(cast.session?.summonParticipantIds).toBeUndefined();
  const immediate = combat.log.find((entry) => entry.hit?.sourceId === goblin.id)!;
  expect(immediate.session).toMatchObject({ actorId: owner.id, summonIds: [owner.id], summonActorId: goblin.id, summonParticipantIds: [goblin.id] });

  goblin.maxActions = 10;
  const beforeCommand = combat.log.length;
  expect(queueCommand(combat, ownerRef, "command", { summonId: goblin.id, skillId: "rock-throw" }, [enemyRef], ctx)).toBeNull();
  resolveRound(combat, ctx);
  const commandEntries = combat.log.slice(beforeCommand);
  const command = commandEntries.find((entry) => entry.hit?.sourceId === owner.id && entry.hit.visual === "rock")!;
  expect(command.session).toMatchObject({ actorId: owner.id, summonIds: [], summonActorId: goblin.id, summonParticipantIds: [goblin.id] });
  const queue = new RevealQueue();
  queue.enqueue(commandEntries.filter((entry) => entry.session?.id === command.session?.id), new Map([[goblin.id, owner.id]]));
  queue.tick();
  expect(queue.slotOccupant(owner.id)).toBe(goblin.id);
  expect(queue.attackFrames[0]?.hit.sourceId).toBe(goblin.id);
  expect(command.hit?.sourceId).toBe(owner.id);
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
  for (let i = 0; i < HIT_BEAT_TICKS + COMBAT_FX.flash.frames.length; i++) queue.tick();
  expect(queue.supportFrames).toMatchObject([{ effect, age: 0 }]);
});

test("support painting is visible on opaque or empty cells but never mutates the cached battlefield", () => {
  const base = background(), before = structuredClone(base.map((row) => row.map((cell) => cell.text)));
  const anchors = new Map([["ally", anchor(20, "party")]]);
  const config = structuredClone(COMBAT_FX);
  config.presets.heal = { phase: "impact", ticks: 3, palette: { A: "#123456" }, frames: [{ offsetX: 0, offsetY: 0, rows: ["A"] }] };
  const painted = paintCombatFx(base, anchors, [], 0, config, [{ effect: { targetId: "ally", visual: "heal" }, age: 0 }]);
  expect(painted[9]![22]!.bg?.equals(RGBA.fromHex("#123456"))).toBe(true);
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
  for (let i = 0; i < HIT_BEAT_TICKS + COMBAT_FX.flash.frames.length; i++) queue.tick();
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

test("authored beam frames repeat their pixels and transparency in both directions", () => {
  for (const [visual, preset] of Object.entries(COMBAT_FX.presets).filter(([, p]) => p.placement === "beam")) for (const [index, frame] of preset.frames.entries()) for (const reverse of [false, true]) {
    const width = frame.rows[0]!.length, distance = width * 2 + Math.floor(width / 2);
    const source = anchor(reverse ? 5 + distance : 5, "party"), target = anchor(reverse ? 5 : 5 + distance, "monster");
    const progress = preset.frames.length === 1 ? 0 : index / (preset.frames.length - 1);
    source.y = target.y = 10;
    const result = paintCombatFx(background(), new Map([["source", source], ["target", target]]), [{ hit: { sourceId: "source", targetId: "target", amount: 8, visual }, progress, impactAge: -1 }]);
    const pixels = result.map((row) => row.flatMap((chunk) => Array.from(chunk.text, () => chunk.bg)));
    const sign = reverse ? -1 : 1;
    for (let step = 0; step <= distance; step++) for (const [dy, row] of frame.rows.entries()) {
      const key = row[step % width]!;
      expect(pixels[12 + frame.offsetY - frame.rows.length + 1 + dy]![source.x + 2 + sign * (step + frame.offsetX)]?.equals(RGBA.fromHex(key === "." ? "#171310" : preset.palette[key]!))).toBe(true);
    }
  }
});

test("AOE damage and each successful status animate on every target, including statuses sharing a preset", () => {
  const { source, target, ctx, combat } = fight();
  const targets = [target, spawnInto(ctx, "goblin"), spawnInto(ctx, "goblin")];
  for (const actor of targets) actor.hp = actor.maxHp = 10000;
  const chance = spyOn(ctx.rng, "chance").mockReturnValue(true);
  try {
    const skill = { ...getEffectiveSkill(getSkill("spreading-toxic-fog"), 15), alwaysHits: true, effects: [
      { kind: "damage" as const, amount: 1, animation: "poison-cloud" },
      { kind: "applyStatusEffect" as const, statusEffectId: "poisoned", durationTurns: 2, animation: "poison" },
      { kind: "applyStatusEffect" as const, statusEffectId: "weakened", durationTurns: 2, animation: "debuff" },
      { kind: "applyStatusEffect" as const, statusEffectId: "breached", durationTurns: 2, animation: "debuff" },
    ] };
    runInSession(combat, source.id, () => applySkillEffects(skill, source, targets, combat, ctx, combat.log));
    const queue = new RevealQueue(); queue.enqueue(combat.log);
    const starts = new Map<string, { visual: string; tick: number }[]>();
    let tick = 0;
    while (queue.active && tick < 200) {
      queue.tick();
      if (tick === IMPACT_TICKS) expect(queue.attackFrames.filter((frame) => frame.impactAge === 0).map((frame) => frame.hit.targetId)).toEqual(targets.map((actor) => actor.id));
      for (const actor of targets) expect(queue.supportFrames.filter((frame) => frame.effect.targetId === actor.id).length).toBeLessThanOrEqual(1);
      for (const { effect, age } of queue.supportFrames) if (age === 0) starts.set(effect.targetId, [...(starts.get(effect.targetId) ?? []), { visual: effect.visual, tick }]);
      tick++;
    }
    expect(queue.active).toBe(false);
    const expected = starts.get(target.id)!;
    expect(expected.map((entry) => entry.visual)).toEqual(["poison", "debuff", "debuff"]);
    expect(expected[0]!.tick).toBe(IMPACT_TICKS + COMBAT_FX.presets["poison-cloud"]!.ticks!);
    expect(expected[1]!.tick - expected[0]!.tick).toBe(COMBAT_FX.presets.poison!.ticks!);
    expect(expected[2]!.tick - expected[1]!.tick).toBe(COMBAT_FX.presets.debuff!.ticks!);
    for (const actor of targets) expect(starts.get(actor.id)).toEqual(expected);
  } finally { chance.mockRestore(); }
});

test("each effect chooses its own animation and explicit null suppresses only that effect", () => {
  const { source, target, ctx, combat } = fight();
  source.hp -= 10;
  const effects: SkillEffect[] = [
    { kind: "damage", amount: 1, animation: "knife" },
    { kind: "damage", amount: 1, animation: "fireball" },
    { kind: "applyStatusEffect", statusEffectId: "weakened", animation: "fear" },
    { kind: "applyStatusEffect", statusEffectId: "breached", animation: null },
  ];
  const chance = spyOn(ctx.rng, "chance").mockReturnValue(true);
  try {
    applySkillEffects({ ...getSkill("slash"), alwaysHits: true, effects }, source, [target], combat, ctx, combat.log);
    expect(combat.log.flatMap((entry) => entry.hit ? [entry.hit.visual] : [])).toEqual(["knife", "fireball"]);
    expect(combat.log.flatMap((entry) => entry.effect ? [entry.effect.visual] : [])).toEqual(["fear"]);
    expect(target.activeStatusEffects.some((status) => status.statusEffectId === "breached")).toBe(true);
    resolveSkillEffect({ kind: "heal", amount: 3, animation: "focus" }, source, source, { log: combat.log });
    expect(combat.log.at(-1)?.effect?.visual).toBe("focus");
  } finally { chance.mockRestore(); }
});

test("one effect applying several statuses emits a separate animation for each successful status", () => {
  const { source, target } = fight();
  const log: LogEntry[] = [];
  resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "weakened", alsoApplyStatusEffectIds: ["breached"], animation: "debuff" }, source, target, { log });
  expect(log.flatMap((entry) => entry.effect ? [entry.effect.visual] : [])).toEqual(["debuff", "debuff"]);
});

test("AOE recovery reaches every healed ally and skipped replay clears every pending status", () => {
  const { source, combat, ctx } = fight();
  for (const ally of ctx.party) ally.hp -= 10;
  runInSession(combat, source.id, () => applySkillEffects({ ...getEffectiveSkill(getSkill("mass-heal"), 15), effects: [{ kind: "heal", amount: 3, animation: "heal" }] }, source, ctx.party, combat, ctx, combat.log));
  const queue = new RevealQueue(); queue.enqueue(combat.log);
  for (let i = 0; i <= IMPACT_TICKS; i++) queue.tick();
  expect(queue.supportFrames.map((frame) => frame.effect.targetId)).toEqual(ctx.party.map((ally) => ally.id));
  queue.flush();
  expect(queue.supportFrames).toEqual([]);
  expect(queue.attackFrames).toEqual([]);
  expect(queue.active).toBe(false);
});

test("successful player and monster summons emit their configured animation, but null and failed summons do not", () => {
  const game = new Game(7, ["summoner", "knight", "mage", "acolyte"]);
  const source = game.state.party[0]!;
  const monster = spawnMonster("goblin", 1); game.ctx.monsters.push(monster);
  const combat = startCombat("fx-summon", [monster.id], game.ctx, false);
  const cast = getEffectiveSkill(getSkill("summon-goblin"), 15);
  for (const animation of ["summon", null]) {
    combat.log = [];
    applySkillEffects({ ...cast, effects: [ { kind: "summon", summonCastId: "summon-goblin", animation } ] }, source, [source], combat, game.ctx, combat.log);
    expect(game.ctx.summons.some((unit) => unit.ownerId === source.id)).toBe(true);
    expect(combat.log.flatMap((entry) => entry.effect ? [entry.effect] : [])).toEqual(animation ? [{ targetId: source.id, sourceId: source.id, visual: animation }] : []);
  }
  combat.log = [];
  applySkillEffects({ ...cast, effects: [{ kind: "summon", animation: "buff" }] }, source, [source], combat, game.ctx, combat.log);
  expect(combat.log.some((entry) => entry.effect)).toBe(false);
  applySkillEffects({ ...cast, effects: [{ kind: "summonMonster", monsterArchetypeId: "goblin", count: 1, animation: "ward" }] }, monster, [monster], combat, game.ctx, combat.log);
  expect(combat.log.at(-1)?.effect).toEqual({ targetId: monster.id, sourceId: monster.id, visual: "ward" });
  combat.log = [];
  applySkillEffects({ ...cast, effects: [{ kind: "summonMonster", monsterArchetypeId: "goblin", count: 0, animation: "ward" }] }, monster, [monster], combat, game.ctx, combat.log);
  expect(combat.log.some((entry) => entry.effect)).toBe(false);
});

test("a monster summon component emits one caster cue for multiple successful adds", () => {
  const { ctx, source, target, combat } = fight();
  applySkillEffects({ ...getSkill("slash"), effects: [{ kind: "summonMonster", monsterArchetypeId: "goblin", count: 2, animation: "summon" }] }, target, [target], combat, ctx, combat.log);
  expect(ctx.monsters.filter((entry) => entry.summonerId === target.id)).toHaveLength(2);
  expect(combat.log.filter((entry) => entry.effect).map((entry) => entry.effect)).toEqual([{ targetId: target.id, sourceId: target.id, visual: "summon" }]);
  expect(combat.log.some((entry) => entry.effect?.targetId === source.id)).toBe(false);
});
