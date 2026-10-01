import { describe, test, expect } from "bun:test";
import { Game } from "../src/engine/game";
import { enterRoom, getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";
import { tickDotEffects } from "../src/engine/resolver";
import { barterBuffFor } from "../src/engine/events/barter";
import { BALANCE } from "../src/data/balanceConfig";
import { getStatusEffect } from "../src/data/statusEffects";
import type { ItemTier } from "../src/types";

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

describe("barterBuffFor", () => {
  test("a balanced individual trophy splits its strength between attack and defense, and its race adds a secondary", () => {
    // rat-tail: uncommon (P = 8); Dungeon Rat is a balanced beast, so attack 4 + defense 4, beast adds speed at half of P.
    expect(barterBuffFor("rat-tail")).toEqual([
      { stat: "attack", percent: 4 },
      { stat: "defense", percent: 4 },
      { stat: "speed", percent: 4 },
    ]);
  });

  test("a group trophy uses the most common monster type among its monsters", () => {
    // chitin-shard: rare (P = 12); snake/lizard/spider/armored-beetle are 2 armored, 1 glass, 1 bruiser.
    expect(barterBuffFor("chitin-shard")).toEqual([
      { stat: "defense", percent: 12 },
      { stat: "speed", percent: 6 },
    ]);
  });

  test("a tie goes to the first monster, and a secondary on the same stat is added to the primary", () => {
    // warband-trophy: striker, glass, bruiser tie so the first (striker, attack) wins; demi-human adds attack at half of P.
    expect(barterBuffFor("warband-trophy")).toEqual([{ stat: "attack", percent: 18 }]);
    // venom-gland: glass, armored, bruiser tie so the first (glass, attack) wins; beast adds speed.
    expect(barterBuffFor("venom-gland")).toEqual([
      { stat: "attack", percent: 12 },
      { stat: "speed", percent: 6 },
    ]);
  });

  test("an item that isn't a trophy has no buff", () => {
    expect(() => barterBuffFor("small-health-potion")).toThrow();
  });

  test("each regen status heals the tier's secondary share of max HP", () => {
    for (const [tier, percent] of Object.entries(BALANCE.barter.magnitudePercentByTier) as [ItemTier, number][]) {
      const heal = getStatusEffect(`barter-regen-${tier}`).perTurnEffects[0]!;
      expect(heal.maxHpPercent).toBe(percent * BALANCE.barter.secondaryShare);
    }
  });
});

describe("applying pending barter buffs", () => {
  test("entering the elite/boss room applies them to the living party and empties the list", () => {
    const { game, room } = bossRoomGame(1);
    game.state.pendingBarterBuffs = ["chitin-shard"];
    const before = game.state.party.map((c) => ({ defense: c.defense, speed: c.speed, attack: c.attack }));
    enterRoom(game.state, room, game.ctx);
    game.state.party.forEach((c, i) => {
      expect(c.defense).toBe(before[i]!.defense + Math.round(0.12 * (BALANCE.combat.defenseMitigationX + before[i]!.defense)));
      expect(c.speed).toBe(before[i]!.speed + Math.round(0.06 * before[i]!.speed));
      expect(c.attack).toBe(before[i]!.attack);
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
    game.state.pendingBarterBuffs = ["warband-trophy", "rat-tail"]; // attack 18% + attack 4%
    const attacks = game.state.party.map((c) => c.attack);
    enterRoom(game.state, room, game.ctx);
    game.state.party.forEach((c, i) => expect(c.attack).toBe(attacks[i]! + Math.round(0.22 * attacks[i]!)));
  });

  test("an attack buff also raises a caster's magic power", () => {
    const { game, room } = bossRoomGame(4);
    const mage = game.state.party.find((c) => c.classId === "mage")!;
    game.state.pendingBarterBuffs = ["warband-trophy"];
    const magic = mage.magicPower;
    enterRoom(game.state, room, game.ctx);
    expect(mage.magicPower).toBe(magic + Math.round(0.18 * magic));
  });

  test("a regeneration buff heals its share of max HP each turn", () => {
    const { game, room } = bossRoomGame(5);
    game.state.pendingBarterBuffs = ["slime-solution"]; // common, slime race: regen at 2.5% of max HP
    enterRoom(game.state, room, game.ctx);
    const c = game.state.party[0]!;
    c.hp = 1;
    tickDotEffects(c, { log: [] });
    expect(c.hp).toBe(1 + Math.round(c.maxHp * 0.025));
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
