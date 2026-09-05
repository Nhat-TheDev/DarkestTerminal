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
  /** Excluded from every roll (Elite/Boss kills, the Event room's standard table, Merchant,
      Ritual Circle) except the source(s) listed here — `10-event-narrative.md` §F.4. Callers opt
      in explicitly via `rollArtifact`'s `allowRestrictedSource` param; nothing infers it from the
      rarity table alone (Collapsed Floor rolls the same "boss" table without being a Boss kill). */
  restrictedDropSources?: ("boss" | "blood-altar")[];
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

/** A single condition an event's outcome tag must match, for `CrossEventVariant.when`
    (10-event-narrative.md Part C.1). `outcome` is compared against `GameState.eventOutcomes[eventId]`. */
export interface EventOutcomeCondition {
  eventId: Id;
  outcome: string;
}

/** One conditional description an event can show instead of its base `description`, keyed off other
    events' outcome tags (Part C.1). Array order matters: `pickEventText()` uses first-match-wins, so
    a more specific condition must be listed before a more general one targeting the same event. */
export interface CrossEventVariant {
  when: EventOutcomeCondition[];
  match: "all" | "any";
  description: string;
}

export interface EventDefinition {
  id: Id;
  name: string;
  description: string;
  kind: EventKind;
  tier: EventTier;
  forceEquip?: boolean;
  /** Minimum `floor.depth` at which this event can be rolled at all (Part C.4/C.5) — checked by
      `rollEvent()`, not by `pickEventText()`. Absent means no depth gate. */
  minFloorDepth?: number;
  /** This event can fire at most once per run — `rollEvent()` excludes it once its id is in
      `GameState.firedOnceEventIds`, set by `closeEvent()` (Part C.4/C.5). */
  onceLifetime?: boolean;
  /** `instantReward` only: skip the usual rollArtifact/grantArtifact — still-breathing is
      deliberately "no artifact, no stat effect of any kind" (Part C.4). */
  noArtifactReward?: boolean;
  /** `instantReward` only: grants this specific artifact instead of rolling from the standard
      table — for a scene whose reward is a specific object described in the text itself, not a
      generic loot beat (e.g. waiting-supplies' bundle). Ignored if `noArtifactReward` is set. */
  guaranteedArtifactId?: Id;
  /** Overrides the generic "Open the chest" confirm-option text in the `eventOpenChest` UI screen
      for `instantReward` events whose scene isn't a chest. */
  instantRewardActionLabel?: string;
  /** Shown instead of `description` from the 2nd encounter onward (10-event-narrative.md §10.2).
      Only merchant/wandering-hermit/gambling-den set this. gambling-den needs to branch on the
      outcome of the player's last visit, so it uses the object form instead of a plain string. */
  returnDescription?: string | Record<"won" | "lost" | "declined", string>;
  /** Appended to `returnDescription` based on the party's dominant recorded reflection stance
      (`GameState.eventReflectionStances`) — 11-world-bible.md §11.13's payoff: flavor only, never
      mechanical, and each line must stay readable more than one way (a leaning, not a verdict). */
  stanceEcho?: { curious: string; wary: string; dismissive: string };
  /** Appended to a `returnDescription` visit once `GameState.eventOutcomes["camp-reflection"]` is
      `"unaware"` (03-survival-stats.md's Camp Reflection, tier 4) — the counterpart to this event's
      own `crossEventVariants` entry for the same tag: that variant only ever shows on a party's
      *first* meeting with this NPC (crossEventVariants never wins over returnDescription past the
      1st encounter, `pickEventText`), which is the less common case for a state this late-game.
      This field covers every visit after the first instead. Wandering Hermit only, so far. */
  campReflectionUnawareEcho?: string;
  /** Shown instead of `description` once `narrativeCounters.guardianFightsSkipped` reaches 2
      (10-event-narrative.md §10.3 Chain 1) — a subtle, non-warning variant. Only guardian-fight and
      desecrated-altar set this. */
  chainBuildupDescription?: string;
  /** Shown instead of `description` once `narrativeCounters.guardianFightsSkipped` reaches the
      forced threshold (§10.3 Chain 1) — Skip is hidden/rejected on this room. Only guardian-fight
      and desecrated-altar set this. */
  chainForcedDescription?: string;
  /** Shown instead of `chainForcedDescription` from the 2nd forced encounter onward this run
      (`narrativeCounters.guardianGrudgeFiredCount >= 1`) and only past `events.chainTier2MinFloorDepth`
      (11-world-bible.md §11.13) — Skip stays rejected, same as tier 1. Deliberately shared verbatim
      between guardian-fight/desecrated-altar (unlike the tier-1 fields, which are per-id) — tier 2 is
      about losing that specificity, not keeping it. */
  chainForced2Description?: string;
  /** Shown instead of `chainForced2Description` once `guardianGrudgeFiredCount >= 2` AND floor depth
      is past `events.chainTier3MinFloorDepth` (10-event-narrative.md Part C.3) — Skip stays rejected,
      same as tier 1/2. Shared verbatim between guardian-fight/desecrated-altar, same reasoning as
      tier 2. */
  chainForced3Description?: string;
  /** Shown instead of `description` once the relevant `narrativeCounters` threshold is crossed
      (10-event-narrative.md §10.3 Chain 2/3) — permanent, no reset. Set by sacrificial-circle
      (`artifactsSacrificed`) and blood-altar (`altarPaymentsCount`); also reused verbatim by Chain
      4's 7 events (§8.15, `freeRewardsTakenCount`) — a single tier, unlike Chain 2/3's 3. */
  chainEscalatedDescription?: string;
  /** Shown instead of `chainEscalatedDescription` once the higher tier-2 threshold
      (`circleRemembersThreshold2`/`bloodDebtThreshold2`) is crossed AND floor depth is past
      `events.chainTier2MinFloorDepth` (11-world-bible.md §11.13) — permanent, no reset, same as tier 1.
      Only sacrificial-circle and blood-altar set this. */
  chainEscalated2Description?: string;
  /** Shown instead of `chainEscalated2Description` once the tier-3 threshold
      (`circleRemembersThreshold3`/`bloodDebtThreshold3`) is crossed AND floor depth is past
      `events.chainTier3MinFloorDepth` (Part C.3) — permanent, no reset. Only sacrificial-circle and
      blood-altar set this. */
  chainEscalated3Description?: string;
  /** Conditional variants keyed off other events' outcome tags (Part C.1) — checked after all chain
      states, before `descriptionVariants`. First array entry whose condition matches wins. */
  crossEventVariants?: CrossEventVariant[];
  /** Alternate base-scene descriptions (Part C.2) — `pickEventText()`'s lowest-priority fallback
      picks uniformly among `[description, ...descriptionVariants]`, `description` always being
      option 0. Picked once per room at roll time and pinned via `Room.descriptionVariantIndex`. */
  descriptionVariants?: string[];
  /** Post-event reflection content (10-event-narrative.md §10.5) — set on the 9 in-scope events
      (all but open-chest and collapsed-floor). `escalatedPrompt` is only set on the 4 events §10.3
      can escalate (guardian-fight, desecrated-altar, sacrificial-circle, blood-altar).
      `escalated2Prompt`/`escalated3Prompt` are only set on those same 4, shown once the tier-2/3
      escalation is what just resolved (see the `chain*Description` fields above). */
  reflection?: {
    prompt: string;
    escalatedPrompt?: string;
    escalated2Prompt?: string;
    escalated3Prompt?: string;
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
  chainVariant?: "buildup" | "forced" | "forced2" | "forced3";
  /** Index into `[event.description, ...event.descriptionVariants]` for this room's rolled event
      (Part C.2) — picked once by `resolveEventEntry` when the event is freshly rolled, so re-renders
      within the same visit stay consistent. Undefined if the event has no `descriptionVariants`. */
  descriptionVariantIndex?: number;
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
  /** `"stay"`/`"letGo"`/`"leaveAmbushed"`/`"leaveEscaped"` are the Ending System's 4 immediate
      terminal endings (10-event-narrative.md Part F.2-F.4) — narrative conclusions distinct from
      an ordinary loss, but terminal the same way `"defeat"` is (no further play on this save).
      `"leaveAmbushed"` is deliberately not folded into `"defeat"`: it's framed as unresolved fate,
      never a confirmed death. Continuing past floor 100 (Ending 3) sets nothing here — the run
      keeps playing normally toward floor 120, per §F.5. */
  gameOver: "victory" | "defeat" | "stay" | "letGo" | "leaveAmbushed" | "leaveEscaped" | null;
  /** Set when the run advances to floor 100 still alive (Part F.1) — a guaranteed, non-rolled
      story beat, checked before anything else in `syncUiToGameState()`. Which endings are actually
      offered is computed live from existing state (`src/data/endings.ts`'s `endingCheckpointMode`),
      never stored, so nothing here needs to change if that state changes before the player answers
      (it can't, since normal play is blocked while this is true). Cleared by
      `Game.pickEndingChoice()`. */
  pendingEndingCheckpoint: boolean;
  /** Set true by `pickEndingChoice("continue")` (Part F.5) — never reset. Read only at floor-120
      entry to decide whether the guaranteed founder encounter fires; otherwise inert. */
  continuedPastCheckpoint: boolean;
  /** Set when the run advances to floor 120 with `continuedPastCheckpoint` true — the founder's
      pre-fight dialogue and boss visual, shown before `Game.enterFounderFight()` starts combat.
      Same "block everything else" priority as `pendingEndingCheckpoint`. */
  pendingFounderDialogue: boolean;
  /** Part F.2's cross-run persistence layer — set once, at fresh-run construction, from
      `src/engine/profile.ts`'s on-disk profile: the most recently retired class, if any exist and
      `the-one-who-stayed` hasn't already been shown in a previous run. `null` means either nobody
      has stayed yet, or the payoff has already been shown — either way the event is pre-excluded
      from this run's `firedOnceEventIds` at construction, so this field is only ever read to fill
      in the event's text once it does roll, never to gate anything itself. */
  retiredCharacterClassId: Id | null;
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
    /** How many times Chain 1's forced encounter has been entered this run (11-world-bible.md
        §11.13 tier 2) — unlike `guardianFightsSkipped`, this never resets, so it can tell "is this
        the 1st time the chain has fired, or the 2nd+" even after the skip counter resets to 0. */
    guardianGrudgeFiredCount: number;
    /** §8.15 Chain 4, "Taken, Never Given" — increments once per resolved event among the 7
        zero-cost reward ids (open-chest, old-count, doubled-back, waiting-supplies, vigil-candle,
        broken-seal, half-a-warning). Never decreases. Feeds `10-event-narrative.md` §F.1's 2nd
        Leave trigger alongside `altarPaymentsCount`/`artifactsSacrificed` staying at 0. */
    freeRewardsTakenCount: number;
  };
  /** A post-event reflection is waiting to be shown (10-event-narrative.md §10.5) — set by
      `maybeTriggerReflection()`, cleared by `Game.pickReflectionStance()`. */
  pendingReflection?: { eventId: Id } | null;
  /** Player's most recent post-event reflection choice per event id (§10.5) — overwritten on each
      re-trigger, not a history log. Purely flavor today. */
  eventReflectionStances: Partial<Record<Id, "curious" | "wary" | "dismissive">>;
  /** 03-survival-stats.md's Camp Reflection — entirely independent of `narrativeCounters`,
      `eventOutcomes`, `pendingReflection`, and `eventReflectionStances` above; a 4th, unrelated
      piece of rest-room content. Increments by 1 each time the party resolves an event in
      `LORE_EXPOSURE_EVENT_IDS` (`src/data/loreExposure.ts`) — every event id except open-chest.
      Never resets, never decreases. Written in `closeEvent()` (src/engine/events/shared.ts). */
  loreExposureCount: number;
  /** Set at rest-room entry (`moveToRoom`'s "rest" branch, src/engine/dungeon.ts) when a newly
      computed tier is higher than the highest tier already answered in `campReflectionChoices`.
      Skipped if `pendingReflection` is currently set. Cleared once the player picks a response
      (`Game.pickCampReflectionChoice`). */
  pendingCampReflectionTier: 1 | 2 | 3 | 4 | null;
  /** Which option (0/1/2) was picked at each Camp Reflection tier — a genuine per-tier record,
      unlike `eventReflectionStances`, since each tier fires exactly once per run. */
  campReflectionChoices: Partial<Record<1 | 2 | 3 | 4, 0 | 1 | 2>>;
  /** Outcome tag per event id, set once that event's defining choice resolves (10-event-narrative.md
      Part C.1) — read by `crossEventVariants`. Never reset mid-run. Most events only ever get the
      generic `"resolved"` fallback, written by `closeEvent()`; a handful of handlers
      (bloodAltarPay/Leave, collapsedFloorAttempt/Leave, sacrifice) write a more specific tag first. */
  eventOutcomes: Partial<Record<Id, string>>;
  /** Ids of events with `onceLifetime: true` that have already fired this run (Part C.4/C.5) —
      `rollEvent()` excludes them from future rolls. Marked by `closeEvent()`. */
  firedOnceEventIds: Id[];
}
