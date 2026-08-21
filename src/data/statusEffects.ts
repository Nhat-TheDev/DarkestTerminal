import type { StatusEffectDefinition } from "../types";
import statusEffectsJson from "../../data/status-effects.json";

export const STATUS_EFFECTS = statusEffectsJson as unknown as StatusEffectDefinition[];

export function getStatusEffect(id: string): StatusEffectDefinition {
  const def = STATUS_EFFECTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown status effect: ${id}`);
  return def;
}
