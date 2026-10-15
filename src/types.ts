export type Id = string;

export interface SurvivalStats {
  /** 0.0-100.0, one decimal place. */
  fear: number;
}

export type SkillEffectKind =
  | "damage"
  | "heal"
  | "restoreMp"
  | "applyStatusEffect"
  | "removeStatusEffect"
  | "modifyStat"
  | "modifyCombatStat"
  | "summon"
  | "summonMonster"
  | "commandSummons"
  | "throwDice";

export type DamageType = "physical" | "magic" | "fire" | "ice" | "lightning" | "poison" | "bleed" | "holy";

export type CombatStat = "attack" | "defense" | "aggro" | "speed" | "magicPower" | "maxHp";

export interface SkillEffect {
  kind: SkillEffectKind;
  amount?: number;
  /** "satiety" is party-wide, so resolving it needs the GameState. */
  stat?: keyof SurvivalStats | "satiety";
  combatStat?: CombatStat;
  statusEffectId?: Id;
  /** Applied with `statusEffectId` under the same roll, so a multi-status proc lands or misses together. */
  alsoApplyStatusEffectIds?: Id[];
  chance?: number;
  ignoreDefensePercent?: number;
  lifestealPercent?: number;
  /** Percent of the caster's attack/magicPower used before mitigation; absent = 100. */
  offenseMultiplierPercent?: number;
  /** On a `damage` tick, adds `target.maxHp * maxHpPercent / 100` to `amount`; on a `heal`, floors `amount` at that value. */
  maxHpPercent?: number;
  critChance?: number;
  /** Absent = `BALANCE.combat.defaultCritMultiplierPercent`. */
  critMultiplierPercent?: number;
  /** On success the effect resolves a second time against the same target. */
  extraHitChance?: number;
  /** For an `allEnemies` damage effect: hits per enemy, rolled per enemy, inclusive. Absent = 1. */
  hitCountRange?: { min: number; max: number };
  /** Damage multiplier `1 + stacks * percentPerStack / 100`, counting the target's stacks of `statusEffectId`. */
  scalesWithStatusStacks?: { statusEffectId: Id; percentPerStack: number };
  /** Recasting the same archetype replaces the owner's summon; another archetype is added up to the minion cap (default 1), evicting the oldest. */
  summonCastId?: Id;
  /** Turns this application lasts (also for `alsoApplyStatusEffectIds`); absent = 1. */
  durationTurns?: number;
  /** Turns the status an on-hit rider applies lasts on each hit target; absent = 1. */
  onHitDurationTurns?: number;
  /** Per-effect target override; only `self`/`all*` kinds resolve, a `single*` override is skipped. */
  target?: SkillTarget;
  /** Filters the skill's already-resolved targets by side, relative to `isPlayerSide`, not the caster. */
  appliesToRelation?: "ally" | "enemy";
  /** For `modifyCombatStat`: delta is the larger magnitude of `amount` or `actorStat * minPercent / 100`, sign kept. */
  minPercent?: number;
  /** Absent = "physical". */
  damageType?: DamageType;
  /** The status expires with the summon this skill casts; the `summon` effect must resolve first. */
  linksToCasterSummon?: boolean;
  excludesSummonTargets?: boolean;
  /** For `summonMonster`: the normal-role archetype spawned into the running combat. */
  monsterArchetypeId?: Id;
  /** For `summonMonster`: how many to spawn, before the per-summoner cap. */
  count?: number;
  /** For a `damage` effect: adds `percentPerDebuff` to its offense multiplier for each harmful status the target carries when the hit lands (a stackable status counts once). */
  scalesWithDebuffCount?: { percentPerDebuff: number };
  /** One die's faces, as percents of the offense multiplier. On a `damage` effect one face is rolled per target; on a `throwDice` effect one face is rolled per die thrown. */
  damageRollFaces?: number[];
  /** For `throwDice`: every second die scales off magic power (`damageType: "magic"`) instead of attack. */
  alternatesWithMagic?: boolean;
  /** For `applyStatusEffect`: how many stacks one application adds, rolled within the range (a stackable status). */
  stackCount?: { min: number; max: number };
  /** For `applyStatusEffect` with `stackCount`: each stack past the status's `maxStacks` strikes another random enemy instead, at most `maxHitsPerTarget` times each. */
  overflowDamage?: { amount: number; offenseMultiplierPercent: number; maxHitsPerTarget: number };
  /** For `removeStatusEffect`: takes off this many stacks of `statusEffectId` rather than the whole status. */
  stacks?: number;
  /** For `removeStatusEffect`: takes off every harmful damage-over-time status the target carries. */
  removesHarmfulDots?: boolean;
  /** For `heal`: adds this percent of the caster's own max HP. */
  casterMaxHpPercent?: number;
  /** For `heal`: raises the heal by up to `maxBonusPercent`, growing evenly as the recipient's HP falls from full to `fullBonusBelowHpPercent` of its max. */
  lowHpHealBonus?: { maxBonusPercent: number; fullBonusBelowHpPercent: number };
  /** Leaves the caster out of this effect when the skill's own target includes it (Battle Ballad's "the rest of the party"). */
  excludesCaster?: boolean;
  /** For `commandSummons`: the commanded minion skill's damage and healing, both flat and scaled, at this percent. */
  powerPercent?: number;
}

