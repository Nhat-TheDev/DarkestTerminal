import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyOnHitRider, combatHooks } from "../src/engine/combatHooks";
import { resolveSkillEffect, tickStatModEffects, type Actor } from "../src/engine/resolver";
import { spawnMonster } from "../src/data/monsters";
import { getClass } from "../src/data/classes";
import { ABILITIES } from "../src/data/abilities";
import { ARTIFACTS, getArtifact } from "../src/data/artifacts";
import { STATUS_EFFECTS, getStatusEffect } from "../src/data/statusEffects";
import type { ArtifactEffect } from "../src/types";
import { makeCtx } from "./helpers";

type PoisonOnHit = Extract<ArtifactEffect, { kind: "poisonOnHit" }>;

function fireOnDamageDealt(source: Actor, target: Actor, damage: number, ctx: ReturnType<typeof makeCtx>["ctx"]): void {
  for (const hook of combatHooks) hook.onDamageDealt?.(source, target, damage, ctx, []);
}

/** Runs `run` with `obj[key]` temporarily replaced, so a test can prove a hook reads a data value rather than matching it by coincidence. */
function withOverride<T extends object, K extends keyof T>(obj: T, key: K, value: T[K], run: () => void): void {
  const original = obj[key];
  obj[key] = value;
  try {
    run();
  } finally {
    obj[key] = original;
  }
}

describe("Rogue passive: bonus poison damage vs. poisoned targets", () => {
  test("a Rogue's hit on a poisoned target deals bonus poison-type damage", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.level = 35; // rank 3: +30% + 20 flat
    const target = spawnMonster("goblin", 1); // no poison resist, safe baseline
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, rogue, target, { log: [] });
    const before = target.hp;
    fireOnDamageDealt(rogue, target, 10, ctx);
    expect(target.hp).toBeLessThan(before);
    // bonus = round(10 * 0.30) + 20 = 23
    expect(before - target.hp).toBe(23);
  });

  test("no bonus applies when the target has no poison-family status active", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.level = 35;
    const target = spawnMonster("goblin", 1);
    const before = target.hp;
    fireOnDamageDealt(rogue, target, 10, ctx);
    expect(target.hp).toBe(before);
  });

  test("no bonus applies below level 5 (rank 0)", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.level = 1;
    const target = spawnMonster("goblin", 1);
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, rogue, target, { log: [] });
    const before = target.hp;
    fireOnDamageDealt(rogue, target, 10, ctx);
    expect(target.hp).toBe(before);
  });
});

describe("Mage passive: stacking defense shred on hit", () => {
  test("a Mage's hit stacks the shredded status on the target, reducing its defense", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.level = 35; // rank 3: -10% / -12 flat, whichever is larger in magnitude
    const target = spawnMonster("goblin", 1);
    target.defense = 40;
    const before = target.defense;
    fireOnDamageDealt(mage, target, 10, ctx);
    // max(12, round(40 * 10 / 100)) = max(12, 4) = 12
    expect(target.defense).toBe(before - 12);
    expect(target.activeStatusEffects.find((s) => s.statusEffectId === "shredded-iii")?.stacks).toBe(1);
  });

  test("a 2nd hit adds another stack, up to maxStacks", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.level = 35;
    const target = spawnMonster("goblin", 1);
    target.defense = 40;
    fireOnDamageDealt(mage, target, 10, ctx);
    fireOnDamageDealt(mage, target, 10, ctx);
    expect(target.activeStatusEffects.find((s) => s.statusEffectId === "shredded-iii")?.stacks).toBe(2);
    expect(target.defense).toBe(40 - 12 - 12);
  });

  test("the shred lasts 3 turns: still on the target after 2 round-end ticks, gone after the 3rd", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.level = 35;
    const target = spawnMonster("goblin", 1);
    target.defense = 40;
    const shred = () => target.activeStatusEffects.find((s) => s.statusEffectId === "shredded-iii");
    fireOnDamageDealt(mage, target, 10, ctx);
    expect(shred()?.turnsRemaining).toBe(3);
    tickStatModEffects(target, { log: [] });
    tickStatModEffects(target, { log: [] });
    expect(shred()?.turnsRemaining).toBe(1);
    expect(target.defense).toBe(40 - 12);
    tickStatModEffects(target, { log: [] });
    expect(shred()).toBeUndefined();
    expect(target.defense).toBe(40);
  });

  test("a later hit refreshes the shred back to its full duration", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.level = 35;
    const target = spawnMonster("goblin", 1);
    const shred = () => target.activeStatusEffects.find((s) => s.statusEffectId === "shredded-iii");
    fireOnDamageDealt(mage, target, 10, ctx);
    tickStatModEffects(target, { log: [] });
    tickStatModEffects(target, { log: [] });
    expect(shred()?.turnsRemaining).toBe(1);
    fireOnDamageDealt(mage, target, 10, ctx);
    expect(shred()?.turnsRemaining).toBe(3);
    expect(shred()?.stacks).toBe(2);
  });

  test("no shred applies below level 5 (rank 0)", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.level = 1;
    const target = spawnMonster("goblin", 1);
    const before = target.defense;
    fireOnDamageDealt(mage, target, 10, ctx);
    expect(target.defense).toBe(before);
    expect(target.activeStatusEffects.length).toBe(0);
  });
});

