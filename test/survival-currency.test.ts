import { describe, test, expect } from "bun:test";
import { Rng } from "../src/engine/rng";
import { Game } from "../src/engine/game";
import { spawnMonster } from "../src/data/monsters";
import { rollCoinDrop } from "../src/data/currency";
import { migrateGameState } from "../src/engine/migration";
import { startCombat } from "../src/engine/combat";
import { BALANCE } from "../src/data/balanceConfig";
import { makeCtx } from "./helpers";

describe("Camp", () => {
  test("camp() consumes 1 Exploration Kit and restores satiety only, never HP/MP", () => {
    const game = new Game(1);
    game.state.satiety = 40;
    game.state.inventory["exploration-kit"] = 2;
    const c = game.state.party[0]!;
    c.hp = 1;
    expect(game.camp()).toBeNull();
    expect(game.state.satiety).toBe(70);
    expect(game.state.inventory["exploration-kit"]).toBe(1);
    expect(c.hp).toBe(1); // untouched
  });

  test("camp() fails once the party has 0 kits", () => {
    const game = new Game(2);
    game.state.inventory["exploration-kit"] = 0;
    expect(game.camp()).not.toBeNull();
  });

  test("party starts with BALANCE.party.startingExplorationKits", () => {
    const game = new Game(3);
    expect(game.state.inventory["exploration-kit"]).toBe(BALANCE.party.startingExplorationKits);
  });
});

describe("coins", () => {
  test("rollCoinDrop stays within the configured [min,max] range per tier", () => {
    const rng = new Rng(1);
    const weak = spawnMonster("dungeon-rat", 1);
    for (let i = 0; i < 200; i++) {
      const amount = rollCoinDrop(weak, rng);
      expect(amount).toBeGreaterThanOrEqual(BALANCE.currency.coinDropByTier.weak[0]);
      expect(amount).toBeLessThanOrEqual(BALANCE.currency.coinDropByTier.weak[1]);
    }
    const boss = spawnMonster("dungeon-rat", 1, { tier: "boss" });
    for (let i = 0; i < 200; i++) {
      const amount = rollCoinDrop(boss, rng);
      expect(amount).toBeGreaterThanOrEqual(BALANCE.currency.coinDropByTier.boss[0]);
      expect(amount).toBeLessThanOrEqual(BALANCE.currency.coinDropByTier.boss[1]);
    }
  });

  test("coins are 100% drop chance and party-wide", () => {
    const { ctx } = makeCtx();
    const rat = spawnMonster("dungeon-rat", 1);
    const rng = new Rng(2);
    for (let i = 0; i < 50; i++) expect(rollCoinDrop(rat, rng)).toBeGreaterThan(0);
    void ctx;
  });
});

