import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound, applySkillEffects, applyOnActStatuses } from "../src/engine/combat";
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

  function jesterFight(level: number) {
    const { ctx } = makeCtx();
    const jester = ctx.party.find((c) => c.classId === "jester")!;
    unlock(jester, level, "double-or-nothing");
    const target = tank(spawnInto(ctx, "dungeon-rat"));
    const combat = startCombat("r1", [target.id], ctx, false);
    const cast = () => {
      const before = target.hp;
      applySkillEffects(getEffectiveSkill(getSkill("double-or-nothing"), jester.level), jester, [target], combat, ctx, combat.log);
      return before - target.hp;
    };
    return { ctx, jester, cast };
  }

  test("a lost coin flip slows the Jester and stores Fortune; a won one spends it for more damage", () => {
    const { ctx, jester, cast } = jesterFight(25);
    ctx.rng.chance = () => false;
    cast();
    expect(jester.activeStatusEffects.some((s) => s.statusEffectId === "slowed")).toBe(true);
    expect(jester.activeStatusEffects.find((s) => s.statusEffectId === "fortune")?.stacks).toBe(1);
    cast();
    expect(jester.activeStatusEffects.find((s) => s.statusEffectId === "fortune")?.stacks).toBe(2);

    ctx.rng.chance = () => true;
    const withFortune = cast();
    expect(jester.activeStatusEffects.some((s) => s.statusEffectId === "fortune")).toBe(false);
    const withoutFortune = cast();
    expect(withFortune).toBeGreaterThan(withoutFortune);
  });

  test("below the passive's first rank a lost gamble stores nothing", () => {
    const { ctx, jester, cast } = jesterFight(1);
    ctx.rng.chance = () => false;
    cast();
    expect(jester.activeStatusEffects.some((s) => s.statusEffectId === "fortune")).toBe(false);
  });

  test("Loaded Dice rolls its damage inside its range", () => {
    const { ctx } = makeCtx();
    const jester = ctx.party.find((c) => c.classId === "jester")!;
    const target = tank(spawnInto(ctx, "dungeon-rat"));
    target.defense = 0;
    const combat = startCombat("r1", [target.id], ctx, false);
    const skill = getEffectiveSkill(getSkill("loaded-dice"), 1);
    const range = skill.effects![0]!.damageRollRange!;
    const hits = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const before = target.hp;
      applySkillEffects(skill, jester, [target], combat, ctx, combat.log);
      hits.add(before - target.hp);
    }
    expect(hits.size).toBeGreaterThan(1);
    const amount = skill.effects![0]!.amount!;
    for (const hit of hits) {
      expect(hit).toBeGreaterThanOrEqual(Math.floor(amount + (jester.attack * range.minPercent) / 100) - 1);
      expect(hit).toBeLessThanOrEqual(Math.ceil(amount + (jester.attack * range.maxPercent) / 100) + 1);
    }
  });

  test("Rigged Game puts a debuff from its pool on every enemy", () => {
    const { ctx } = makeCtx();
    const jester = ctx.party.find((c) => c.classId === "jester")!;
    unlock(jester, 15, "rigged-game");
    const rats = [0, 1, 2].map(() => tank(spawnInto(ctx, "dungeon-rat")));
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    const skill = getEffectiveSkill(getSkill("rigged-game"), jester.level);
    const pool = skill.effects!.find((e) => e.randomStatusEffectIds)!.randomStatusEffectIds!;
    applySkillEffects(skill, jester, rats, combat, ctx, combat.log);
    for (const rat of rats) expect(rat.activeStatusEffects.some((s) => pool.includes(s.statusEffectId))).toBe(true);
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
