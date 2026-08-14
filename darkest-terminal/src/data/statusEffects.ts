import type { StatusEffectDefinition } from "../types";

// Matches docs/gameplay-decisions.md §1. curableByMiniGame is always empty in
// this prototype (mini-games are out of scope) — every status effect here
// simply expires via durationTurns.
export const STATUS_EFFECTS: StatusEffectDefinition[] = [
  {
    id: "phong-thu",
    name: "Phòng Thủ",
    description: "Trấn Thủ (Cận Vệ): +6 phòng thủ mỗi lượt.",
    perTurnEffects: [{ kind: "modifyCombatStat", combatStat: "defense", amount: 6 }],
    curableByMiniGame: [],
    durationTurns: 2,
  },
  {
    id: "khieu-khich",
    name: "Khiêu Khích",
    description: "Khiêu Khích (Cận Vệ): +40 thu hút mỗi lượt.",
    perTurnEffects: [{ kind: "modifyCombatStat", combatStat: "aggro", amount: 40 }],
    curableByMiniGame: [],
    durationTurns: 2,
  },
  {
    id: "nguyen-rua",
    name: "Nguyền Rủa",
    description: "Nguyền Rủa (Pháp Sư Bóng Tối): -4 tấn công mỗi lượt.",
    perTurnEffects: [{ kind: "modifyCombatStat", combatStat: "attack", amount: -4 }],
    curableByMiniGame: [],
    durationTurns: 3,
  },
  {
    id: "ne-tranh",
    name: "Né Tránh",
    description: "Lẩn Tránh (Sát Thủ): +6 phòng thủ mỗi lượt.",
    perTurnEffects: [{ kind: "modifyCombatStat", combatStat: "defense", amount: 6 }],
    curableByMiniGame: [],
    durationTurns: 1,
  },
  {
    id: "trung-doc",
    name: "Trúng Độc",
    description: "Tẩm Độc (Sát Thủ): mất 4 HP mỗi lượt.",
    perTurnEffects: [{ kind: "damage", amount: 4 }],
    curableByMiniGame: [{ miniGameId: "snake", clearScore: 8 }],
    durationTurns: 3,
  },
];

export function getStatusEffect(id: string): StatusEffectDefinition {
  const def = STATUS_EFFECTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown status effect: ${id}`);
  return def;
}