describe("save-file migration", () => {
  test("migrateGameState fills in coins/satiety/pendingArtifactDecision defaults on a pre-rework save", () => {
    const legacy = { party: [], inventory: {} } as unknown as Parameters<typeof migrateGameState>[0];
    const migrated = migrateGameState(legacy);
    expect(migrated.coins).toBe(0);
    expect(migrated.satiety).toBe(BALANCE.survival.initialSatiety);
    expect(migrated.pendingArtifactDecision).toBeNull();
    expect(migrated.secondJackpotArtifactId).toBeNull();
  });

  test("migrateGameState defaults metNarrativeNpcIds to [] on a pre-§10.2 save, leaves lastGamblingDenOutcome undefined", () => {
    const legacy = { party: [], inventory: {} } as unknown as Parameters<typeof migrateGameState>[0];
    const migrated = migrateGameState(legacy);
    expect(migrated.metNarrativeNpcIds).toEqual([]);
    expect(migrated.lastGamblingDenOutcome).toBeUndefined();
  });

  test("migrateGameState auto-equips a legacy artifact pool onto characters with room", () => {
    const game = new Game(4);
    const legacyRaw = {
      ...game.state,
      unequippedArtifactIds: ["iron-gauntlet", "sharp-claw", "ancient-sword", "heart-of-stone"],
    };
    const migrated = migrateGameState(legacyRaw);
    expect((migrated as unknown as { unequippedArtifactIds?: unknown }).unequippedArtifactIds).toBeUndefined();
    const totalEquipped = migrated.party.reduce((sum, c) => sum + c.equippedArtifactIds.length, 0);
    expect(totalEquipped).toBeGreaterThan(0);
    expect(totalEquipped).toBeLessThanOrEqual(migrated.party.length * 3);
  });

  test("migrateGameState strips inventory entries for items no longer in the catalog", () => {
    const game = new Game(5);
    const legacyRaw = { ...game.state, inventory: { ...game.state.inventory, ration: 3, "water-flask": 2 } };
    const migrated = migrateGameState(legacyRaw);
    expect(migrated.inventory["ration"]).toBeUndefined();
    expect(migrated.inventory["water-flask"]).toBeUndefined();
  });

  test("migrateGameState strips active status effects for ids no longer in the catalog", () => {
    const game = new Game(6);
    const bearer = game.state.party[0]!;
    bearer.activeStatusEffects = [
      { statusEffectId: "poison-coat-ii", turnsRemaining: 2 }, // rank id removed by the poison-coat/venom-edge split
      { statusEffectId: "guard", turnsRemaining: 1 },
    ];
    const migrated = migrateGameState({ ...game.state });
    const migratedBearer = migrated.party.find((c) => c.id === bearer.id)!;
    expect(migratedBearer.activeStatusEffects).toEqual([{ statusEffectId: "guard", turnsRemaining: 1 }]);
  });
});

describe("combat reward reveal sync", () => {
  function setUpOneHitVictory(seed: number) {
    const game = new Game(seed);
    const monster = spawnMonster("dungeon-rat", 1);
    monster.hp = 1;
    monster.maxHp = 1;
    monster.attack = 0;
    const room = game.state.floor.rooms.find((r) => r.id === game.state.currentRoomId)!;
    room.monsterIds = [monster.id];
    game.ctx.monsters.push(monster);
    game.state.combat = startCombat(room.id, [monster.id], game.ctx, false);
    return { game, monster };
  }

  test("roundStartPartySnapshot captures coins/EXP/satiety as they stood before this round", () => {
    const { game, monster } = setUpOneHitVictory(101);
    const coinsBefore = game.state.coins;
    const partyExpBefore = game.state.partyExp;
    const satietyBefore = game.state.satiety;

    const attacker = game.state.party[0]!;
    game.queue({ kind: "character", id: attacker.id }, attacker.unlockedSkillIds[0]!, [{ kind: "monster", id: monster.id }]);
    game.resolve();

    expect(game.state.combat?.roundStartPartySnapshot).toEqual({ coins: coinsBefore, partyExp: partyExpBefore, satiety: satietyBefore });
  });

  test("post-victory reward log lines carry a partySnapshot matching the final coins/EXP/satiety, not the pre-battle values", () => {
    const { game, monster } = setUpOneHitVictory(102);
    const attacker = game.state.party[0]!;
    game.queue({ kind: "character", id: attacker.id }, attacker.unlockedSkillIds[0]!, [{ kind: "monster", id: monster.id }]);
    game.resolve();

    const log = game.state.combat!.log;
    const expLine = log.find((l) => l.text.includes("EXP"))!;
    expect(expLine.partySnapshot).toEqual({ coins: game.state.coins, partyExp: game.state.partyExp, satiety: game.state.satiety });
    expect(expLine.snapshot).toBeDefined();
  });

  test("combat-action log lines (before the reward block) carry no partySnapshot — coins/EXP/satiety don't change mid-round", () => {
    const { game, monster } = setUpOneHitVictory(103);
    const attacker = game.state.party[0]!;
    game.queue({ kind: "character", id: attacker.id }, attacker.unlockedSkillIds[0]!, [{ kind: "monster", id: monster.id }]);
    game.resolve();

    const log = game.state.combat!.log;
    const firstRewardIndex = log.findIndex((l) => l.partySnapshot !== undefined);
    expect(firstRewardIndex).toBeGreaterThan(0);
    for (let i = 0; i < firstRewardIndex; i++) {
      expect(log[i]!.partySnapshot).toBeUndefined();
    }
  });
});
