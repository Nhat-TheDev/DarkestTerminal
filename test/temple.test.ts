import { describe, expect, test } from "bun:test";
import { BALANCE } from "../src/data/balanceConfig";
import { CLASSES } from "../src/data/classes";
import { RELIGIONS, religionOf } from "../src/data/religions";
import { Game } from "../src/engine/game";
import { getRoom } from "../src/engine/dungeon";
import { characterStatBreakdown } from "../src/engine/party";
import { faithDecayForRoom, roundFaith } from "../src/engine/survival";
import { templeActionsAvailable, templeAskBoon, templeGiveAll, templeGiveBlood, templeLeave, templeMatchingMembers } from "../src/engine/temple";
import type { Character, Id } from "../src/types";
import { withTempleChance } from "./setup";

const [RELIGION_A, RELIGION_B, RELIGION_C] = RELIGIONS.map((r) => r.id) as [Id, Id, Id];
const classOf = (religionId: Id) => CLASSES.filter((c) => c.religionId === religionId).map((c) => c.id);

/** Party of two followers of A and two of B, in a temple of `templeReligion`; every member at 100/100 HP. */
function templeGame(templeReligion: Id = RELIGION_A): { game: Game; a: Character[]; b: Character[] } {
  const game = withTempleChance(1, () => new Game(1, [...classOf(RELIGION_A).slice(0, 2), ...classOf(RELIGION_B).slice(0, 2)]));
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  expect(room.type).toBe("temple");
  room.templeReligionId = templeReligion;
  for (const c of game.state.party) {
    c.maxHp = 100;
    c.hp = 100;
  }
  const a = game.state.party.filter((c) => religionOf(c).id === RELIGION_A);
  const b = game.state.party.filter((c) => religionOf(c).id === RELIGION_B);
  return { game, a, b };
}

const room = (game: Game) => getRoom(game.state.floor, game.state.currentRoomId);

