import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, queueCommand, commandedSkill, commandableSummons, spawnAdditionalSummon, resolveRound, applySkillEffects, applyOnActStatuses, clearCombatResources, allLivingCharactersHaveQueuedActions, breakChannel } from "../src/engine/combat";
import { runMonsterTurn } from "../src/engine/monsterAI";
import { resolveSkillEffect, applyStatusEffectToActor, tickDotEffects, harmfulStatusCount, removeStatusStacks } from "../src/engine/resolver";
import { resistedFearGain } from "../src/engine/survival";
import { getClass, getSkill, getEffectiveSkill, SKILLS_PER_CLASS } from "../src/data/classes";
import { characterStatBreakdown, recomputeCharacterStats } from "../src/engine/party";
import { getStatusEffect, statusMechanicsParts } from "../src/data/statusEffects";
import { getSummonSkill } from "../src/data/summons";
import { spawnMonster } from "../src/data/monsters";
import type { Character, CombatantRef, Monster } from "../src/types";
import { makeCtx, spawnInto, sk, withFixture, withoutDamageRolls } from "./helpers";

function unlock(character: Character, level: number, ...skillIds: string[]): void {
  character.level = level;
  for (const id of skillIds) if (!character.unlockedSkillIds.includes(id)) character.unlockedSkillIds.push(id);
}

const ref = (c: Character): CombatantRef => ({ kind: "character", id: c.id });
const monsterRef = (m: Monster): CombatantRef => ({ kind: "monster", id: m.id });

function tank(monster: Monster): Monster {
  monster.maxHp = 100000;
  monster.hp = 100000;
  return monster;
}

/** Leaves only `keep` alive, so every monster hit lands on one of them. */
function onlyAlive(party: Character[], ...keep: Character[]): void {
  for (const c of party) {
    if (keep.includes(c)) continue;
    c.hp = 0;
    c.isAlive = false;
  }
}

describe("kit shape", () => {
  test("every class has 7 skills, slot 5 a ranked class skill and slot 6 the ultimate", () => {
    for (const id of ["knight", "mage", "rogue", "acolyte", "viking", "plague-doctor", "archer", "ninja", "summoner", "jester", "paladin", "warlock"]) {
      const cls = getClass(id);
      expect(cls.skills.length).toBe(SKILLS_PER_CLASS);
      expect(cls.skills.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(cls.skills[5]!.isUltimate).toBeUndefined();
      expect(cls.skills[5]!.ranks!.map((r) => r.unlockLevel)).toEqual([25, 50, 75]);
      expect(cls.skills[4]!.ranks!.map((r) => r.unlockLevel)).toEqual([15, 40, 65]);
      expect(cls.skills[6]!.isUltimate).toBe(true);
    }
  });
});

describe("Engage (Knight)", () => {
  function setup() {
    const { ctx } = makeCtx(3);
    const knight = ctx.party.find((c) => c.classId === "knight")!;
    unlock(knight, 25, "engage");
    knight.maxHp = knight.hp = 1e6;
    onlyAlive(ctx.party, knight);
    const [ratA, ratB] = [tank(spawnInto(ctx, "dungeon-rat")), tank(spawnInto(ctx, "dungeon-rat"))] as [Monster, Monster];
    const combat = startCombat("r1", [ratA.id, ratB.id], ctx, false);
    return { ctx, knight, ratA, ratB, combat };
  }

  test("Engage damages its target and taunts", () => {
    const { ctx, knight, ratA, combat } = setup();
    applySkillEffects(getEffectiveSkill(getSkill("engage"), 25), knight, [ratA], combat, ctx, combat.log);
    expect(ratA.hp).toBeLessThan(ratA.maxHp);
    const ids = knight.activeStatusEffects.map((s) => s.statusEffectId);
    expect(ids).toContain("taunt");
    expect(ids).toContain("engaged");
  });

  test("Engage's counter strikes only the monster that hit the Knight", () => {
    const { ctx, knight, ratA, ratB, combat } = setup();
    ctx.rng.next = () => 0;
    applySkillEffects(getEffectiveSkill(getSkill("engage"), 25), knight, [ratB], combat, ctx, combat.log);
    const aBefore = ratA.hp;
    const bBefore = ratB.hp;
    runMonsterTurn(monsterRef(ratA), combat, ctx);
    expect(ratA.hp).toBeLessThan(aBefore);
    expect(ratB.hp).toBe(bBefore);
  });

  test("Engage's counter stops after maxCounters", () => {
    const { ctx, knight, ratA, combat } = setup();
    ctx.rng.next = () => 0;
    applySkillEffects(getEffectiveSkill(getSkill("engage"), 25), knight, [ratA], combat, ctx, combat.log);
    const before = combat.log.length;
    for (let i = 0; i < 3; i++) runMonsterTurn(monsterRef(ratA), combat, ctx);
    const counters = combat.log.slice(before).filter((l) => l.text.includes("answers the blow")).length;
    expect(counters).toBe(2);
    expect(knight.activeStatusEffects.some((s) => s.statusEffectId.startsWith("engaged"))).toBe(false);
  });

  test("an unused Engage counter ends with the round", () => {
    const { ctx, knight, ratA, ratB, combat } = setup();
    ratA.attack = 0;
    ratB.attack = 0;
    for (const rat of [ratA, ratB]) applyStatusEffectToActor(rat, "stunned", 3, { log: [] });
    queueAction(combat, ref(knight), "engage", [monsterRef(ratA)], ctx);
    resolveRound(combat, ctx);
    expect(knight.activeStatusEffects.some((s) => s.statusEffectId.startsWith("engaged"))).toBe(false);
  });
});

describe("Side by Side (Knight)", () => {
  withoutDamageRolls();
  function setup() {
    const { ctx } = makeCtx(3);
    const knight = ctx.party.find((c) => c.classId === "knight")!;
    const rogue = ctx.party.find((c) => c.classId === "rogue")!;
    unlock(knight, 1, "side-by-side");
    for (const c of [knight, rogue]) c.maxHp = c.hp = 1e6;
    onlyAlive(ctx.party, knight, rogue);
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    rat.attack = 0;
    ctx.rng.next = () => 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    return { ctx, knight, rogue, rat, combat };
  }
  const has = (c: Character, id: string) => c.activeStatusEffects.some((s) => s.statusEffectId === id);

  test("Side by Side raises the ally's defense, attack and magic power", () => {
    const { ctx, knight, rogue, combat } = setup();
    const before = { defense: rogue.defense, attack: rogue.attack, magicPower: rogue.magicPower };
    applySkillEffects(getEffectiveSkill(getSkill("side-by-side"), 1), knight, [rogue], combat, ctx, combat.log);
    expect(rogue.defense).toBeGreaterThan(before.defense);
    expect(rogue.attack).toBeGreaterThan(before.attack);
    expect(rogue.magicPower).toBeGreaterThan(before.magicPower);
  });

  test("an ally who lands a hit under Side by Side gives the Knight Following Through", () => {
    const { ctx, knight, rogue, rat, combat } = setup();
    queueAction(combat, ref(knight), "side-by-side", [ref(rogue)], ctx);
    queueAction(combat, ref(rogue), "stab", [monsterRef(rat)], ctx);
    resolveRound(combat, ctx);
    expect(rat.hp).toBeLessThan(rat.maxHp);
    expect(has(knight, "following-through")).toBe(true);
  });

  test("a miss, a stun, or a non-damaging action gives the Knight nothing", () => {
    const miss = setup();
    miss.rogue.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 2 });
    queueAction(miss.combat, ref(miss.knight), "side-by-side", [ref(miss.rogue)], miss.ctx);
    queueAction(miss.combat, ref(miss.rogue), "stab", [monsterRef(miss.rat)], miss.ctx);
    resolveRound(miss.combat, miss.ctx);
    expect(has(miss.knight, "following-through")).toBe(false);

    const stun = setup();
    stun.rogue.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 1 });
    queueAction(stun.combat, ref(stun.knight), "side-by-side", [ref(stun.rogue)], stun.ctx);
    queueAction(stun.combat, ref(stun.rogue), "stab", [monsterRef(stun.rat)], stun.ctx);
    resolveRound(stun.combat, stun.ctx);
    expect(has(stun.knight, "following-through")).toBe(false);

    const heal = setup();
    heal.rogue.activeStatusEffects.push({ statusEffectId: "side-by-side", turnsRemaining: 1, sourceId: heal.knight.id });
    const buff = sk("self-buff", { target: "self", isBuff: true, effects: [{ kind: "applyStatusEffect", statusEffectId: "venom-edge", durationTurns: 1 }] }) as any;
    applySkillEffects(buff, heal.rogue, [heal.rogue], heal.combat, heal.ctx, heal.combat.log);
    expect(has(heal.knight, "following-through")).toBe(false);
  });

  test("Following Through is still on the Knight at its next turn", () => {
    function roundTwoDamage(withSideBySide: boolean): number {
      const { ctx, knight, rogue, rat, combat } = setup();
      knight.speed = 100;
      rogue.speed = 1;
      if (withSideBySide) queueAction(combat, ref(knight), "side-by-side", [ref(rogue)], ctx);
      queueAction(combat, ref(rogue), "stab", [monsterRef(rat)], ctx);
      resolveRound(combat, ctx);
      expect(has(knight, "following-through")).toBe(withSideBySide);
      rogue.activeStatusEffects = [];
      queueAction(combat, ref(knight), "slash", [monsterRef(rat)], ctx);
      queueAction(combat, ref(rogue), "stab", [monsterRef(rat)], ctx);
      const hpBefore = rat.hp;
      resolveRound(combat, ctx);
      expect(has(knight, "following-through")).toBe(false);
      return hpBefore - rat.hp;
    }
    expect(roundTwoDamage(true)).toBeGreaterThan(roundTwoDamage(false));
  });

  test("Side by Side on an ally who already acted this round lasts into that ally's next action", () => {
    const { ctx, knight, rogue, rat, combat } = setup();
    knight.speed = 1;
    rogue.speed = 100;
    queueAction(combat, ref(knight), "side-by-side", [ref(rogue)], ctx);
    queueAction(combat, ref(rogue), "stab", [monsterRef(rat)], ctx);
    resolveRound(combat, ctx);
    expect(has(rogue, "side-by-side")).toBe(true);
    expect(has(knight, "following-through")).toBe(false);
    queueAction(combat, ref(knight), "slash", [monsterRef(rat)], ctx);
    queueAction(combat, ref(rogue), "stab", [monsterRef(rat)], ctx);
    resolveRound(combat, ctx);
    expect(has(rogue, "side-by-side")).toBe(false);
    const texts = combat.log.map((l) => l.text);
    const gained = texts.indexOf("Knight gains the Following Through effect.");
    const slashed = texts.indexOf("Knight uses Slash on Dungeon Rat.");
    const expired = texts.indexOf("Knight's Following Through effect expires.");
    expect(gained).toBeGreaterThan(-1);
    expect(slashed).toBeGreaterThan(gained);
    expect(expired).toBeGreaterThan(slashed);
  });

  test("Side by Side's mechanics text names its follow-up status", () => {
    const text = statusMechanicsParts(getStatusEffect("side-by-side")).join(" ");
    expect(text).toContain("Following Through");
    expect(text).toContain("for 1 turn");
    expect(text).not.toContain("1 turns");
    expect(text).not.toContain("{");
  });

  test("Side by Side cannot target the Knight itself", () => {
    const { ctx, knight, combat } = setup();
    expect(queueAction(combat, ref(knight), "side-by-side", [ref(knight)], ctx)?.reason).toBe("it cannot be cast on yourself");
  });
});

