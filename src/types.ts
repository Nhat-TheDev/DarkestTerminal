export type Id = string;

export interface SurvivalStats {
  fear: number;
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
  /** "satiety" is party-wide (GameState.satiety), so resolveSkillEffect needs a GameState reference to apply it. */
  stat?: keyof SurvivalStats | "satiety";
  combatStat?: CombatStat;
  statusEffectId?: Id;
  miniGameId?: MiniGameId;
  chance?: number;
  ignoreDefensePercent?: number;
  lifestealPercent?: number;
}

export type SkillTarget =
  | "self"
  | "singleAlly"
  | "allAllies"
  | "singleEnemy"
  | "allEnemies"
  | "singleAllyOrEnemy"
  | "allAlliesAndEnemies";

export interface SkillRankDefinition {
  rank: 1 | 2 | 3;
  unlockLevel: number;
  mpCost: number;
  effects?: SkillEffect[];
  effectsByRelation?: { ally: SkillEffect[]; enemy: SkillEffect[] };
}

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
  isMagic?: boolean;
  ranks?: SkillRankDefinition[];
  conditionalBonus?: { requiresStatusId: Id; ignoreDefensePercentBonus: number; consumesStatus?: boolean };
}

export interface GrowthWeights {
  attack: number;
  defense: number;
  maxHp: number;
  maxMp: number;
  magicPower: number;
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
  baseMagicPower: number;
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
  magicPower: number;
  aggro: number;
  speed: number;
  survival: SurvivalStats;
  unlockedSkillIds: Id[];
  activeStatusEffects: ActiveStatusEffect[];
  isAlive: boolean;
  usesRemainingThisCombat: Record<Id, number>;
  cooldownsRemaining: Record<Id, number>;
  equippedArtifactIds: Id[];
}

export interface StatusEffectDefinition {
  id: Id;
  name: string;
  description: string;
  perTurnEffects: SkillEffect[];
  curableByMiniGame: { miniGameId: MiniGameId; clearScore: number }[];
  durationTurns?: number;
  onHitStatusEffectId?: Id;
  onHitAoeDamage?: { amount: number; isMagic?: boolean; ignoreDefensePercent?: number };
  accuracyPenaltyPercent?: number;
  stuns?: boolean;
  vulnerableTo?: { statusEffectId: Id; multiplier: number };
  /** If set, this status is a higher-rank variant of `rankOf` (e.g. "storm-empowered-ii" of "storm-empowered") — used to match ranks and compose the displayed name. */
  rankOf?: Id;
  rankLevel?: 2 | 3;
}

export interface ItemDefinition {
  id: Id;
  name: string;
  description: string;
  target: SkillTarget;
  effects: SkillEffect[];
  archetypeIds?: Id[];
  weight?: number;
  combatUsable?: boolean;
}

export type ArtifactRarity = "common" | "rare" | "unique" | "epic";

export type ArtifactEffect =
  | { kind: "statBoost"; stat: "attack" | "defense" | "maxHp" | "maxMp"; amount: number }
  | { kind: "reflectDamage"; percent: number }
  | { kind: "poisonOnHit"; chance: number }
  | { kind: "lifesteal"; percent: number }
  | { kind: "dodgeChance"; chance: number }
  | { kind: "healOnKill"; amount: number }
  | { kind: "autoDamage"; amount: number }
  | { kind: "expBoost"; percent: number }
  | { kind: "fearResist"; percent: number }
  | { kind: "cooldownReduction"; turns: number }
  | { kind: "curseAggroBoost"; amount: number };

export interface ArtifactDefinition {
  id: Id;
  name: string;
  description: string;
  rarity: ArtifactRarity;
  effects: ArtifactEffect[];
  isCursed?: boolean;
}

export type EventTier = "common" | "rare";

export type EventKind =
  | "instantReward"
  | "combatReward"
  | "merchant"
  | "hpGamble"
  | "choiceReveal"
  | "artifactExchange"
  | "rescueGamble"
  | "coinGamble";

export interface EventDefinition {
  id: Id;
  name: string;
  description: string;
  kind: EventKind;
  tier: EventTier;
  forceEquip?: boolean;
}

export interface ActiveStatusEffect {
  statusEffectId: Id;
  turnsRemaining: number;
  /** Debuffs only: true for the round applied/refreshed, so that round's tick skips the countdown. */
  justApplied?: boolean;
}

export type RoomType = "combat" | "rest" | "boss" | "treasure" | "empty" | "event";

export interface Room {
  id: Id;
  name: string;
  type: RoomType;
  connectedRoomIds: Id[];
  monsterIds: Id[];
  cleared: boolean;
  rolledEventId?: Id;
}

export interface Floor {
  depth: number;
  rooms: Room[];
  entryRoomId: Id;
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
  expReward: number;
  eliteSkillIds?: { strike: Id; cleave: Id };
  bossSkillIds?: { execute: Id; debuff: Id };
  guardOnly?: boolean;
  powerTier?: "weak" | "medium" | "strong";
  actionWeights?: {
    normal?: Partial<Record<"basicAttack" | "skill", number>>;
    elite?: Partial<Record<"basicAttack" | "skill" | "strike" | "cleave", number>>;
    boss?: Partial<Record<"basicAttack" | "strike" | "cleave" | "debuff", number>>;
  };
}

export type MonsterTier = "normal" | "elite" | "boss";

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
  tier: MonsterTier;
  aiPattern: MonsterAiPattern;
  activeStatusEffects: ActiveStatusEffect[];
  expReward: number;
  executeCooldownTurns?: number;
  isChargingExecute?: boolean;
  executeTargetId?: Id;
}

export type CombatantRef = { kind: "character"; id: Id } | { kind: "monster"; id: Id };

export interface Combatant {
  ref: CombatantRef;
  speed: number;
}

export type ActionSource = { kind: "skill"; skillId: Id } | { kind: "item"; itemId: Id };

export interface QueuedAction {
  actor: CombatantRef;
  source: ActionSource;
  targets: CombatantRef[];
}

export type LogEntryKind = "attack" | "heal" | "buff" | "debuff" | "item" | "death" | "info";

export interface CombatantSnapshot {
  id: Id;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  level?: number;
  mp?: number;
  maxMp?: number;
}

export interface LogEntry {
  text: string;
  kind: LogEntryKind;
  snapshot?: CombatantSnapshot[];
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
  log: LogEntry[];
  roundStartSnapshot?: CombatantSnapshot[];
  outcome?: "victory" | "defeat";
}

export interface GameState {
  runId: string;
  party: Character[];
  floor: Floor;
  currentRoomId: Id;
  combat: CombatState | null;
  message: string;
  gameOver: "victory" | "defeat" | null;
  partyExp: number;
  inventory: Record<Id, number>;
  coins: number;
  satiety: number;
  pendingArtifactDecision?: { artifactId: Id; forceEquip: boolean; source: "elite" | "boss" | "treasureOrEvent" | "event" } | null;
  /** Gambling Den's round-4 jackpot grants 2 Epic artifacts; the 2nd waits here until the 1st is resolved. */
  secondJackpotArtifactId?: Id | null;
  activeEvent?: { eventId: Id; offerArtifactIds: Id[]; gambleState?: { round: number; pot: number; maxRounds: number }; refreshCount?: number } | null;
  lastRoomDrops: { itemIds: Id[]; artifactIds: Id[] } | null;
}