const PLAGUE_DOCTOR_DEBUFF_POOL = ["poisoned", "burning", "weakened", "blinded", "slowed", "enfeebled"];

describe("Plague Doctor passive: double-roll debuff proc", () => {
  test("at rank 3 (50% per roll), across many trials, roughly 75% of hits land at least 1 debuff", () => {
    const trials = 500;
    let landedAtLeastOne = 0;
    for (let i = 0; i < trials; i++) {
      const { ctx } = makeCtx(i + 1);
      const doctor = ctx.party.find((p) => p.classId === "plague-doctor")!;
      doctor.level = 35; // rank 3: 50% per roll
      const target = spawnMonster("goblin", 1);
      fireOnDamageDealt(doctor, target, 10, ctx);
      if (target.activeStatusEffects.some((s) => PLAGUE_DOCTOR_DEBUFF_POOL.includes(s.statusEffectId))) landedAtLeastOne++;
    }
    // 1 - (1-0.5)^2 = 0.75 expected.
    const rate = landedAtLeastOne / trials;
    expect(rate).toBeGreaterThan(0.65);
    expect(rate).toBeLessThan(0.85);
  });

  test("the applied debuff is always one of the 6-entry pool", () => {
    for (let i = 0; i < 100; i++) {
      const { ctx } = makeCtx(i + 1);
      const doctor = ctx.party.find((p) => p.classId === "plague-doctor")!;
      doctor.level = 35;
      const target = spawnMonster("goblin", 1);
      fireOnDamageDealt(doctor, target, 10, ctx);
      for (const active of target.activeStatusEffects) {
        expect(PLAGUE_DOCTOR_DEBUFF_POOL).toContain(active.statusEffectId);
      }
    }
  });

  test("no proc at all below level 5 (rank 0)", () => {
    const { ctx } = makeCtx();
    const doctor = ctx.party.find((p) => p.classId === "plague-doctor")!;
    doctor.level = 1;
    const target = spawnMonster("goblin", 1);
    fireOnDamageDealt(doctor, target, 10, ctx);
    expect(target.activeStatusEffects.length).toBe(0);
  });

  test("a proc lasts the unlocked rank's durationTurns", () => {
    const rank3 = getClass("plague-doctor").passiveSkill.ranks.find((r) => r.rank === 3)!;
    withOverride(rank3, "durationTurns", 5, () => {
      let landed = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const { ctx } = makeCtx(seed);
        const doctor = ctx.party.find((p) => p.classId === "plague-doctor")!;
        doctor.level = 35;
        const target = spawnMonster("goblin", 1);
        fireOnDamageDealt(doctor, target, 10, ctx);
        for (const active of target.activeStatusEffects) {
          landed++;
          expect(active.turnsRemaining).toBe(5);
        }
      }
      expect(landed).toBeGreaterThan(0);
    });
  });
});