describe("Venom Brand (Rogue)", () => {
  test("poison-vulnerable raises every rank of Poisoned, not only the base status", () => {
    const { ctx } = makeCtx();
    const plain = tank(spawnInto(ctx, "dungeon-rat"));
    const branded = tank(spawnInto(ctx, "dungeon-rat"));
    for (const m of [plain, branded]) applyStatusEffectToActor(m, "poisoned-ii", 3, { log: [] });
    applyStatusEffectToActor(branded, "poison-vulnerable", 3, { log: [] });
    tickDotEffects(plain, { log: [] });
    tickDotEffects(branded, { log: [] });
    const plainLoss = plain.maxHp - plain.hp;
    const brandedLoss = branded.maxHp - branded.hp;
    expect(brandedLoss).toBe(Math.round(plainLoss * getStatusEffect("poison-vulnerable").vulnerableTo!.multiplier));
  });

  test("it always brands the target", () => {
    const skill = getEffectiveSkill(getSkill("venom-brand"), 25);
    const brand = skill.effects!.find((e) => e.kind === "applyStatusEffect")!;
    expect(brand.statusEffectId).toBe("poison-vulnerable");
    expect(brand.chance).toBeUndefined();
  });
});

describe("Sanctuary (Acolyte)", () => {
  test("Steadfast cuts fear gains by its fearResistPercent", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    const before = resistedFearGain(target, 10);
    applyStatusEffectToActor(target, "steadfast", 2, { log: [] });
    expect(resistedFearGain(target, 10)).toBeCloseTo(before * (1 - getStatusEffect("steadfast").fearResistPercent! / 100), 5);
  });

  test("it puts a heal over time and Steadfast on the whole party", () => {
    const { ctx } = makeCtx();
    const acolyte = ctx.party.find((c) => c.classId === "acolyte")!;
    unlock(acolyte, 25, "sanctuary");
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    queueAction(combat, ref(acolyte), "sanctuary", ctx.party.map(ref), ctx);
    resolveRound(combat, ctx);
    for (const c of ctx.party) {
      expect(c.activeStatusEffects.some((s) => s.statusEffectId === "sanctified")).toBe(true);
      expect(c.activeStatusEffects.some((s) => s.statusEffectId === "steadfast")).toBe(true);
    }
  });
});

describe("Mage — Chilled and Frozen", () => {
  test("Frost Lance and Ice Age always Chill; a second stack freezes the target solid", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((c) => c.classId === "mage")!;
    unlock(mage, 35, "frost-lance", "ice-age");
    const rats = [0, 1].map(() => tank(spawnInto(ctx, "dungeon-rat")));
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    const speed = rats[0]!.speed;
    applySkillEffects(getEffectiveSkill(getSkill("ice-age"), 35), mage, rats, combat, ctx, combat.log);
    for (const rat of rats) expect(rat.activeStatusEffects.find((s) => s.statusEffectId === "chilled")?.stacks).toBe(1);
    expect(rats[0]!.speed).toBeLessThan(speed);

    ctx.rng.next = () => 0.99; // the lance's accuracy roll lands
    applySkillEffects(getEffectiveSkill(getSkill("frost-lance"), 35), mage, [rats[0]!], combat, ctx, combat.log);
    expect(rats[0]!.activeStatusEffects.some((s) => s.statusEffectId === "chilled")).toBe(false);
    expect(rats[0]!.activeStatusEffects.some((s) => s.statusEffectId === "frozen")).toBe(true);
    // The chill's slow goes with its stacks.
    expect(rats[0]!.speed).toBe(speed);
  });

  test("a Frozen monster loses its turn", () => {
    const { ctx } = makeCtx();
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    const combat = startCombat("r1", [rat.id], ctx, false);
    applyStatusEffectToActor(rat, "frozen", 1, { log: [] });
    const partyHp = ctx.party.map((c) => c.hp);
    runMonsterTurn(monsterRef(rat), combat, ctx);
    ctx.party.forEach((c, i) => expect(c.hp).toBe(partyHp[i]!));
  });
});

