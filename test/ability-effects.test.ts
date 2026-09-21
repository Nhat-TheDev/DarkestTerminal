import { describe, test, expect } from "bun:test";
import { getSkill, getClass } from "../src/data/classes";
import { Rng } from "../src/engine/rng";
import { startCombat, applySkillEffects, resolveRound } from "../src/engine/combat";
import { mitigatedOffense } from "../src/engine/resolver";
import { recomputeCharacterStats, statsForLevel, characterBaseStats } from "../src/engine/party";
import { applyArtifactHealOnKill } from "../src/engine/combatHooks";
import { abilityWidenedStatBoost, alwaysHitChance, debuffResistPercent, totalHealOnKill } from "../src/engine/artifacts";
import { ABILITIES, getAbility, rollAbility, formatAbilityEffect } from "../src/data/abilities";
import { loadProfile, saveProfile, unlockAbility, lockAbility, isAbilityUnlocked, type Profile } from "../src/engine/profile";
import { Game } from "../src/engine/game";
import { BALANCE } from "../src/data/balanceConfig";
import { makeCtx, spawnInto } from "./helpers";
import { migrateGameState } from "../src/engine/migration";
import { CLASSES } from "../src/data/classes";
import { buildRewardEntries } from "../src/ui/state";
import type { LogEntry, SkillDefinition } from "../src/types";

/** Expected delta of an Ability `statBoost` on a pre-equipment `base`, per the documented minPercent rule. Deliberately independent of the engine so the test checks the hook against the data, and data edits can't silently break it again. */
function expectedAbilityStatBoost(abilityId: string, stat: string, base: number): number {
  const effect = getAbility(abilityId).effects.find((e) => e.kind === "statBoost" && "stat" in e && e.stat === stat) as
    | { amount: number; minPercent?: number }
    | undefined;
  if (!effect) throw new Error(`test setup: ability "${abilityId}" has no statBoost for "${stat}"`);
  if (effect.minPercent === undefined) return effect.amount;
  return Math.max(effect.amount, Math.round((base * effect.minPercent) / 100));
}

describe("Abilities: stat boosts", () => {
  test("statBoost through an equipped Ability applies via the same hook Artifacts use (attack/defense/maxHp/maxMp)", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    const baseAttack = c.attack;
    c.equippedAbilityId = "battle-instinct";
    recomputeCharacterStats(c, 100);
    expect(c.attack).toBe(baseAttack + expectedAbilityStatBoost("battle-instinct", "attack", baseAttack));
  });

  test("the minPercent floor is measured against the raw base stat, not the Exhausted-reduced one", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.level = 100;
    const base = characterBaseStats(c);
    c.equippedAbilityId = null;
    recomputeCharacterStats(c, 0);
    const exhaustedAttack = c.attack;
    expect(exhaustedAttack).toBeLessThan(base.attack); // satiety 0 really is penalizing

    c.equippedAbilityId = "battle-instinct";
    recomputeCharacterStats(c, 0);
    expect(c.attack - exhaustedAttack).toBe(expectedAbilityStatBoost("battle-instinct", "attack", base.attack));
  });

  test("Ability-only statBoost stats (aggro/speed/magicPower) apply via the widened hook", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    const baseSpeed = c.speed;
    const baseAggro = c.aggro;
    const baseMagicPower = c.magicPower;

    c.equippedAbilityId = "lodestone"; // autoDamage + statBoost aggro
    recomputeCharacterStats(c, 100);
    expect(c.aggro).toBe(baseAggro + expectedAbilityStatBoost("lodestone", "aggro", baseAggro));

    c.equippedAbilityId = "restless-vigor"; // statBoost speed
    recomputeCharacterStats(c, 100);
    expect(c.speed).toBe(baseSpeed + expectedAbilityStatBoost("restless-vigor", "speed", baseSpeed));

    c.equippedAbilityId = "arcane-aptitude"; // statBoost magicPower
    recomputeCharacterStats(c, 100);
    expect(c.magicPower).toBe(baseMagicPower + expectedAbilityStatBoost("arcane-aptitude", "magicPower", baseMagicPower));
  });

  test("no Ability equipped contributes nothing", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedAbilityId = null;
    expect(abilityWidenedStatBoost(c, "aggro", c.aggro)).toBe(0);
    expect(abilityWidenedStatBoost(c, "speed", c.speed)).toBe(0);
    expect(abilityWidenedStatBoost(c, "magicPower", c.magicPower)).toBe(0);
    expect(alwaysHitChance(c)).toBe(0);
  });
});

