import { describe, test, expect } from "bun:test";
import { Rng } from "../src/engine/rng";
import { startCombat, queueItemAction, checkItemUsable, resolveRound, autoResolveTargets } from "../src/engine/combat";
import { resolveSkillEffect, tickDotEffects, expireStatusEffect } from "../src/engine/resolver";
import { recomputeCharacterStats } from "../src/engine/party";
import { rollItemDrop, getItem, ITEMS, formatItemEffect } from "../src/data/items";
import { BALANCE } from "../src/data/balanceConfig";
import { getArchetype } from "../src/data/monsters";
import { Game } from "../src/engine/game";
import type { CombatantRef, ItemDefinition, StatusEffectDefinition } from "../src/types";
import { makeCtx, spawnInto } from "./helpers";
import { STATUS_EFFECTS, formatStatusEffectMechanics } from "../src/data/statusEffects";

describe("items", () => {
  test("rollItemDrop fires close to the configured 90% of the time", () => {
    const rng = new Rng(42);
    let drops = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      if (rollItemDrop("dungeon-rat", rng)) drops++;
    }
    expect(drops / total).toBeGreaterThan(0.86);
    expect(drops / total).toBeLessThan(0.94);
  });

  test("every item has a known tier, and a trophy (an item with archetypeIds) has no effects", () => {
    for (const item of ITEMS) {
      expect(Object.keys(BALANCE.items.tierWeights)).toContain(item.tier);
      if (item.archetypeIds?.length) expect(item.effects).toEqual([]);
      if (item.groupItem) expect(item.archetypeIds?.length ?? 0).toBeGreaterThan(1);
      for (const archetypeId of item.archetypeIds ?? []) expect(() => getArchetype(archetypeId)).not.toThrow();
    }
  });

  test("a trophy monster spends about trophyDropShare of its drops on its trophies", () => {
    const rng = new Rng(7);
    let trophyDrops = 0;
    let totalDrops = 0;
    for (let i = 0; i < 8000; i++) {
      const id = rollItemDrop("dungeon-rat", rng);
      if (!id) continue;
      totalDrops++;
      if (getItem(id).archetypeIds?.length) trophyDrops++;
    }
    expect(trophyDrops / totalDrops).toBeGreaterThan(BALANCE.items.trophyDropShare - 0.04);
    expect(trophyDrops / totalDrops).toBeLessThan(BALANCE.items.trophyDropShare + 0.04);
  });

  test("within a monster's trophies the drop weight follows the tier, and a group trophy is scaled down", () => {
    // Dungeon Rat: rat-tail (uncommon, 0.8) vs the vermin-hide group trophy (uncommon, 0.8 x 0.6 = 0.48).
    const rng = new Rng(3);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) {
      const id = rollItemDrop("dungeon-rat", rng);
      if (id === "rat-tail" || id === "vermin-hide") counts[id] = (counts[id] ?? 0) + 1;
    }
    const ratTailShare = (counts["rat-tail"] ?? 0) / ((counts["rat-tail"] ?? 0) + (counts["vermin-hide"] ?? 0));
    expect(ratTailShare).toBeGreaterThan(0.58);
    expect(ratTailShare).toBeLessThan(0.67);
  });

  test("an archetype with 3 trophies (Zombie Knight) splits its trophy share by tier weight, not evenly", () => {
    // rotten-flesh (common 1), broken-blade-fragment (uncommon 0.8), warped-vambrace (epic 0.1) share
    // the 40% trophy bucket roughly 1 : 0.8 : 0.1.
    const rng = new Rng(11);
    const counts: Record<string, number> = {};
    let totalDrops = 0;
    for (let i = 0; i < 12000; i++) {
      const id = rollItemDrop("zombie-knight", rng);
      if (!id) continue;
      totalDrops++;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect((counts["rotten-flesh"] ?? 0) / totalDrops).toBeGreaterThan(0.18);
    expect((counts["rotten-flesh"] ?? 0) / totalDrops).toBeLessThan(0.24);
    expect((counts["broken-blade-fragment"] ?? 0) / totalDrops).toBeGreaterThan(0.14);
    expect((counts["broken-blade-fragment"] ?? 0) / totalDrops).toBeLessThan(0.2);
    expect((counts["warped-vambrace"] ?? 0) / totalDrops).toBeLessThan(0.05);
  });

  test("a monster with no trophy (Lesser Vampire) only drops general-pool items, Exploration Kit included", () => {
    const rng = new Rng(5);
    let sawKit = false;
    for (let i = 0; i < 4000; i++) {
      const id = rollItemDrop("lesser-vampire", rng);
      if (!id) continue;
      expect(getItem(id).archetypeIds?.length ?? 0).toBe(0);
      if (id === "exploration-kit") sawKit = true;
    }
    expect(sawKit).toBe(true);
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

  test("a trophy shows 'No effect.' in item text", () => {
    expect(formatItemEffect(getItem("rat-tail"))).toBe("No effect.");
    expect(formatItemEffect(getItem("small-health-potion"))).not.toBe("No effect.");
  });

  test("using a trophy in combat spends it and logs that it has no effect", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    ctx.inventory["rat-tail"] = 1;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    expect(queueItemAction(combat, self, "rat-tail", [self], ctx)).toBeNull();
    expect(ctx.inventory["rat-tail"]).toBe(0);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text === "It has no effect at all. Strange.")).toBe(true);
  });

  test("using a trophy outside combat spends it and says it has no effect", () => {
    const game = new Game(4);
    game.state.inventory["rat-tail"] = 1;
    expect(game.useItemOutOfCombat("rat-tail", game.state.party[0]!.id)).toBeNull();
    expect(game.state.inventory["rat-tail"]).toBe(0);
    expect(game.state.message).toBe("It has no effect at all. Strange.");
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
    tickDotEffects(target, { log: [] });
    expect(target.hp).toBe(11);
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "regeneration" }, target, target, { log: [] });
    expect(target.activeStatusEffects.filter((s) => s.statusEffectId === "regeneration")).toHaveLength(1);
  });

  test("poison-vulnerable increases the bearer's own Poisoned DoT tick by 60%", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.activeStatusEffects.push({ statusEffectId: "poisoned", turnsRemaining: 3 });
    target.activeStatusEffects.push({ statusEffectId: "poison-vulnerable", turnsRemaining: 2 });
    const before = target.hp;
    tickDotEffects(target, { log: [] });
    const expectedTick = Math.max(1, Math.round((4 + target.maxHp * 0.025) * 1.6));
    expect(before - target.hp).toBe(expectedTick);
  });

  test("Game.useItemOutOfCombat heals outside combat, decrements inventory, and rejects singleEnemy items", () => {
    const game = new Game(1);
    const c = game.state.party[0]!;
    c.hp = 1;
    game.state.inventory["small-health-potion"] = 1;
    expect(game.useItemOutOfCombat("small-health-potion", c.id)).toBeNull();
    expect(c.hp).toBe(31);
    expect(game.state.inventory["small-health-potion"]).toBe(0);

    const bomb: ItemDefinition = { id: "test-enemy-item", name: "Test", description: "", target: "singleEnemy", effects: [], tier: "common" };
    ITEMS.push(bomb);
    try {
      game.state.inventory[bomb.id] = 1;
      expect(game.useItemOutOfCombat(bomb.id, c.id)).not.toBeNull();
    } finally {
      ITEMS.splice(ITEMS.indexOf(bomb), 1);
    }
  });

  test("Exploration Kit (allAllies satiety) is applied once outside combat, not once per party member", () => {
    const game = new Game(2);
    game.state.satiety = 40;
    game.state.inventory["exploration-kit"] = 1;
    expect(game.useItemOutOfCombat("exploration-kit")).toBeNull();
    expect(game.state.satiety).toBe(70);
  });

  test("a magic power status raises magicPower, survives a stat recompute and is undone on expiry", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((c) => c.classId === "mage")!;
    recomputeCharacterStats(mage, 100);
    const base = mage.magicPower;
    const focus: StatusEffectDefinition = {
      id: "test-focus",
      name: "Test Focus",
      description: "",
      perTurnEffects: [{ kind: "modifyCombatStat", combatStat: "magicPower", amount: 7 }],
    };
    STATUS_EFFECTS.push(focus);
    try {
      const log: never[] = [];
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: focus.id, durationTurns: 2 }, mage, mage, { log });
      expect(mage.magicPower).toBe(base + 7);
      recomputeCharacterStats(mage, 100);
      expect(mage.magicPower).toBe(base + 7);
      expireStatusEffect(mage, mage.activeStatusEffects[0]!, { log });
      expect(mage.magicPower).toBe(base);
    } finally {
      STATUS_EFFECTS.splice(STATUS_EFFECTS.indexOf(focus), 1);
    }
  });

  test("a magic power effect leaves a Monster untouched", () => {
    const { ctx } = makeCtx();
    const rat = spawnInto(ctx, "dungeon-rat");
    resolveSkillEffect({ kind: "modifyCombatStat", combatStat: "magicPower", amount: 5 }, ctx.party[0]!, rat, { log: [] });
    expect("magicPower" in rat).toBe(false);
  });

  test("item text names a damage amount and type, a named cure, and the allEnemies note", () => {
    const base = { name: "Test", description: "", tier: "common" } as const;
    const bomb: ItemDefinition = { ...base, id: "test-bomb", target: "allEnemies", effects: [{ kind: "damage", amount: 68, damageType: "fire", offenseMultiplierPercent: 0 }] };
    const cure: ItemDefinition = { ...base, id: "test-cure", target: "singleAlly", effects: [{ kind: "removeStatusEffect", statusEffectId: "poisoned" }] };
    expect(formatItemEffect(bomb)).toBe("Deals 68 fire damage. (all enemies — combat only)");
    expect(formatItemEffect(cure)).toBe("Removes Poisoned. (choose 1 ally)");
  });

  test("an allEnemies item is rejected outside combat and damages every enemy in combat", () => {
    const bomb: ItemDefinition = {
      id: "test-bomb",
      name: "Test Bomb",
      description: "",
      target: "allEnemies",
      effects: [{ kind: "damage", amount: 30, damageType: "fire", offenseMultiplierPercent: 0 }],
      tier: "common",
    };
    ITEMS.push(bomb);
    try {
      const game = new Game(6);
      game.state.inventory[bomb.id] = 1;
      expect(game.useItemOutOfCombat(bomb.id)).not.toBeNull();
      expect(game.state.inventory[bomb.id]).toBe(1);

      const { ctx } = makeCtx();
      const ratA = spawnInto(ctx, "dungeon-rat");
      const ratB = spawnInto(ctx, "dungeon-rat");
      ratA.attack = 0;
      ratB.attack = 0;
      ctx.inventory[bomb.id] = 1;
      const combat = startCombat("r1", [ratA.id, ratB.id], ctx, false);
      const self: CombatantRef = { kind: "character", id: ctx.party[0]!.id };
      const targets = autoResolveTargets("allEnemies", self, combat, ctx)!;
      expect(queueItemAction(combat, self, bomb.id, targets, ctx)).toBeNull();
      resolveRound(combat, ctx);
      expect(ratA.hp).toBeLessThan(ratA.maxHp);
      expect(ratB.hp).toBeLessThan(ratB.maxHp);
    } finally {
      ITEMS.splice(ITEMS.indexOf(bomb), 1);
    }
  });
});

describe("status effect mechanics text", () => {
  // A status that gains a new mechanical field without a branch in formatStatusEffectMechanics
  // must fail here rather than quietly rendering "no per-turn effect" to the player.
  test("every status effect describes itself from its own data", () => {
    for (const def of STATUS_EFFECTS) {
      const text = formatStatusEffectMechanics(def);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe("no per-turn effect");
    }
  });
});
