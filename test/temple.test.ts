import { describe, expect, test } from "bun:test";
import { BALANCE } from "../src/data/balanceConfig";
import { CLASSES } from "../src/data/classes";
import { RELIGIONS, religionOf } from "../src/data/religions";
import { Game } from "../src/engine/game";
import { getRoom } from "../src/engine/dungeon";
import { characterStatBreakdown } from "../src/engine/party";
import { faithDecayForRoom, roundFaith } from "../src/engine/survival";
import { bloodGift, templeActionsAvailable, templeAskBoon, templeGiveBlood, templeLeave } from "../src/engine/temple";
import type { Character, Id } from "../src/types";
import { withTempleChance } from "./setup";

const [RELIGION_A, RELIGION_B] = RELIGIONS.map((r) => r.id) as [Id, Id];
const classOf = (religionId: Id) => CLASSES.filter((c) => c.religionId === religionId).map((c) => c.id);

/** Party of two followers of A and two of B, in a temple of `templeReligion`; every member at 100/100 HP. */
function templeGame(templeReligion: Id = RELIGION_A, classes = [...classOf(RELIGION_A).slice(0, 2), ...classOf(RELIGION_B).slice(0, 2)]): { game: Game; a: Character[]; b: Character[] } {
  const game = withTempleChance(1, () => new Game(1, classes));
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
  test("a follower at or above the upper line gives the full cost", () => {
    const { game, a } = templeGame();
    game.state.faith = 50;
    a[0]!.hp = 80;
    expect(bloodGift(game.state, a[0]!)).toEqual({ hpAfter: 30, faith: 18 });
    expect(game.templeGiveBlood([a[0]!.id])).toBeNull();
    expect(a[0]!.hp).toBe(30);
    expect(game.state.faith).toBe(68);
    expect(room(game).cleared).toBe(true);
  });

  test("giving at exactly the upper line never kills", () => {
    const { game, a } = templeGame();
    game.state.faith = 50;
    a[0]!.hp = 50;
    expect(templeGiveBlood(game.state, [a[0]!.id])).toBeNull();
    expect(a[0]!.hp).toBe(1);
    expect(a[0]!.isAlive).toBe(true);
    expect(game.state.faith).toBe(68);
  });

  test("a follower in the low band drops to the floor for the low gain", () => {
    const { game, a } = templeGame();
    a[0]!.hp = 49;
    expect(bloodGift(game.state, a[0]!)).toEqual({ hpAfter: 1, faith: 6 });
    a[0]!.hp = 30;
    expect(bloodGift(game.state, a[0]!)).toEqual({ hpAfter: 1, faith: 6 });
    a[0]!.hp = 29;
    expect(bloodGift(game.state, a[0]!)).toBeNull();
  });

  test("another religion gives only from its own line", () => {
    const { game, b } = templeGame();
    b[0]!.hp = 100;
    expect(bloodGift(game.state, b[0]!)).toEqual({ hpAfter: 45, faith: 15 });
    b[0]!.hp = 55;
    expect(bloodGift(game.state, b[0]!)).toEqual({ hpAfter: 1, faith: 15 });
    b[0]!.hp = 54;
    expect(bloodGift(game.state, b[0]!)).toBeNull();
  });

  test("only the chosen donors give, and their Faith adds up", () => {
    const { game, a, b } = templeGame();
    game.state.faith = 50;
    a[0]!.hp = 80;
    expect(templeGiveBlood(game.state, [a[0]!.id, b[0]!.id])).toBeNull();
    expect(game.state.faith).toBe(83);
    expect([a[0]!.hp, a[1]!.hp, b[0]!.hp, b[1]!.hp]).toEqual([30, 100, 45, 100]);
  });

  test("Faith over the cap is lost", () => {
    const { game, a, b } = templeGame();
    game.state.faith = 90;
    expect(templeGiveBlood(game.state, [a[0]!.id, b[0]!.id])).toBeNull();
    expect(game.state.faith).toBe(100);
  });

  test("a full torch locks Give blood", () => {
    const { game, a } = templeGame();
    game.state.faith = 100;
    expect(templeActionsAvailable(game.state).giveBlood).toBe("full");
    expect(templeGiveBlood(game.state, [a[0]!.id])).not.toBeNull();
    expect(a[0]!.hp).toBe(100);
    expect(room(game).cleared).toBe(false);
  });

  test("Give blood needs at least one donor, each one the temple takes", () => {
    const { game, a, b } = templeGame();
    game.state.faith = 50;
    expect(templeGiveBlood(game.state, [])).not.toBeNull();
    b[0]!.hp = 54;
    expect(templeGiveBlood(game.state, [a[0]!.id, b[0]!.id])).not.toBeNull();
    expect([a[0]!.hp, b[0]!.hp]).toEqual([100, 54]);
    expect(game.state.faith).toBe(50);
    expect(room(game).cleared).toBe(false);
  });

  test("no one able to give locks Give blood; the dead never give", () => {
    const { game, a, b } = templeGame();
    game.state.faith = 50;
    for (const c of a) c.hp = 29;
    for (const c of b) c.hp = 54;
    expect(templeActionsAvailable(game.state).giveBlood).toBe("none");
    b[0]!.hp = 100;
    expect(templeActionsAvailable(game.state).giveBlood).toBe("open");
    b[0]!.isAlive = false;
    expect(bloodGift(game.state, b[0]!)).toBeNull();
    expect(templeActionsAvailable(game.state).giveBlood).toBe("none");
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
    const giveFirst = (state: Game["state"]) => templeGiveBlood(state, [state.party[0]!.id]);
    for (const act of [giveFirst, templeAskBoon, templeLeave]) {
      const { game } = templeGame();
      game.state.faith = 50;
      act(game.state);
      expect(room(game).cleared).toBe(true);
      expect(giveFirst(game.state)).not.toBeNull();
      expect(templeAskBoon(game.state)).not.toBeNull();
      expect(templeActionsAvailable(game.state)).toEqual({ giveBlood: "none", boon: false });
    }
  });
});