describe("Abilities: healOnKill and autoDamage scale off the bearer's base stats", () => {
  test("healOnKill takes the larger of the flat amount and minPercent of the bearer's base max HP", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedAbilityId = "reapers-instinct";
    const effect = getAbility("reapers-instinct").effects.find((e) => e.kind === "healOnKill") as { amount: number; minPercent: number };

    c.level = 1;
    expect(totalHealOnKill(c, characterBaseStats(c).maxHp)).toBe(effect.amount);

    c.level = 100;
    const base = characterBaseStats(c).maxHp;
    expect(totalHealOnKill(c, base)).toBe(Math.max(effect.amount, Math.round((base * effect.minPercent) / 100)));
    expect(Math.round((base * effect.minPercent) / 100)).toBeGreaterThan(effect.amount);
  });

  test("the on-kill heal ignores max HP the bearer has gained from equipment, ability or buffs", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedAbilityId = "reapers-instinct";
    c.level = 100;
    const effect = getAbility("reapers-instinct").effects.find((e) => e.kind === "healOnKill") as { minPercent: number };
    const expected = Math.round((characterBaseStats(c).maxHp * effect.minPercent) / 100);

    c.maxHp = 1_000_000;
    c.hp = 1;
    applyArtifactHealOnKill(c, []);
    expect(c.hp - 1).toBe(expected);
  });

  function autoDamageTaken(abilityId: string, classId: string, liveStat: number | null): { taken: number; expected: number } {
    const { ctx } = makeCtx();
    const c = ctx.party.find((p) => p.classId === classId)!;
    c.level = 100;
    c.equippedAbilityId = abilityId;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = 50000;
    rat.hp = 50000;
    const combat = startCombat("r1", [rat.id], ctx, false);
    if (liveStat !== null) {
      c.attack = liveStat;
      c.magicPower = liveStat;
    }
    const effect = getAbility(abilityId).effects.find((e) => e.kind === "autoDamage") as {
      amount: number;
      offenseMultiplierPercent: number;
      isMagic?: boolean;
    };
    const base = characterBaseStats(c);
    const offense = (effect.isMagic ? base.magicPower : base.attack) * (effect.offenseMultiplierPercent / 100);
    const expected = Math.max(1, Math.round(effect.amount + mitigatedOffense(offense, rat.defense)));
    resolveRound(combat, ctx);
    return { taken: 50000 - rat.hp, expected };
  }

  test("autoDamage deals amount + offenseMultiplierPercent of the BASE stat, ignoring the live (buffed) stat", () => {
    for (const [ability, classId] of [
      ["thunderous-aura", "mage"],
      ["lodestone", "rogue"],
    ] as const) {
      const plain = autoDamageTaken(ability, classId, null);
      const buffed = autoDamageTaken(ability, classId, 9999);
      const drained = autoDamageTaken(ability, classId, 1);
      expect(plain.taken).toBe(plain.expected);
      expect(buffed.taken).toBe(plain.taken);
      expect(drained.taken).toBe(plain.taken);
    }
  });

  test("a magic autoDamage Ability reads base magicPower, a non-magic one reads base attack", () => {
    // mage: high base magicPower, tiny base attack — rogue: the reverse
    expect(autoDamageTaken("thunderous-aura", "mage", null).taken).toBeGreaterThan(autoDamageTaken("thunderous-aura", "rogue", null).taken);
    expect(autoDamageTaken("lodestone", "rogue", null).taken).toBeGreaterThan(autoDamageTaken("lodestone", "mage", null).taken);
  });

  test("the combat log names the Ability that dealt the auto damage", () => {
    const { ctx } = makeCtx();
    const c = ctx.party.find((p) => p.classId === "mage")!;
    c.equippedAbilityId = "thunderous-aura";
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("Thunderous Aura"))).toBe(true);
  });
});

describe("Abilities: effect text surfaces the level scaling", () => {
  test("every effect carrying minPercent or offenseMultiplierPercent shows its percentage in the description", () => {
    for (const ability of ABILITIES) {
      const text = formatAbilityEffect(ability);
      for (const effect of ability.effects) {
        const percent = "minPercent" in effect ? effect.minPercent : "offenseMultiplierPercent" in effect ? effect.offenseMultiplierPercent : undefined;
        if (percent !== undefined) expect(text).toContain(`${percent}%`);
      }
    }
  });
});

