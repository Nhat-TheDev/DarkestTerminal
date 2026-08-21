export type Id = string;

export interface Vector2 {
  x: number;
  y: number;
}

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
  chance?: number;
}

export type SkillTarget =
  | "self"
  | "singleAlly"
  | "allAllies"
  | "singleEnemy"
  | "allEnemies"
  | "singleAllyOrEnemy"
  | "allAlliesAndEnemies";

export interface SkillDefinition {
  id: Id;
  name: string;
  description: string;
  mpCost: number;
  target: SkillTarget;
  effects?: SkillEffect[];
  effectsByRelation?: { ally: SkillEffect[]; enemy: SkillEffect[] };
  slot: 0 | 1 | 2 | 3 | 4 | 5;
  unlockLevel: number;
  usesPerCombat?: number;
  cooldownTurns?: number;
  isUltimate?: boolean;
  isBuff?: boolean;
}

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

export interface ActiveStatusEffect {
  statusEffectId: Id;
  turnsRemaining: number;
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
}

export type ItemCategory = "consumable" | "equipment" | "keyItem";

export interface ItemDefinition {
  id: Id;
  name: string;
  description: string;
  category: ItemCategory;
  effects: SkillEffect[];
  stackable: boolean;
}

export interface StatusEffectDefinition {
  id: Id;
  name: string;
  description: string;
  perTurnEffects: SkillEffect[];
  curableByMiniGame: {
    miniGameId: MiniGameId;
    clearScore: number;
  }[];
  durationTurns?: number;
  onHitStatusEffectId?: Id;
  stuns?: boolean;
}

export type RoomType = "combat" | "rest" | "boss" | "treasure" | "empty";

export interface Room {
  id: Id;
  type: RoomType;
  connectedRoomIds: Id[];
  monsterIds: Id[];
  cleared: boolean;
  position: Vector2;
}

export interface Floor {
  depth: number;
  rooms: Room[];
  entryRoomId: Id;
  darknessLevel: number;
}

export type KeyEventType = "press" | "release";

export interface KeyEvent {
  type: KeyEventType;
  key: string;
  timestamp: number;
}

export interface MiniGameResult {
  won: boolean;
  score: number;
  targetScore: number;
  maxCombo: number;
  fearDelta: number;
}

export interface MiniGameSession {
  readonly id: MiniGameId;
  start(): void;
  tick(nowMs: number): void;
  handleInput(event: KeyEvent): void;
  isComplete(): boolean;
  getResult(): MiniGameResult;
}

export type MonsterAiPattern = "aggressive" | "defensive" | "erratic";

export interface Monster {
  id: Id;
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

export type CombatantRef =
  | { kind: "character"; id: Id }
  | { kind: "monster"; id: Id };

export interface Combatant {
  ref: CombatantRef;
  speed: number;
}

export type ActionSource =
  | { kind: "skill"; skillId: Id }
  | { kind: "item"; itemId: Id };

export interface QueuedAction {
  actor: CombatantRef;
  source: ActionSource;
  targets: CombatantRef[];
}

export interface CombatState {
  roomId: Id;
  combatants: Combatant[];
  roundNumber: number;
  phase: "command" | "resolution";
  queuedActions: QueuedAction[];
  turnQueue: CombatantRef[];
  activeTurnIndex: number;
  isBossFight: boolean;
}

export type GameMode =
  | { kind: "dungeon" }
  | { kind: "combat"; combat: CombatState }
  | {
      kind: "miniGame";
      session: MiniGameSession;
      reason: "debuffCure" | "bossPhase" | "eventTrigger";
    };

export interface GameState {
  party: Character[];
  currentFloor: Floor;
  currentRoomId: Id;
  mode: GameMode;
  classes: CharacterClass[];
  skills: SkillDefinition[];
  items: ItemDefinition[];
  statusEffects: StatusEffectDefinition[];
  monsters: Monster[];
}
