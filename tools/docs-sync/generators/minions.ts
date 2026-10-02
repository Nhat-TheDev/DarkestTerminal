import type { SummonCast, SummonStatFormula } from "../../../src/types";
import { describeEffects, joinRanks } from "../effects";
import { formatNumber } from "../format";
import type { GeneratorSpec } from "../types";

const tuple = (value: number | readonly number[]): readonly number[] => (typeof value === "number" ? [value] : value);

/** `30% owner maxHp + 25`, or just the flat part when nothing scales off the owner. */
function formula({ base, percent, sourceStat }: SummonStatFormula): string {
  const percents = tuple(percent);
  if (percents.every((value) => value === 0)) return formatNumber(base);
  const scaled = `${joinRanks(percents.map(formatNumber))}% owner ${sourceStat}`;
  return base === 0 ? scaled : `${scaled} + ${formatNumber(base)}`;
}

/** Each minion cast: who it summons, how long it lasts, and how its stats follow the owner's. */
export const minions: GeneratorSpec = {
  source: "`data/summons.json`",
  args: [],
  generate: ({ summons }) => ({
    columns: ["Cast", "Minion", "Speed", "Actions", "Aggro", "Max HP", "Defense", "Attack", "Magic power", "Action weights"],
    rows: summons.casts.map((cast) => {
      const archetype = summons.archetypes.find((candidate) => candidate.id === cast.archetypeId);
      if (!archetype) throw new Error(`cast ${cast.id} names no archetype ${cast.archetypeId}`);
      const weights = Object.entries(archetype.actionWeights ?? {}).map(([action, weight]) => `${action} ${formatNumber(weight)}`);
      return [
        `\`${cast.id}\``,
        archetype.name,
        formatNumber(archetype.speed),
        formatNumber(cast.maxActions),
        formatNumber(cast.aggro),
        formula(cast.stat.maxHp),
        formula(cast.stat.defense),
        formula(cast.stat.attack),
        formula(cast.stat.magicPower),
        weights.length === 0 ? "—" : weights.join(", "),
      ];
    }),
  }),
};

/** The skills the minions use, and the archetypes that pick them. */
export const minionSkills: GeneratorSpec = {
  source: "`data/summons.json`",
  args: [],
  generate: ({ summons }) => ({
    columns: ["Skill id", "Name", "Target", "Effects", "Used by"],
    rows: summons.skills.map((skill) => {
      const users = summons.archetypes.filter((archetype) => archetype.signatureSkillIds?.includes(skill.id)).map((archetype) => archetype.name);
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

function burst(onDeath: NonNullable<SummonCast["onDeath"]>): string {
  const damage = `damage ${joinRanks(tuple(onDeath.amount).map(formatNumber))} + ${joinRanks(tuple(onDeath.offenseMultiplierPercent).map(formatNumber))}% owner ${onDeath.sourceStat}`;
  if (!onDeath.statusEffectId) return damage;
  const chance = joinRanks(tuple(onDeath.statusEffectChance).map((rate) => formatNumber(rate * 100)));
  const turns = onDeath.durationTurns === undefined ? 1 : onDeath.durationTurns;
  return `${damage}; status ${onDeath.statusEffectId} (${turns} ${turns === 1 ? "turn" : "turns"}, ${chance}% chance)`;
}

/** What a cast's minion does when it dies, at each rank of the summoning skill. */
export const deathBursts: GeneratorSpec = {
  source: "`data/summons.json`",
  args: [],
  generate: ({ summons }) => ({
    columns: ["Cast", "On death (R1/R2/R3)"],
    rows: summons.casts.filter((cast) => cast.onDeath !== undefined).map((cast) => [`\`${cast.id}\``, burst(cast.onDeath!)]),
  }),
};
