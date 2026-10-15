import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound, applySkillEffects, applyOnActStatuses, clearCombatResources } from "../src/engine/combat";
import { runMonsterTurn } from "../src/engine/monsterAI";
import { resolveSkillEffect, applyStatusEffectToActor, tickDotEffects, harmfulStatusCount } from "../src/engine/resolver";
import { resistedFearGain } from "../src/engine/survival";
import { getClass, getSkill, getEffectiveSkill, SKILLS_PER_CLASS } from "../src/data/classes";
import { getStatusEffect } from "../src/data/statusEffects";
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
    for (const id of ["vanguard", "mage", "rogue", "acolyte", "viking", "plague-doctor", "archer", "ninja", "summoner", "jester", "paladin", "warlock"]) {
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

describe("Retaliate (Vanguard)", () => {
  test("a monster's hit on a Retaliating Vanguard strikes back at every enemy, at most twice a round", () => {
    const { ctx } = makeCtx(3);
    const vanguard = ctx.party.find((c) => c.classId === "vanguard")!;
    unlock(vanguard, 25, "retaliate");
    vanguard.maxHp = vanguard.hp = 1e6;
    onlyAlive(ctx.party, vanguard);
    const rats = [0, 1, 2].map(() => tank(spawnInto(ctx, "dungeon-rat")));
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    queueAction(combat, ref(vanguard), "retaliate", [ref(vanguard)], ctx);
    resolveRound(combat, ctx);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "retaliating")).toBe(true);

    const from = combat.log.length;
    resolveRound(combat, ctx);
    const counters = combat.log.slice(from).filter((l) => l.text.includes("answers the blow")).length;
    expect(counters).toBe(2);
    for (const rat of rats) expect(rat.hp).toBeLessThan(rat.maxHp);
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
  test("every minion out acts once more with its signature skill, without spending an action", () => {
    const { ctx } = makeCtx(5);
    const summoner = ctx.party.find((c) => c.classId === "summoner")!;
    unlock(summoner, 25, "summon-goblin", "command");
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    queueAction(combat, ref(summoner), "summon-goblin", [ref(summoner)], ctx);
    resolveRound(combat, ctx);
    const goblin = ctx.summons.find((s) => s.archetypeId === "goblin-thrower" && s.hp > 0)!;
    expect(goblin).toBeDefined();
    const actionsBefore = goblin.actionsTaken;

    const from = combat.log.length;
    queueAction(combat, ref(summoner), "command", [monsterRef(rat)], ctx);
    resolveRound(combat, ctx);
    const rockThrows = combat.log.slice(from).filter((l) => l.text.includes(goblin.name) && l.text.includes("Rock Throw")).length;
    expect(rockThrows).toBeGreaterThanOrEqual(1);
    // Its normal turn this round counts; the commanded one does not.
    expect(goblin.actionsTaken).toBe(actionsBefore + 1);
  });
});

describe("Jester", () => {
  withoutDamageRolls();

  function jesterFight(level: number, ratCount = 1) {
    const { ctx } = makeCtx();
    const jester = ctx.party.find((c) => c.classId === "jester")!;
    unlock(jester, level, "jeer", "battle-ballad", "rigged-game", "double-or-nothing", "finale");
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

  test("a lost coin flip misses, slows the Jester, rigs the next toss, resets the cooldown and stores Fortune", () => {
    const { ctx, jester, cast } = jesterFight(25);
    const realChance = ctx.rng.chance.bind(ctx.rng);
    ctx.rng.chance = () => false;
    jester.cooldownsRemaining["double-or-nothing"] = 3;
    expect(cast("double-or-nothing")).toBe(0);
    for (const id of ["slowed", "rigged"]) expect(jester.activeStatusEffects.some((s) => s.statusEffectId === id)).toBe(true);
    expect(jester.cooldownsRemaining["double-or-nothing"]).toBe(0);
    expect(jester.activeStatusEffects.find((s) => s.statusEffectId === "fortune")?.stacks).toBe(1);

    // Rigged doubles a 50% toss: the next one cannot lose.
    ctx.rng.chance = realChance;
    expect(cast("double-or-nothing")).toBeGreaterThan(0);
    expect(jester.activeStatusEffects.some((s) => s.statusEffectId === "fortune")).toBe(false);
  });

  test("Fortune makes the winning toss hit harder, and below rank 1 nothing is stored", () => {
    const { ctx, jester, cast } = jesterFight(25);
    ctx.rng.chance = () => false;
    cast("double-or-nothing");
    cast("double-or-nothing");
    ctx.rng.chance = () => true;
    const withFortune = cast("double-or-nothing");
    const withoutFortune = cast("double-or-nothing");
    expect(withFortune).toBeGreaterThan(withoutFortune);

    const low = jesterFight(1);
    low.ctx.rng.chance = () => false;
    low.cast("double-or-nothing");
    expect(low.jester.activeStatusEffects.some((s) => s.statusEffectId === "fortune")).toBe(false);
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

  test("Jeer always weakens, and a Provoked monster's attacks all go to the Jester", () => {
    const { ctx, jester, target, combat, cast } = jesterFight(15);
    ctx.rng.chance = () => true;
    cast("jeer");
    expect(target.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(true);
    expect(target.activeStatusEffects.find((s) => s.statusEffectId === "provoked")?.sourceId).toBe(jester.id);
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
    const slowAlly = ctx.party.find((c) => c.classId === "vanguard")!;
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

describe("Paladin — Retribution", () => {
  withoutDamageRolls();

  test("a direct hit on the Paladin turns its rank's share back on the attacker", () => {
    const { ctx } = makeCtx();
    const paladin = ctx.party.find((c) => c.classId === "paladin")!;
    paladin.level = 5;
    const rat = tank(spawnInto(ctx, "dungeon-rat"));
    rat.attack = 200;
    const dealt = resolveSkillEffect({ kind: "damage", amount: 0 }, rat, paladin, { log: [] });
    const percent = getClass("paladin").passiveSkill.ranks[0]!.reflectPercent!;
    expect(rat.maxHp - rat.hp).toBe(Math.round((dealt * percent) / 100));
  });
});

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

  test("Soul Feast restores MP and HP on a kill", () => {
    const { ctx } = makeCtx();
    const warlock = ctx.party.find((c) => c.classId === "warlock")!;
    warlock.level = 5;
    warlock.mp = 0;
    warlock.hp = 1;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.hp = 1;
    const combat = startCombat("r1", [rat.id], ctx, false);
    applySkillEffects(getEffectiveSkill(getSkill("eldritch-bolt"), 5), warlock, [rat], combat, ctx, combat.log);
    expect(rat.hp).toBe(0);
    expect(warlock.mp).toBeGreaterThan(0);
    expect(warlock.hp).toBeGreaterThan(1);
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
