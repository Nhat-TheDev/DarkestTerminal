// Runtime types for the darkest-terminal prototype.
//
// Mirrors ../../dungeon-crawler-data-model.ts and the decisions in
// ../../docs/gameplay-decisions.md + ../../docs/technical-decisions.md.
// Scope cuts for this prototype (see README.md): no mini-games. Items now
// implemented per docs/gameplay-decisions/07-items-artifacts.md §7.1 (Artifact
// equipment and Event rooms — §7.2/§8 — are still not implemented).
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
  /** Only meaningful on a `damage` effect — 0-100, reduces target.defense by this % before the mitigation formula runs (e.g. a boss's execute "finishing blow" punching through armor). Omit = 0, no change. */
  ignoreDefensePercent?: number;
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
  /** True for skills whose damage/heal effects scale off the caster's magicPower instead of attack — elemental/holy skills (fire, lightning, ice, heal). Unset = physical, scales off attack as before. */
  isMagic?: boolean;
}

/** Multiplier applied to the shared growthBonus() curve per stat, per class — see docs/gameplay-decisions/06-level-system.md §6.8. Budget convention: all 5 weights (attack/defense/maxHp/maxMp/magicPower) sum to 5.0 across classes, so no class gets strictly more total growth, only redistributed differently. Vanguard/Rogue keep magicPower at (or near) 0 since none of their skills are isMagic. */
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
  /** Offensive stat for skills flagged isMagic (elemental/holy damage and heal) — separate from attack, which still drives every non-magic skill. */
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
  /** Tracks remaining usesPerCombat per skill for the current combat only. */
  usesRemainingThisCombat: Record<Id, number>;
  /** Tracks remaining cooldownTurns per skill; resets at startCombat, decrements each round (docs/technical-decisions.md §4.6). */
  cooldownsRemaining: Record<Id, number>;
  /** Equipped artifact ids, max 3 (docs/gameplay-decisions/07-items-artifacts.md §7.2). */
  equippedArtifactIds: Id[];
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
  /** While active on a bearer, multiplies the per-turn `damage` amount of the named status's own DoT tick on that same bearer (docs/gameplay-decisions/07-items-artifacts.md §7.1, `poison-vulnerable`/Venom Thorn). Does not apply the named status itself. */
  vulnerableTo?: { statusEffectId: Id; multiplier: number };
}

/** Consumable item (docs/gameplay-decisions/07-items-artifacts.md §7.1) — used instead of a skill during the combat command phase, or directly outside combat. Reuses SkillEffect/resolveSkillEffect exactly like a skill, no dedicated effect kind. */
export interface ItemDefinition {
  id: Id;
  name: string;
  description: string;
  target: SkillTarget;
  effects: SkillEffect[];
  /** Set only for the 9 monster-signature items — the MonsterArchetype ids whose kills roll this item into the "signature" half of the drop pool (§7.1 "Item đặc trưng theo quái"). Omitted/empty for the 10 common-pool items. */
  archetypeIds?: Id[];
  /** Relative drop weight within its pool (signature or common), default 1 if omitted. Stronger items use <1 to drop less often; see rollItemDrop's floor-depth growth. */
  weight?: number;
}

export type ArtifactRarity = "common" | "rare" | "unique" | "epic";

/** Passive artifact effect (docs/gameplay-decisions/07-items-artifacts.md §7.2) — applies only to the character it's equipped on, except expBoost (party-wide, since EXP is shared). The 2 curse* kinds (docs/gameplay-decisions/08-events.md §8.6) only ever appear on isCursed artifacts. */
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
  | { kind: "survivalDrainReduction"; percent: number }
  /** Adds flat aggro to the equipped-on character (permanent, like statBoost) — monsters target them more. */
  | { kind: "curseAggroBoost"; amount: number }
  /** Inverse of survivalDrainReduction — speeds up hunger/thirst drain for the equipped-on character. */
  | { kind: "curseDrainBoost"; percent: number };

/** Permanent relic equipment for the run (docs/gameplay-decisions/07-items-artifacts.md §7.2) — unlike Item, never consumed; equipped/unequipped freely outside combat, max 3 per character. */
export interface ArtifactDefinition {
  id: Id;
  name: string;
  description: string;
  rarity: ArtifactRarity;
  effects: ArtifactEffect[];
  /** True when effects includes at least 1 negative/curse effect (docs/gameplay-decisions/08-events.md §8.6) — flagged to the player before accepting. */
  isCursed?: boolean;
}

