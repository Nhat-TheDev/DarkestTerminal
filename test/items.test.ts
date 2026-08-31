import { describe, test, expect } from "bun:test";
import { getClass } from "../src/data/classes";
import { Rng } from "../src/engine/rng";
import { startCombat, queueItemAction, checkItemUsable, resolveRound } from "../src/engine/combat";
import { resolveSkillEffect, tickStatusEffects } from "../src/engine/resolver";
import { rollItemDrop, getItem } from "../src/data/items";
import { Game } from "../src/engine/game";
import type { CombatantRef } from "../src/types";
import { makeCtx, spawnInto } from "./helpers";

describe("items", () => {
  test("rollItemDrop fires close to the spec'd 60% of the time", () => {
    const rng = new Rng(42);
    let drops = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      if (rollItemDrop("dungeon-rat", rng)) drops++;
    }
    expect(drops / total).toBeGreaterThan(0.55);
    expect(drops / total).toBeLessThan(0.65);
  });

  test("on a successful roll, roughly half go to the archetype's own signature item", () => {
    const rng = new Rng(7);
    let signatureHits = 0;
    let totalDrops = 0;
    for (let i = 0; i < 8000; i++) {
      const id = rollItemDrop("dungeon-rat", rng);
      if (!id) continue;
      totalDrops++;
      if (id === "rat-meat") signatureHits++;
    }
    expect(totalDrops).toBeGreaterThan(0);
    expect(signatureHits / totalDrops).toBeGreaterThan(0.4);
    expect(signatureHits / totalDrops).toBeLessThan(0.6);
  });

  test("an archetype in 3 groups (Zombie Knight) splits the signature share by weight, not evenly", () => {
    // Zombie Knight's signature pool is now rotten-flesh (weight 1), broken-blade-fragment (weight 0.5),
    // and the low-weight Exploration Kit (weight 0.15, shared across several humanoid archetypes) — so
    // the 50% signature share splits ~30/15/5 by weight rather than evenly across "both" items.
    const rng = new Rng(11);
    const counts: Record<string, number> = {};
    let totalDrops = 0;
    for (let i = 0; i < 12000; i++) {
      const id = rollItemDrop("zombie-knight", rng);
      if (!id) continue;
      totalDrops++;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    const rottenFleshRatio = (counts["rotten-flesh"] ?? 0) / totalDrops;
    const bladeFragmentRatio = (counts["broken-blade-fragment"] ?? 0) / totalDrops;
    expect(rottenFleshRatio).toBeGreaterThan(0.25);
    expect(rottenFleshRatio).toBeLessThan(0.37);
    expect(bladeFragmentRatio).toBeGreaterThan(0.1);
    expect(bladeFragmentRatio).toBeLessThan(0.2);
  });

  test("a base-pool item is still reachable for an archetype that also has a signature item", () => {
    const rng = new Rng(3);
    let sawBaseItem = false;
    for (let i = 0; i < 4000 && !sawBaseItem; i++) {
      const id = rollItemDrop("dungeon-rat", rng);
      if (id && !getItem(id).archetypeIds) sawBaseItem = true;
    }
    expect(sawBaseItem).toBe(true);
  });

  test("queueItemAction deducts inventory at queue time and applies the item's effect on resolve", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    vanguard.hp = vanguard.maxHp - 30;
    ctx.inventory["small-health-potion"] = 1;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    const err = queueItemAction(combat, self, "small-health-potion", [self], ctx);
    expect(err).toBeNull();
    expect(ctx.inventory["small-health-potion"]).toBe(0);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("recovers 30 HP"))).toBe(true);
  });

  test("checkItemUsable rejects when inventory has 0 of the item", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    expect(checkItemUsable(vanguard, "small-health-potion", ctx.inventory)).not.toBeNull();
  });

  test("Regeneration heals 10 HP/turn and refreshes (doesn't stack a 2nd instance) when reapplied while active", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.hp = 1;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "regeneration" }, target, target, { log: [] });
    expect(target.activeStatusEffects.filter((s) => s.statusEffectId === "regeneration")).toHaveLength(1);
    tickStatusEffects(target, { log: [] });
    expect(target.hp).toBe(11);
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "regeneration" }, target, target, { log: [] });
    expect(target.activeStatusEffects.filter((s) => s.statusEffectId === "regeneration")).toHaveLength(1);
  });

  test("poison-vulnerable doubles the bearer's own Poisoned DoT tick", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.activeStatusEffects.push({ statusEffectId: "poisoned", turnsRemaining: 3 });
    target.activeStatusEffects.push({ statusEffectId: "poison-vulnerable", turnsRemaining: 2 });
    const before = target.hp;
    tickStatusEffects(target, { log: [] });
    expect(before - target.hp).toBe(8);
  });

  test("Game.useItemOutOfCombat heals outside combat, decrements inventory, and rejects singleEnemy items", () => {
    const game = new Game(1);
    const c = game.state.party[0]!;
    c.hp = 1;
    game.state.inventory["small-health-potion"] = 1;
    expect(game.useItemOutOfCombat("small-health-potion", c.id)).toBeNull();
    expect(c.hp).toBe(31);
    expect(game.state.inventory["small-health-potion"]).toBe(0);

    game.state.inventory["venom-thorn"] = 1;
    expect(game.useItemOutOfCombat("venom-thorn", c.id)).not.toBeNull();
  });

  test("Dragon Scale (allAllies) buffs every living party member at once outside combat", () => {
    const game = new Game(2);
    game.state.inventory["dragon-scale"] = 1;
    expect(game.useItemOutOfCombat("dragon-scale")).toBeNull();
    for (const c of game.state.party) {
      if (c.isAlive) expect(c.defense).toBeGreaterThan(getClass(c.classId).baseDefense);
    }
  });
});

