import type { Character, CombatantRef, SkillDefinition, ItemDefinition, Id, CommandOrder } from "../types";
import { getSkill, getEffectiveSkill } from "../data/classes";
import { getItem } from "../data/items";
import { withBasicAttackOverride } from "../engine/combat";
import { getEvent } from "../data/events";

export type PickTargetSource =
  | { kind: "skill"; skill: SkillDefinition }
  | { kind: "item"; item: ItemDefinition }
  /** A Command cast: `skill` is the minion skill as the caster casts it (`commandedSkill`), `commandSkillId` the Command itself. */
  | { kind: "command"; skill: SkillDefinition; commandSkillId: Id; order: CommandOrder };

export type ItemDetailOrigin = { kind: "combat"; actorRef: CombatantRef } | { kind: "outOfCombat" };

export type ArtifactDetailOrigin = { kind: "owned"; characterId: Id };

export type RewardEntry = { kind: "item"; id: Id; qty: number } | { kind: "artifact"; id: Id } | { kind: "ability"; id: Id };

/** The two HP-paid event kinds share one screen. */
export type HpGambleKind = "hpGamble" | "rescueGamble";

export type UiState =
  | { kind: "room" }
  | { kind: "rest" }
  | { kind: "runnerNotice" }
  | { kind: "runnerShop" }
  | { kind: "runnerSell" }
  | { kind: "runnerBarter" }
  | { kind: "pickAction"; actorRef: CombatantRef }
  | { kind: "pickSkill"; actorRef: CombatantRef }
  | { kind: "pickItemInCombat"; actorRef: CombatantRef }
  | { kind: "pickTarget"; actorRef: CombatantRef; source: PickTargetSource; candidates: CombatantRef[] }
  | { kind: "skillDetail"; actorRef: CombatantRef; skill: SkillDefinition }
  | { kind: "pickCommandMinion"; actorRef: CombatantRef; skill: SkillDefinition }
  | { kind: "pickCommandSkill"; actorRef: CombatantRef; skill: SkillDefinition; summonId: Id }
  | { kind: "roundResolved" }
  | { kind: "combatOver" }
  | { kind: "pickItemOutOfCombat" }
  | { kind: "itemDetail"; item: ItemDefinition; origin: ItemDetailOrigin }
  | { kind: "artifactMenu" }
  | { kind: "artifactDetail"; artifactId: Id; origin: ArtifactDetailOrigin }
  | { kind: "artifactDecision" }
  | { kind: "artifactDecisionPickCharacter" }
  | { kind: "artifactDecisionPickReplace"; characterId: Id }
  | { kind: "saveMenu"; previous: UiState }
  | { kind: "fullLog"; previous: UiState }
  | { kind: "roomReward"; entries: RewardEntry[]; viewing: RewardEntry | null }
  | { kind: "campPrompt" }
  | { kind: "eventInstantReward" }
  | { kind: "eventMerchant"; viewingOfferIndex: number | null }
  | { kind: "eventCursedOffer" }
  | { kind: "eventPairedOffer" }
  | { kind: "eventHpGamble"; gamble: HpGambleKind }
  | { kind: "eventHpGamblePickPayer"; gamble: HpGambleKind }
  | { kind: "eventArtifactSacrifice" }
  | { kind: "eventCoinGamble" }
  | { kind: "eventFortuneExchange" }
  | { kind: "eventFortuneExchangePickArtifact" }
  | { kind: "eventCombatReward" }
  | { kind: "eventReflection" }
  | { kind: "campReflection" }
  | { kind: "floorMilestone" }
  | { kind: "memoryIntro" }
  | { kind: "memory"; previous: UiState; previousPage: number; pages: string[][] }
  | { kind: "endingCheckpoint" }
  | { kind: "founderDialogue" }
  | { kind: "gatekeeper" }
  | { kind: "abilityBuyback" }
  | { kind: "characterInfo"; characterIndex: number; previousUi: UiState }
  | { kind: "gameover" };

export const ARTIFACT_ICON = "✦";
export const ABILITY_ICON = "◆";
export const SUMMON_ICON = "☾";
export const TROPHY_ICON = "⚱";

export function itemIcon(item: ItemDefinition): string {
  if (item.archetypeIds?.length) return TROPHY_ICON;
  if (item.target === "singleEnemy" || item.target === "allEnemies") return "⚔";
  if (item.effects.some((e) => e.kind === "heal" || e.kind === "restoreMp")) return "✚";
  return "↑";
}

export function inventoryEntries(inventory: Record<Id, number>): { item: ItemDefinition; qty: number }[] {
  return Object.entries(inventory)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ item: getItem(id), qty }));
}

export function combatInventoryEntries(inventory: Record<Id, number>): { item: ItemDefinition; qty: number }[] {
  return inventoryEntries(inventory).filter(({ item }) => item.combatUsable !== false);
}

export function buildRewardEntries(drops: { itemIds: Id[]; artifactIds: Id[]; abilityIds: Id[] }): RewardEntry[] {
  const itemQty = new Map<Id, number>();
  for (const id of drops.itemIds) itemQty.set(id, (itemQty.get(id) ?? 0) + 1);
  const entries: RewardEntry[] = [];
  for (const [id, qty] of itemQty) entries.push({ kind: "item", id, qty });
  for (const id of drops.artifactIds) entries.push({ kind: "artifact", id });
  for (const id of drops.abilityIds) entries.push({ kind: "ability", id });
  return entries;
}

export function ownedArtifactEntries(party: Character[]): { character: Character; artifactId: Id }[] {
  return party.flatMap((character) => character.equippedArtifactIds.map((artifactId) => ({ character, artifactId })));
}

export function skillEntries(actor: Character): SkillDefinition[] {
  return actor.unlockedSkillIds.map((id) => {
    const skill = getEffectiveSkill(getSkill(id), actor.level);
    return skill.slot === 0 ? withBasicAttackOverride(skill, actor) : skill;
  });
}

export function eventUiState(eventId: Id): UiState {
  const event = getEvent(eventId);
  switch (event.kind) {
    case "instantReward":
      return { kind: "eventInstantReward" };
    case "merchant":
      return { kind: "eventMerchant", viewingOfferIndex: null };
    case "cursedOffer":
      return { kind: "eventCursedOffer" };
    case "pairedOffer":
      return { kind: "eventPairedOffer" };
    case "fortuneExchange":
      return { kind: "eventFortuneExchange" };
    case "artifactSacrifice":
      return { kind: "eventArtifactSacrifice" };
    case "hpGamble":
    case "rescueGamble":
      return { kind: "eventHpGamble", gamble: event.kind };
    case "coinGamble":
      return { kind: "eventCoinGamble" };
    case "combatReward":
      return { kind: "eventCombatReward" };
    default:
      return { kind: "room" };
  }
}
