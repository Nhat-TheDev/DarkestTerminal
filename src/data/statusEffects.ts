import type { StatusEffectDefinition } from "../types";
import statusEffectsJson from "../../data/status-effects.json";

// Design data now lives in ../../data/status-effects.json — see
// docs/gameplay-decisions.md §1. curableByMiniGame is always empty in this
// prototype (mini-games are out of scope): every status effect here simply
// expires via durationTurns.
export const STATUS_EFFECTS = statusEffectsJson as unknown as StatusEffectDefinition[];

export function getStatusEffect(id: string): StatusEffectDefinition {
  const def = STATUS_EFFECTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown status effect: ${id}`);
  return def;
}
