// dungeon-crawler-data-model.ts
//
// Design-time sketch of the core data types described in
// dungeon-crawler-design-doc.md (section 4). Types only, no game logic —
// the resolver algorithm that reads these and applies real effects is
// specified in docs/technical-decisions.md.

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export type Id = string;

export interface Vector2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Survival stats (1.3): fear/hunger/thirst only — HP/MP live on
// Character/Monster directly (see below), since HP/MP are class-defining
// combat stats while fear/hunger/thirst start identical for every class
// (docs/gameplay-decisions.md §3).
// ---------------------------------------------------------------------------

export interface SurvivalStats {
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
  | "modifyCombatStat"
  | "triggerMiniGame";

/** attack/defense/aggro/speed — the 4 buffable/debuffable combat stats (1.5). */
export type CombatStat = "attack" | "defense" | "aggro" | "speed";

export interface SkillEffect {
  kind: SkillEffectKind;
  /** Flat amount; meaning depends on `kind` (damage / heal / mp / stat delta). */
  amount?: number;
  /** Target survival stat, for `modifyStat` (fear/hunger/thirst only). */
  stat?: keyof SurvivalStats;
  /** Target combat stat, for `modifyCombatStat` (buffs/debuffs like Guard or Curse). */
  combatStat?: CombatStat;
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
  /** Max casts per combat encounter (ultimates); omit for mp/cooldown-only gating. */
  usesPerCombat?: number;
}

/**
 * Multiplier applied to the shared level-growth curve (docs/gameplay-
 * decisions.md §6.3's `growthBonus`) per stat, per class — §6.8. Budget
 * convention: the 4 weights always sum to 4.0 across a class, so no class
 * gets strictly more total growth, only redistributed differently (VD tank
 * dồn vào defense/maxHp, mage dồn vào attack/maxMp).
 */
export interface GrowthWeights {
  attack: number;
  defense: number;
  maxHp: number;
  maxMp: number;
}

/**
 * Level-1 combat stats for a class: tấn công/phòng thủ/máu/mana/thu hút/tốc độ
 * (docs/gameplay-decisions.md §1). fear/hunger/thirst are NOT here — every
 * character starts with the same values regardless of class (§3).
 */
export interface CharacterClass {
  id: Id;
  name: string;
  description: string;
  baseMaxHp: number;
  baseMaxMp: number;
  baseAttack: number;
  baseDefense: number;
  /** Thu hút — weight in monster target selection (docs/gameplay-decisions.md §2). */
  baseAggro: number;
  /** Tốc độ — priority in the resolution-phase turn order (docs/technical-decisions.md §2). */
  baseSpeed: number;
  /** Per-stat growth multiplier for leveling 1-100 (docs/gameplay-decisions.md §6.8). */
  growthWeights: GrowthWeights;
  /** Exactly 5 skills total per class (2 starting + 3 unlocked by level). */
  skills: SkillDefinition[];
}

/** Active instance of a status effect on a Character/Monster, tracking remaining duration (durationTurns on StatusEffectDefinition needs somewhere to count down to 0). */
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
// Combat (1.2): command phase + speed-ordered resolution phase, boss fights
// ---------------------------------------------------------------------------

/** See docs/gameplay-decisions.md §2 for what each pattern does. */
export type MonsterAiPattern = "aggressive" | "defensive" | "erratic";

export interface Monster {
  id: Id;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  /** Monsters are never targeted by other monsters, so no aggro stat here. */
  speed: number;
  skillIds: Id[];
  isBoss: boolean;
  aiPattern: MonsterAiPattern;
  /** Monsters can be debuffed too (VD Tẩm Độc/Nguyền Rủa nhắm địch = quái). */
  activeStatusEffects: ActiveStatusEffect[];
}

export type CombatantRef =
  | { kind: "character"; id: Id }
  | { kind: "monster"; id: Id };

export interface Combatant {
  ref: CombatantRef;
  /** Snapshotted from the underlying Character/Monster speed at round start. */
  speed: number;
}

export type ActionSource =
  | { kind: "skill"; skillId: Id }
  | { kind: "item"; itemId: Id };

/**
 * A player-submitted action, captured during the command phase and executed
 * later during the resolution phase (docs/technical-decisions.md §2).
 */
export interface QueuedAction {
  actor: CombatantRef;
  source: ActionSource;
  targets: CombatantRef[];
}

export interface CombatState {
  roomId: Id;
  combatants: Combatant[];
  roundNumber: number;
  /**
   * "command": player is choosing an action for each living character.
   * "resolution": turnQueue is being executed in speed order (monsters
   * choose their action live, at their own turn, instead of pre-committing).
   */
  phase: "command" | "resolution";
  /** One entry per living character, filled during the command phase. */
  queuedActions: QueuedAction[];
  /** Built from `combatants` sorted by speed once the command phase ends. */
  turnQueue: CombatantRef[];
  activeTurnIndex: number;
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