describe("Abilities: alwaysHit", () => {
  test("alwaysHit meaningfully lowers the fear-accuracy miss rate at max fear tier", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.survival.fear = 100; // fear tier 4 -> 20% base miss chance (getFearAccuracyPenalty)
    c.equippedAbilityId = "unerring-will"; // alwaysHit 20% + fearResist 12%
    expect(alwaysHitChance(c)).toBe(20);

    const skill = getSkill("vanguard-slash");
    const combat = startCombat("test-room", [], ctx, false);
    const trials = 6000;
    let misses = 0;
    for (let i = 0; i < trials; i++) {
      const monster = spawnInto(ctx, "dungeon-rat", 1);
      const log: LogEntry[] = [];
      applySkillEffects(skill, c, [monster], combat, ctx, log);
      if (log.some((e) => e.text.includes("misses its attack"))) misses++;
      ctx.monsters = ctx.monsters.filter((m) => m.id !== monster.id);
    }
    // Expected miss rate = (1 - 0.20) * 0.20 = 0.16, well below the un-augmented 0.20.
    const rate = misses / trials;
    expect(rate).toBeGreaterThan(0.13);
    expect(rate).toBeLessThan(0.19);
  });

  test("without alwaysHit, the same fear tier misses close to the base 20% rate", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.survival.fear = 100;
    c.equippedAbilityId = null;

    const skill = getSkill("vanguard-slash");
    const combat = startCombat("test-room", [], ctx, false);
    const trials = 6000;
    let misses = 0;
    for (let i = 0; i < trials; i++) {
      const monster = spawnInto(ctx, "dungeon-rat", 1);
      const log: LogEntry[] = [];
      applySkillEffects(skill, c, [monster], combat, ctx, log);
      if (log.some((e) => e.text.includes("misses its attack"))) misses++;
      ctx.monsters = ctx.monsters.filter((m) => m.id !== monster.id);
    }
    const rate = misses / trials;
    expect(rate).toBeGreaterThan(0.17);
    expect(rate).toBeLessThan(0.23);
  });
});

describe("Abilities: debuffResist", () => {
  const statusSkill = (statusEffectId: string, chance?: number): SkillDefinition => ({
    id: "test-status",
    name: "Test Status",
    description: "",
    mpCost: 0,
    target: "singleEnemy",
    effects: [{ kind: "applyStatusEffect", statusEffectId, durationTurns: 2, chance }],
    slot: 0,
    unlockLevel: 1,
  });

  function landRate(abilityId: string | null, statusEffectId: string, trials = 4000, chance?: number) {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedAbilityId = abilityId;
    const combat = startCombat("test-room", [], ctx, false);
    const monster = spawnInto(ctx, "dungeon-rat", 1);
    const log: LogEntry[] = [];
    let landed = 0;
    for (let i = 0; i < trials; i++) {
      c.activeStatusEffects = [];
      applySkillEffects(statusSkill(statusEffectId, chance), monster, [c], combat, ctx, log);
      if (c.activeStatusEffects.some((s) => s.statusEffectId === statusEffectId)) landed++;
    }
    return { rate: landed / trials, log };
  }

  test("reads the equipped Ability's percent, 0 without one", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    expect(debuffResistPercent(c)).toBe(0);
    c.equippedAbilityId = "sealed-bulwark";
    expect(debuffResistPercent(c)).toBe(getAbility("sealed-bulwark").effects.find((e) => e.kind === "debuffResist")!.percent);
  });

  test("a guaranteed harmful status lands (1 - percent) of the time, and the misses are logged", () => {
    const bearer = makeCtx().ctx.party[0]!;
    bearer.equippedAbilityId = "sealed-bulwark";
    const percent = debuffResistPercent(bearer);
    const { rate, log } = landRate("sealed-bulwark", "poisoned");
    expect(rate).toBeGreaterThan(1 - percent / 100 - 0.04);
    expect(rate).toBeLessThan(1 - percent / 100 + 0.04);
    expect(log.some((e) => e.text.includes("throws off Poisoned"))).toBe(true);
  });

  test("a 60% status under a 32% resist lands 40.8% of the time", () => {
    const { rate } = landRate("sealed-bulwark", "poisoned", 6000, 0.6);
    expect(rate).toBeGreaterThan(0.408 - 0.04);
    expect(rate).toBeLessThan(0.408 + 0.04);
  });

  test("without the Ability every harmful status lands", () => {
    expect(landRate(null, "poisoned", 500).rate).toBe(1);
  });

  test("a helpful status is never thrown off", () => {
    expect(landRate("sealed-bulwark", "regeneration", 500).rate).toBe(1);
  });

  test("effect text states the percent", () => {
    expect(formatAbilityEffect(getAbility("stubborn-blood"))).toContain("10%");
  });
});

