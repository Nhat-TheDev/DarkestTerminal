import type { Character, GameState, Id, ItemTier, LogEntry } from "../../types";
import type { EngineContext } from "../combat";
import type { PartyActionError } from "../party";
import { resolveSkillEffect } from "../resolver";
import { BALANCE } from "../../data/balanceConfig";
import { getItem } from "../../data/items";
import { getBarterEntry, type BarterEffect } from "../../data/barter";
import { t } from "../../data/strings";

export function barterBuffFor(itemId: Id): BarterEffect[] {
  return getBarterEntry(itemId).effects;
}

function applyStatus(character: Character, statusEffectId: string, amount?: number): void {
  const quiet: LogEntry[] = [];
  resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId, durationTurns: BALANCE.barter.activeDurationTurns, amount }, character, character, { log: quiet });
}

/** Never below 1 for a raised stat, or a small percent would round away at low stats. */
export function statBonus(percent: number, base: number): number {
  return percent > 0 && base > 0 ? Math.max(1, Math.round((percent / 100) * base)) : 0;
}

/** A stat several buffs raise is applied once with their percents added: a status already active would only refresh. */
export function applyPendingBarterBuffs(state: GameState, ctx: EngineContext, log: LogEntry[]): void {
  const pending = state.pendingBarterBuffs ?? [];
  if (pending.length === 0) return;
  const percentByStat: Record<"attack" | "defense" | "speed", number> = { attack: 0, defense: 0, speed: 0 };
  const regenTiers = new Set<ItemTier>();
  for (const itemId of pending) {
    const tier = getItem(itemId).tier;
    for (const effect of barterBuffFor(itemId)) {
      if (effect.kind === "healOverTime") regenTiers.add(tier);
      else percentByStat[effect.stat] += effect.percent;
    }
  }

  const { defenseMitigationX } = BALANCE.combat;
  for (const character of ctx.party) {
    if (!character.isAlive) continue;
    // Computed from the stats before any buff lands, so one buff never inflates another's base.
    const attackBonus = statBonus(percentByStat.attack, character.attack);
    const magicBonus = statBonus(percentByStat.attack, character.magicPower);
    const defenseBonus = statBonus(percentByStat.defense, defenseMitigationX + character.defense);
    const speedBonus = statBonus(percentByStat.speed, character.speed);
    const { statStatusIds, regenStatusIdByTier } = BALANCE.barter;
    if (attackBonus > 0) applyStatus(character, statStatusIds.attack, attackBonus);
    if (magicBonus > 0) applyStatus(character, statStatusIds.magicPower, magicBonus);
    if (defenseBonus > 0) applyStatus(character, statStatusIds.defense, defenseBonus);
    if (speedBonus > 0) applyStatus(character, statStatusIds.speed, speedBonus);
    for (const tier of regenTiers) applyStatus(character, regenStatusIdByTier[tier]);
  }

  log.push({ text: t("combat.barterBuffs", { items: pending.map((id) => getItem(id).name).join(", ") }), kind: "buff" });
  state.pendingBarterBuffs = [];
}

export function barterCost(itemId: Id): number {
  return getBarterEntry(itemId).cost;
}

/** The buff stays hidden until this floor's elite/boss fight (`applyPendingBarterBuffs`). */
export function runnerBarter(state: GameState, offerIndex: number): PartyActionError | null {
  const runner = state.restRunner;
  if (!runner) return { reason: t("errors.noRunner") };
  const offer = runner.barterOffers?.[offerIndex];
  if (!offer || offer.done) return { reason: t("errors.noSuchOffer") };
  const item = getItem(offer.itemId);
  const cost = barterCost(item.id);
  if ((state.inventory[item.id] ?? 0) < cost) return { reason: t("errors.notEnoughTrophies") };
  state.inventory[item.id] = (state.inventory[item.id] ?? 0) - cost;
  state.pendingBarterBuffs = [...(state.pendingBarterBuffs ?? []), item.id];
  state.barterUsedDepth = state.floor.depth;
  offer.done = true;
  state.message = t("game.barterMade", { count: cost, item: item.name });
  return null;
}