export type SummonSourceStat = "maxHp" | "attack" | "defense" | "magicPower";

/** Value = `base + percent / 100 * owner[sourceStat]`; a tuple `percent` is indexed by the casting skill's rank. */
export interface SummonStatFormula {
  base: number;
  percent: number | [number, number, number];
  sourceStat: SummonSourceStat;
}

/** Shared by all 3 ranks of `skillId`; that skill's effective rank picks from any per-rank tuple. */
export interface SummonCast {
  id: Id;
  skillId: Id;
  archetypeId: Id;
  maxActions: number;
  stat: Record<SummonSourceStat, SummonStatFormula>;
  aggro: number;
  /** AoE burst when the summon dies or runs out of `maxActions`, never on dismiss/replace; tuples resolve by rank and are frozen onto `Summon.deathBurst` at spawn. */
  onDeath?: {
    offenseMultiplierPercent: number | [number, number, number];
    amount: number | [number, number, number];
    sourceStat: SummonSourceStat;
    statusEffectId?: Id;
    statusEffectChance: number | [number, number, number];
    durationTurns?: number;
  };
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
}

/** Conditions a monster skill's `aiCondition` / `aiRules[].if` / `targetRules[].if` can test; every field present must hold (`monsterAiRules.ts`). */
export interface MonsterAiPredicate {
  selfHpBelowPercent?: number;
  selfHasStatusId?: Id;
  selfLacksStatusId?: Id;
  targetHasStatusId?: Id;
  targetLacksStatusId?: Id;
  targetHpBelowPercent?: number;
  targetsBelowHpPercent?: number;
  atLeast?: number;
  alliesFewerThan?: number;
}

/** Multiplies a candidate's weight by `weightMultiplier` while `if` holds. */
export interface MonsterAiRule {
  if: MonsterAiPredicate;
  weightMultiplier: number;
}

/** From `hpBelowPercent` of max HP down, `weights` replace the tier's action table; `onEnterSkillId` is cast on the turn the phase is entered. */
export interface MonsterPhase {
  tier: MonsterTier;
  hpBelowPercent: number;
  weights: Record<string, number>;
  onEnterSkillId?: Id;
}

/** A breakable shell: while intact each direct hit is capped at a share of max HP and counts toward breaking it; breaking stuns the bearer, and it reforms later (`monsterShell.ts`). */
export interface MonsterShellDefinition {
  hitsToBreak: { min: number; max: number };
  hitDamageCapMaxHpPercent: number;
  breakStatusId: Id;
  breakDurationTurns: number;
  reformAfterOwnTurns: number;
}

/** The runtime state of a monster's shell. */
export interface MonsterShellState {
  state: "intact" | "broken";
  hitsLeft: number;
  ownTurnsSinceBreak: number;
}

export interface SkillDefinition {
  id: Id;
  name: string;
  description: string;
  shortDescription?: string;
  mpCost: number;
  target: SkillTarget;
  effects?: SkillEffect[];
  slot: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  unlockLevel: number;
  /** Set only on the stand-in skill for a used item: item damage and heals never crit. */
  fromItem?: true;
  usesPerCombat?: number;
  cooldownTurns?: number;
  isUltimate?: boolean;
  isBuff?: boolean;
  isMagic?: boolean;
  ranks?: SkillRankDefinition[];
  conditionalBonus?: { requiresStatusId: Id; ignoreDefensePercentBonus: number; consumesStatus?: boolean };
  /** Bonus damage while the target's HP is below `hpPercentThreshold` of its maxHp; unrelated to the Boss execute charge. */
  executeBonus?: { hpPercentThreshold: number; bonusDamagePercent?: number; bonusDamageFlat?: number };
  /** While the caster's HP is below `hpPercentThreshold` (of its own maxHp) when the skill resolves, every `damage` effect gains `offenseMultiplierPercentBonus` and heals the caster for `lifestealPercent` of what it deals. */
  casterHpBelowBonus?: { hpPercentThreshold: number; offenseMultiplierPercentBonus: number; lifestealPercent?: number };
  /** One roll per cast: on a win every `damage` effect uses `winOffenseMultiplierPercent`, on a loss `loseOffenseMultiplierPercent`, and a loss also puts `loseSelfStatusEffectId` on the caster. A loss is a lost gamble (`PassiveSkillDefinition.gambleStatusEffectId`). */
  coinFlip?: CoinFlip;
  /** Dice added to the caster's hand once the skill is cast (`CharacterClass.dice`), up to the hand's limit. */
  grantsDice?: number;
  /** While this skill is queued, every other character of the party gets this much speed for this round's turn order. */
  allyTurnOrderBonus?: number;
  /** HP the cast costs on top of its MP, as a percent of max HP: `atFullHpPercent` at full HP, falling evenly to `atLowHpPercent` at `lowHpBelowPercent` of max HP and below. It never drops the caster below 1 HP. */
  hpCost?: { atFullHpPercent: number; atLowHpPercent: number; lowHpBelowPercent: number };
  /** Lands on enemies with no accuracy roll and cannot be dodged, without being an ultimate. */
  alwaysHits?: boolean;
  /** A `singleAlly` skill that cannot be cast on the caster. */
  targetsOtherAlliesOnly?: boolean;
  /** Monster skills only: the skill is a candidate only while this holds (`monsterAiRules.ts`). */
  aiCondition?: MonsterAiPredicate;
  /** Monster skills only: each matching rule multiplies the skill's weight in the pick. */
  aiRules?: MonsterAiRule[];
  /** Monster skills only: each matching rule multiplies a candidate target's weight. */
  targetRules?: MonsterAiRule[];
  /** Monster skills only: a charge turn that locks its target(s), then releases on the monster's next unstunned turn. */
  telegraph?: boolean;
  /** Monster skills only: effects resolved on the caster during a telegraph's charge turn. */
  chargeEffects?: SkillEffect[];
  /** Monster skills only, on a `singleEnemy` skill: hits this many distinct enemies. */
  targetCount?: { min: number; max: number };
  /** Monster skills only: the cooldown the skill starts the fight on, so it cannot open the fight. */
  initialCooldownTurns?: number;
}

