import type { StatusEffectDefinition } from "../types";
import statusEffectsJson from "../../data/status-effects.json";

export const STATUS_EFFECTS = statusEffectsJson as unknown as StatusEffectDefinition[];

export function getStatusEffect(id: string): StatusEffectDefinition {
  const def = STATUS_EFFECTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown status effect: ${id}`);
  return def;
}

const RANK_NUMERAL: Record<2 | 3, string> = { 2: "II", 3: "III" };

/** Composes the player-facing name for a status, appending a rank numeral (e.g. "Storm-Empowered II") for ranked variants instead of baking it into `name`. */
export function statusDisplayName(def: StatusEffectDefinition): string {
  return def.rankLevel ? `${def.name} ${RANK_NUMERAL[def.rankLevel]}` : def.name;
}

/** Whether `activeId` satisfies a `conditionalBonus.requiresStatusId` of `requiredId` — either the exact status, or one of its ranked variants (`rankOf === requiredId`). */
export function statusSatisfiesRequirement(activeId: string, requiredId: string): boolean {
  if (activeId === requiredId) return true;
  return getStatusEffect(activeId).rankOf === requiredId;
}
