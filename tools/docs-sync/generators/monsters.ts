import { describeEffects } from "../effects";
import { formatNumber } from "../format";
import type { GeneratorSpec } from "../types";

/** How each monster type scales an archetype's attack, defense and max HP. */
export const monsterTypeWeights: GeneratorSpec = {
  source: "`data/growth-weights.json` (`monsterGrowthWeights`)",
  args: [],
  generate: ({ growthWeights }) => ({
    columns: ["Type", "attack", "defense", "maxHp"],
    rows: Object.entries(growthWeights.monsterGrowthWeights).map(([type, weights]) => [
      `\`${type}\``,
      formatNumber(weights.attack),
      formatNumber(weights.defense),
      formatNumber(weights.maxHp),
    ]),
  }),
};

/** Every monster skill, its effects, and the archetypes that carry it with their AI pattern. */
export const monsterSkills: GeneratorSpec = {
  source: "`data/monster-skills.json` and `data/monsters.json`",
  args: [],
  generate: ({ monsters }) => ({
    columns: ["Skill id", "Name", "Target", "Effects", "Used by"],
    rows: monsters.skills.map((skill) => {
      const users = monsters.archetypes.filter((archetype) => archetype.skillIds.includes(skill.id)).map((archetype) => `${archetype.name} (${archetype.aiPattern})`);
      return [
        `\`${skill.id}\``,
        skill.name,
        skill.target,
        describeEffects([skill.effects ?? []], skill.isMagic ? "MAG" : "ATK").join("; ") || "—",
        users.length === 0 ? "—" : users.join(", "),
      ];
    }),
  }),
};
