import type { Character, GameState, Id, ItemTier, LogEntry } from "../../types";
import type { EngineContext } from "../combat";
import { resolveSkillEffect } from "../resolver";
import { BALANCE } from "../../data/balanceConfig";
import { getItem } from "../../data/items";
import { getArchetype } from "../../data/monsters";
import { t } from "../../data/strings";

export type BarterStat = "attack" | "defense" | "speed" | "regen";

export interface BarterComponent {
  stat: BarterStat;
  /** A percent of the stat's effect (for regen: percent of max HP per turn). */
  percent: number;
}

/** The value that appears most often; on a tie, the one that appears first. */
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return values.find((value) => counts.get(value) === top)!;
}

/**
 * What a trophy buys: its tier sets the strength P, the most common `monsterType` among the monsters
 * that drop it sets the primary stat, and the most common `race` adds a secondary effect at
 * `secondaryShare` of P. Stats that come out twice are added together.
 */
export function barterBuffFor(itemId: Id): BarterComponent[] {
  const item = getItem(itemId);
  const archetypes = (item.archetypeIds ?? []).map(getArchetype);
  if (archetypes.length === 0) throw new Error(`"${itemId}" is not a trophy`);
  const { magnitudePercentByTier, secondaryShare, primaryStatByMonsterType, secondaryByRace } = BALANCE.barter;
  const power = magnitudePercentByTier[item.tier];
  const primary = primaryStatByMonsterType[mostCommon(archetypes.map((a) => a.monsterType))]!;
  const secondary = secondaryByRace[mostCommon(archetypes.map((a) => a.race))]!;

  const components: BarterComponent[] = primary === "balanced" ? [{ stat: "attack", percent: power / 2 }, { stat: "defense", percent: power / 2 }] : [{ stat: primary, percent: power }];
  const extra = power * secondaryShare;
  const existing = components.find((c) => c.stat === secondary);
  if (existing) existing.percent += extra;
  else components.push({ stat: secondary, percent: extra });
  return components;
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
    for (const { stat, percent } of barterBuffFor(itemId)) {
      if (stat === "regen") regenTiers.add(tier);
      else percentByStat[stat] += percent;
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