describe("rollAbility", () => {
  test("never rolls an id already in unlockedAbilityIds", () => {
    const nonCommonIds = ABILITIES.filter((a) => a.rarity !== "common").map((a) => a.id);
    const rng = new Rng(3);
    for (let i = 0; i < 500; i++) {
      expect(rollAbility("boss", 30, rng, nonCommonIds)).toBeNull();
    }
  });

  test("depth 1 vs. depth cap: Elite never rolls epic at depth 1, but does by depth cap", () => {
    const rng = new Rng(21);
    let sawEpicAtCap = false;
    for (let i = 0; i < 3000; i++) {
      const shallow = rollAbility("elite", 1, rng, []);
      if (shallow) expect(getAbility(shallow).rarity).not.toBe("epic");
      const deep = rollAbility("elite", 30, rng, []);
      if (deep && getAbility(deep).rarity === "epic") sawEpicAtCap = true;
    }
    expect(sawEpicAtCap).toBe(true);
  });

  test("boss never rolls common", () => {
    const rng = new Rng(11);
    for (let i = 0; i < 3000; i++) {
      const id = rollAbility("boss", 15, rng, []);
      if (id) expect(getAbility(id).rarity).not.toBe("common");
    }
  });

  test("catalog exhaustion: only the 1 remaining unfilled id can ever be rolled", () => {
    const allNonCommon = ABILITIES.filter((a) => a.rarity !== "common").map((a) => a.id);
    const target = "bloodletting";
    const almostAllUnlocked = allNonCommon.filter((id) => id !== target);
    const rng = new Rng(42);
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const id = rollAbility("boss", 30, rng, almostAllUnlocked);
      if (id) seen.add(id);
    }
    expect([...seen]).toEqual([target]);
  });

  test("whole non-common catalog exhausted returns null every time", () => {
    const allNonCommon = ABILITIES.filter((a) => a.rarity !== "common").map((a) => a.id);
    const rng = new Rng(99);
    for (let i = 0; i < 200; i++) {
      expect(rollAbility("boss", 30, rng, allNonCommon)).toBeNull();
    }
  });
});

describe("AbilityProfile persistence", () => {
  test("round-trips unlock/lock across save/load; commons are always unlocked regardless", () => {
    saveProfile({ version: 1, unlockedAbilityIds: [], retiredCharacters: [], shownRetiredCharacterEvent: false });
    let profile = loadProfile();
    expect(profile.unlockedAbilityIds).toEqual([]);
    expect(isAbilityUnlocked(profile, "iron-skin")).toBe(true);
    expect(isAbilityUnlocked(profile, "bloodletting")).toBe(false);

    unlockAbility(profile, "bloodletting");
    saveProfile(profile);
    profile = loadProfile();
    expect(profile.unlockedAbilityIds).toEqual(["bloodletting"]);
    expect(isAbilityUnlocked(profile, "bloodletting")).toBe(true);

    lockAbility(profile, "bloodletting");
    saveProfile(profile);
    profile = loadProfile();
    expect(profile.unlockedAbilityIds).toEqual([]);
  });

  test("unlockAbility is a no-op for an id already present", () => {
    const profile: Profile = { version: 1, unlockedAbilityIds: ["bloodletting"], retiredCharacters: [], shownRetiredCharacterEvent: false };
    unlockAbility(profile, "bloodletting");
    expect(profile.unlockedAbilityIds).toEqual(["bloodletting"]);
  });

  test("lockAbility is a no-op for an id not present", () => {
    const profile: Profile = { version: 1, unlockedAbilityIds: [], retiredCharacters: [], shownRetiredCharacterEvent: false };
    lockAbility(profile, "bloodletting");
    expect(profile.unlockedAbilityIds).toEqual([]);
  });
});

const PARTY = ["vanguard", "mage", "rogue", "acolyte"];

function wipeParty(game: Game): void {
  for (const c of game.state.party) {
    c.hp = 0;
    c.isAlive = false;
  }
  // `triggerDefeat` is private — this is the exact same transition `postMoveCheck`/`resolve()`
  // trigger internally on a real party wipe; reaching it directly keeps this test independent of
  // the combat pipeline that would otherwise be needed to produce a wipe.
  (game as unknown as { triggerDefeat: () => void }).triggerDefeat();
}

