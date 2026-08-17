// Runtime types for the darkest-terminal prototype.
//
// Mirrors ../../dungeon-crawler-data-model.ts and the decisions in
// ../../docs/gameplay-decisions.md + ../../docs/technical-decisions.md.
// Scope cuts for this prototype (see README.md): no mini-games, no items.
// Floor structure IS randomized (1 pattern picked from data/floor-
// patterns.json each run, see src/data/floor.ts). Character level and floor
// depth are 2 independent axes (docs/gameplay-decisions.md §6.9/6.10): level
// grows via EXP from kills (cap 100), floor depth grows by clearing the
// floor's guard room (elite most floors, boss every `bossFloorInterval`
// floors — §6.11), uncapped.

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
  /** Roll independently per (effect, target) before applying — omit = always applies (docs/technical-decisions.md §4.1). */
  chance?: number;
}

export type SkillTarget =
  | "self"
  | "singleAlly"
  | "allAllies"
  | "singleEnemy"
  | "allEnemies"
  /** Player picks 1 target from either side; effectsByRelation decides what happens (§4.4). */
  | "singleAllyOrEnemy"
  /** Auto-resolves to every living ally + every living enemy at once (§4.4). */
  | "allAlliesAndEnemies";

export interface SkillDefinition {
  id: Id;
  name: string;
  description: string;
  mpCost: number;
  target: SkillTarget;
  /** Used by every skill except the 2 dual-relation ones, which use effectsByRelation instead. */
  effects?: SkillEffect[];
  /** Only set for singleAllyOrEnemy/allAlliesAndEnemies skills — effect list picked per target by ally-vs-enemy relation (docs/technical-decisions.md §4.4). */
  effectsByRelation?: { ally: SkillEffect[]; enemy: SkillEffect[] };
  slot: 0 | 1 | 2 | 3 | 4 | 5;
  unlockLevel: number;
  /** Reserved for a future non-skill feature — no skill in data/classes.json sets this (docs/gameplay-decisions.md §1.5). */
  usesPerCombat?: number;
  /** Cooldown in rounds, tracked per-character via Character.cooldownsRemaining (§4.6). Replaces usesPerCombat for skills. */
  cooldownTurns?: number;
  /** Always hits (bypasses fear accuracy roll); damage/heal amounts scale by a dedicated fear-effectiveness curve instead (§4.5). */
  isUltimate?: boolean;
  /** Grants +20 speed for this round's turn-order sort only, not a persistent stat change (§4.7). */
  isBuff?: boolean;
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
  /** Tracks remaining cooldownTurns per skill; resets at startCombat, decrements each round (docs/technical-decisions.md §4.6). */
  cooldownsRemaining: Record<Id, number>;
}

export interface StatusEffectDefinition {
  id: Id;
  name: string;
  description: string;
  perTurnEffects: SkillEffect[];
  curableByMiniGame: { miniGameId: MiniGameId; clearScore: number }[];
  durationTurns?: number;
  /** When active on the source of a successful `damage` effect, also applies this status to the target hit — "poisoned blade" style riders (§4.2). */
  onHitStatusEffectId?: Id;
  /** While active, the bearer skips their entire turn (checked before acting, both Character and Monster) — §4.3. */
  stuns?: boolean;
}

/** Active instance of a status effect on a combatant, tracking remaining duration. */
export interface ActiveStatusEffect {
  statusEffectId: Id;
  turnsRemaining: number;
}

export type RoomType = "combat" | "rest" | "boss" | "treasure" | "empty" | "event";

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
  /** Base EXP granted to the party on kill, before floor-depth scaling (docs/gameplay-decisions.md §6.9). */
  expReward: number;
  /** Elite-tier-only skill kit (docs/gameplay-decisions.md §6.12) — undefined for archetypes never spawned as the floor's guard-room monster. Boss tier gets this too, on top of bossSkillIds. IDs reference data/monster-skills.json. */
  eliteSkillIds?: { strike: Id; cleave: Id };
  /** Boss-tier-only skill kit, on top of eliteSkillIds (§6.12). */
  bossSkillIds?: { execute: Id; debuff: Id };
  /** True for archetypes only ever spawned as the floor's guard-room monster (elite/boss tier) — excluded from the regular combat-room pool in src/data/floor.ts. */
  guardOnly?: boolean;
  /** Combat-room strength bracket used by ROOM_COMPOSITION_TEMPLATES (src/data/floor.ts) to keep room EXP balanced — unset for guard-only archetypes, which don't go through that composition logic. */
  powerTier?: "weak" | "medium" | "strong";
}

/** "normal" = regular combat-room spawn; "elite"/"boss" = the floor's guard room (§6.11), mutually exclusive per floor. */
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
  /** Fully-scaled EXP granted to the party on kill (archetype base + depth scaling + tier multiplier). */
  expReward: number;
  /** Boss-only (§6.12): turns remaining before Đòn Kết Liễu can start charging again — 0 = ready. Unused outside boss tier. */
  executeCooldownTurns?: number;
  /** Boss-only: true on the turn after charging starts — the boss's next turn releases Kết Liễu instead of rolling its normal kit, then resets. */
  isChargingExecute?: boolean;
  /** Boss-only: locked in when charging starts, so the release always hits the character that was telegraphed. */
  executeTargetId?: Id;
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
  /** Cumulative party EXP, shared by the whole party (docs/gameplay-decisions.md §6.9). */
  partyExp: number;
}