describe("the boon", () => {
  const boonStats = BALANCE.temple.boon;
  const emphasisOf = (id: Id) => RELIGIONS.find((r) => r.id === id)!.boon;
  const religionWith = (pick: (boon: ReturnType<typeof emphasisOf>) => boolean) => RELIGIONS.find((r) => pick(r.boon))!.id;

  function boonedGame(templeReligion: Id) {
    const otherReligion = RELIGIONS.find((r) => r.id !== templeReligion)!.id;
    const { game } = templeGame(templeReligion, [...classOf(templeReligion).slice(0, 2), ...classOf(otherReligion).slice(0, 2)]);
    const matching = game.state.party.filter((c) => religionOf(c).id === templeReligion);
    const other = game.state.party.filter((c) => religionOf(c).id !== templeReligion);
    const before = new Map(game.state.party.map((c) => [c.id, characterStatBreakdown(c, game.state.satiety, null)]));
    expect(templeAskBoon(game.state)).toBeNull();
    return { game, matching, other, before };
  }

  test.each(RELIGIONS.filter((r) => r.boon.emphasis !== null))("$name applies emphasis and matching rates", ({ id: religion, boon }) => {
    const { game, matching, other, before } = boonedGame(religion);
    expect(matching.length).toBeGreaterThan(0);
    expect(other.length).toBeGreaterThan(0);
    for (const [members, normal, emphasis] of [[other, 8, 15], [matching, 12, 20]] as const) {
      for (const c of members) {
        const base = before.get(c.id)!;
        const now = characterStatBreakdown(c, game.state.satiety, game.state.boon);
        const groups = { attack: "offense", magicPower: "offense", defense: "defense", speed: "speed" };
        for (const stat of ["attack", "magicPower", "defense", "speed"] as const) {
          const percent = groups[stat] === boon.emphasis ? emphasis : normal;
          expect(now[stat].total).toBe(Math.round(base[stat].total * (1 + percent / 100)));
        }
        expect(now.maxHp.total).toBe(base.maxHp.total);
        expect(c.defense).toBe(now.defense.total);
        expect(now.defense.boon).toBe(now.defense.total - base.defense.total);
      }
    }
  });

  test("a recovering boon raises the three stats evenly", () => {
    const religion = religionWith((b) => b.recoversHpMp);
    expect(emphasisOf(religion).emphasis).toBeNull();
    const { game, other, matching, before } = boonedGame(religion);
    for (const [members, percent] of [[other, 8], [matching, 12]] as const) {
      for (const c of members) {
        const base = before.get(c.id)!;
        const now = characterStatBreakdown(c, game.state.satiety, game.state.boon);
        for (const stat of ["attack", "defense", "magicPower", "speed"] as const) {
          expect(now[stat].total).toBe(Math.round(base[stat].total * (1 + percent / 100)));
        }
      }
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
    expect(matching.length).toBeGreaterThan(0);
    for (const [members, share] of [[other.slice(0, 1), 0.07], [matching, 0.10]] as const) {
      for (const c of members) {
        expect(c.hp).toBe(10 + Math.round(c.maxHp * share));
        expect(c.mp).toBe(Math.round(c.maxMp * share));
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

test("temple narration reports selected donors and capped faith through Game", () => {
  const { game, a, b } = templeGame();
  game.state.faith = 99;
  const donors = [a[0]!, b[0]!];
  const before = donors.map(c => c.hp);
  const untouched = a[1]!.hp;
  expect(game.templeGiveBlood(donors.map(c => c.id))).toBeNull();
  expect(game.state.pendingChoiceNarration?.result.faithDelta).toBe(1);
  expect(game.state.pendingChoiceNarration?.result.hpChanges).toEqual(donors.map((c, i) => ({ characterId: c.id, name: c.name, before: before[i]!, after: c.hp })));
  expect(donors.every(c => c.isAlive && c.hp > 0)).toBe(true);
  expect(a[1]!.hp).toBe(untouched);
});

test("temple boon acknowledgement does not heal and leave outside a temple is a no-op", () => {
  const { game, a } = templeGame();
  a[0]!.hp = 10;
  game.state.faith = 100;
  expect(game.templeAskBoon()).toBeNull();
  const hp = a[0]!.hp;
  game.acknowledgeChoiceNarration();
  expect(a[0]!.hp).toBe(hp);
  const current = room(game);
  current.type = "event";
  current.cleared = false;
  current.rolledEventId = "open-chest";
  game.templeLeave();
  expect(game.state.pendingChoiceNarration).toBeNull();
  expect(current.cleared).toBe(false);
});

test("temple narration includes a selected donor whose payment rounds to zero", () => {
  const { game, a } = templeGame();
  const donor = a[0]!;
  donor.maxHp = 1;
  donor.hp = 1;
  game.state.faith = 50;
  expect(game.templeGiveBlood([donor.id])).toBeNull();
  expect(game.state.pendingChoiceNarration?.result.hpChanges).toEqual([{ characterId: donor.id, name: donor.name, before: 1, after: 1 }]);
  expect(donor.isAlive).toBe(true);
});