/**
 * One roll per cast, at `winChance` times the caster's `coinFlipWinChanceMultiplier` statuses (at most 1).
 * A win resolves the skill as written; a loss skips every `damage` effect, puts each `loseSelfStatuses`
 * entry on the caster and, with `resetCooldownOnLose`, leaves the skill ready again.
 */
export interface CoinFlip {
  winChance: number;
  loseSelfStatuses?: { statusEffectId: Id; durationTurns: number }[];
  resetCooldownOnLose?: boolean;
}

export interface PassiveRankDefinition {
  rank: 1 | 2 | 3;
  unlockLevel: number;
  maxHpPercent?: number;
  defensePercent?: number;
  aggroFlat?: number;
  onHitStatusEffectId?: Id;
  durationTurns?: number;
  bonusPercent?: number;
  bonusFlat?: number;
  healBoostPercent?: number;
  debuffResistPercent?: number;
  hpThresholdPercent?: number;
  thresholdStatusEffectId?: Id; // kept applied while HP is below hpThresholdPercent
  procChancePercent?: number;
  critChancePercent?: number;
  critMultiplierPercent?: number;
  dodgePercent?: number;
  secondCloneChancePercent?: number;
  minionMaxHpPercent?: number;
  minionAttackPercent?: number;
  maxActiveMinions?: number;
  growthSwapWeights?: { low: number; high: number }; // the two growth weights `growthSwapStats` trade between each round
  reflectPercent?: number;
  stackBurstPowerPercent?: number; // the free cast's power, as a percent of the skill's own damage
}

/** A stat a class passive can shift the level growth of mid-fight (`PassiveSkillDefinition.growthSwapStats`). */
export type GrowthSwapStat = "attack" | "magicPower";

export interface PassiveSkillDefinition {
  id: Id;
  name: string;
  description: string;
  ranks: PassiveRankDefinition[]; // exactly 3
  requiresTargetStatusId?: Id; // also matches a rankOf variant of this status
  bonusDamageType?: DamageType;
  selfDamagePerHitMaxHPPercent?: number;
  maxClones?: number;
  cloneSummonCastId?: Id; // the cast the second-clone proc spawns; maxClones counts its archetype
  secondCloneName?: string;
  debuffPool?: Id[];
  ignoresFearEffects?: boolean; // fear still builds, but none of its combat penalties apply
  stackBurst?: { statusEffectId: Id; atStacks: number; removeStacks: number; skillId: Id }; // a target reaching `atStacks` of the status loses `removeStacks` of them and takes a free cast of `skillId`
  growthSwapStats?: [GrowthSwapStat, GrowthSwapStat]; // the two stats whose growth weights trade places at random each round
  growthSwapStatusIds?: Record<GrowthSwapStat, { up: Id; down: Id }>; // the round-long statuses that carry each stat's shift, one per direction
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
  roleTags: string[];
  baseMaxHp: number;
  baseMaxMp: number;
  baseAttack: number;
  baseDefense: number;
  baseAggro: number;
  baseSpeed: number;
  baseMagicPower: number;
  skills: SkillDefinition[];
  passiveSkill: PassiveSkillDefinition;
  /** A hand of dice the class carries through a fight: `startCount` at the start of every combat, at most `maxCount`; a `throwDice` effect lands at most `maxPerTarget` of them on one enemy. */
  dice?: { startCount: number; maxCount: number; maxPerTarget: number };
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
  /** Dice in hand during a fight, for a class with `CharacterClass.dice`; absent outside combat. */
  dice?: number;
  equippedArtifactIds: Id[];
  /** Fixed at character select for the whole run; `null`/absent = none. */
  equippedAbilityId?: Id | null;
}