describe("temple actions", () => {
  test("give blood upper band", () => {
    const { game, a } = templeGame();
    game.state.faith = 50;
    a[0]!.hp = 80;
    a[1]!.hp = 25;
    expect(game.templeGiveBlood()).toBeNull();
    expect(a[0]!.hp).toBe(30);
    expect(game.state.faith).toBe(65);
  });

  test("give blood at exactly the upper line never kills", () => {
    const { game, a } = templeGame();
    game.state.faith = 50;
    a[0]!.hp = 50;
    a[1]!.hp = 25;
    templeGiveBlood(game.state);
    expect(a[0]!.hp).toBe(5);
    expect(a[0]!.isAlive).toBe(true);
    expect(game.state.faith).toBe(65);
  });

  test("give blood middle band", () => {
    const { game, a } = templeGame();
    game.state.faith = 50;
    a[0]!.hp = 40;
    a[1]!.hp = 25;
    templeGiveBlood(game.state);
    expect(a[0]!.hp).toBe(5);
    expect(game.state.faith).toBe(55);
  });

  test("give blood skips the low band", () => {
    const { game, a } = templeGame();
    game.state.faith = 50;
    a[0]!.hp = 25;
    a[1]!.hp = 25;
    expect(templeActionsAvailable(game.state).giveBlood).toBe("locked");
    expect(templeGiveBlood(game.state)).not.toBeNull();
    expect(a[0]!.hp).toBe(25);
    expect(game.state.faith).toBe(50);
    expect(room(game).cleared).toBe(false);
  });

  test("give blood takes every eligible matching member", () => {
    const { game, a, b } = templeGame();
    game.state.faith = 50;
    a[0]!.hp = 80;
    a[1]!.hp = 40;
    templeGiveBlood(game.state);
    expect(game.state.faith).toBe(70);
    expect(b.every((c) => c.hp === 100)).toBe(true);
  });

  test("give all only when nobody living matches", () => {
    const { game, a } = templeGame();
    expect(templeActionsAvailable(game.state).giveAll).toBe(false);
    expect(templeGiveAll(game.state)).not.toBeNull();
    expect(room(game).cleared).toBe(false);
    for (const c of a) c.isAlive = false;
    expect(templeMatchingMembers(game.state)).toEqual([]);
    expect(templeActionsAvailable(game.state).giveAll).toBe(true);
  });

  test("dead matching member does not count at the temple", () => {
    const { game, a } = templeGame();
    a[0]!.isAlive = false;
    expect(templeMatchingMembers(game.state)).toEqual([a[1]!]);
    a[1]!.isAlive = false;
    expect(templeActionsAvailable(game.state)).toEqual({ giveBlood: "hidden", giveAll: true, boon: true });
  });

  test("give all costs everyone and can kill", () => {
    const { game } = templeGame(RELIGION_C);
    game.state.faith = 50;
    const [first, second, third, fourth] = game.state.party as [Character, Character, Character, Character];
    first.hp = 100;
    second.hp = 70;
    third.hp = 50;
    fourth.hp = 100;
    expect(game.templeGiveAll()).toBeNull();
    expect([first.hp, second.hp, third.hp]).toEqual([40, 10, 0]);
    expect(third.isAlive).toBe(false);
    expect(game.state.faith).toBe(80);
    expect(game.state.gameOver).toBeNull();
  });

  test("give all that kills everyone is a defeat", () => {
    const { game } = templeGame(RELIGION_C);
    for (const c of game.state.party) c.hp = 50;
    game.templeGiveAll();
    expect(game.state.party.every((c) => !c.isAlive)).toBe(true);
    expect(game.state.gameOver).toBe("defeat");
  });

  test("boon cost and gate", () => {
    const { game } = templeGame();
    game.state.faith = BALANCE.temple.boon.faithCost - 1;
    expect(templeActionsAvailable(game.state).boon).toBe(false);
    expect(templeAskBoon(game.state)).not.toBeNull();
    expect(game.state.boon).toBeNull();
    game.state.faith = 50;
    expect(templeActionsAvailable(game.state).boon).toBe(true);
    expect(templeAskBoon(game.state)).toBeNull();
    expect(game.state.faith).toBe(30);
    expect(game.state.boon).toEqual({ religionId: RELIGION_A, depth: game.state.floor.depth });
  });

  test("one action per visit", () => {
    for (const act of [templeGiveBlood, templeAskBoon, templeLeave]) {
      const { game } = templeGame();
      game.state.faith = 50;
      game.state.party[0]!.hp = 80;
      act(game.state);
      expect(room(game).cleared).toBe(true);
      expect(templeGiveBlood(game.state)).not.toBeNull();
      expect(templeGiveAll(game.state)).not.toBeNull();
      expect(templeAskBoon(game.state)).not.toBeNull();
      expect(templeActionsAvailable(game.state)).toEqual({ giveBlood: "hidden", giveAll: false, boon: false });
    }
    const { game } = templeGame(RELIGION_C);
    templeGiveAll(game.state);
    expect(room(game).cleared).toBe(true);
    expect(templeGiveAll(game.state)).not.toBeNull();
  });
});