describe("Acolyte tweaks", () => {
  test("Mass Heal clears every damage over time but leaves heals over time", () => {
    const { ctx } = makeCtx();
    const acolyte = ctx.party.find((c) => c.classId === "acolyte")!;
    unlock(acolyte, 15, "mass-heal");
    const ally = ctx.party.find((c) => c.classId === "mage")!;
    for (const id of ["poisoned", "burning", "bleeding", "mending"]) applyStatusEffectToActor(ally, id, 3, { log: [] });
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    const combat = startCombat("r1", [rat.id], ctx, false);
    applySkillEffects(getEffectiveSkill(getSkill("mass-heal"), 15), acolyte, ctx.party, combat, ctx, combat.log);
    expect(ally.activeStatusEffects.map((s) => s.statusEffectId)).toEqual(["mending"]);
  });

  test("after Sanctuary the Acolyte's basic attack is a holy Cleansing Smite for 2 turns", () => {
    const { ctx } = makeCtx();
    const acolyte = ctx.party.find((c) => c.classId === "acolyte")!;
    unlock(acolyte, 25, "sanctuary");
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    queueAction(combat, ref(acolyte), "sanctuary", ctx.party.map(ref), ctx);
    resolveRound(combat, ctx);
    expect(acolyte.activeStatusEffects.some((s) => s.statusEffectId === "cleansing-light")).toBe(true);
    for (let turn = 0; turn < 2; turn++) {
      const from = combat.log.length;
      queueAction(combat, ref(acolyte), "smite", [monsterRef(rat)], ctx);
      resolveRound(combat, ctx);
      expect(combat.log.slice(from).some((l) => l.text.includes("Cleansing Smite"))).toBe(true);
    }
    expect(acolyte.activeStatusEffects.some((s) => s.statusEffectId === "cleansing-light")).toBe(false);
    const from = combat.log.length;
    queueAction(combat, ref(acolyte), "smite", [monsterRef(rat)], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.slice(from).some((l) => l.text.includes("Smite") && !l.text.includes("Cleansing"))).toBe(true);
  });
});

describe("Desperate Cleave (Viking)", () => {
  withoutDamageRolls();

  function cleave(hpFraction: number) {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((c) => c.classId === "viking")!;
    unlock(viking, 25, "desperate-cleave");
    viking.hp = Math.round(viking.maxHp * hpFraction);
    const target = tank(spawnInto(ctx, "dungeon-rat"));
    const combat = startCombat("r1", [target.id], ctx, false);
    const hpBefore = viking.hp;
    applySkillEffects(getEffectiveSkill(getSkill("desperate-cleave"), viking.level), viking, [target], combat, ctx, combat.log);
    return { dealt: target.maxHp - target.hp, healed: viking.hp - hpBefore };
  }

  test("Storm-Empowered lets it ignore part of the target's defense", () => {
    expect(getSkill("desperate-cleave").conditionalBonus?.requiresStatusId).toBe("storm-empowered");
  });

  test("below the threshold it hits harder and heals the Viking", () => {
    const healthy = cleave(1);
    const desperate = cleave(0.3);
    expect(desperate.dealt).toBeGreaterThan(healthy.dealt);
    expect(healthy.healed).toBe(0);
    expect(desperate.healed).toBeGreaterThan(0);
  });
});

describe("Volatile Flask (Plague Doctor)", () => {
  withoutDamageRolls();

  test("each hit grows with the number of debuffs on the target", () => {
    const { ctx } = makeCtx();
    const doctor = ctx.party.find((c) => c.classId === "plague-doctor")!;
    const clean = tank(spawnInto(ctx, "dungeon-rat"));
    const sick = tank(spawnInto(ctx, "dungeon-rat"));
    applyStatusEffectToActor(sick, "weakened", 3, { log: [] });
    applyStatusEffectToActor(sick, "slowed", 3, { log: [] });
    expect(harmfulStatusCount(sick)).toBe(2);
    const effect = getEffectiveSkill(getSkill("volatile-flask"), 25).effects![0]!;
    const hitClean = resolveSkillEffect(effect, doctor, clean, { log: [], isMagic: true });
    const hitSick = resolveSkillEffect(effect, doctor, sick, { log: [], isMagic: true });
    expect(hitSick).toBeGreaterThan(hitClean);
  });
});

describe("Barbed Net (Ninja)", () => {
  test("a Netted monster that acts can open a bleed on itself", () => {
    const { ctx } = makeCtx();
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    const combat = startCombat("r1", [rat.id], ctx, false);
    applyStatusEffectToActor(rat, "netted", 3, { log: [] });
    ctx.rng.chance = () => true;
    applyOnActStatuses(rat, combat, ctx);
    expect(rat.activeStatusEffects.some((s) => s.statusEffectId === "bleeding")).toBe(true);
  });

  test("the roll happens on the monster's own turn", () => {
    const { ctx } = makeCtx();
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    const combat = startCombat("r1", [rat.id], ctx, false);
    applyStatusEffectToActor(rat, "netted", 3, { log: [] });
    ctx.rng.chance = () => true;
    runMonsterTurn(monsterRef(rat), combat, ctx);
    expect(rat.activeStatusEffects.some((s) => s.statusEffectId === "bleeding")).toBe(true);
  });
});