export interface StatusEffectDefinition {
  id: Id;
  name: string;
  description: string;
  perTurnEffects: SkillEffect[];
  onHitStatusEffectId?: Id;
  onHitAoeDamage?: { amount: number; isMagic?: boolean; ignoreDefensePercent?: number; offenseMultiplierPercent?: number; damageType?: DamageType };
  accuracyPenaltyPercent?: number;
  stuns?: boolean;
  vulnerableTo?: { statusEffectId: Id; multiplier: number };
  rankOf?: Id;
  rankLevel?: 2 | 3 | 4 | 5 | 6;
  /** Overrides the countdown schedule inferred from `perTurnEffects`' shape. */
  tickCategory?: "dot" | "statMod" | "special";
  stackable?: boolean;
  maxStacks?: number;
  /** Each stack beyond the first multiplies `damage` ticks by `1 + perStackBonusPercent / 100`. */
  perStackBonusPercent?: number;
  /** The bearer attacks the next monster to act first, and a hit cancels that monster's turn; spent after one shot, hit or miss. */
  triggersOverwatch?: boolean;
  /** Absent = a plain basic-attack-strength shot. */
  overwatchShot?: { amount: number; offenseMultiplierPercent: number };
  /** 0-1 chance a landed Overwatch shot cancels the turn; absent = always. */
  interruptChance?: number;
  untargetable?: boolean;
  /** The status is removed the instant the bearer lands an attack, and that attack gets this bonus. */
  breakBonus?: { basicAttackGuaranteedCrit?: boolean; skillDamageBonusPercent?: number };
  dodgePercent?: number;
  /** Shown as a debuff and cleansable even when the status changes no stat, ticks or stuns (a tag such as `marked`). */
  harmful?: boolean;
  /** When the bearer takes direct damage, it deals this percentage of that damage back to the attacker. Status ticks are never reflected. */
  reflectDamagePercent?: number;
  /** When a monster's direct hit lands on the bearer, the bearer strikes back at every enemy; after `maxCounters` counters the status ends. */
  counterAttack?: { maxCounters: number; amount: number; offenseMultiplierPercent: number };
  /** For a stackable status: the moment it reaches `maxStacks`, every stack goes and the bearer gets this status instead. */
  onMaxStacks?: { statusEffectId: Id; durationTurns: number };
  /** While the bearer carries this status, its basic attack (slot 0) becomes this strike instead. */
  basicAttackOverride?: { name: string; amount: number; offenseMultiplierPercent: number; damageType?: DamageType; isMagic?: boolean };
  /** Reduces every fear gain on the bearer by this percent, combined with its fearResist. */
  fearResistPercent?: number;
  /** Each time the bearer acts (not when it loses the turn), rolls `chance` to apply `statusEffectId` to itself for `durationTurns`. */
  onActStatus?: { statusEffectId: Id; chance: number; durationTurns: number };
  /** The bearer can only use its basic attack. An elite or boss still releases a charged telegraph. */
  silences?: boolean;
  /** On an elite or boss, no application of this status lasts longer than this many turns. */
  eliteBossMaxTurns?: number;
  /** The bearer's single-target attacks all go to whoever applied the status, while that one can be targeted. */
  forcesTargetOnSource?: boolean;
  /** Each attack the bearer makes has this chance (0–1) to go to its own side instead: another monster, or itself when it stands alone. */
  redirectToAlliesChance?: number;
  /** When a monster's direct hit lands on the bearer, the attacker gets this status. */
  debuffsAttackerOnHit?: { statusEffectId: Id; durationTurns: number };
  /** Should the bearer fall while it lasts, it gets back up at this percent of its max HP, and the status is spent. */
  reviveHpPercent?: number;
  /** Each direct hit the bearer survives heals it for this percent of the HP the hit took. */
  healOnHitPercent?: number;
  /** The bearer is channeling this skill: each of its own turns repeats the skill's heal and damage effects instead of acting, until the status ends or the channel is broken. */
  channelSkillId?: Id;
  /** Taken off the bearer when its fight ends, whatever turns it has left (a status that only means something inside a fight). */
  endsWithCombat?: boolean;
  /** Multiplies the bearer's `coinFlip` win chance. */
  coinFlipWinChanceMultiplier?: number;
}

export type ItemTier = "common" | "uncommon" | "rare" | "unique" | "epic" | "legendary";

export interface ItemDefinition {
  id: Id;
  name: string;
  description: string;
  target: SkillTarget;
  effects: SkillEffect[];
  tier: ItemTier;
  /** A trophy: an effect-less barter token dropped only by these monsters. */
  archetypeIds?: Id[];
  /** A trophy shared by one race's monsters; drop weight scaled by `BALANCE.items.groupDropMultiplier`. */
  groupItem?: boolean;
  combatUsable?: boolean;
}

export type ArtifactRarity = "common" | "rare" | "unique" | "epic";

