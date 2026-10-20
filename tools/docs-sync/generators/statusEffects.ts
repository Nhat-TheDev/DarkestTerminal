import type { SkillEffect } from "../../../src/types";
import { formatNumber, showValue } from "../format";
import { list } from "./args";
import type { GeneratorSpec } from "../types";

const signed = (value: number) => (value > 0 ? `+${formatNumber(value)}` : formatNumber(value));

function perTurn(effect: SkillEffect): string {
  const percent = effect.maxHpPercent === undefined ? "" : `${formatNumber(effect.maxHpPercent)}% max HP`;
  const scaling = effect.offenseMultiplierPercent === undefined ? "" : ` + ${formatNumber(effect.offenseMultiplierPercent)}% caster MAG`;
  const amount = effect.amount === undefined ? "" : `${formatNumber(effect.amount)}${scaling}`;
  switch (effect.kind) {
    case "damage":
    case "heal":
      return `${effect.kind} ${[amount, percent].filter(Boolean).join(" or ")} per turn`;
    case "modifyCombatStat": {
      const floor = effect.minPercent === undefined ? "" : ` (min ${formatNumber(effect.minPercent)}%)`;
      return `${effect.combatStat} ${signed(effect.amount ?? 0)}${floor}`;
    }
    default:
      return effect.kind;
  }
}

const SKIPPED = new Set(["id", "name", "description", "perTurnEffects"]);

function field(key: string, value: unknown): string {
  return value === true ? key : `${key} ${showValue(value)}`;
}

export const statusEffects: GeneratorSpec = {
  source: "`data/status-effects.json`",
  args: ["ids"],
  generate: ({ statusEffects: all }, args) => ({
    columns: ["id", "Name", "Mechanics"],
    rows: list(args, "ids").map((id) => {
      const status = all.find((candidate) => candidate.id === id);
      if (!status) throw new Error(`no status effect "${id}" in data/status-effects.json`);
      const extras = Object.entries(status).filter(([key]) => !SKIPPED.has(key)).map(([key, value]) => field(key, value));
      const parts = [...status.perTurnEffects.map(perTurn), ...extras];
      return [`\`${id}\``, status.name, parts.length === 0 ? "—" : parts.join("; ")];
    }),
  }),
};