describe("Game: ability death flow", () => {
  test("a common equipped ability is never at risk — no buyback needed", () => {
    saveProfile({ version: 1, unlockedAbilityIds: [], retiredCharacters: [], shownRetiredCharacterEvent: false });
    const game = new Game(1, PARTY, undefined, ["battle-instinct", null, null, null]);
    wipeParty(game);
    expect(game.state.gameOver).toBe("defeat");
    expect(game.state.pendingAbilityBuyback).toBeNull();
    expect(game.state.abilityDeathResults).toEqual([]);
  });

  test("a non-common equipped ability is struck from the profile immediately, then reclaimable with enough Stardust", () => {
    saveProfile({ version: 1, unlockedAbilityIds: ["bloodletting"], retiredCharacters: [], shownRetiredCharacterEvent: false });
    const game = new Game(2, PARTY, undefined, ["bloodletting", null, null, null]);
    game.state.runStardust = 10;
    wipeParty(game);

    expect(loadProfile().unlockedAbilityIds).not.toContain("bloodletting");
    expect(game.state.pendingAbilityBuyback?.entries).toHaveLength(1);
    expect(game.state.pendingAbilityBuyback?.entries[0]).toEqual({ characterId: "p1", lostAbilityId: "bloodletting", rarity: "rare" });

    const cost = BALANCE.abilities.stardustCostByRarity.rare;
    const err = game.resolveAbilityBuyback("reclaim");
    expect(err).toBeNull();
    expect(game.state.runStardust).toBe(10 - cost);
    expect(loadProfile().unlockedAbilityIds).toContain("bloodletting");
    expect(game.state.pendingAbilityBuyback).toBeNull();
    expect(game.state.abilityDeathResults).toEqual([{ characterId: "p1", lostAbilityId: "bloodletting", outcome: "reclaimed" }]);
  });

  test("skipping a buyback entry leaves it lost", () => {
    saveProfile({ version: 1, unlockedAbilityIds: ["bloodletting"], retiredCharacters: [], shownRetiredCharacterEvent: false });
    const game = new Game(3, PARTY, undefined, ["bloodletting", null, null, null]);
    wipeParty(game);

    const err = game.resolveAbilityBuyback("skip");
    expect(err).toBeNull();
    expect(loadProfile().unlockedAbilityIds).not.toContain("bloodletting");
    expect(game.state.abilityDeathResults).toEqual([{ characterId: "p1", lostAbilityId: "bloodletting", outcome: "lost" }]);
    expect(game.state.pendingAbilityBuyback).toBeNull();
  });

  test("reclaim fails outright with insufficient Stardust, and nothing is consumed", () => {
    saveProfile({ version: 1, unlockedAbilityIds: ["bloodletting"], retiredCharacters: [], shownRetiredCharacterEvent: false });
    const game = new Game(4, PARTY, undefined, ["bloodletting", null, null, null]);
    game.state.runStardust = 0;
    wipeParty(game);

    const err = game.resolveAbilityBuyback("reclaim");
    expect(err).not.toBeNull();
    expect(game.state.runStardust).toBe(0);
    expect(game.state.pendingAbilityBuyback?.entries).toHaveLength(1);
    expect(loadProfile().unlockedAbilityIds).not.toContain("bloodletting");
  });

  test("multiple lost abilities resolve one at a time, in order", () => {
    saveProfile({ version: 1, unlockedAbilityIds: ["bloodletting", "predators-edge"], retiredCharacters: [], shownRetiredCharacterEvent: false });
    const game = new Game(5, PARTY, undefined, ["bloodletting", "predators-edge", null, null]);
    game.state.runStardust = 100;
    wipeParty(game);

    expect(game.state.pendingAbilityBuyback?.entries).toHaveLength(2);
    expect(game.resolveAbilityBuyback("skip")).toBeNull();
    expect(game.state.pendingAbilityBuyback?.resolvedIndex).toBe(1);
    expect(game.resolveAbilityBuyback("reclaim")).toBeNull();
    expect(game.state.pendingAbilityBuyback).toBeNull();
    expect(game.state.abilityDeathResults).toEqual([
      { characterId: "p1", lostAbilityId: "bloodletting", outcome: "lost" },
      { characterId: "p2", lostAbilityId: "predators-edge", outcome: "reclaimed" },
    ]);
  });
});