describe("Command (Summoner)", () => {
  withoutDamageRolls();

  function summonerWithMinions(level = 25) {
    const { ctx } = makeCtx(5);
    const summoner = ctx.party.find((c) => c.classId === "summoner")!;
    unlock(summoner, level, "summon-goblin", "totem-recall", "command");
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const spawn = (skillId: string) => {
      const effect = getEffectiveSkill(getSkill(skillId), summoner.level).effects!.find((e) => e.kind === "summon")!;
      return spawnAdditionalSummon(effect, summoner, combat, ctx, [])!;
    };
    const goblin = spawn("summon-goblin");
    goblin.maxActions = 10;
    return { ctx, summoner, rat, combat, goblin, totem: spawn("totem-recall") };
  }

  test("casts the minion's signature skill as the Summoner's, scaled by rank, off MAG", () => {
    const { summoner, goblin } = summonerWithMinions();
    const rockThrow = getSummonSkill("rock-throw").effects![0]!;
    for (const [level, percent] of [[25, 100], [50, 115], [75, 130]] as const) {
      summoner.level = level;
      const cast = commandedSkill(getEffectiveSkill(getSkill("command"), level), goblin, "rock-throw");
      expect(cast.isMagic).toBe(true);
      expect(cast.target).toBe("singleEnemy");
      expect(cast.effects![0]!.amount).toBe(Math.round(rockThrow.amount! * (percent / 100)));
      expect(cast.effects![0]!.offenseMultiplierPercent).toBe(Math.round(rockThrow.offenseMultiplierPercent! * (percent / 100)));
    }
  });

  test("the hit scales with the Summoner's MAG, not its attack or the minion's stats", () => {
    const { ctx, summoner, rat, combat, goblin } = summonerWithMinions();
    const cast = commandedSkill(getEffectiveSkill(getSkill("command"), 25), goblin, "rock-throw");
    const hit = () => {
      const before = rat.hp;
      applySkillEffects(cast, summoner, [rat], combat, ctx, []);
      return before - rat.hp;
    };
    summoner.attack = 500;
    goblin.attack = 500;
    summoner.magicPower = 0;
    const weak = hit();
    summoner.magicPower = 200;
    expect(hit()).toBeGreaterThan(weak + 100);
  });

  test("a queued Command lands on the chosen target and costs the minion one action", () => {
    const { ctx, summoner, rat, combat, goblin } = summonerWithMinions();
    const before = goblin.actionsTaken;
    expect(queueCommand(combat, ref(summoner), "command", { summonId: goblin.id, skillId: "rock-throw" }, [monsterRef(rat)], ctx)).toBeNull();
    const from = combat.log.length;
    resolveRound(combat, ctx);
    expect(combat.log.slice(from).some((l) => l.text.includes(`${summoner.name} uses ${goblin.name}'s Rock Throw on ${rat.name}`))).toBe(true);
    expect(rat.hp).toBeLessThan(rat.maxHp);
    expect(goblin.actionsTaken).toBe(before + 1);
    expect(summoner.cooldownsRemaining["command"]).toBeGreaterThan(0);
  });

  test("a commanded minion faster than the Summoner holds its turn for the order, then leaves on its last action", () => {
    const { ctx, summoner, rat, combat, goblin } = summonerWithMinions();
    goblin.speed = 99;
    summoner.speed = 1;
    goblin.actionsTaken = goblin.maxActions - 1;
    queueCommand(combat, ref(summoner), "command", { summonId: goblin.id, skillId: "rock-throw" }, [monsterRef(rat)], ctx);
    const from = combat.log.length;
    resolveRound(combat, ctx);
    const lines = combat.log.slice(from).map((l) => l.text);
    expect(lines.some((l) => l.includes(`${goblin.name} holds still`))).toBe(true);
    expect(lines.some((l) => l.includes(`${summoner.name} uses ${goblin.name}'s Rock Throw`))).toBe(true);
    expect(combat.combatants.some((c) => c.ref.id === goblin.id)).toBe(false);
  });

  test("a minion killed before the Summoner's turn wastes the order without spending MP or cooldown", () => {
    const { ctx, summoner, rat, combat, goblin } = summonerWithMinions();
    const mpBefore = summoner.mp;
    queueCommand(combat, ref(summoner), "command", { summonId: goblin.id, skillId: "rock-throw" }, [monsterRef(rat)], ctx);
    goblin.hp = 0;
    resolveRound(combat, ctx);
    expect(summoner.mp).toBe(mpBefore);
    expect(summoner.cooldownsRemaining["command"] ?? 0).toBe(0);
    expect(rat.hp).toBe(rat.maxHp);
  });

  test("a stunned minion can't be picked for an order", () => {
    const { ctx, summoner, rat, combat, goblin } = summonerWithMinions();
    applyStatusEffectToActor(goblin, "stunned", 1, { log: [] });
    expect(commandableSummons(summoner, combat, ctx)).toEqual([]);
    expect(queueCommand(combat, ref(summoner), "command", { summonId: goblin.id, skillId: "rock-throw" }, [monsterRef(rat)], ctx)).not.toBeNull();
  });

  test.each([
    ["moves first", 99, 1],
    ["moves after the Summoner", 1, 99],
  ])("a stunned minion that %s cancels the order, with no MP, cooldown or action spent", (_, goblinSpeed, summonerSpeed) => {
    const { ctx, summoner, rat, combat, goblin } = summonerWithMinions();
    goblin.speed = goblinSpeed;
    summoner.speed = summonerSpeed;
    const mpBefore = summoner.mp;
    const actionsBefore = goblin.actionsTaken;
    queueCommand(combat, ref(summoner), "command", { summonId: goblin.id, skillId: "rock-throw" }, [monsterRef(rat)], ctx);
    applyStatusEffectToActor(goblin, "stunned", 1, { log: [] });
    const from = combat.log.length;
    resolveRound(combat, ctx);
    expect(combat.log.slice(from).some((l) => l.text.includes(`${goblin.name} is stunned — the order is cancelled`))).toBe(true);
    expect(summoner.mp).toBe(mpBefore);
    expect(summoner.cooldownsRemaining["command"] ?? 0).toBe(0);
    expect(goblin.actionsTaken).toBe(actionsBefore);
    expect(rat.hp).toBe(rat.maxHp);
  });

  test("the totem can't be commanded, and Command can't be queued without a minion order", () => {
    const { ctx, summoner, rat, combat, goblin, totem } = summonerWithMinions();
    expect(commandableSummons(summoner, combat, ctx).map((s) => s.id)).toEqual([goblin.id]);
    expect(queueCommand(combat, ref(summoner), "command", { summonId: totem.id, skillId: "rock-throw" }, [monsterRef(rat)], ctx)).not.toBeNull();
    expect(queueCommand(combat, ref(summoner), "command", { summonId: goblin.id, skillId: "stomp" }, [monsterRef(rat)], ctx)).not.toBeNull();
    expect(queueAction(combat, ref(summoner), "command", [ref(summoner)], ctx)).not.toBeNull();
    expect(combat.queuedActions).toHaveLength(0);
  });
});