export type ArtifactEffect =
  /** `minPercent`: boost is the larger of `amount` or `base * minPercent / 100`, `base` being the class-plus-level stat before any modifier. */
  | { kind: "statBoost"; stat: "attack" | "defense" | "maxHp" | "maxMp" | "magicPower" | "speed"; amount: number; minPercent?: number }
  | { kind: "reflectDamage"; percent: number }
  /** `chance` is a percent per damaging hit. */
  | { kind: "poisonOnHit"; chance: number; statusEffectId: Id; durationTurns: number }
  | { kind: "lifesteal"; percent: number }
  | { kind: "dodgeChance"; chance: number }
  /** `minPercent` floors the heal at `baseMaxHp * minPercent / 100` (class-plus-level max HP, not the live one). */
  | { kind: "healOnKill"; amount: number; minPercent?: number }
  /** With `offenseMultiplierPercent`, a mitigated hit scaling off the bearer's base attack/magicPower; absent = fixed, unmitigated `amount`. */
  | { kind: "autoDamage"; amount: number; offenseMultiplierPercent?: number; isMagic?: boolean }
  | { kind: "expBoost"; percent: number }
  | { kind: "fearResist"; percent: number }
  | { kind: "cooldownReduction"; turns: number }
  /** Percent chance the bearer's hit and debuff rolls succeed outright; independent chances across sources. */
  | { kind: "alwaysHit"; chance: number }
  /** Relative cut to enemy debuff land chance (60% at 30 becomes 42%; no `chance` counts as 100%); stacks multiplicatively. */
  | { kind: "debuffResist"; percent: number }
  | { kind: "curseAggroBoost"; amount: number };

export interface ArtifactDefinition {
  id: Id;
  name: string;
  description: string;
  rarity: ArtifactRarity;
  effects: ArtifactEffect[];
  isCursed?: boolean;
  /** Excluded from every roll except these sources, opted into via `rollArtifact`'s `allowRestrictedSource` (the "boss" table alone doesn't imply a Boss kill). */
  restrictedDropSources?: ("boss" | "blood-altar")[];
}

/** An `aggro` statBoost, which `ArtifactEffect` reserves for the cursed `curseAggroBoost`. */
export type AbilityOnlyEffect = { kind: "statBoost"; stat: "aggro"; amount: number; minPercent?: number };

export type AbilityEffect = Exclude<ArtifactEffect, { kind: "curseAggroBoost" }> | AbilityOnlyEffect;

export interface AbilityDefinition {
  id: Id;
  name: string;
  description: string;
  rarity: ArtifactRarity;
  effects: AbilityEffect[];
}

/** Persisted outside any run's `SaveFile`; survives permadeath's `deleteSlot`. */
export interface AbilityProfile {
  version: number;
  unlockedAbilityIds: Id[];
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
  | "coinGamble"
  /** Shown at a fixed point (the-gatekeeper), never rolled into a room. */
  | "scripted";

/** `outcome` is compared against `GameState.eventOutcomes[eventId]`. */
export interface EventOutcomeCondition {
  eventId: Id;
  outcome: string;
}

/** First match wins, so a more specific condition must come before a general one on the same event. */
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
  minFloorDepth?: number;
  onceLifetime?: boolean;
  /** Grants an Artifact at no cost with no decline; every resolution counts toward `freeRewardsTakenCount`. */
  freeTake?: boolean;
  /** The reflection shows only when `GameState.eventOutcomes[id]` holds this tag. */
  reflectionRequiresOutcome?: string;
  /** Leaves the roll pool for good once the founder falls. */
  removedOnFounderVictory?: boolean;
  noArtifactReward?: boolean;
  /** `instantReward` only: grant this artifact instead of rolling; ignored with `noArtifactReward`. */
  guaranteedArtifactId?: Id;
  guaranteedItems?: { itemId: Id; count: number }[];
  /** Replaces "Open the chest" on `eventOpenChest` for a scene that isn't a chest. */
  instantRewardActionLabel?: string;
  /** Replaces `description` from the 2nd encounter on; the object form branches on the last visit's outcome. */
  returnDescription?: string | Record<"won" | "lost" | "declined", string>;
  /** Appended to `returnDescription` by the party's dominant reflection stance; flavor only. */
  stanceEcho?: { curious: string; wary: string; dismissive: string };
  /** Appended to a `returnDescription` visit once `eventOutcomes["camp-reflection"]` is "unaware"; `crossEventVariants` only cover the first meeting. */
  campReflectionUnawareEcho?: string;
  /** Replaces `description` once `narrativeCounters.guardianFightsSkipped` reaches 2. */
  chainBuildupDescription?: string;
  /** Replaces `description` at the forced threshold, where Skip is rejected. */
  chainForcedDescription?: string;
  /** Replaces `chainForcedDescription` once `guardianGrudgeFiredCount >= 1` and past `events.chainTier2MinFloorDepth`. */
  chainForced2Description?: string;
  /** Replaces `chainForced2Description` once `guardianGrudgeFiredCount >= 2` and past `events.chainTier3MinFloorDepth`. */
  chainForced3Description?: string;
  /** Replaces `description` once the event's `narrativeCounters` threshold is crossed; permanent. */
  chainEscalatedDescription?: string;
  /** Replaces `chainEscalatedDescription` past the tier-2 threshold and `events.chainTier2MinFloorDepth`; permanent. */
  chainEscalated2Description?: string;
  /** Replaces `chainEscalated2Description` past the tier-3 threshold and `events.chainTier3MinFloorDepth`; permanent. */
  chainEscalated3Description?: string;
  /** Checked after all chain states, before `descriptionVariants`. */
  crossEventVariants?: CrossEventVariant[];
  /** Picked uniformly with `description` as option 0, pinned per room via `Room.descriptionVariantIndex`. */
  descriptionVariants?: string[];
  /** `escalated*Prompt` shows when that escalation tier is what just resolved. */
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
  stacks?: number;
  /** Deltas actually applied by `modifyCombatStat`, undone exactly on expiry since the stat may have moved in between. */
  appliedAmounts?: Partial<Record<CombatStat, number>>;
  /** Force-expired the instant this summon leaves combat. */
  linkedSummonId?: Id;
  /** Caster's magicPower at application, so `heal` ticks scale off the caster rather than the bearer. */
  sourceMagicPower?: number;
  onHitDurationTurns?: number;
  /** For a status with `counterAttack`: how many counters it has struck so far. */
  countersStruck?: number;
  /** For a status with `forcesTargetOnSource`: the id of the actor that applied it. */
  sourceId?: Id;
}

