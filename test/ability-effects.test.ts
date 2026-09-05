import { describe, test, expect } from "bun:test";
import { getSkill } from "../src/data/classes";
import { Rng } from "../src/engine/rng";
import { startCombat, applySkillEffects } from "../src/engine/combat";
import { recomputeCharacterStats } from "../src/engine/party";
import { abilityWidenedStatBoost, alwaysHitChance } from "../src/engine/artifacts";
import { ABILITIES, getAbility, rollAbility } from "../src/data/abilities";
import { loadProfile, saveProfile, unlockAbility, lockAbility, isAbilityUnlocked } from "../src/engine/profile";
import { Game } from "../src/engine/game";
import { BALANCE } from "../src/data/balanceConfig";
import { makeCtx, spawnInto } from "./helpers";
import type { LogEntry } from "../src/types";

describe("Abilities: stat boosts", () => {
  test("statBoost through an equipped Ability applies via the same hook Artifacts use (attack/defense/maxHp/maxMp)", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    const baseAttack = c.attack;
    c.equippedAbilityId = "battle-instinct"; // statBoost attack +4
    recomputeCharacterStats(c, 100);
    expect(c.attack).toBe(baseAttack + 4);
  });

  test("Ability-only statBoost stats (aggro/speed/magicPower) apply via the widened hook", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    const baseSpeed = c.speed;
    const baseAggro = c.aggro;
    const baseMagicPower = c.magicPower;

    c.equippedAbilityId = "eye-of-the-storm"; // autoDamage 12 + statBoost aggro +15
    recomputeCharacterStats(c, 100);
    expect(c.aggro).toBe(baseAggro + 15);

    c.equippedAbilityId = "restless-vigor"; // statBoost speed +3
    recomputeCharacterStats(c, 100);
    expect(c.speed).toBe(baseSpeed + 3);

    c.equippedAbilityId = "arcane-aptitude"; // statBoost magicPower +4
    recomputeCharacterStats(c, 100);
    expect(c.magicPower).toBe(baseMagicPower + 4);
  });

  test("no Ability equipped contributes nothing", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedAbilityId = null;
    expect(abilityWidenedStatBoost(c, "aggro")).toBe(0);
    expect(abilityWidenedStatBoost(c, "speed")).toBe(0);
    expect(abilityWidenedStatBoost(c, "magicPower")).toBe(0);
    expect(alwaysHitChance(c)).toBe(0);
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
    saveProfile({ version: 1, unlockedAbilityIds: [] });
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
    const profile = { version: 1, unlockedAbilityIds: ["bloodletting"] };
    unlockAbility(profile, "bloodletting");
    expect(profile.unlockedAbilityIds).toEqual(["bloodletting"]);
  });

  test("lockAbility is a no-op for an id not present", () => {
    const profile = { version: 1, unlockedAbilityIds: [] };
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
    saveProfile({ version: 1, unlockedAbilityIds: [] });
    const game = new Game(1, PARTY, undefined, ["battle-instinct", null, null, null]);
    wipeParty(game);
    expect(game.state.gameOver).toBe("defeat");
    expect(game.state.pendingAbilityBuyback).toBeNull();
    expect(game.state.abilityDeathResults).toEqual([]);
  });

  test("a non-common equipped ability is struck from the profile immediately, then reclaimable with enough Stardust", () => {
    saveProfile({ version: 1, unlockedAbilityIds: ["bloodletting"] });
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
    saveProfile({ version: 1, unlockedAbilityIds: ["bloodletting"] });
    const game = new Game(3, PARTY, undefined, ["bloodletting", null, null, null]);
    wipeParty(game);

    const err = game.resolveAbilityBuyback("skip");
    expect(err).toBeNull();
    expect(loadProfile().unlockedAbilityIds).not.toContain("bloodletting");
    expect(game.state.abilityDeathResults).toEqual([{ characterId: "p1", lostAbilityId: "bloodletting", outcome: "lost" }]);
    expect(game.state.pendingAbilityBuyback).toBeNull();
  });

  test("reclaim fails outright with insufficient Stardust, and nothing is consumed", () => {
    saveProfile({ version: 1, unlockedAbilityIds: ["bloodletting"] });
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
    saveProfile({ version: 1, unlockedAbilityIds: ["bloodletting", "predators-edge"] });
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