describe("Jester", () => {
  withoutDamageRolls();

  function jesterFight(level: number, ratCount = 1) {
    const { ctx } = makeCtx();
    const jester = ctx.party.find((c) => c.classId === "jester")!;
    unlock(jester, level, "jeer", "battle-ballad", "rigged-game", "double-or-nothing", "finale");
    recomputeCharacterStats(jester, 100);
    const rats = Array.from({ length: ratCount }, () => tank(spawnInto(ctx, "dungeon-rat")));
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    const target = rats[0]!;
    const cast = (skillId: string, targets: Monster[] = [target]) => {
      const before = targets.map((t) => t.hp);
      applySkillEffects(getEffectiveSkill(getSkill(skillId), jester.level), jester, targets, combat, ctx, combat.log);
      return targets.reduce((sum, t, i) => sum + before[i]! - t.hp, 0);
    };
    return { ctx, jester, rats, target, combat, cast };
  }

  test("a lost coin flip misses, slows the Jester, rigs the next toss and resets the cooldown", () => {
    const { ctx, jester, cast } = jesterFight(25);
    const realChance = ctx.rng.chance.bind(ctx.rng);
    ctx.rng.chance = () => false;
    jester.cooldownsRemaining["double-or-nothing"] = 3;
    expect(cast("double-or-nothing")).toBe(0);
    for (const id of ["slowed", "rigged"]) expect(jester.activeStatusEffects.some((s) => s.statusEffectId === id)).toBe(true);
    expect(jester.cooldownsRemaining["double-or-nothing"]).toBe(0);

    // Rigged doubles a 50% toss: the next one cannot lose.
    ctx.rng.chance = realChance;
    expect(cast("double-or-nothing")).toBeGreaterThan(0);
  });

  test("Two-Faced logs and applies a round-long face each round, leaving the base stats at 1:1 growth", () => {
    const { ctx, jester, rats, combat } = jesterFight(50);
    const base = { attack: jester.attack, magicPower: jester.magicPower };
    const faceIds = ["sharp-face", "dull-face", "bright-face", "dim-face"];
    const seen = new Set<string>();
    for (let round = 0; round < 12 && seen.size < 2; round++) {
      const from = combat.log.length;
      queueAction(combat, ref(jester), "loaded-dice", [monsterRef(rats[0]!)], ctx);
      resolveRound(combat, ctx);
      const line = combat.log.slice(from).find((l) => l.text.includes("turns a new face"));
      expect(line).toBeDefined();
      seen.add(line!.text.includes("attack +") ? "attack" : "magic");
      // The face lasts the round: it is gone again once the round has ended.
      expect(jester.activeStatusEffects.some((s) => faceIds.includes(s.statusEffectId))).toBe(false);
      expect(jester.attack).toBe(base.attack);
      expect(jester.magicPower).toBe(base.magicPower);
    }
    expect(seen.size).toBe(2);
    // Character Info's base stays at the class's own 1:1 growth.
    const breakdown = characterStatBreakdown(jester, 100);
    expect(breakdown.attack.base).toBe(base.attack);
  });

  test("during the round the face is on the Jester, one stat up and the other down", () => {
    const { ctx, jester, rats, combat } = jesterFight(50);
    const base = { attack: jester.attack, magicPower: jester.magicPower };
    let during: { attack: number; magicPower: number; ids: string[] } | undefined;
    const realNext = ctx.rng.next.bind(ctx.rng);
    // Read the stats from inside the round: the Jester's accuracy roll draws from the rng after the face is on.
    queueAction(combat, ref(jester), "loaded-dice", [monsterRef(rats[0]!)], ctx);
    const original = rats[0]!.hp;
    ctx.rng.next = () => {
      if (!during && jester.activeStatusEffects.length > 0) during = { attack: jester.attack, magicPower: jester.magicPower, ids: jester.activeStatusEffects.map((s) => s.statusEffectId) };
      return realNext();
    };
    resolveRound(combat, ctx);
    expect(rats[0]!.hp).toBeLessThan(original);
    expect(during).toBeDefined();
    expect(Math.sign(during!.attack - base.attack)).toBe(-Math.sign(during!.magicPower - base.magicPower));
    expect(during!.ids.length).toBe(2);
  });

  test("a face that outlives the round's end is taken off with the fight", () => {
    const { ctx, jester } = jesterFight(50);
    const before = jester.magicPower;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "dim-face", durationTurns: 1, amount: -7 }, jester, jester, { log: [] });
    expect(jester.magicPower).toBe(before - 7);
    clearCombatResources(ctx);
    expect(jester.magicPower).toBe(before);
  });

  test("below the passive's first rank no face is turned", () => {
    const { ctx, jester, rats, combat } = jesterFight(1);
    queueAction(combat, ref(jester), "loaded-dice", [monsterRef(rats[0]!)], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("turns a new face"))).toBe(false);
  });

  test("Finale's dice take turns between attack and magic power", () => {
    const { ctx, jester, rats, combat } = jesterFight(35, 2);
    jester.dice = getClass("jester").dice!.maxCount;
    jester.attack = 2000;
    jester.magicPower = 0;
    for (const rat of rats) rat.defense = 0;
    const from = combat.log.length;
    applySkillEffects(getEffectiveSkill(getSkill("finale"), jester.level), jester, rats, combat, ctx, combat.log);
    const amounts = combat.log.slice(from).flatMap((l) => (l.hit ? [l.hit.amount] : []));
    expect(amounts.length).toBe(12);
    // Attack dice hit for hundreds; magic dice, with no magic power, only for their flat amount.
    expect(amounts.filter((a) => a > 200).length).toBe(6);
    expect(amounts.filter((a) => a <= 200).length).toBe(6);
    expect(getSkill("rigged-game").isMagic).toBe(true);
  });

  test("Loaded Dice deals one of its six faces", () => {
    const { jester, target, cast } = jesterFight(1);
    target.defense = 0;
    const effect = getEffectiveSkill(getSkill("loaded-dice"), 1).effects![0]!;
    const possible = new Set(effect.damageRollFaces!.map((face) => Math.round(effect.amount! + (jester.attack * Math.round((effect.offenseMultiplierPercent! * face) / 100)) / 100)));
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(cast("loaded-dice"));
    for (const hit of seen) expect(possible.has(hit)).toBe(true);
    expect(seen.size).toBeGreaterThan(2);
  });

  test("the hand starts at its startCount, grows with each casting skill up to its limit, and Finale throws it all", () => {
    const { ctx, jester, rats, combat } = jesterFight(35, 2);
    const hand = getClass("jester").dice!;
    expect(jester.dice).toBe(hand.startCount);

    queueAction(combat, ref(jester), "double-or-nothing", [monsterRef(rats[0]!)], ctx);
    resolveRound(combat, ctx);
    expect(jester.dice).toBe(hand.startCount + getSkill("double-or-nothing").grantsDice!);

    jester.dice = hand.maxCount;
    jester.cooldownsRemaining = {};
    queueAction(combat, ref(jester), "loaded-dice", [monsterRef(rats[0]!)], ctx);
    resolveRound(combat, ctx);
    expect(jester.dice).toBe(hand.maxCount);

    const from = combat.log.length;
    const before = rats.map((r) => r.hp);
    applySkillEffects(getEffectiveSkill(getSkill("finale"), jester.level), jester, rats, combat, ctx, combat.log);
    expect(jester.dice).toBe(0);
    rats.forEach((r, i) => expect(r.hp).toBeLessThan(before[i]!));
    // 12 dice on 2 enemies, at most 6 each: every die lands.
    const hits = combat.log.slice(from).filter((l) => l.hit !== undefined).length;
    expect(hits).toBe(hand.maxPerTarget * rats.length);
  });

  test("dice leave with the fight", () => {
    const { ctx, jester } = jesterFight(1);
    clearCombatResources(ctx);
    expect(jester.dice).toBeUndefined();
  });

  test("Jeer always weakens, may confuse, and a Provoked monster's attacks all go to the Jester", () => {
    const { ctx, jester, target, combat, cast } = jesterFight(15);
    ctx.rng.chance = () => true;
    cast("jeer");
    expect(target.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(true);
    expect(target.activeStatusEffects.some((s) => s.statusEffectId === "confused")).toBe(true);
    expect(target.activeStatusEffects.find((s) => s.statusEffectId === "provoked")?.sourceId).toBe(jester.id);
    // Confused would turn some blows onto the monster's own side; drop it to isolate Provoked.
    target.activeStatusEffects = target.activeStatusEffects.filter((s) => s.statusEffectId !== "confused");
    jester.maxHp = jester.hp = 1e6;
    const others = ctx.party.filter((c) => c !== jester);
    const hpBefore = others.map((c) => c.hp);
    for (let i = 0; i < 6; i++) runMonsterTurn(monsterRef(target), combat, ctx);
    others.forEach((c, i) => expect(c.hp).toBe(hpBefore[i]!));
    expect(jester.hp).toBeLessThan(1e6);
  });

  test("a Confused monster turns on its own side, or on itself when alone", () => {
    const { ctx, rats, combat } = jesterFight(15, 2);
    const [confused, other] = rats as [Monster, Monster];
    applyStatusEffectToActor(confused, "confused", 2, { log: [] });
    ctx.rng.chance = () => true;
    const partyHp = ctx.party.map((c) => c.hp);
    runMonsterTurn(monsterRef(confused), combat, ctx);
    expect(other.hp).toBeLessThan(other.maxHp);
    ctx.party.forEach((c, i) => expect(c.hp).toBe(partyHp[i]!));

    other.hp = 0;
    const selfBefore = confused.hp;
    runMonsterTurn(monsterRef(confused), combat, ctx);
    expect(confused.hp).toBeLessThan(selfBefore);
  });

  test("Battle Ballad buffs the rest of the party, not the Jester, and moves them ahead in the turn order", () => {
    const { ctx, jester, target, combat } = jesterFight(10);
    const slowAlly = ctx.party.find((c) => c.classId === "knight")!;
    slowAlly.speed = 1;
    target.speed = 5;
    queueAction(combat, ref(jester), "battle-ballad", ctx.party.map(ref), ctx);
    queueAction(combat, ref(slowAlly), "slash", [monsterRef(target)], ctx);
    resolveRound(combat, ctx);
    const order = combat.turnQueue.map((r) => r.id);
    expect(order.indexOf(slowAlly.id)).toBeLessThan(order.indexOf(target.id));
    expect(order.indexOf(jester.id)).toBeLessThan(order.indexOf(slowAlly.id));

    // The buff lasts this round only, so it is read straight off a cast outside the round.
    applySkillEffects(getEffectiveSkill(getSkill("battle-ballad"), jester.level), jester, ctx.party, combat, ctx, combat.log);
    expect(jester.activeStatusEffects.some((s) => s.statusEffectId === "ballad")).toBe(false);
    for (const c of ctx.party.filter((p) => p !== jester)) expect(c.activeStatusEffects.some((s) => s.statusEffectId === "ballad"), c.classId).toBe(true);
  });
});

