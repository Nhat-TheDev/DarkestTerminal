import { describe, test, expect } from "bun:test";
import { Game } from "../src/engine/game";
import { startCombat } from "../src/engine/combat";
import { getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";
import { migrateGameState } from "../src/engine/migration";
import { derivedRng } from "../src/engine/rng";
import { APP_VERSION } from "../src/engine/save";

const PARTY = ["knight", "mage", "rogue", "acolyte"];

/** A boss with 1 HP in the entry room, killed in one round after `burned` extra draws on the run's main stream. */
function winBossFight(seed: number, burned: number): Game {
  const game = new Game(seed, PARTY);
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
  boss.hp = 1;
  game.ctx.monsters.push(boss);
  room.type = "boss";
  room.monsterIds = [boss.id];
  room.cleared = false;
  game.state.combat = startCombat(room.id, [boss.id], game.ctx, true);
  for (let i = 0; i < burned; i++) game.ctx.rng.next();
  for (const ref of game.livingCharactersNeedingAction()) {
    const actor = game.state.party.find((c) => c.id === ref.id)!;
    expect(game.queue(ref, actor.unlockedSkillIds[0]!, [{ kind: "monster", id: boss.id }])).toBeNull();
  }
  game.resolve();
  expect(game.state.combat?.outcome).toBe("victory");
  return game;
}

function floorShape(game: Game) {
  return game.state.floor.rooms.map((room) => ({
    id: room.id,
    type: room.type,
    hidden: room.hidden,
    connectedRoomIds: room.connectedRoomIds,
    monsters: room.monsterIds.map((id) => game.ctx.monsters.find((m) => m.id === id)!.archetypeId),
  }));
}

describe("the run's random streams", () => {
  test("derivedRng gives the same stream for the same seed and labels, and another for any other", () => {
    const draws = (rng: ReturnType<typeof derivedRng>) => [rng.next(), rng.next(), rng.next()];
    expect(draws(derivedRng(7, "floor", 2))).toEqual(draws(derivedRng(7, "floor", 2)));
    expect(draws(derivedRng(7, "floor", 2))).not.toEqual(draws(derivedRng(7, "floor", 3)));
    expect(draws(derivedRng(7, "floor", 2))).not.toEqual(draws(derivedRng(8, "floor", 2)));
    expect(draws(derivedRng(7, "floor", 2))).not.toEqual(draws(derivedRng(7, "rewards", 2)));
  });

  test("what a fight drops does not depend on the draws spent winning it", () => {
    for (const seed of [3, 11, 42]) {
      const plain = winBossFight(seed, 0);
      const other = winBossFight(seed, 7);
      expect(other.ctx.rng.getState()).not.toBe(plain.ctx.rng.getState());
      expect(other.state.lastRoomDrops).toEqual(plain.state.lastRoomDrops);
      expect(plain.state.lastRoomDrops?.artifactIds).toHaveLength(1);
      expect(other.state.coins).toBe(plain.state.coins);
    }
  });

  test("the next floor does not depend on the draws spent on this one", () => {
    const plain = new Game(5, PARTY);
    const other = new Game(5, PARTY);
    expect(floorShape(other)).toEqual(floorShape(plain));
    for (const game of [plain, other]) game.state.combat = null;
    for (let i = 0; i < 13; i++) other.ctx.rng.next();
    plain.advanceToNextFloor();
    other.advanceToNextFloor();
    expect(plain.state.floor.depth).toBe(2);
    expect(floorShape(other)).toEqual(floorShape(plain));
  });

  test("a save from before the run seed gets one from its run id, the same every load", () => {
    const stored = () => {
      const state = JSON.parse(JSON.stringify(new Game(9, PARTY).state));
      state.runId = "0b9d6c0e-4f8a-4c57-9c6e-2f3f8f0a1d11";
      delete state.runSeed;
      return state;
    };
    const first = migrateGameState(stored(), APP_VERSION);
    expect(Number.isInteger(first.runSeed)).toBe(true);
    expect(migrateGameState(stored(), APP_VERSION).runSeed).toBe(first.runSeed);
  });
});
