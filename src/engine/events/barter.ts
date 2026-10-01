import type { Character, GameState, Id, ItemTier, LogEntry } from "../../types";
import type { EngineContext } from "../combat";
import type { PartyActionError } from "../party";
import { resolveSkillEffect } from "../resolver";
import { BALANCE } from "../../data/balanceConfig";
import { getItem } from "../../data/items";
import { getBarterEntry, type BarterEffect } from "../../data/barter";
import { t } from "../../data/strings";

/** The buff a trophy buys, from `data/barter.json`. */
export function barterBuffFor(itemId: Id): BarterEffect[] {
  return getBarterEntry(itemId).effects;
}

function applyStatus(character: Character, statusEffectId: string, amount?: number): void {
  const quiet: LogEntry[] = [];
  resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId, durationTurns: BALANCE.barter.activeDurationTurns, amount }, character, character, { log: quiet });
}

/**
 * Applies every pending barter buff to the living party as the elite/boss room's fight begins. A stat
 * that several buffs raise is applied once with their percents added (a status already active would
 * only refresh); regeneration is applied once per distinct tier. The buffs then expire with the
 * fight, like any other buff (`Game.resolve`), and the pending list is emptied.
 */
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
    const attackBonus = Math.round((percentByStat.attack / 100) * character.attack);
    const magicBonus = Math.round((percentByStat.attack / 100) * character.magicPower);
    const defenseBonus = Math.round((percentByStat.defense / 100) * (defenseMitigationX + character.defense));
    const speedBonus = Math.round((percentByStat.speed / 100) * character.speed);
    if (attackBonus > 0) applyStatus(character, "barter-attack", attackBonus);
    if (magicBonus > 0) applyStatus(character, "barter-magic-power", magicBonus);
    if (defenseBonus > 0) applyStatus(character, "barter-defense", defenseBonus);
    if (speedBonus > 0) applyStatus(character, "barter-speed", speedBonus);
    for (const tier of regenTiers) applyStatus(character, `barter-regen-${tier}`);
  }

  log.push({ text: t("combat.barterBuffs", { items: pending.map((id) => getItem(id).name).join(", ") }), kind: "buff" });
  state.pendingBarterBuffs = [];
}

/** How many of the trophy a trade takes, from `data/barter.json`. */
export function barterCost(itemId: Id): number {
  return getBarterEntry(itemId).cost;
}

/**
 * Trades the Runner's `offerIndex`-th trophy kind for a buff: takes `barterCost` of that trophy from
 * the inventory and queues the buff for this floor's elite/boss room. The buff is not described
 * here — it stays hidden until that fight (`applyPendingBarterBuffs`).
 */
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