describe("Paladin", () => {
  withoutDamageRolls();

  function paladinFight(level: number, ratCount = 1) {
    const { ctx } = makeCtx();
    const paladin = ctx.party.find((c) => c.classId === "paladin")!;
    unlock(paladin, level, "defiance", "cross-slash", "guardian-angel", "vigil", "martyrs-oath");
    recomputeCharacterStats(paladin, 100);
    paladin.hp = paladin.maxHp;
    const rats = Array.from({ length: ratCount }, () => tank(spawnInto(ctx, "dungeon-rat")));
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    return { ctx, paladin, rats, combat };
  }

  test("Retribution turns its rank's share of a direct hit back on the attacker", () => {
    const { ctx, paladin } = paladinFight(5);
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    rat.attack = 200;
    const dealt = resolveSkillEffect({ kind: "damage", amount: 0 }, rat, paladin, { log: [] });
    const percent = getClass("paladin").passiveSkill.ranks[0]!.reflectPercent!;
    expect(rat.maxHp - rat.hp).toBe(Math.round((dealt * percent) / 100));
  });

  test("from rank 1, fear builds but its penalties never apply", () => {
    const { ctx, paladin, rats, combat } = paladinFight(5);
    paladin.survival.fear = 100;
    const rat = rats[0]!;
    rat.defense = 0;
    // A fearless character at max fear still hits for its full damage and never loses control.
    const before = rat.hp;
    for (let i = 0; i < 20; i++) {
      queueAction(combat, ref(paladin), getClass("paladin").skills[0]!.id, [monsterRef(rat)], ctx);
      resolveRound(combat, ctx);
    }
    expect(combat.log.some((l) => l.text.includes(paladin.name) && l.text.toLowerCase().includes("loses control"))).toBe(false);
    expect(rat.hp).toBeLessThan(before);
    expect(paladin.survival.fear).toBe(100);
  });

  test("Lay on Hands adds the Paladin's max HP share and heals more the lower the target", () => {
    const { paladin, ctx } = paladinFight(1);
    const target = ctx.party.find((c) => c.classId === "knight")!;
    const effect = getEffectiveSkill(getSkill("lay-on-hands"), 1).effects![0]!;
    const healAt = (hpFraction: number) => {
      target.hp = Math.max(1, Math.round(target.maxHp * hpFraction));
      const before = target.hp;
      resolveSkillEffect(effect, paladin, target, { log: [] });
      return target.hp - before;
    };
    const base = effect.amount! + (paladin.maxHp * effect.casterMaxHpPercent!) / 100;
    target.maxHp = 10000;
    expect(healAt(0.99)).toBe(Math.round(base * (1 + (40 * 0.01) / 0.8 / 100)));
    expect(healAt(0.1)).toBe(Math.round(base * 1.4));
    expect(healAt(0.6)).toBe(Math.round(base * 1.2));
  });

  test("Defiance taunts, and a monster that hits the Paladin is Weakened", () => {
    const { ctx, paladin, rats, combat } = paladinFight(1);
    onlyAlive(ctx.party, paladin);
    paladin.maxHp = paladin.hp = 1e6;
    queueAction(combat, ref(paladin), "defiance", [ref(paladin)], ctx);
    resolveRound(combat, ctx);
    expect(rats[0]!.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(true);
  });

  test("Defiance III marks a monster that hits the Paladin with Weakened, Enfeebled and Slowed", () => {
    const { ctx, paladin, rats, combat } = paladinFight(15);
    onlyAlive(ctx.party, paladin);
    paladin.maxHp = paladin.hp = 1e6;
    queueAction(combat, ref(paladin), "defiance", [ref(paladin)], ctx);
    resolveRound(combat, ctx);
    const marks = rats[0]!.activeStatusEffects.map((s) => s.statusEffectId);
    for (const id of ["weakened", "enfeebled", "slowed"]) expect(marks).toContain(id);
  });

  test("Cross Slash strikes twice", () => {
    const { ctx, paladin, rats, combat } = paladinFight(10);
    const from = combat.log.length;
    applySkillEffects(getEffectiveSkill(getSkill("cross-slash"), 10), paladin, rats, combat, ctx, combat.log);
    expect(combat.log.slice(from).filter((l) => l.hit !== undefined).length).toBe(2);
  });

  test("Cross Slash scales with attack plus magic power and leaves the target Condemned", () => {
    const { ctx, paladin, rats, combat } = paladinFight(10);
    const effect = getEffectiveSkill(getSkill("cross-slash"), 10).effects![0]!;
    const clean = tank(spawnInto(ctx, "dungeon-rat"));
    const hit = () => resolveSkillEffect(effect, paladin, clean, { log: [] });
    paladin.magicPower = 0;
    const attackOnly = hit();
    paladin.magicPower = 40;
    expect(hit()).toBeGreaterThan(attackOnly);
    applySkillEffects(getEffectiveSkill(getSkill("cross-slash"), 10), paladin, rats, combat, ctx, combat.log);
    expect(rats[0]!.activeStatusEffects.find((s) => s.statusEffectId === "condemned")?.turnsRemaining).toBe(3);
  });

  test("Condemned adds its weakPercent to holy damage only", () => {
    const { ctx, paladin } = paladinFight(10);
    const clean = tank(spawnInto(ctx, "dungeon-rat"));
    const condemned = tank(spawnInto(ctx, "dungeon-rat"));
    applyStatusEffectToActor(condemned, "condemned", 3, { log: [] });
    const holy = { kind: "damage" as const, amount: 100, damageType: "holy" as const };
    const physical = { kind: "damage" as const, amount: 100 };
    expect(resolveSkillEffect(holy, paladin, condemned, { log: [] })).toBeGreaterThan(resolveSkillEffect(holy, paladin, clean, { log: [] }));
    expect(resolveSkillEffect(physical, paladin, condemned, { log: [] })).toBe(resolveSkillEffect(physical, paladin, clean, { log: [] }));
  });

  test("Guardian Angel cannot target the Paladin, and brings a fallen ally back once", () => {
    const { ctx, paladin, combat } = paladinFight(15);
    expect(queueAction(combat, ref(paladin), "guardian-angel", [ref(paladin)], ctx)).not.toBeNull();
    const ally = ctx.party.find((c) => c.classId === "mage")!;
    applySkillEffects(getEffectiveSkill(getSkill("guardian-angel"), 15), paladin, [ally], combat, ctx, combat.log);
    const killer = tank(spawnInto(ctx, "dungeon-rat"));
    resolveSkillEffect({ kind: "damage", amount: 1e6 }, killer, ally, { log: combat.log });
    expect(ally.isAlive).toBe(true);
    expect(ally.hp).toBe(Math.round(ally.maxHp * 0.3));
    expect(ally.activeStatusEffects.some((s) => s.statusEffectId === "guardian-angel")).toBe(false);
    resolveSkillEffect({ kind: "damage", amount: 1e6 }, killer, ally, { log: combat.log });
    expect(ally.isAlive).toBe(false);
  });

  test("Vigil pulses three times while held, never misses, and steadies the party", () => {
    const { ctx, paladin, rats, combat } = paladinFight(25, 2);
    for (const r of rats) r.attack = 0;
    // Blinded and Smoke Pellets' haze add up to a 100% accuracy penalty: any skill that rolled to hit would miss.
    applyStatusEffectToActor(paladin, "blinded", 9, { log: [] });
    applyStatusEffectToActor(paladin, "smoke-pellets-haze", 9, { log: [] });
    queueAction(combat, ref(paladin), "vigil", [...ctx.party.map(ref), ...rats.map(monsterRef)], ctx);
    resolveRound(combat, ctx);
    expect(ctx.party.filter((c) => c !== paladin).every((c) => c.activeStatusEffects.some((s) => s.statusEffectId === "vigil-light"))).toBe(true);
    expect(channelStatusOf(paladin)).toBe(true);
    onlyAlive(ctx.party, paladin);
    for (let round = 0; round < 2; round++) {
      // The channeling Paladin needs no order, and the round still resolves.
      expect(allLivingCharactersHaveQueuedActions(combat, ctx)).toBe(true);
      resolveRound(combat, ctx);
    }
    expect(combat.log.filter((l) => l.text.includes("holds Vigil")).length).toBe(2);
    expect(channelStatusOf(paladin)).toBe(false);
    const ratIds = rats.map((r) => r.id);
    const hits = combat.log.filter((l) => l.hit !== undefined && ratIds.includes(l.hit.targetId)).length;
    expect(hits).toBe(6);
  });

  test("Vigil's heal adds a share of the Paladin's max HP, not the ally's, and the low-HP bonus", () => {
    const { ctx, paladin, combat } = paladinFight(25);
    const ally = ctx.party.find((c) => c.classId === "mage")!;
    ally.maxHp = 100000;
    ally.hp = 1;
    const effect = getEffectiveSkill(getSkill("vigil"), 25).effects!.find((e) => e.kind === "heal")!;
    resolveSkillEffect(effect, paladin, ally, { log: combat.log, isMagic: true });
    const bonus = 1 + effect.lowHpHealBonus!.maxBonusPercent / 100;
    expect(ally.hp - 1).toBe(Math.round((effect.amount! + (paladin.maxHp * effect.casterMaxHpPercent!) / 100) * bonus));
  });

  test("Vigil adds a Searing Light stack per pulse and takes it away when the channel ends", () => {
    const { ctx, paladin, rats, combat } = paladinFight(25, 2);
    for (const r of rats) r.attack = 0;
    onlyAlive(ctx.party, paladin);
    const searing = (m: Monster) => m.activeStatusEffects.find((s) => s.statusEffectId === "searing-light")?.stacks ?? 0;
    queueAction(combat, ref(paladin), "vigil", [ref(paladin), ...rats.map(monsterRef)], ctx);
    resolveRound(combat, ctx);
    for (const r of rats) expect(searing(r)).toBe(1);
    resolveRound(combat, ctx);
    for (const r of rats) expect(searing(r)).toBe(2);
    resolveRound(combat, ctx);
    expect(channelStatusOf(paladin)).toBe(false);
    for (const r of rats) expect(searing(r)).toBe(0);
    expect(combat.log.some((l) => l.text.includes("Searing Light") && l.text.includes("3"))).toBe(true);
  });

  test("breaking Vigil ends the light and frees the Paladin to act", () => {
    const { ctx, paladin, rats, combat } = paladinFight(25);
    queueAction(combat, ref(paladin), "vigil", [...ctx.party.map(ref), ...rats.map(monsterRef)], ctx);
    resolveRound(combat, ctx);
    breakChannel(paladin, combat, ctx, combat.log);
    expect(channelStatusOf(paladin)).toBe(false);
    expect(ctx.party.some((c) => c.activeStatusEffects.some((s) => s.statusEffectId === "vigil-light"))).toBe(false);
    expect(rats.some((r) => r.activeStatusEffects.some((s) => s.statusEffectId === "searing-light"))).toBe(false);
    expect(allLivingCharactersHaveQueuedActions(combat, ctx)).toBe(false);
  });

  test("Martyr's Grace heals back part of each surviving hit, but not a killing one", () => {
    const { ctx, paladin, combat } = paladinFight(35);
    const ally = ctx.party.find((c) => c.classId === "knight")!;
    ally.maxHp = ally.hp = 1000;
    applySkillEffects(getEffectiveSkill(getSkill("martyrs-oath"), 35), paladin, ctx.party, combat, ctx, combat.log);
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    resolveSkillEffect({ kind: "damage", amount: 100, ignoreDefensePercent: 100, offenseMultiplierPercent: 0 }, rat, ally, { log: combat.log });
    expect(ally.hp).toBe(1000 - 100 + 90);
    ally.hp = 10;
    resolveSkillEffect({ kind: "damage", amount: 100, ignoreDefensePercent: 100, offenseMultiplierPercent: 0 }, rat, ally, { log: combat.log });
    expect(ally.isAlive).toBe(false);
  });
});

function channelStatusOf(c: Character): boolean {
  return c.activeStatusEffects.some((s) => getStatusEffect(s.statusEffectId).channelSkillId !== undefined);
}

describe("Warlock", () => {
  test("a Silenced monster only uses its basic attack", () => {
    withFixture([sk("fx-only-skill", { effects: [{ kind: "damage", amount: 1 }] })], { actionWeights: { boss: { "fx-only-skill": 100 } } }, () => {
      const { ctx } = makeCtx();
      const boss = tank(spawnMonster("fixture-boss", 1, { tier: "boss" }));
      ctx.monsters.push(boss);
      const combat = startCombat("r1", [boss.id], ctx, true);
      applyStatusEffectToActor(boss, "silenced", 2, { log: [] });
      const from = combat.log.length;
      runMonsterTurn(monsterRef(boss), combat, ctx);
      expect(combat.log.slice(from).some((l) => l.text.includes("fx-only-skill"))).toBe(false);
    });
  });

  test("Silenced lasts at most its eliteBossMaxTurns on an elite or boss", () => {
    const { ctx } = makeCtx();
    const normal = spawnInto(ctx, "dungeon-rat");
    const elite = spawnMonster("skeleton-guard", 1, { tier: "elite" });
    applyStatusEffectToActor(normal, "silenced", 2, { log: [] });
    applyStatusEffectToActor(elite, "silenced", 2, { log: [] });
    expect(normal.activeStatusEffects.find((s) => s.statusEffectId === "silenced")!.turnsRemaining).toBe(2);
    expect(elite.activeStatusEffects.find((s) => s.statusEffectId === "silenced")!.turnsRemaining).toBe(getStatusEffect("silenced").eliteBossMaxTurns!);
  });

  function warlockFight(level: number, ratCount = 1) {
    const { ctx } = makeCtx();
    const warlock = ctx.party.find((c) => c.classId === "warlock")!;
    unlock(warlock, level, "blood-pact", "bind-tongue", "soul-rend", "withering-curse", "doom");
    recomputeCharacterStats(warlock, 100);
    warlock.hp = warlock.maxHp;
    warlock.mp = warlock.maxMp;
    const rats = Array.from({ length: ratCount }, () => tank(spawnInto(ctx, "dungeon-rat")));
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    const cast = (skillId: string, targets: Monster[]) => applySkillEffects(getEffectiveSkill(getSkill(skillId), warlock.level), warlock, targets, combat, ctx, combat.log);
    return { ctx, warlock, rats, combat, cast };
  }
  const hexStacks = (m: Monster) => m.activeStatusEffects.find((s) => s.statusEffectId === "hexed")?.stacks ?? 0;

  test("Hexed stacks to 4, and Ripened Curse turns the fourth into a free Hex and 3 stacks gone", () => {
    const { warlock, rats, combat, cast } = warlockFight(5);
    const rat = rats[0]!;
    expect(getStatusEffect("hexed").maxStacks).toBe(4);
    for (let i = 0; i < 3; i++) cast("hex", [rat]);
    expect(hexStacks(rat)).toBe(3);
    cast("hex", [rat]);
    // 4 stacks ripen: 3 removed, then the free Hex lands one more.
    expect(hexStacks(rat)).toBe(2);
    expect(combat.log.some((l) => l.text.includes("ripens"))).toBe(true);
    expect(warlock.isAlive).toBe(true);
  });

  test("removing stacks gives back the matching share of the attack they took", () => {
    const { rats } = warlockFight(1);
    const rat = rats[0]!;
    rat.attack = 1000;
    for (let i = 0; i < 4; i++) applyStatusEffectToActor(rat, "hexed", 3, { log: [] });
    const lowered = rat.attack;
    removeStatusStacks(rat, "hexed", 3, { log: [] });
    expect(hexStacks(rat)).toBe(1);
    expect(rat.attack).toBeGreaterThan(lowered);
    expect(rat.attack).toBeLessThan(1000);
  });

  test("Blood Pact costs 10% max HP at full health, less when low, and never kills", () => {
    const { ctx, warlock, rats, combat } = warlockFight(1);
    const rat = rats[0]!;
    rat.attack = 0;
    queueAction(combat, ref(warlock), "blood-pact", [ref(warlock)], ctx);
    const full = warlock.hp;
    resolveRound(combat, ctx);
    expect(full - warlock.hp).toBe(Math.round(warlock.maxHp * 0.1));
    expect(warlock.activeStatusEffects.some((s) => s.statusEffectId === "bleeding")).toBe(false);

    warlock.cooldownsRemaining = {};
    warlock.hp = 2;
    queueAction(combat, ref(warlock), "blood-pact", [ref(warlock)], ctx);
    resolveRound(combat, ctx);
    expect(warlock.hp).toBe(1);
    expect(warlock.isAlive).toBe(true);
  });

  test("Blood Pact pays its MP cost, then restores MP", () => {
    const { ctx, warlock, rats, combat } = warlockFight(1);
    rats[0]!.attack = 0;
    warlock.mp = 20;
    queueAction(combat, ref(warlock), "blood-pact", [ref(warlock)], ctx);
    resolveRound(combat, ctx);
    expect(warlock.mp).toBe(20 - 4 + 10);
  });

  test("Blood Pact can be cast on an ally: the ally gets Pact and MP, the Warlock pays the HP", () => {
    const { ctx, warlock, rats, combat } = warlockFight(1);
    rats[0]!.attack = 0;
    const mage = ctx.party.find((c) => c.classId === "mage")!;
    mage.mp = 0;
    const full = warlock.hp;
    const mageHp = mage.hp;
    expect(queueAction(combat, ref(warlock), "blood-pact", [ref(mage)], ctx)).toBeNull();
    resolveRound(combat, ctx);
    expect(mage.activeStatusEffects.some((s) => s.statusEffectId === "pact")).toBe(true);
    expect(warlock.activeStatusEffects.some((s) => s.statusEffectId === "pact")).toBe(false);
    expect(mage.mp).toBeGreaterThan(0);
    expect(full - warlock.hp).toBe(Math.round(warlock.maxHp * 0.1));
    expect(mage.hp).toBe(mageHp);
  });

  test("Soul Rend heals the rest of the party a share of its lifesteal", () => {
    const { ctx, warlock, rats, combat, cast } = warlockFight(15);
    const effect = getEffectiveSkill(getSkill("soul-rend"), 15).effects![0]!;
    const allies = ctx.party.filter((c) => c !== warlock);
    for (const c of allies) c.hp = 1;
    const from = combat.log.length;
    cast("soul-rend", [rats[0]!]);
    const dealt = combat.log.slice(from).find((l) => l.hit?.targetId === rats[0]!.id)!.hit!.amount;
    const share = Math.round((Math.round((dealt * effect.lifestealPercent!) / 100) * effect.lifestealPartySharePercent!) / 100);
    expect(share).toBeGreaterThan(0);
    for (const c of allies) expect(c.hp).toBe(Math.min(c.maxHp, 1 + share));
  });

  test("Ripened Curse may pass a stack of Hexed from a fallen foe, at its rank's chance per stack", () => {
    const { ctx, warlock, rats, combat } = warlockFight(35, 2);
    const [fallen, next] = rats as [Monster, Monster];
    onlyAlive(ctx.party, warlock);
    for (const r of rats) r.attack = 0;
    for (let i = 0; i < 3; i++) applyStatusEffectToActor(fallen, "hexed", 3, { log: [] });
    resolveSkillEffect({ kind: "damage", amount: 1e7 }, warlock, fallen, { log: [] });
    const asked: number[] = [];
    const chance = ctx.rng.chance.bind(ctx.rng);
    ctx.rng.chance = (p: number) => {
      asked.push(p);
      return p === 0.6 ? true : chance(p);
    };
    queueAction(combat, ref(warlock), "blood-pact", [ref(warlock)], ctx);
    resolveRound(combat, ctx);
    const perStack = getClass("warlock").passiveSkill.ranks[2]!.deathSpreadChancePercentPerStack!;
    expect(asked).toContain((perStack * 3) / 100);
    expect(hexStacks(next)).toBe(1);
    expect(hexStacks(fallen)).toBe(0);
    expect(combat.log.some((l) => l.text.includes("passes to"))).toBe(true);
  });

  test("Ripened Curse passes nothing when its roll fails, and a corpse rolls only once", () => {
    const { ctx, warlock, rats, combat } = warlockFight(35, 2);
    const [fallen, next] = rats as [Monster, Monster];
    onlyAlive(ctx.party, warlock);
    for (const r of rats) r.attack = 0;
    applyStatusEffectToActor(fallen, "hexed", 3, { log: [] });
    resolveSkillEffect({ kind: "damage", amount: 1e7 }, warlock, fallen, { log: [] });
    const chance = ctx.rng.chance.bind(ctx.rng);
    ctx.rng.chance = (p: number) => (p === 0.2 ? false : chance(p));
    queueAction(combat, ref(warlock), "blood-pact", [ref(warlock)], ctx);
    resolveRound(combat, ctx);
    expect(hexStacks(next)).toBe(0);
    expect(hexStacks(fallen)).toBe(0);
  });

  test("Ripened Curse ignores a cursed body left in another room", () => {
    const { ctx, warlock, rats, combat } = warlockFight(35, 1);
    onlyAlive(ctx.party, warlock);
    rats[0]!.attack = 0;
    const elsewhere = tank(spawnInto(ctx, "dungeon-rat"));
    applyStatusEffectToActor(elsewhere, "hexed", 3, { log: [] });
    elsewhere.hp = 0;
    ctx.rng.chance = () => true;
    queueAction(combat, ref(warlock), "blood-pact", [ref(warlock)], ctx);
    resolveRound(combat, ctx);
    expect(hexStacks(rats[0]!)).toBe(0);
    expect(combat.log.some((l) => l.text.includes("passes to"))).toBe(false);
  });

  test("a spread stack that brings a foe to the burst threshold ripens at once", () => {
    const { ctx, warlock, rats, combat } = warlockFight(35, 2);
    const [fallen, next] = rats as [Monster, Monster];
    onlyAlive(ctx.party, warlock);
    for (const r of rats) r.attack = 0;
    applyStatusEffectToActor(fallen, "hexed", 3, { log: [] });
    for (let i = 0; i < 3; i++) applyStatusEffectToActor(next, "hexed", 3, { log: [] });
    resolveSkillEffect({ kind: "damage", amount: 1e7 }, warlock, fallen, { log: [] });
    const chance = ctx.rng.chance.bind(ctx.rng);
    ctx.rng.chance = (p: number) => (p === 0.2 ? true : chance(p));
    const from = combat.log.length;
    queueAction(combat, ref(warlock), "blood-pact", [ref(warlock)], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.slice(from).some((l) => l.text.includes("ripens"))).toBe(true);
  });

  test("Soul Rend eats one Hexed stack", () => {
    const { rats, cast } = warlockFight(15);
    const rat = rats[0]!;
    for (let i = 0; i < 2; i++) applyStatusEffectToActor(rat, "hexed", 3, { log: [] });
    cast("soul-rend", [rat]);
    expect(hexStacks(rat)).toBe(1);
  });

  test("Withering Curse lands 1-2 Hexed stacks on every foe", () => {
    const { rats, cast } = warlockFight(25, 3);
    cast("withering-curse", rats);
    for (const rat of rats) expect([1, 2]).toContain(hexStacks(rat));
  });

  test("Doom lands 4 stacks, spills the excess onto others at most twice each, then ripens", () => {
    const { rats, combat, cast } = warlockFight(35, 3);
    const [main, a, b] = rats as [Monster, Monster, Monster];
    for (let i = 0; i < 3; i++) applyStatusEffectToActor(main, "hexed", 3, { log: [] });
    const before = [a.hp, b.hp];
    const from = combat.log.length;
    cast("doom", [main]);
    // 3 + 4 = 7 stacks against a cap of 4: 3 spill. With two others, they take 2 and 1 (or 1 and 2).
    const spillHits = combat.log.slice(from).filter((l) => l.hit && (l.hit.targetId === a.id || l.hit.targetId === b.id)).length;
    expect(spillHits).toBe(3);
    expect(a.hp).toBeLessThan(before[0]!);
    expect(b.hp).toBeLessThan(before[1]!);
    // Capped at 4, ripened to 1, then the free Hex adds one.
    expect(hexStacks(main)).toBe(2);
  });

  test("Doom's spill is lost when the target stands alone", () => {
    const { rats, combat, cast } = warlockFight(35, 1);
    const main = rats[0]!;
    for (let i = 0; i < 2; i++) applyStatusEffectToActor(main, "hexed", 3, { log: [] });
    const from = combat.log.length;
    cast("doom", [main]);
    expect(combat.log.slice(from).filter((l) => l.hit && l.hit.targetId !== main.id).length).toBe(0);
  });

  // Without `rollDamage` the resolver rolls neither crit nor variance, so the two hits compare exactly.
  test("Soul Rend scales with Hexed stacks", () => {
    const { ctx } = makeCtx();
    const warlock = ctx.party.find((c) => c.classId === "warlock")!;
    const clean = tank(spawnInto(ctx, "dungeon-rat"));
    const cursed = tank(spawnInto(ctx, "dungeon-rat"));
    for (let i = 0; i < 3; i++) applyStatusEffectToActor(cursed, "hexed", 3, { log: [] });
    const effect = getEffectiveSkill(getSkill("soul-rend"), 25).effects![0]!;
    expect(resolveSkillEffect(effect, warlock, cursed, { log: [], isMagic: true })).toBeGreaterThan(resolveSkillEffect(effect, warlock, clean, { log: [], isMagic: true }));
  });
});