describe("Elite/Boss ability unlock: revealed on the room-clear reward screen, like an Artifact drop", () => {
  test("buildRewardEntries includes a ability entry per dropped ability id, alongside items/artifacts", () => {
    const entries = buildRewardEntries({ itemIds: ["small-health-potion"], artifactIds: ["iron-gauntlet"], abilityIds: ["bloodletting"] });

    expect(entries).toContainEqual({ kind: "ability", id: "bloodletting" });
    expect(entries.filter((e) => e.kind === "ability")).toHaveLength(1);
  });

  test("no abilityIds produces no ability entries (unaffected by the item/artifact entries)", () => {
    const entries = buildRewardEntries({ itemIds: [], artifactIds: ["iron-gauntlet"], abilityIds: [] });

    expect(entries.some((e) => e.kind === "ability")).toBe(false);
    expect(entries).toEqual([{ kind: "artifact", id: "iron-gauntlet" }]);
  });

  test("multiple dropped abilities each get their own entry", () => {
    const entries = buildRewardEntries({ itemIds: [], artifactIds: [], abilityIds: ["bloodletting", "predators-edge"] });

    expect(entries).toEqual([
      { kind: "ability", id: "bloodletting" },
      { kind: "ability", id: "predators-edge" },
    ]);
  });
});

describe("Abilities: run entry", () => {
  test("an equipped Ability's stat boost is live before the first combat, at full hp", () => {
    const classIds = CLASSES.map((c) => c.id);
    // thornhide grants a maxHp statBoost (amount 60, minPercent 10); battle-instinct grants an
    // attack statBoost (amount 5, minPercent 5) — each resolved against the character's
    // pre-equipment base (a fresh run starts at level 1, satiety 100 → no Exhausted multiplier).
    const game = new Game(11, classIds, undefined, ["thornhide", "battle-instinct"]);
    const [vanguard, mage] = game.state.party;
    const vanguardMaxHp = statsForLevel(getClass(vanguard!.classId), vanguard!.level).maxHp;
    const mageAttack = statsForLevel(getClass(mage!.classId), mage!.level).attack;

    expect(vanguard!.maxHp).toBe(vanguardMaxHp + expectedAbilityStatBoost("thornhide", "maxHp", vanguardMaxHp));
    expect(vanguard!.hp).toBe(vanguard!.maxHp);
    expect(mage!.attack).toBe(mageAttack + expectedAbilityStatBoost("battle-instinct", "attack", mageAttack));

    // The bonus must survive the first recompute rather than being clamped away into a permanent
    // hp shortfall — `recomputeCharacterStats` only ever clamps hp down.
    recomputeCharacterStats(vanguard!, game.state.satiety);
    expect(vanguard!.hp).toBe(vanguard!.maxHp);
  });

  test("two characters cannot enter a run carrying the same Ability", () => {
    const classIds = CLASSES.map((c) => c.id);
    const game = new Game(11, classIds, undefined, ["battle-instinct", "battle-instinct"]);

    expect(game.state.party[0]!.equippedAbilityId).toBe("battle-instinct");
    expect(game.state.party[1]!.equippedAbilityId).toBeNull();
  });
});

describe("Abilities: old saves", () => {
  test("a pre-Abilities lastRoomDrops is backfilled with an empty abilityIds", () => {
    const state = JSON.parse(JSON.stringify(new Game(3).state));
    state.lastRoomDrops = { itemIds: ["exploration-kit"], artifactIds: [] };
    delete state.runStardust;
    delete state.pendingAbilityBuyback;
    delete state.abilityDeathResults;

    migrateGameState(state);

    expect(state.lastRoomDrops.abilityIds).toEqual([]);
    expect(buildRewardEntries(state.lastRoomDrops)).toEqual([{ kind: "item", id: "exploration-kit", qty: 1 }]);
  });
});

describe("Abilities: alwaysHit rng cost", () => {
  test("a character with no alwaysHit Ability spends no rng draw on the alwaysHit roll", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    attacker.equippedAbilityId = null;
    const monster = spawnInto(ctx, "black-bat");
    const combat = startCombat("test-room", [monster.id], ctx, false);
    const log: LogEntry[] = [];

    let draws = 0;
    const next = ctx.rng.next.bind(ctx.rng);
    ctx.rng.next = () => {
      draws++;
      return next();
    };

    applySkillEffects(getSkill("vanguard-slash"), attacker, [monster], combat, ctx, log);

    // Exactly the skill's own accuracy roll. `Rng.chance` advances the stream even at p = 0, so an
    // unguarded alwaysHit roll would make this 2 and shift every seeded run downstream of it.
    expect(draws).toBe(1);
  });
});
