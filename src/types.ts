export type Id = string;

export interface SurvivalStats {
  fear: number;
}

export type SkillEffectKind =
  | "damage"
  | "heal"
  | "restoreMp"
  | "applyStatusEffect"
  | "removeStatusEffect"
  | "modifyStat"
  | "modifyCombatStat";

export type CombatStat = "attack" | "defense" | "aggro" | "speed";

export interface SkillEffect {
  kind: SkillEffectKind;
  amount?: number;
  /** "satiety" is party-wide (GameState.satiety), so resolveSkillEffect needs a GameState reference to apply it. */
  stat?: keyof SurvivalStats | "satiety";
  combatStat?: CombatStat;
  statusEffectId?: Id;
  /** For `applyStatusEffect`: extra status ids applied alongside `statusEffectId` under the same roll/target, so a multi-status proc lands or misses atomically. */
  alsoApplyStatusEffectIds?: Id[];
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

export interface GrowthWeightsData {
  classGrowthWeights: Record<Id, GrowthWeights>;
  monsterGrowthWeights: Record<MonsterType, { attack: number; defense: number; maxHp: number }>;
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
  durationTurns?: number;
  onHitStatusEffectId?: Id;
  onHitAoeDamage?: { amount: number; isMagic?: boolean; ignoreDefensePercent?: number };
  accuracyPenaltyPercent?: number;
  stuns?: boolean;
  vulnerableTo?: { statusEffectId: Id; multiplier: number };
  /** If set, this status is a higher-rank variant of `rankOf` (e.g. "storm-empowered-ii" of "storm-empowered") — used to match ranks and compose the displayed name. */
  rankOf?: Id;
  rankLevel?: 2 | 3;
  /** Overrides the turn-countdown schedule inferred from `perTurnEffects`' shape — for a status whose shape alone doesn't capture its intended timing, e.g. a pure stat-mod rider that must tick in lockstep with a "special" status it's always co-applied with. */
  tickCategory?: "dot" | "statMod" | "special";
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
  /** Shown instead of `description` from the 2nd encounter onward (10-event-narrative.md §10.2).
      Only merchant/wandering-hermit/gambling-den set this. gambling-den needs to branch on the
      outcome of the player's last visit, so it uses the object form instead of a plain string. */
  returnDescription?: string | Record<"won" | "lost" | "declined", string>;
  /** Shown instead of `description` once `narrativeCounters.guardianFightsSkipped` reaches 2
      (10-event-narrative.md §10.3 Chain 1) — a subtle, non-warning variant. Only guardian-fight and
      desecrated-altar set this. */
  chainBuildupDescription?: string;
  /** Shown instead of `description` once `narrativeCounters.guardianFightsSkipped` reaches the
      forced threshold (§10.3 Chain 1) — Skip is hidden/rejected on this room. Only guardian-fight
      and desecrated-altar set this. */
  chainForcedDescription?: string;
  /** Shown instead of `description` once the relevant `narrativeCounters` threshold is crossed
      (10-event-narrative.md §10.3 Chain 2/3) — permanent, no reset. Only sacrificial-circle
      (`artifactsSacrificed`) and blood-altar (`altarPaymentsCount`) set this. */
  chainEscalatedDescription?: string;
  /** Post-event reflection content (10-event-narrative.md §10.5) — set on the 9 in-scope events
      (all but open-chest and collapsed-floor). `escalatedPrompt` is only set on the 4 events §10.3
      can escalate (guardian-fight, desecrated-altar, sacrificial-circle, blood-altar). */
  reflection?: {
    prompt: string;
    escalatedPrompt?: string;
    options: { curious: string; wary: string; dismissive: string };
  };
}

export interface ActiveStatusEffect {
  statusEffectId: Id;
  turnsRemaining: number;
}

export type RoomType = "combat" | "rest" | "boss" | "event";

export interface Room {
  id: Id;
  name: string;
  type: RoomType;
  connectedRoomIds: Id[];
  monsterIds: Id[];
  cleared: boolean;
  rolledEventId?: Id;
  /** Which text variant this room's event resolved to (10-event-narrative.md §10.3 Chain 1) — set
      by `resolveEventEntry`, left undefined otherwise. */
  chainVariant?: "buildup" | "forced";
}

export interface Floor {
  depth: number;
  rooms: Room[];
  entryRoomId: Id;
}

export type MonsterAiPattern = "aggressive" | "defensive" | "erratic";

/** Stat-budget archetype, mirroring how `classGrowthWeights` splits a character class's budget across stats — see `monsterGrowthWeights` (`data/growth-weights.json`). Multipliers sum to 3 (1 per stat) the same way `classGrowthWeights` sums to 5. */
export type MonsterType = "balanced" | "tanky" | "armored" | "striker" | "glass" | "bruiser" | "sentinel";

export interface MonsterArchetype {
  id: Id;
  name: string;
  baseHp: number;
  baseAttack: number;
  baseDefense: number;
  baseSpeed: number;
  monsterType: MonsterType;
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
  monsterType: MonsterType;
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
  activeStatusEffects?: ActiveStatusEffect[];
}

/** Party-wide stats (not per-combatant) captured alongside a log entry, so the reveal can freeze coins/EXP/satiety in sync with the log the same way CombatantSnapshot freezes HP/MP/level/status. */
export interface PartyStateSnapshot {
  coins: number;
  partyExp: number;
  satiety: number;
}

export interface LogEntry {
  text: string;
  kind: LogEntryKind;
  snapshot?: CombatantSnapshot[];
  partySnapshot?: PartyStateSnapshot;
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
  roundStartPartySnapshot?: PartyStateSnapshot;
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
  pendingArtifactDecision?: { artifactId: Id; forceEquip: boolean } | null;
  /** Gambling Den's round-4 jackpot grants 2 Epic artifacts; the 2nd waits here until the 1st is resolved. */
  secondJackpotArtifactId?: Id | null;
  activeEvent?: { eventId: Id; offerArtifactIds: Id[]; gambleState?: { round: number; pot: number; maxRounds: number }; refreshCount?: number } | null;
  lastRoomDrops: { itemIds: Id[]; artifactIds: Id[] } | null;
  /** Ids of personified events (merchant/wandering-hermit/gambling-den) already met this run —
      drives the "return" flavor text in 10-event-narrative.md §10.2. */
  metNarrativeNpcIds: Id[];
  /** Outcome of the player's most recent Gambling Den visit — undefined until the 1st visit closes.
      Drives which `returnDescription` variant gambling-den shows on the next visit. "declined"
      covers leaving before any round was played. */
  lastGamblingDenOutcome?: "won" | "lost" | "declined";
  /** Running counters that unlock the escalated event variants in 10-event-narrative.md §10.3.
      Never decrease, except `guardianFightsSkipped` which resets to 0 once its forced encounter
      is entered. */
  narrativeCounters: {
    guardianFightsSkipped: number;
    artifactsSacrificed: number;
    altarPaymentsCount: number;
  };
  /** A post-event reflection is waiting to be shown (10-event-narrative.md §10.5) — set by
      `maybeTriggerReflection()`, cleared by `Game.pickReflectionStance()`. */
  pendingReflection?: { eventId: Id } | null;
  /** Player's most recent post-event reflection choice per event id (§10.5) — overwritten on each
      re-trigger, not a history log. Purely flavor today. */
  eventReflectionStances: Partial<Record<Id, "curious" | "wary" | "dismissive">>;
}
