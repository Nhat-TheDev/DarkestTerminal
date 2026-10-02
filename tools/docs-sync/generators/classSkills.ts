import type { SkillDefinition } from "../../../src/types";
import { describeEffects, joinRanks } from "../effects";
import { formatNumber } from "../format";
import type { GeneratorSpec } from "../types";

/** What a skill adds on top of its per-rank effects: a bonus that needs a status, and an execute bonus. */
function modifiers(skill: SkillDefinition): string[] {
  const out: string[] = [];
  const conditional = skill.conditionalBonus;
  if (conditional) {
    const consumes = conditional.consumesStatus ? ", consumes it" : "";
    out.push(`with status ${conditional.requiresStatusId}: ignores ${formatNumber(conditional.ignoreDefensePercentBonus)}% defense${consumes}`);
  }
  const execute = skill.executeBonus;
  if (execute) {
    const bonus: string[] = [];
    if (execute.bonusDamageFlat !== undefined) bonus.push(`+${formatNumber(execute.bonusDamageFlat)} damage`);
    if (execute.bonusDamagePercent !== undefined) bonus.push(`+${formatNumber(execute.bonusDamagePercent)}% damage`);
    out.push(`below ${formatNumber(execute.hpPercentThreshold)}% HP: ${bonus.join(", ")}`);
  }
  return out;
}

function flags(skill: SkillDefinition): string {
  const set = [skill.isBuff ? "buff" : "", skill.isUltimate ? "ultimate" : "", skill.isMagic ? "magic" : ""].filter(Boolean);
  return set.length === 0 ? "—" : set.join(" · ");
}

/** A class's ranked skills (slot 1 and up): cost, unlock level and effects at each rank. */
export const classSkills: GeneratorSpec = {
  source: "`data/classes.json`",
  args: ["class"],
  generate: ({ classes }, args) => {
    const id = args.class;
    if (!id) throw new Error('"class" is required');
    const found = classes.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`no class "${id}" in data/classes.json`);
    const skills = found.skills.filter((skill) => skill.ranks !== undefined).sort((a, b) => a.slot - b.slot);
    const legend = Array.from({ length: Math.max(0, ...skills.map((skill) => skill.ranks!.length)) }, (_, index) => `R${index + 1}`).join("/");
    return {
      columns: ["Slot", "Skill id", "Name", "Target", "Cooldown", `MP cost (${legend})`, `Unlock level (${legend})`, `Effects (${legend})`, "Flags"],
      rows: skills.map((skill) => {
        const ranks = skill.ranks!;
        const effects = [...describeEffects(ranks.map((rank) => rank.effects ?? []), skill.isMagic ? "MAG" : "ATK"), ...modifiers(skill)];
        return [
          skill.slot,
          `\`${skill.id}\``,
          skill.name,
          skill.target,
          skill.cooldownTurns === undefined ? "—" : formatNumber(skill.cooldownTurns),
          joinRanks(ranks.map((rank) => formatNumber(rank.mpCost))),
          joinRanks(ranks.map((rank) => formatNumber(rank.unlockLevel))),
          effects.length === 0 ? "—" : effects.join("; "),
          flags(skill),
        ];
      }),
    };
  },
};
