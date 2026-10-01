import { describe, test, expect } from "bun:test";
import { Game } from "../src/engine/game";
import { enterRoom, getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";
import { tickDotEffects } from "../src/engine/resolver";
import { barterBuffFor, barterCost } from "../src/engine/events/barter";
import { rollRestRunner } from "../src/engine/events/runner";
import { rollBarterOffers } from "../src/data/shopStock";
import { getArchetype } from "../src/data/monsters";
import { BARTER_ENTRIES } from "../src/data/barter";
import { getItem } from "../src/data/items";
import { Rng } from "../src/engine/rng";
import { BALANCE } from "../src/data/balanceConfig";
import { ITEMS } from "../src/data/items";

function bossRoomGame(seed: number, type: "boss" | "combat" = "boss") {
  const game = new Game(seed);
  game.state.combat = null;
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = type;
  const monster = spawnMonster("dungeon-rat", 1);
  monster.hp = 1;
  game.ctx.monsters.push(monster);
  room.monsterIds = [monster.id];
  room.cleared = false;
  return { game, room, monster };
}

/** Total percent the given trophies' buffs give a stat, read from `data/barter.json` so the tests follow the data. */
function percentOf(itemIds: string[], stat: "attack" | "defense" | "speed" | "regen"): number {
  let total = 0;
  for (const effect of itemIds.flatMap((id) => barterBuffFor(id))) {
    if (effect.kind === "healOverTime") {
      if (stat === "regen") total += effect.maxHpPercentPerTurn;
    } else if (effect.stat === stat) total += effect.percent;
  }
  return total;
}

describe("data/barter.json", () => {
  test("every trophy has exactly one entry, with a whole cost and a buff", () => {
    const trophyIds = ITEMS.filter((i) => i.archetypeIds?.length).map((i) => i.id);
    expect(BARTER_ENTRIES.map((e) => e.itemId).sort()).toEqual(trophyIds.sort());
    for (const entry of BARTER_ENTRIES) {
      expect(Number.isInteger(entry.cost) && entry.cost >= 1).toBe(true);
      expect(entry.effects.length).toBeGreaterThan(0);
    }
  });

  test("an item that isn't a trophy has no buff", () => {
    expect(() => barterBuffFor("small-health-potion")).toThrow();
  });

  test("a trade costs what the entry says", () => {
    for (const entry of BARTER_ENTRIES) expect(barterCost(entry.itemId)).toBe(entry.cost);
  });
});

describe("applying pending barter buffs", () => {
  test("entering the elite/boss room applies them to the living party and empties the list", () => {
    const { game, room } = bossRoomGame(1);
    game.state.pendingBarterBuffs = ["chitin-shard"];
    const before = game.state.party.map((c) => ({ defense: c.defense, speed: c.speed, attack: c.attack }));
    enterRoom(game.state, room, game.ctx);
    game.state.party.forEach((c, i) => {
      const defensePercent = percentOf(["chitin-shard"], "defense");
      const speedPercent = percentOf(["chitin-shard"], "speed");
      expect(c.defense).toBe(before[i]!.defense + Math.round((defensePercent / 100) * (BALANCE.combat.defenseMitigationX + before[i]!.defense)));
      expect(c.speed).toBe(before[i]!.speed + Math.round((speedPercent / 100) * before[i]!.speed));
      expect(c.attack).toBe(before[i]!.attack + Math.round((percentOf(["chitin-shard"], "attack") / 100) * before[i]!.attack));
    });
    expect(game.state.pendingBarterBuffs).toEqual([]);
    expect(game.state.combat?.log.some((l) => l.text === "The runner's bargains take hold: Chitin Shard.")).toBe(true);
  });

  test("an ordinary combat room leaves them waiting", () => {
    const { game, room } = bossRoomGame(2, "combat");
    game.state.pendingBarterBuffs = ["chitin-shard"];
    const defense = game.state.party[0]!.defense;
    enterRoom(game.state, room, game.ctx);
    expect(game.state.party[0]!.defense).toBe(defense);
    expect(game.state.pendingBarterBuffs).toEqual(["chitin-shard"]);
  });

  test("buffs raising the same stat add up", () => {
    const { game, room } = bossRoomGame(3);
    const picked = ["warband-trophy", "rat-tail"];
    game.state.pendingBarterBuffs = picked;
    const attacks = game.state.party.map((c) => c.attack);
    enterRoom(game.state, room, game.ctx);
    const percent = percentOf(picked, "attack");
    expect(percent).toBeGreaterThan(percentOf(["warband-trophy"], "attack")); // both buffs raise attack
    game.state.party.forEach((c, i) => expect(c.attack).toBe(attacks[i]! + Math.round((percent / 100) * attacks[i]!)));
  });

  test("an attack buff also raises a caster's magic power", () => {
    const { game, room } = bossRoomGame(4);
    const mage = game.state.party.find((c) => c.classId === "mage")!;
    game.state.pendingBarterBuffs = ["warband-trophy"];
    const magic = mage.magicPower;
    enterRoom(game.state, room, game.ctx);
    expect(mage.magicPower).toBe(magic + Math.round((percentOf(["warband-trophy"], "attack") / 100) * magic));
  });

  test("a regeneration buff heals its share of max HP each turn", () => {
    const { game, room } = bossRoomGame(5);
    game.state.pendingBarterBuffs = ["slime-solution"];
    enterRoom(game.state, room, game.ctx);
    const c = game.state.party[0]!;
    c.hp = 1;
    tickDotEffects(c, { log: [] });
    expect(c.hp).toBe(1 + Math.round((c.maxHp * percentOf(["slime-solution"], "regen")) / 100));
  });

  test("the buffs end with the fight", () => {
    const { game, room, monster } = bossRoomGame(6);
    game.state.pendingBarterBuffs = ["chitin-shard"];
    const defenses = game.state.party.map((c) => c.defense);
    enterRoom(game.state, room, game.ctx);
    const attacker = game.state.party[0]!;
    game.queue({ kind: "character", id: attacker.id }, attacker.unlockedSkillIds[0]!, [{ kind: "monster", id: monster.id }]);
    game.resolve();
    expect(game.state.combat?.outcome).toBe("victory");
    game.state.party.forEach((c, i) => {
      expect(c.defense).toBe(defenses[i]!);
      expect(c.activeStatusEffects.some((s) => s.statusEffectId.startsWith("barter-"))).toBe(false);
    });
  });

  test("a buff not used by the end of the floor is lost", () => {
    const game = new Game(7);
    game.state.pendingBarterBuffs = ["chitin-shard"];
    game.advanceToNextFloor();
    expect(game.state.pendingBarterBuffs).toEqual([]);
  });
});

describe("barter offers and trade", () => {
  function runnerGame(seed: number) {
    const game = new Game(seed);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "rest";
    room.cleared = false;
    game.state.restRunner = {
      roomId: room.id,
      noticeShown: true,
      noticeVariant: 0,
      offers: [],
      refreshCount: 0,
      barterOffers: [{ itemId: "rat-tail" }, { itemId: "warped-vambrace" }],
    };
    return { game, room };
  }

  test("2 different trophy kinds that can drop at this depth are offered", () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const depth of [1, 40, 120]) {
        const offers = rollBarterOffers(new Rng(seed), depth);
        expect(offers.length).toBe(BALANCE.barter.offerCount);
        expect(new Set(offers.map((o) => o.itemId)).size).toBe(offers.length);
        for (const { itemId } of offers) {
          const item = getItem(itemId);
          expect(item.archetypeIds?.length).toBeGreaterThan(0);
          expect(item.archetypeIds!.some((id) => (getArchetype(id).minFloor ?? 0) <= depth)).toBe(true);
        }
      }
    }
  });

  test("Legendary trophies are offered once their monsters can appear", () => {
    let sawLegendary = false;
    for (let seed = 1; seed <= 400; seed++) {
      if (rollBarterOffers(new Rng(seed), 120).some((o) => getItem(o.itemId).tier === "legendary")) sawLegendary = true;
      for (const o of rollBarterOffers(new Rng(seed), 1)) expect(getItem(o.itemId).tier).not.toBe("legendary");
    }
    expect(sawLegendary).toBe(true);
  });

  test("trading takes the trophies, queues the buff and marks the floor's barter as used", () => {
    const { game } = runnerGame(1);
    const cost = barterCost("rat-tail");
    game.state.inventory["rat-tail"] = cost + 1;
    expect(game.runnerBarter(0)).toBeNull();
    expect(game.state.inventory["rat-tail"]).toBe(1);
    expect(game.state.pendingBarterBuffs).toEqual(["rat-tail"]);
    expect(game.state.barterUsedDepth).toBe(game.state.floor.depth);
    expect(game.state.restRunner?.barterOffers?.[0]?.done).toBe(true);
    expect(game.state.message).toBe(`The runner takes ${cost} Rat Tail. The bargain is struck.`);
    expect(game.runnerBarter(0)).not.toBeNull(); // each offer is made once
  });

  test("too few trophies is refused and nothing changes", () => {
    const { game } = runnerGame(2);
    const short = barterCost("rat-tail") - 1;
    game.state.inventory["rat-tail"] = short;
    expect(game.runnerBarter(0)).not.toBeNull();
    expect(game.state.inventory["rat-tail"]).toBe(short);
    expect(game.state.pendingBarterBuffs).toEqual([]);
    expect(game.state.barterUsedDepth).toBeNull();
  });

  test("both offers can be traded in one visit, and the buffs queue in order", () => {
    const { game } = runnerGame(3);
    game.state.inventory["rat-tail"] = barterCost("rat-tail");
    game.state.inventory["warped-vambrace"] = barterCost("warped-vambrace");
    expect(game.runnerBarter(0)).toBeNull();
    expect(game.runnerBarter(1)).toBeNull();
    expect(game.state.pendingBarterBuffs).toEqual(["rat-tail", "warped-vambrace"]);
    expect(game.state.inventory["warped-vambrace"]).toBe(0);
  });

  test("with no runner there is nothing to trade", () => {
    const game = new Game(4);
    game.state.restRunner = null;
    expect(game.runnerBarter(0)).not.toBeNull();
  });

  test("later Rest rooms on the same floor have no barter, and the next floor has it again", () => {
    const { game } = runnerGame(5);
    game.state.barterUsedDepth = game.state.floor.depth;
    const secondRoom = getRoom(game.state.floor, game.state.currentRoomId);
    const runnerNow = () => game.state.restRunner; // read through a function so the assignments below don't narrow it to null
    let withRunner = 0;
    for (let i = 0; i < 200 && withRunner < 5; i++) {
      game.state.restRunner = null;
      rollRestRunner(game.state, secondRoom, game.ctx);
      const runner = runnerNow();
      if (runner) {
        withRunner++;
        expect(runner.barterOffers).toEqual([]);
      }
    }
    expect(withRunner).toBeGreaterThan(0);

    game.state.barterUsedDepth = game.state.floor.depth - 1; // used on an earlier floor
    let sawOffers = false;
    for (let i = 0; i < 200 && !sawOffers; i++) {
      game.state.restRunner = null;
      rollRestRunner(game.state, secondRoom, game.ctx);
      if (runnerNow()?.barterOffers?.length) sawOffers = true;
    }
    expect(sawOffers).toBe(true);
  });
});