export interface ShopOffer {
  itemId: Id;
  /** A lot of `BALANCE.runner.lotSize` of the same item instead of a single one. */
  lot: boolean;
  sold?: boolean;
}

export interface BarterOffer {
  itemId: Id;
  done?: boolean;
}

export interface RestRunner {
  roomId: Id;
  noticeShown: boolean;
  /** Kept so the appearance text survives save/load. */
  noticeVariant: number;
  offers: ShopOffer[];
  refreshCount: number;
  /** Empty once the floor's barter has been used. */
  barterOffers?: BarterOffer[];
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
  chainVariant?: "buildup" | "forced" | "forced2" | "forced3";
  /** Index into `[event.description, ...event.descriptionVariants]`; undefined when the event has no variants. */
  descriptionVariantIndex?: number;
}

export interface Floor {
  depth: number;
  rooms: Room[];
  entryRoomId: Id;
}

export type MonsterAiPattern = "aggressive" | "defensive" | "opportunistic";

/** Its `monsterGrowthWeights` multipliers sum to 3. */
export type MonsterType = "balanced" | "tanky" | "armored" | "striker" | "glass" | "bruiser" | "sentinel";

export interface RaceProfile {
  // Recommended 10-100 per entry; the merged race+subRace+traits value is clamped to 0-100.
  resistPercent?: Partial<Record<DamageType, number>>;
  // Recommended 10-50 per entry; the merged value is clamped to 0-100.
  weakPercent?: Partial<Record<DamageType, number>>;
  statBuff?: {
    maxHpPercent?: number;
    attackPercent?: number;
    defensePercent?: number;
    speedFlat?: number;
  };
}

export interface SubRaceDefinition {
  id: Id;
  name: string;
  /** resistPercent/weakPercent keys override the parent race's; statBuff fields add to it. */
  profile: RaceProfile;
}

export interface RaceDefinition {
  id: Id;
  name: string;
  profile: RaceProfile;
  subRaces: SubRaceDefinition[]; // 1-3 entries
}

export interface TraitDefinition {
  id: Id;
  name: string;
  profile: RaceProfile; // added on top of the resolved race+subRace profile
}

export interface MonsterArchetype {
  id: Id;
  name: string;
  description: string;
  baseHp: number;
  baseAttack: number;
  baseDefense: number;
  baseSpeed: number;
  monsterType: MonsterType;
  aiPattern: MonsterAiPattern;
  /** Exactly one of `["normal"]`, `["normal","elite","boss"]`, `["elite","boss"]`, or `["boss"]` with `finalBoss`; must match `actionWeights`' keys. */
  roles: MonsterTier[];
  /** Never enters any random roll. */
  finalBoss?: boolean;
  /** A skill is usable at a tier when that tier's `actionWeights` name it. */
  skillIds: Id[];
  expReward: number;
  /** Elite/boss phases: each replaces its tier's weights once HP falls below its threshold. */
  phases?: MonsterPhase[];
  /** `"random"`: targets are picked uniformly, ignoring aggro. */
  targeting?: "random";
  /** A breakable shell the monster carries from spawn. */
  shell?: MonsterShellDefinition;
  powerTier?: "weak" | "medium" | "strong";
  /** Per tier: "basicAttack" or a `skillIds` id mapped to its relative weight; keys are validated on load. */
  actionWeights?: Partial<Record<MonsterTier, Record<string, number>>>;
  race: Id;
  subRace?: Id;        // must belong to that race's subRaces if present
  traitIds?: Id[];      // default []
  /** Multiple of 10; never picked at random below this depth. Absent only on the final boss. */
  minFloor?: number;
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
  tier: MonsterTier;
  monsterType: MonsterType;
  aiPattern: MonsterAiPattern;
  race: Id;
  subRace?: Id;
  traitIds?: Id[];
  activeStatusEffects: ActiveStatusEffect[];
  expReward: number;
  /** Turns left on each skill's cooldown. */
  skillCooldowns?: Record<Id, number>;
  /** How many times each skill with `usesPerCombat` has been cast. */
  skillUses?: Record<Id, number>;
  /** Indexes into the archetype's `phases` already entered. */
  enteredPhaseIndexes?: number[];
  /** The telegraphed skill being charged and the targets it locked. */
  charging?: { skillId: Id; targetIds: Id[] };
  /** The monster that summoned this one; it falls when its summoner does. */
  summonerId?: Id;
  /** Present on a shell bearer. */
  shell?: MonsterShellState;
}