describe("the boon", () => {
  const boonStats = BALANCE.temple.boon;
  const emphasisOf = (id: Id) => RELIGIONS.find((r) => r.id === id)!.boon;
  const religionWith = (pick: (boon: ReturnType<typeof emphasisOf>) => boolean) => RELIGIONS.find((r) => pick(r.boon))!.id;

  function boonedGame(templeReligion: Id) {
    const { game } = templeGame(templeReligion);
    const matching = game.state.party.filter((c) => religionOf(c).id === templeReligion);
    const other = game.state.party.filter((c) => religionOf(c).id !== templeReligion);
    const before = new Map(game.state.party.map((c) => [c.id, characterStatBreakdown(c, game.state.satiety, null)]));
    expect(templeAskBoon(game.state)).toBeNull();
    return { game, matching, other, before };
  }

  test("emphasis and matching multiplier", () => {
    const religion = religionWith((b) => b.emphasis === "defense");
    const { game, matching, other, before } = boonedGame(religion);
    expect(matching.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
    for (const [members, multiplier] of [[other, 1], [matching, boonStats.matchingMultiplier]] as const) {
      for (const c of members) {
        const base = before.get(c.id)!;
        const now = characterStatBreakdown(c, game.state.satiety, game.state.boon);
        expect(now.defense.total).toBe(Math.round(base.defense.total * (1 + (boonStats.emphasisPercent * multiplier) / 100)));
        expect(now.attack.total).toBe(Math.round(base.attack.total * (1 + (boonStats.statPercent * multiplier) / 100)));
        expect(now.magicPower.total).toBe(Math.round(base.magicPower.total * (1 + (boonStats.statPercent * multiplier) / 100)));
        expect(now.speed.total).toBe(Math.round(base.speed.total * (1 + (boonStats.statPercent * multiplier) / 100)));
        expect(now.maxHp.total).toBe(base.maxHp.total);
        expect(c.defense).toBe(now.defense.total);
        expect(now.defense.boon).toBe(now.defense.total - base.defense.total);
      }
    }
  });

  test("a recovering boon raises the three stats evenly", () => {
    const religion = religionWith((b) => b.recoversHpMp);
    expect(emphasisOf(religion).emphasis).toBeNull();
    const { game, other, before } = boonedGame(religion);
    const c = other[0]!;
    const base = before.get(c.id)!;
    const now = characterStatBreakdown(c, game.state.satiety, game.state.boon);
    for (const stat of ["attack", "defense", "magicPower", "speed"] as const) {
      expect(now[stat].total).toBe(Math.round(base[stat].total * (1 + boonStats.statPercent / 100)));
    }
  });

  test("plague boon recovers on room entry", () => {
    const religion = religionWith((b) => b.recoversHpMp);
    const { game, matching, other } = boonedGame(religion);
    const dead = other[1]!;
    dead.isAlive = false;
    dead.hp = 0;
    for (const c of game.state.party.filter((p) => p.isAlive)) {
      c.hp = 10;
      c.mp = 0;
    }
    const nextId = room(game).connectedRoomIds[0]!;
    game.move(nextId);
    for (const [members, multiplier] of [[other.slice(0, 1), 1], [matching, boonStats.matchingMultiplier]] as const) {
      for (const c of members) {
        expect(c.hp).toBe(10 + Math.round(c.maxHp * boonStats.recoveryPerRoom * multiplier));
        expect(c.mp).toBe(Math.round(c.maxMp * boonStats.recoveryPerRoom * multiplier));
      }
    }
    expect(dead.hp).toBe(0);
  });

  test("a boon without recovery does not heal on room entry", () => {
    const religion = religionWith((b) => !b.recoversHpMp);
    const { game } = boonedGame(religion);
    game.state.party[0]!.hp = 10;
    game.move(room(game).connectedRoomIds[0]!);
    expect(game.state.party[0]!.hp).toBe(10);
  });

  test("slows decay and ends with the floor", () => {
    const { game, before } = boonedGame(RELIGION_A);
    const faith = game.state.faith;
    game.move(room(game).connectedRoomIds[0]!);
    expect(game.state.faith).toBe(roundFaith(faith - faithDecayForRoom(faith, boonStats.decayMultiplier)));
    expect(faithDecayForRoom(faith, boonStats.decayMultiplier)).toBe(faithDecayForRoom(faith, 1) / 2);

    game.state.combat = null;
    game.advanceToNextFloor();
    expect(game.state.boon).toBeNull();
    const c = game.state.party[0]!;
    expect(c.defense).toBe(before.get(c.id)!.defense.total);
    expect(c.attack).toBe(before.get(c.id)!.attack.total);
  });
});