export type EventTier = "common" | "rare";

export type EventKind =
  | "instantReward"
  | "combatReward"
  | "merchant"
  | "hpGamble"
  /** cursed-shrine, twin-altars — reveals an offer, then the player decides. */
  | "choiceReveal"
  /** sacrificial-circle, gambling-den, wandering-hermit — operates on artifacts already owned instead of a plain new roll. */
  | "artifactExchange"
  /** collapsed-floor. */
  | "rescueGamble";

/** Event room definition (docs/gameplay-decisions/08-events.md §8) — the specific event a room resolves to is rolled once on first entry (Room.rolledEventId) from the 2-tier table in §8.1. */
export interface EventDefinition {
  id: Id;
  name: string;
  description: string;
  kind: EventKind;
  tier: EventTier;
  /** True only for twin-altars (§8.8/§8.13) — the chosen Artifact must be equipped immediately, no "để đó" option. */
  forceEquip?: boolean;
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
  /** Only set for type "event" — rolled once on first entry (docs/gameplay-decisions/08-events.md §8.1), so leaving and re-entering doesn't reroll. */
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
  /**
   * Per-tier relative weights for runMonsterTurn's action pick (combat.ts `pickMonsterAction`).
   * "skill" = a random pick from `skillIds`; "strike"/"cleave" need `eliteSkillIds`; "debuff" needs
   * `bossSkillIds`. `execute` is NOT part of this pool — it stays on its own charge/cooldown/release
   * cycle (§6.12), not a per-turn weighted choice. Missing tier/action-key, an action with weight 0,
   * or an action whose prerequisite skill kit is absent are all excluded from the roll; if nothing is
   * left, the monster falls back to a plain basic attack.
   */
  actionWeights?: {
    normal?: Partial<Record<"basicAttack" | "skill", number>>;
    elite?: Partial<Record<"basicAttack" | "skill" | "strike" | "cleave", number>>;
    boss?: Partial<Record<"basicAttack" | "strike" | "cleave" | "debuff", number>>;
  };
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

export type ActionSource = { kind: "skill"; skillId: Id } | { kind: "item"; itemId: Id };

export interface QueuedAction {
  actor: CombatantRef;
  source: ActionSource;
  targets: CombatantRef[];
}

/** Semantic category of a combat log line, used to pick an icon/color when rendering (see src/ui/app.ts). */
export type LogEntryKind = "attack" | "heal" | "buff" | "debuff" | "item" | "death" | "info";

/** HP/alive state of 1 combatant at a point in a round's resolution — lets the UI show the battlefield/party/monster panels in sync with however far the paced log reveal has gotten, instead of jumping straight to the round's final state (see src/ui/app.ts). */
export interface CombatantSnapshot {
  id: Id;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  /** Character-only (undefined for monsters) — lets the party panel hold the pre-levelup/pre-spend value while the log is still catching up to it. */
  level?: number;
  mp?: number;
  maxMp?: number;
}

export interface LogEntry {
  text: string;
  kind: LogEntryKind;
  /** Full-roster HP/alive state right after this line (and the rest of its turn/block) resolved. Undefined only for entries pushed outside resolveRound's tagging (shouldn't happen for combat.log). */
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
  /** Full-roster HP/alive state captured at the very start of the round currently resolving (before any of its mutations) — the UI's baseline while none of this round's log lines have been revealed yet. */
  roundStartSnapshot?: CombatantSnapshot[];
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
  /** Item count by id, shared by the whole party — docs/gameplay-decisions/07-items-artifacts.md §7.1. */
  inventory: Record<Id, number>;
  /** Artifacts picked up but not equipped on any character yet — shared pool (docs/gameplay-decisions/07-items-artifacts.md §7.2). */
  unequippedArtifactIds: Id[];
  /** Set while a "reveal before decide" event (merchant/cursed-shrine/twin-altars) is being resolved — the artifact ids it pre-rolled to show the player, cleared once the room resolves (docs/gameplay-decisions/08-events.md). */
  activeEvent?: { eventId: Id; offerArtifactIds: Id[] } | null;
  /** Items/artifacts picked up by the room-clear victory just resolved — the UI shows a "you received" reveal screen from this, then clears it. Null when the last clear dropped nothing, or outside that 1-render window. */
  lastRoomDrops: { itemIds: Id[]; artifactIds: Id[] } | null;
}