/** Player-side combatant from a skill; gone once `actionsTaken` reaches `maxActions` (a stunned turn doesn't count) or `hp` hits 0. */
export interface Summon {
  id: Id;
  ownerId: Id;
  archetypeId: Id;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  magicPower: number;
  aggro: number;
  speed: number;
  activeStatusEffects: ActiveStatusEffect[];
  actionsTaken: number;
  maxActions: number;
  /** Spawned by the owner's passive: a recast never replaces it and it doesn't count toward the minion cap. */
  fromPassive?: boolean;
  /** Frozen from `SummonCast.onDeath` at spawn; `offensiveStatOverride` is the owner's stat at cast time. */
  deathBurst?: {
    amount: number;
    offenseMultiplierPercent: number;
    offensiveStatOverride: number;
    statusEffectId?: Id;
    statusEffectChance: number;
    durationTurns?: number;
  };
}

export interface SummonArchetype {
  id: Id;
  name: string;
  /** Independent of the owner's speed; its first action, right after the cast, ignores speed. */
  speed: number;
  /** Same as `MonsterArchetype.actionWeights`, without the tier level. */
  actionWeights?: Record<string, number>;
  signatureSkillIds?: Id[];
  /** Never acts and `actionsTaken` never increments, so it only leaves by dying. */
  passive?: boolean;
  /** `chance` is 0-1. */
  basicAttackOnHit?: { statusEffectId: Id; chance: number; durationTurns: number };
}

export type CombatantRef = { kind: "character"; id: Id } | { kind: "monster"; id: Id } | { kind: "summon"; id: Id };

export interface Combatant {
  ref: CombatantRef;
  speed: number;
}

/** A Command cast (`commandSummons`): which of the caster's minions it orders, and which of that minion's signature skills it casts. */
export interface CommandOrder {
  summonId: Id;
  skillId: Id;
}

export type ActionSource = { kind: "skill"; skillId: Id; command?: CommandOrder } | { kind: "item"; itemId: Id };

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
  /** Characters only. */
  fear?: number;
  activeStatusEffects?: ActiveStatusEffect[];
  /** Monsters only: the state of a shell bearer's shell. */
  shell?: MonsterShellState;
}

export interface PartyStateSnapshot {
  coins: number;
  partyExp: number;
  satiety: number;
}

/**
 * One actor's action (or one actor-less tick block); every `LogEntry` it produces shares this object.
 * Ids are battlefield unit ids, so a summon is recorded as its owner.
 */
export interface LogSession {
  /** Index in `CombatState.log` of its first entry; stable across a save round trip. */
  id: number;
  actorId: Id | null;
  /** Opposing-side targets of a damaging skill, hit or missed. */
  attackedIds: Id[];
  /** Opposing-side targets of a skill with no damage. */
  debuffedIds: Id[];
  buffedIds: Id[];
  healedIds: Id[];
  /** Opposing-side targets whose attack or debuff missed or was dodged. */
  missedIds: Id[];
  /** Healed by lifesteal, not by any other self-heal. */
  lifestealIds: Id[];
  /** DoT sessions only: units a damage tick actually lowered. */
  tickDamageIds: Id[];
  buffLostIds: Id[];
  /** Stunned, too afraid to act, or interrupted by an Overwatch shot. */
  lostTurnIds: Id[];
  /** Owners whose summon took part; not set for the session that summons it. */
  summonIds: Id[];
  /** Lit without a role: DoT ticks, dying damage, an artifact's bearer, an expiring summon's owner. */
  affectedIds: Id[];
  /** Shown a beat after the character's other changes. */
  fearChangedIds: Id[];
  debuffLandedIds: Id[];
  dotLandedIds: Id[];
  /** Fully resisted a DoT by race; filled from the entries' `statusImmuneOf`. */
  immuneIds: Id[];
  /** What an actor-less session was, so its lit units get the matching icon. */
  cause?: "dot" | "dying" | "artifact" | "fear";
}

export interface HitMark {
  amount: number;
  /** Absent = the target took all of `amount`; a hit after the target has fallen is all overkill. */
  overkill?: number;
  crit?: true;
}

export interface LogEntry {
  text: string;
  kind: LogEntryKind;
  snapshot?: CombatantSnapshot[];
  partySnapshot?: PartyStateSnapshot;
  session?: LogSession;
  /** Carries a session that has no line to show; never rendered. */
  hidden?: true;
  /** Direct hits only, not damage-over-time ticks. */
  hit?: HitMark & { targetId: Id };
  healCritOf?: Id;
  /** Unit (a summon's owner) that lost a status whose `statusRole` is "buff". */
  buffLostOf?: Id;
  buffLostOfSummon?: true;
  /** Opposing-side unit (a summon's owner) a debuff or DoT landed on. */
  statusLandedOf?: Id;
  statusLanded?: "debuff" | "dot";
  /** Opposing-side unit immune to the DoT aimed at it. */
  statusImmuneOf?: Id;
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
  /** Snapshots keep showing departed summons: HP unchanged for a fade-away, 0 for a death. */
  departedSummons?: { id: Id; hp: number; maxHp: number }[];
  /** Transient: built while an actor's turn runs (`runInSession`). */
  activeSession?: LogSession;
  /** Characters whose player chose, this round, to keep channeling rather than break the channel. */
  heldChannelIds?: Id[];
  outcome?: "victory" | "defeat";
}

