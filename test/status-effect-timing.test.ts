import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound } from "../src/engine/combat";
import type { CombatantRef } from "../src/types";
import { makeCtx, spawnInto } from "./helpers";

describe("status effect turn-countdown timing, per category", () => {
  test("DoT/HoT: casting round deals no damage; the tick lands at the start of the following round", () => {
    // Burning must land via an actual mid-round cast (not a direct pre-round apply, which would look
    // identical to "already active before round 1" and defeat the point of this test) — Fireball's
    // burn chance is 30%, so search seeds for one where it procs on the first cast.
    for (let seed = 0; seed < 300; seed++) {
      const { ctx } = makeCtx(seed);
      const mage = ctx.party.find((p) => p.classId === "mage")!;
      const rat1 = spawnInto(ctx, "dungeon-rat"); // Burning target — never attacked directly after round 1
      const rat2 = spawnInto(ctx, "dungeon-rat"); // keeps the mage busy in round 2 without touching rat1
      rat1.maxHp = 200;
      rat1.hp = 200;
      rat1.attack = 0;
      rat2.attack = 0;
      const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
      const mageRef: CombatantRef = { kind: "character", id: mage.id };
      const rat1Ref: CombatantRef = { kind: "monster", id: rat1.id };
      const rat2Ref: CombatantRef = { kind: "monster", id: rat2.id };

      queueAction(combat, mageRef, "mage-fireball", [rat1Ref], ctx);
      resolveRound(combat, ctx);
      const burning = rat1.activeStatusEffects.find((s) => s.statusEffectId === "burning");
      if (!burning) continue; // this seed's roll didn't proc Burning — try another
      expect(burning.turnsRemaining).toBe(2);
      const hpAfterRound1 = rat1.hp;

      queueAction(combat, mageRef, "mage-bludgeon", [rat2Ref], ctx);
      resolveRound(combat, ctx);
      expect(rat1.hp).toBe(hpAfterRound1 - 5);
      expect(rat1.activeStatusEffects.find((s) => s.statusEffectId === "burning")?.turnsRemaining).toBe(1);
      return;
    }
    throw new Error("no seed within range produced a Burning proc on the first Fireball cast");
  });

  test("Stat-mod: a 1-turn buff is already gone by the end of its own casting round", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };

    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    resolveRound(combat, ctx);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "guard")).toBe(false);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "taunt")).toBe(false);
  });

  test("Stat-mod: a 2-turn debuff decrements every round-end with no free round", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "weakened", turnsRemaining: 2 });
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    const ratRef: CombatantRef = { kind: "monster", id: rat.id };

    queueAction(combat, self, "vanguard-slash", [ratRef], ctx);
    resolveRound(combat, ctx);
    expect(vanguard.activeStatusEffects.find((s) => s.statusEffectId === "weakened")?.turnsRemaining).toBe(1);

    queueAction(combat, self, "vanguard-slash", [ratRef], ctx);
    resolveRound(combat, ctx);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(false);
  });

  test("Special, self-cast (Poison Coat): the casting round doesn't count; ticks at the caster's own next turn", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };
    const ratRef: CombatantRef = { kind: "monster", id: rat.id };

    queueAction(combat, self, "rogue-poison-coat", [self], ctx);
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.find((s) => s.statusEffectId === "poison-coat")?.turnsRemaining).toBe(3);

    queueAction(combat, self, "rogue-stab", [ratRef], ctx);
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.find((s) => s.statusEffectId === "poison-coat")?.turnsRemaining).toBe(2);
  });

  test("Special, refresh: re-casting an already-active special status doesn't lose a tick to the refreshing turn", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };

    queueAction(combat, self, "rogue-poison-coat", [self], ctx);
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.find((s) => s.statusEffectId === "poison-coat")?.turnsRemaining).toBe(3);

    // Bypass the skill's own cooldown so it can be re-cast immediately, purely to exercise the refresh path.
    rogue.cooldownsRemaining["rogue-poison-coat"] = 0;
    queueAction(combat, self, "rogue-poison-coat", [self], ctx);
    resolveRound(combat, ctx);
    // A refresh must behave like a first cast: still 3 right after the refreshing round, not ticked to 2.
    expect(rogue.activeStatusEffects.find((s) => s.statusEffectId === "poison-coat")?.turnsRemaining).toBe(3);
  });

  test("Poison Coat rank 2: poison-coat (special) and venom-edge (statMod-shaped) tick in lockstep", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.level = 10; // unlocks rogue-poison-coat rank 2 (unlockLevel 7), which also applies venom-edge
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };
    const ratRef: CombatantRef = { kind: "monster", id: rat.id };

    queueAction(combat, self, "rogue-poison-coat", [self], ctx);
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.find((s) => s.statusEffectId === "poison-coat")?.turnsRemaining).toBe(3);
    expect(rogue.activeStatusEffects.find((s) => s.statusEffectId === "venom-edge")?.turnsRemaining).toBe(3);

    queueAction(combat, self, "rogue-stab", [ratRef], ctx);
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.find((s) => s.statusEffectId === "poison-coat")?.turnsRemaining).toBe(2);
    expect(rogue.activeStatusEffects.find((s) => s.statusEffectId === "venom-edge")?.turnsRemaining).toBe(2);
  });

  test("Special, cross-target (Stunned): a target who hasn't acted yet this round ticks within that same round", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const vanguardRef: CombatantRef = { kind: "character", id: vanguard.id };
    const ratRef: CombatantRef = { kind: "monster", id: rat.id };

    // Simulates a faster attacker's stun landing before this round's turn order reaches Vanguard.
    vanguard.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 1 });
    queueAction(combat, vanguardRef, "vanguard-slash", [ratRef], ctx);
    resolveRound(combat, ctx);

    expect(combat.log.some((l) => l.text.includes("stunned"))).toBe(true);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "stunned")).toBe(false);
  });
});