describe("On-hit statuses read their status and duration from the effect that grants them", () => {
  const poisonedOn = (target: Actor) => target.activeStatusEffects.find((s) => s.statusEffectId === "poisoned");

  test("a rider's hit applies its status for the onHitDurationTurns of the effect that granted the rider", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poison-coated", durationTurns: 3, onHitDurationTurns: 4 }, rogue, rogue, { log: [] });
    const target = spawnMonster("goblin", 1);
    applyOnHitRider(rogue, target, []);
    expect(poisonedOn(target)?.turnsRemaining).toBe(4);
  });

  test("granting the rider again without onHitDurationTurns keeps the earlier value", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poison-coated", durationTurns: 3, onHitDurationTurns: 4 }, rogue, rogue, { log: [] });
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poison-coated", durationTurns: 3 }, rogue, rogue, { log: [] });
    const target = spawnMonster("goblin", 1);
    applyOnHitRider(rogue, target, []);
    expect(poisonedOn(target)?.turnsRemaining).toBe(4);
  });

  test("a poisonOnHit proc applies the statusEffectId and durationTurns its artifact declares", () => {
    const effect = getArtifact("serpent-ring").effects.find((e): e is PoisonOnHit => e.kind === "poisonOnHit")!;
    withOverride(effect, "statusEffectId", "burning", () =>
      withOverride(effect, "durationTurns", 4, () => {
        let applied: { turnsRemaining: number } | undefined;
        for (let seed = 1; seed <= 500 && !applied; seed++) {
          const { ctx } = makeCtx(seed);
          const bearer = ctx.party.find((p) => p.classId === "vanguard")!;
          bearer.equippedArtifactIds.push("serpent-ring");
          const target = spawnMonster("goblin", 1);
          fireOnDamageDealt(bearer, target, 10, ctx);
          applied = target.activeStatusEffects.find((s) => s.statusEffectId === "burning");
        }
        expect(applied?.turnsRemaining).toBe(4);
      })
    );
  });

  test("every poisonOnHit effect names a real status and a whole duration of at least 1 turn", () => {
    const effects = [...ARTIFACTS.flatMap((a) => a.effects), ...ABILITIES.flatMap((a) => a.effects)].filter((e): e is PoisonOnHit => e.kind === "poisonOnHit");
    expect(effects.length).toBeGreaterThan(0);
    for (const e of effects) {
      expect(() => getStatusEffect(e.statusEffectId), `poisonOnHit status "${e.statusEffectId}"`).not.toThrow();
      expect(Number.isInteger(e.durationTurns) && e.durationTurns >= 1, `poisonOnHit durationTurns ${e.durationTurns}`).toBe(true);
    }
  });

  test("every effect in data/*.json that grants an on-hit rider declares onHitDurationTurns", () => {
    const riderIds = new Set(STATUS_EFFECTS.filter((s) => s.onHitStatusEffectId).map((s) => s.id));
    const missing: string[] = [];
    const walk = (node: unknown, where: string): void => {
      if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${where}[${i}]`));
      else if (node && typeof node === "object") {
        const effect = node as { kind?: string; statusEffectId?: string; alsoApplyStatusEffectIds?: string[]; onHitDurationTurns?: number };
        const granted = [effect.statusEffectId, ...(effect.alsoApplyStatusEffectIds ?? [])];
        if (effect.kind === "applyStatusEffect" && granted.some((id) => id !== undefined && riderIds.has(id)) && effect.onHitDurationTurns === undefined) missing.push(where);
        for (const [key, value] of Object.entries(node)) walk(value, `${where}.${key}`);
      }
    };
    const dataDir = join(import.meta.dir, "..", "data");
    for (const file of readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== "strings.json" && f !== "sprites.json")) {
      walk(JSON.parse(readFileSync(join(dataDir, file), "utf8")), file);
    }
    expect(missing).toEqual([]);
  });
});