export interface GameState {
  runId: string;
  party: Character[];
  floor: Floor;
  currentRoomId: Id;
  roomPath: Id[];
  combat: CombatState | null;
  message: string;
  /** All but "victory"/"defeat" are terminal story endings; "leaveAmbushed" is unresolved fate, not a death. */
  gameOver: "victory" | "defeat" | "stay" | "letGo" | "leaveAmbushed" | "leaveEscaped" | null;
  /** Set on beating floor 100's boss and blocks normal play until `Game.pickEndingChoice()`; the offered endings are computed live, never stored. */
  pendingEndingCheckpoint: boolean;
  /** Never reset; read at floor-120 entry to decide whether the founder encounter fires. */
  continuedPastCheckpoint: boolean;
  /** The founder's pre-fight scene, shown before `Game.enterFounderFight()`; blocks everything else. */
  pendingFounderDialogue: boolean;
  /** Blocks floor 1's entry ambush until `Game.enterDungeon()` clears it. */
  pendingGatekeeper: boolean;
  gatekeeperAnswer: "paid" | "refused" | null;
  /** Floor-1 rooms the blessing still covers, counted on entry; rest rooms don't count. */
  blessingRoomsLeft: number;
  /** A fight that starts in this room starts with the blessing applied. */
  blessedRoomId: Id | null;
  /** From the on-disk profile at run start; only fills in `the-one-who-stayed`'s text, never gates it. */
  retiredCharacterClassId: Id | null;
  partyExp: number;
  inventory: Record<Id, number>;
  coins: number;
  satiety: number;
  pendingArtifactDecision?: { artifactId: Id; forceEquip: boolean } | null;
  /** Gambling Den's 2nd jackpot artifact, waiting until the 1st is resolved. */
  secondJackpotArtifactId?: Id | null;
  activeEvent?: { eventId: Id; offerArtifactIds: Id[]; gambleState?: { round: number; pot: number; maxRounds: number }; refreshCount?: number } | null;
  /** Rolled once on entering an uncleared Rest room; `null`/absent when no Runner is there. */
  restRunner?: RestRunner | null;
  /** Applied when this floor's elite/boss combat starts; dropped if the floor ends first. */
  pendingBarterBuffs?: Id[];
  /** Later Rest rooms on this depth offer no barter. */
  barterUsedDepth?: number | null;
  lastRoomDrops: { itemIds: Id[]; artifactIds: Id[]; abilityIds: Id[] } | null;
  /** Drives the "return" text of merchant/wandering-hermit/gambling-den. */
  metNarrativeNpcIds: Id[];
  /** "declined" covers leaving before any round was played. */
  lastGamblingDenOutcome?: "won" | "lost" | "declined";
  /** Never decrease, except `guardianFightsSkipped`, which resets to 0 once its forced encounter is entered. */
  narrativeCounters: {
    guardianFightsSkipped: number;
    artifactsSacrificed: number;
    altarPaymentsCount: number;
    /** Forced guardian encounters entered; never resets, unlike `guardianFightsSkipped`. */
    guardianGrudgeFiredCount: number;
    /** Resolved `freeTake` events. */
    freeRewardsTakenCount: number;
  };
  pendingReflection?: { eventId: Id } | null;
  eventReflectionStances: Partial<Record<Id, "curious" | "wary" | "dismissive">>;
  /** Events resolved from `LORE_EXPOSURE_EVENT_IDS`; never decreases. */
  loreExposureCount: number;
  /** Set on rest-room entry when a new tier exceeds the highest answered one; skipped while `pendingReflection` is set. */
  pendingCampReflectionTier: 1 | 2 | 3 | 4 | null;
  /** The omen picked on a milestone-floor boss victory; cleared by `Game.dismissFloorMilestoneMessage()`. */
  pendingFloorMilestoneOmenId?: Id | null;
  /** In order; keeps an omen from repeating and lets one held back to its `maxFloor` show there. */
  shownFloorMilestoneIds: Id[];
  campReflectionChoices: Partial<Record<1 | 2 | 3 | 4, 0 | 1 | 2>>;
  /** Set once an event's defining choice resolves; most get the generic "resolved" from `closeEvent()`. */
  eventOutcomes: Partial<Record<Id, string>>;
  /** `onceLifetime` events already fired, plus every `removedOnFounderVictory` id once the founder falls; excluded from future rolls. */
  firedOnceEventIds: Id[];
  /** 1 per Boss kill; spent only in this run's death flow. */
  runStardust: number;
  /** Set at a party wipe when a non-common ability was lost; walks through reclaiming each entry. */
  pendingAbilityBuyback?: { entries: { characterId: Id; lostAbilityId: Id; rarity: Exclude<ArtifactRarity, "common"> }[]; resolvedIndex: number } | null;
  abilityDeathResults?: { characterId: Id; lostAbilityId: Id; outcome: "reclaimed" | "lost" }[] | null;
}
