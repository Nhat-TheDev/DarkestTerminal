// Runtime types for the darkest-terminal prototype.
//
// Mirrors ../../dungeon-crawler-data-model.ts and the decisions in
// ../../docs/gameplay-decisions.md + ../../docs/technical-decisions.md.
// Scope cuts for this prototype (see README.md): no mini-games, no items.
// Floor structure IS randomized (1 pattern picked from data/floor-
// patterns.json each run, see src/data/floor.ts) — the prototype only cuts
// multi-floor progression, so the party stays level 1 all game
// (single floor => Character.level = min(depth, 100) === 1).

export type Id = string;

export interface SurvivalStats {
  fear: number;
  hunger: number;
  thirst: number;
}

export type MiniGameId = "snake" | "tetris" | "brickBreaker" | "magicTiles";

export type SkillEffectKind =
  | "damage"
  | "heal"
  | "restoreMp"
  | "applyStatusEffect"
  | "removeStatusEffect"
  | "modifyStat"
  | "modifyCombatStat"
  | "triggerMiniGame";

export type CombatStat = "attack" | "defense" | "aggro" | "speed";

export interface SkillEffect {
  kind: SkillEffectKind;
  amount?: number;
  stat?: keyof SurvivalStats;
  combatStat?: CombatStat;
  statusEffectId?: Id;
  miniGameId?: MiniGameId;
}

export type SkillTarget = "self" | "singleAlly" | "allAllies" | "singleEnemy" | "allEnemies";

export interface SkillDefinition {
  id: Id;
  name: string;
  description: string;
  mpCost: number;
  target: SkillTarget;
  effects: SkillEffect[];
  slot: 0 | 1 | 2 | 3 | 4;
  unlockLevel: number;
  usesPerCombat?: number;
}

/** Multiplier applied to the shared growthBonus() curve per stat, per class — see docs/gameplay-decisions.md §6.8. Budget convention: the 4 weights sum to 4.0 across classes, so no class gets strictly more total growth, only redistributed differently. */
export interface GrowthWeights {
  attack: number;
  defense: number;
  maxHp: number;
  maxMp: number;
}

export interface CharacterClass {
  id: Id;
  name: string;
  description: string;
  baseMaxHp: number;
  baseMaxMp: number;
  baseAttack: number;
  baseDefense: number;
  baseAggro: number;
  baseSpeed: number;
  growthWeights: GrowthWeights;
  skills: SkillDefinition[];
}

export interface Character {
  id: Id;
  name: string;
  classId: Id;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  aggro: number;
  speed: number;
  survival: SurvivalStats;
  unlockedSkillIds: Id[];
  activeStatusEffects: ActiveStatusEffect[];
  isAlive: boolean;
  /** Tracks remaining usesPerCombat per skill for the current combat only. */
  usesRemainingThisCombat: Record<Id, number>;
}

export interface StatusEffectDefinition {
  id: Id;
  name: string;
  description: string;
  perTurnEffects: SkillEffect[];
  curableByMiniGame: { miniGameId: MiniGameId; clearScore: number }[];
  durationTurns?: number;
}

/** Active instance of a status effect on a combatant, tracking remaining duration. */
export interface ActiveStatusEffect {
  statusEffectId: Id;
  turnsRemaining: number;
}

export type RoomType = "combat" | "rest" | "boss" | "treasure" | "empty";

export interface Room {
  id: Id;
  name: string;
  type: RoomType;
  connectedRoomIds: Id[];
  monsterIds: Id[];
  cleared: boolean;
}

export interface Floor {
  depth: number;
  rooms: Room[];
  entryRoomId: Id;
  darknessLevel: number;
}

export type MonsterAiPattern = "aggressive" | "defensive" | "erratic";

export interface MonsterArchetype {
  id: Id;
  name: string;
  baseHp: number;
  baseAttack: number;
  baseDefense: number;
  baseSpeed: number;
  aiPattern: MonsterAiPattern;
  skillIds: Id[];
}

export interface Monster {
  id: Id;
  archetypeId: Id;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  skillIds: Id[];
  isBoss: boolean;
  aiPattern: MonsterAiPattern;
  activeStatusEffects: ActiveStatusEffect[];
}

export type CombatantRef = { kind: "character"; id: Id } | { kind: "monster"; id: Id };

export interface Combatant {
  ref: CombatantRef;
  speed: number;
}

export type ActionSource = { kind: "skill"; skillId: Id };

export interface QueuedAction {
  actor: CombatantRef;
  source: ActionSource;
  targets: CombatantRef[];
}

export interface CombatState {
  roomId: Id;
  combatants: Combatant[];
  roundNumber: number;
  phase: "command" | "resolution" | "over";
  queuedActions: QueuedAction[];
  turnQueue: CombatantRef[];
  activeTurnIndex: number;
  isBossFight: boolean;
  log: string[];
  outcome?: "victory" | "defeat";
}

export interface GameState {
  party: Character[];
  floor: Floor;
  currentRoomId: Id;
  combat: CombatState | null;
  message: string;
  gameOver: "victory" | "defeat" | null;
}
