// dungeon-crawler-data-model.ts
//
// Design-time sketch of the core data types described in
// dungeon-crawler-design-doc.md (section 4). Types only, no game logic —
// resolver functions that read these and apply real effects are listed as
// open work in section 5 of the doc.

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export type Id = string;

export interface Vector2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Survival stats (1.3): HP/MP + fear/hunger/thirst
// ---------------------------------------------------------------------------

export interface SurvivalStats {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  fear: number;
  hunger: number;
  thirst: number;
}

// ---------------------------------------------------------------------------
// Skill / Item — data-driven effects (3: SkillEffect shared by both)
// ---------------------------------------------------------------------------

export type MiniGameId = "snake" | "tetris" | "brickBreaker" | "magicTiles";

export type SkillEffectKind =
  | "damage"
  | "heal"
  | "restoreMp"
  | "applyStatusEffect"
  | "removeStatusEffect"
  | "modifyStat"
  | "triggerMiniGame";

export interface SkillEffect {
  kind: SkillEffectKind;
  /** Flat amount; meaning depends on `kind` (damage / heal / mp / stat delta). */
  amount?: number;
  /** Target stat, for `modifyStat`. */
  stat?: keyof SurvivalStats;
  /** StatusEffect id, for apply/removeStatusEffect. */
  statusEffectId?: Id;
  /** Mini-game to launch, for `triggerMiniGame` (boss phases, item-triggered games, ...). */
  miniGameId?: MiniGameId;
}

export type SkillTarget =
  | "self"
  | "singleAlly"
  | "allAllies"
  | "singleEnemy"
  | "allEnemies";

export interface SkillDefinition {
  id: Id;
  name: string;
  description: string;
  mpCost: number;
  target: SkillTarget;
  effects: SkillEffect[];
  /** Slot within the class's 5-skill kit; slots 0-1 are unlocked at creation (1.5). */
  slot: 0 | 1 | 2 | 3 | 4;
  /** Character level required to unlock this skill (slots 0-1 should be 1). */
  unlockLevel: number;
}

export interface CharacterClass {
  id: Id;
  name: string;
  description: string;
  baseStats: SurvivalStats;
  /** Exactly 5 skills total per class (2 starting + 3 unlocked by level). */
  skills: SkillDefinition[];
}

export interface Character {
  id: Id;
  name: string;
  classId: Id;
  level: number;
  stats: SurvivalStats;
  unlockedSkillIds: Id[];
  statusEffectIds: Id[];
  /** Permadeath (1.2): once false, stays false — never revived. */
  isAlive: boolean;
}

// ---------------------------------------------------------------------------
// Items (1.6) — reuse SkillEffect so skill/item resolution share one path
// ---------------------------------------------------------------------------

export type ItemCategory = "consumable" | "equipment" | "keyItem";

export interface ItemDefinition {
  id: Id;
  name: string;
  description: string;
  category: ItemCategory;
  effects: SkillEffect[];
  stackable: boolean;
}

// ---------------------------------------------------------------------------
// Status effects (debuffs) <-> mini-games (1.7, 3: curableByMiniGame)
// ---------------------------------------------------------------------------

export interface StatusEffectDefinition {
  id: Id;
  name: string;
  description: string;
  /** Applied once per turn/tick while the effect is active. */
  perTurnEffects: SkillEffect[];
  /** Which mini-game(s) cure this debuff, and the score needed to clear it. */
  curableByMiniGame: {
    miniGameId: MiniGameId;
    clearScore: number;
  }[];
  /** undefined = persists until cured via mini-game, not by time. */
  durationTurns?: number;
}

// ---------------------------------------------------------------------------
// Dungeon structure (1.4): branching room graph, rest rooms, darkness
// ---------------------------------------------------------------------------

export type RoomType = "combat" | "rest" | "boss" | "treasure" | "empty";

export interface Room {
  id: Id;
  type: RoomType;
  /** Adjacency list — branching graph, not a linear chain. */
  connectedRoomIds: Id[];
  monsterIds: Id[];
  cleared: boolean;
  position: Vector2;
}

export interface Floor {
  depth: number;
  /** 5-10 rooms per floor, at least 1-2 of type "rest". */
  rooms: Room[];
  entryRoomId: Id;
  /** Ambient darkness for this floor; rises with depth, drives passive fear gain. */
  darknessLevel: number;
}

// ---------------------------------------------------------------------------
// Mini-games (1.7, 1.8, 3: MiniGameSession contract + monotonic clock)
// ---------------------------------------------------------------------------

export type KeyEventType = "press" | "release";

export interface KeyEvent {
  type: KeyEventType;
  key: string;
  /** performance.now() timestamp — same monotonic clock used for tile timing. */
  timestamp: number;
}

export interface MiniGameResult {
  won: boolean;
  score: number;
  targetScore: number;
  maxCombo: number;
  /** Fear delta to apply on loss (1.3); combo also scales effect potency on win (1.8). */
  fearDelta: number;
}

/**
 * Common contract every mini-game implements. The dungeon loop only ever
 * talks to this interface, so adding a 5th mini-game never touches it.
 */
export interface MiniGameSession {
  readonly id: MiniGameId;
  start(): void;
  tick(nowMs: number): void;
  handleInput(event: KeyEvent): void;
  isComplete(): boolean;
  getResult(): MiniGameResult;
}

// ---------------------------------------------------------------------------
// Combat (1.2): per-character turns, initiative queue, boss fights
// ---------------------------------------------------------------------------

export interface Monster {
  id: Id;
  name: string;
  stats: SurvivalStats;
  attack: number;
  defense: number;
  initiative: number;
  skillIds: Id[];
  isBoss: boolean;
}

export type CombatantRef =
  | { kind: "character"; id: Id }
  | { kind: "monster"; id: Id };

export interface Combatant {
  ref: CombatantRef;
  initiative: number;
  statusEffectIds: Id[];
}

export interface CombatState {
  roomId: Id;
  combatants: Combatant[];
  /** Ordered by initiative; turn order alternates between characters and monsters. */
  turnQueue: CombatantRef[];
  activeTurnIndex: number;
  roundNumber: number;
  isBossFight: boolean;
}

// ---------------------------------------------------------------------------
// Top-level game state — bridges the dungeon loop and the mini-game loop (3)
// ---------------------------------------------------------------------------

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
