import { describe, test, expect } from "bun:test";
import { formatPassiveEffect, renderMain } from "../src/ui/screens/characterInfo";
import { CLASSES } from "../src/data/classes";
import { formatStatusEffectMechanics, getStatusEffect } from "../src/data/statusEffects";
import { Game } from "../src/engine/game";
import type { UiState } from "../src/ui/state";
import type { Character, LogEntry, SkillEffect } from "../src/types";
import { ARTIFACTS } from "../src/data/artifacts";
import { ABILITIES } from "../src/data/abilities";
import { createCharacter, recomputeCharacterStats, characterStatBreakdown } from "../src/engine/party";
import { resolveSkillEffect, expireStatusEffect } from "../src/engine/resolver";

describe("formatPassiveEffect", () => {
  test("every class's rank-3 passive has a formatter line", () => {
    for (const cls of CLASSES) {
      const rank3 = cls.passiveSkill.ranks.find((r) => r.rank === 3)!;
      expect(formatPassiveEffect(cls.passiveSkill, rank3)).not.toBe("");
    }
  });

  test("mechanic text reflects the rank's actual fields, not placeholders", () => {
    const knight = CLASSES.find((c) => c.id === "knight")!;
    const rank3 = knight.passiveSkill.ranks.find((r) => r.rank === 3)!;
    const text = formatPassiveEffect(knight.passiveSkill, rank3);
    expect(text).toContain(`+${rank3.maxHpPercent}%`);
    expect(text).toContain(`+${rank3.defensePercent}%`);
    expect(text).toContain(`+${rank3.aggroFlat} aggro`);
  });

  test("Viking and Ninja text reflects the passive's own top-level fields, not a hand-typed number", () => {
    const viking = CLASSES.find((c) => c.id === "viking")!;
    const vikingRank1 = viking.passiveSkill.ranks.find((r) => r.rank === 1)!;
    expect(formatPassiveEffect(viking.passiveSkill, vikingRank1)).toContain(`costs ${viking.passiveSkill.selfDamagePerHitMaxHPPercent}%`);
    expect(formatPassiveEffect(viking.passiveSkill, vikingRank1)).toContain(formatStatusEffectMechanics(getStatusEffect(vikingRank1.thresholdStatusEffectId!)));

    const ninja = CLASSES.find((c) => c.id === "ninja")!;
    const ninjaRank1 = ninja.passiveSkill.ranks.find((r) => r.rank === 1)!;
    expect(formatPassiveEffect(ninja.passiveSkill, ninjaRank1)).toContain(`max ${ninja.passiveSkill.maxClones}`);
  });

  test("only fires the template for fields the rank actually has, not every class's template", () => {
    const rogue = CLASSES.find((c) => c.id === "rogue")!;
    const rank1 = rogue.passiveSkill.ranks.find((r) => r.rank === 1)!;
    const text = formatPassiveEffect(rogue.passiveSkill, rank1);
    expect(text).toContain("poisoned target");
    expect(text).not.toContain("max HP");
    expect(text).not.toContain("dodge chance");
  });
});

describe("renderMain: active statuses", () => {
  test("a status shows the stat delta it applied, not the status's own value", () => {
    const game = new Game(7);
    game.state.party[0]!.activeStatusEffects.push({ statusEffectId: "totems-strength", turnsRemaining: 2, appliedAmounts: { attack: 8 } });
    const out = renderMain(game, { kind: "characterInfo", characterIndex: 0, previousUi: { kind: "room" } as UiState });
    const text = typeof out === "string" ? out : out.chunks.map((c) => c.text).join("\n");
    expect(text).toContain("+8 attack");
  });
});

describe("stat breakdown always adds up to the character's real stat", () => {
  const STATS = ["maxHp", "maxMp", "attack", "defense", "magicPower", "speed", "aggro"] as const;
  const STAT_ARTIFACTS = ARTIFACTS.filter((a) => a.effects.some((e) => e.kind === "statBoost" || e.kind === "curseAggroBoost")).map((a) => a.id);
  const STAT_ABILITY = ABILITIES.find((a) => a.effects.some((e) => e.kind === "statBoost" && e.minPercent !== undefined))!.id;
  const log: LogEntry[] = [];
  const applyStatus = (c: Character, statusEffectId: string, override: Partial<SkillEffect> = {}) =>
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId, durationTurns: 3, ...override }, c, c, { log });

  function expectSums(c: Character, satiety: number, label: string) {
    const stats = characterStatBreakdown(c, satiety);
    for (const stat of STATS) {
      const s = stats[stat];
      expect(s.base + s.artifact + s.ability + s.passive + s.status, `${label} ${stat} parts`).toBe(s.total);
      expect(s.total, `${label} ${stat} total`).toBe(c[stat]);
    }
  }

  for (const cls of CLASSES) {
    for (const level of [1, 5, 20, 35, 50, 100]) {
      for (const satiety of [100, 10]) {
        test(`${cls.id} level ${level} satiety ${satiety}`, () => {
          const c = createCharacter("p1", cls.name, cls, level);
          c.equippedArtifactIds.push(...STAT_ARTIFACTS.slice(0, 3));
          c.equippedAbilityId = STAT_ABILITY;
          recomputeCharacterStats(c, satiety);
          expectSums(c, satiety, "equipped");

          applyStatus(c, "rallied-iii");
          applyStatus(c, "weakened");
          applyStatus(c, "totems-strength", { amount: 14, minPercent: 15 });
          applyStatus(c, "spirit-bound");
          applyStatus(c, "hellfire-kindled");
          applyStatus(c, "skittish");
          applyStatus(c, "stone-skin");
          expectSums(c, satiety, "buffed");

          recomputeCharacterStats(c, satiety);
          expectSums(c, satiety, "recomputed");

          for (const active of [...c.activeStatusEffects]) expireStatusEffect(c, active, { log });
          expectSums(c, satiety, "expired");
          recomputeCharacterStats(c, satiety);
          expectSums(c, satiety, "expired+recomputed");
        });
      }
    }
  }

  test("the screen shows the Knight passive as its own bracket", () => {
    const game = new Game(7);
    const knight = game.state.party.find((p) => p.classId === "knight") ?? game.state.party[0]!;
    knight.classId = "knight";
    knight.level = 35;
    recomputeCharacterStats(knight, game.state.satiety);
    const passive = characterStatBreakdown(knight, game.state.satiety).defense.passive;
    expect(passive).toBeGreaterThan(0);
    const out = renderMain(game, { kind: "characterInfo", characterIndex: game.state.party.indexOf(knight), previousUi: { kind: "room" } as UiState });
    const chunks = typeof out === "string" ? [] : out.chunks;
    expect(chunks.some((ch) => ch.text === `(+${passive})`)).toBe(true);
  });
});
