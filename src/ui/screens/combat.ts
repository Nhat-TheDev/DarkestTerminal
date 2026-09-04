import { StyledText, type TextChunk, type KeyEvent } from "@opentui/core";
import type { Character, CombatantRef, SkillDefinition, SkillEffect, SkillTarget, StatusEffectDefinition, ItemDefinition } from "../../types";
import type { Game } from "../../engine/game";
import { getActorByRef, checkSkillUsable, checkItemUsable } from "../../engine/combat";
import { PALETTE, plainChunk, colorChunk, joinLines } from "../theme";
import { truncateText } from "../layout";
import { t } from "../../data/strings";
import { signed } from "../../data/items";
import { getStatusEffect, statusDisplayName } from "../../data/statusEffects";
import type { UiState } from "../state";
import { inventoryEntries, skillEntries, buildRewardEntries, itemIcon } from "../state";
import { paginate } from "../pagination";
import { proceedAfterVictory, type ScreenContext } from "./context";

const COMBAT_STAT_LABEL: Record<string, string> = { attack: "Attack", defense: "Defense", aggro: "Aggro", speed: "Speed" };
const SURVIVAL_STAT_LABEL: Record<string, string> = { fear: "Fear", satiety: "Satiety" };

/** Who a skill's effects land on, derived from the skill's own `target` field — every effect in a skill shares the same targets. */
const TARGET_SUFFIX: Partial<Record<SkillTarget, string>> = {
  self: "to yourself",
  singleAlly: "to an ally",
  allAllies: "to your party",
  singleEnemy: "to an enemy",
  allEnemies: "to all enemies",
};

/** A status's own perTurnEffects, formatted as "+6 Defense/turn" style fragments — null if it has none. */
function statusPerTurnSummary(def: StatusEffectDefinition): string | null {
  const parts = def.perTurnEffects
    .map((e) => {
      if (e.kind === "damage") return `-${e.amount ?? 0} HP/turn`;
      if (e.kind === "heal") return `+${e.amount ?? 0} HP/turn`;
      if (e.kind === "modifyCombatStat" && e.combatStat) return `${signed(e.amount ?? 0)} ${COMBAT_STAT_LABEL[e.combatStat]}/turn`;
      return null;
    })
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * One bulleted line per skill effect, built entirely from the skill's own data — never the caster's
 * live stats. Damage gets its own shape — "100% Base Attack + 10" — describing the damage formula
 * itself (100% of the caster's Attack stat, plus the skill's own flat `amount`), not a trigger chance.
 * Every other effect kind is prefixed with its actual trigger chance (100% when guaranteed), and every
 * bullet ends with who it targets.
 */
function skillEffectLine(e: SkillEffect, sk: SkillDefinition): string | null {
  const targetSuffix = TARGET_SUFFIX[sk.target] ?? "";
  if (e.kind === "damage") {
    const statLabel = sk.isMagic ? "Magic Power" : "Attack";
    const base = e.amount ?? 0;
    return base === 0
      ? t("ui.skillEffectDamageScalingOnly", { statLabel, targetSuffix })
      : t("ui.skillEffectDamageScaling", { statLabel, statAmount: base, targetSuffix });
  }
  if (e.kind === "heal" && sk.isMagic) {
    return t("ui.skillEffectHealScaling", { amount: e.amount ?? 0, targetSuffix });
  }
  const chance = `${Math.round((e.chance ?? 1) * 100)}%`;
  let body: string | null;
  switch (e.kind) {
    case "heal":
      body = t("ui.skillEffectHeal", { amount: e.amount ?? 0 });
      break;
    case "restoreMp":
      body = t("ui.skillEffectRestoreMp", { amount: e.amount ?? 0 });
      break;
    case "modifyStat":
      body = `${signed(e.amount ?? 0)} ${e.stat ? SURVIVAL_STAT_LABEL[e.stat] ?? e.stat : ""}`;
      break;
    case "modifyCombatStat":
      body = `${signed(e.amount ?? 0)} ${e.combatStat ? COMBAT_STAT_LABEL[e.combatStat] : ""}`;
      break;
    case "applyStatusEffect": {
      if (!e.statusEffectId) return null;
      const def = getStatusEffect(e.statusEffectId);
      const turnsSuffix = def.durationTurns ? ` (${def.durationTurns}t)` : "";
      const perTurn = statusPerTurnSummary(def);
      const perTurnSuffix = perTurn ? ` (${perTurn})` : "";
      body = `${t("ui.skillEffectApplyStatus", { status: statusDisplayName(def) })}${turnsSuffix}${perTurnSuffix}`;
      break;
    }
    case "removeStatusEffect":
      body = t("ui.skillEffectRemoveStatus");
      break;
    default:
      body = null;
  }
  return body === null ? null : t("ui.skillEffectBullet", { chance, body, targetSuffix });
}

export type CombatUiState = Extract<
  UiState,
  | { kind: "pickAction" }
  | { kind: "pickSkill" }
  | { kind: "skillDetail" }
  | { kind: "pickItemInCombat" }
  | { kind: "pickTarget" }
  | { kind: "roundResolved" }
  | { kind: "combatOver" }
>;

/** Shared by the pickSkill list and the skillDetail screen so the estimate formula lives in one place. */
function skillMeta(actor: Character, sk: SkillDefinition): { dmgAmount: number | null; usesLeft: number | null } {
  const dmgEffect = sk.effects?.find((e) => e.kind === "damage");
  const offensiveStat = sk.isMagic ? actor.magicPower : actor.attack;
  const dmgAmount = dmgEffect ? Math.max(1, Math.round((dmgEffect.amount ?? 0) + offensiveStat)) : null;
  const usesLeft = sk.usesPerCombat !== undefined ? actor.usesRemainingThisCombat[sk.id] ?? sk.usesPerCombat : null;
  return { dmgAmount, usesLeft };
}

export function trySelectSkill(ctx: ScreenContext, actorRef: CombatantRef, skill: SkillDefinition): void {
  const actor = getActorByRef(actorRef, ctx.game.ctx);
  const unusable = checkSkillUsable(actor, skill);
  if (unusable) {
    ctx.reportUnusable(t("ui.skillUnusableNamed", { skill: skill.name, reason: unusable.reason }));
    return;
  }
  if (skill.target === "singleEnemy" || skill.target === "singleAlly") {
    const candidates = skill.target === "singleEnemy" ? ctx.game.livingEnemyRefs() : ctx.game.livingAllyRefs();
    ctx.setUi({ kind: "pickTarget", actorRef, source: { kind: "skill", skill }, candidates });
    return;
  }
  if (skill.target === "singleAllyOrEnemy") {
    const candidates = [...ctx.game.livingAllyRefs(), ...ctx.game.livingEnemyRefs()];
    ctx.setUi({ kind: "pickTarget", actorRef, source: { kind: "skill", skill }, candidates });
    return;
  }
  const targets = ctx.game.autoTargets(skill.target, actorRef) ?? [actorRef];
  const err = ctx.game.queue(actorRef, skill.id, targets);
  if (err) ctx.reportUnusable(err.reason);
  ctx.syncUiToGameState();
}

export function trySelectItem(ctx: ScreenContext, actorRef: CombatantRef, item: ItemDefinition): void {
  const actor = getActorByRef(actorRef, ctx.game.ctx);
  const unusable = checkItemUsable(actor, item.id, ctx.game.state.inventory);
  if (unusable) {
    ctx.reportUnusable(t("ui.itemUnusableNamed", { item: item.name, reason: unusable.reason }));
    return;
  }
  if (item.target === "singleEnemy" || item.target === "singleAlly" || item.target === "self") {
    const candidates = item.target === "singleEnemy" ? ctx.game.livingEnemyRefs() : ctx.game.livingAllyRefs();
    ctx.setUi({ kind: "pickTarget", actorRef, source: { kind: "item", item }, candidates });
    return;
  }
  const targets = ctx.game.autoTargets(item.target, actorRef) ?? [actorRef];
  const err = ctx.game.queueItem(actorRef, item.id, targets);
  if (err) ctx.reportUnusable(err.reason);
  ctx.syncUiToGameState();
}

export function handleKey(ctx: ScreenContext, ui: CombatUiState, key: KeyEvent, digit: number | null): void {
  switch (ui.kind) {
    case "pickAction": {
      if (digit === 1) {
        ctx.setUi({ kind: "pickSkill", actorRef: ui.actorRef });
      } else if (digit === 2) {
        if (inventoryEntries(ctx.game.state.inventory).length === 0) {
          ctx.reportUnusable(t("ui.noItemsToUse"));
          break;
        }
        ctx.setUi({ kind: "pickItemInCombat", actorRef: ui.actorRef });
      }
      break;
    }
    case "pickSkill": {
      if (digit === null) break;
      const actor = getActorByRef(ui.actorRef, ctx.game.ctx) as Character;
      const skill = skillEntries(actor)[digit - 1];
      if (!skill) break;
      const unusable = checkSkillUsable(actor, skill);
      if (unusable) {
        ctx.reportUnusable(t("ui.skillUnusableNamed", { skill: skill.name, reason: unusable.reason }));
        break;
      }
      ctx.setUi({ kind: "skillDetail", actorRef: ui.actorRef, skill });
      break;
    }
    case "skillDetail": {
      if (key.name === "return") trySelectSkill(ctx, ui.actorRef, ui.skill);
      break;
    }
    case "pickItemInCombat": {
      if (digit === null) break;
      const { pageItems } = paginate(inventoryEntries(ctx.game.state.inventory), ctx.getListPage());
      const entry = pageItems[digit - 1];
      if (!entry) break;
      ctx.setUi({ kind: "itemDetail", item: entry.item, origin: { kind: "combat", actorRef: ui.actorRef } });
      break;
    }
    case "pickTarget": {
      if (digit === null) break;
      const target = ui.candidates[digit - 1];
      if (!target) break;
      const err =
        ui.source.kind === "skill"
          ? ctx.game.queue(ui.actorRef, ui.source.skill.id, [target])
          : ctx.game.queueItem(ui.actorRef, ui.source.item.id, [target]);
      if (err) ctx.reportUnusable(err.reason);
      ctx.syncUiToGameState();
      break;
    }
    case "roundResolved":
    case "combatOver": {
      if (ui.kind === "combatOver") {
        const wasVictory = ctx.game.state.combat?.outcome === "victory";
        const wasBossRoomVictory = ctx.game.clearFinishedCombat();
        ctx.setPendingFloorAdvance(wasBossRoomVictory);
        ctx.setPendingCampOffer(wasVictory);
        const drops = ctx.game.state.lastRoomDrops;
        ctx.game.state.lastRoomDrops = null;
        if (drops && (drops.itemIds.length > 0 || drops.artifactIds.length > 0)) {
          ctx.setUi({ kind: "roomReward", entries: buildRewardEntries(drops), viewing: null });
          break;
        }
        proceedAfterVictory(ctx);
        break;
      }
      ctx.syncUiToGameState();
      break;
    }
  }
}

export function renderMain(game: Game, ui: CombatUiState, page = 0): string | StyledText {
  const s = game.state;
  switch (ui.kind) {
    case "combatOver": {
      const combat = s.combat!;
      return combat.outcome === "victory" ? t("ui.combatOverVictory") : t("ui.combatOverDefeat");
    }

    case "roundResolved":
      return t("ui.roundResolved");

    case "pickAction": {
      const actor = getActorByRef(ui.actorRef, game.ctx) as Character;
      const hasItems = inventoryEntries(s.inventory).length > 0;
      const lines = [
        t("ui.turnOfChooseAction", { actor: actor.name }),
        t("ui.fightOption"),
        t("ui.useItemOption", { suffix: hasItems ? "" : t("ui.noItemsSuffix") }),
      ];
      return lines.join("\n");
    }

    case "pickSkill": {
      const actor = getActorByRef(ui.actorRef, game.ctx) as Character;
      const lines: TextChunk[][] = [[plainChunk(t("ui.turnOfChooseSkill", { actor: actor.name }))]];
      skillEntries(actor).forEach((sk, i) => {
        const unusable = checkSkillUsable(actor, sk);
        const { dmgAmount, usesLeft } = skillMeta(actor, sk);
        const usesSuffix = usesLeft !== null ? t("ui.usesLeftSuffix", { count: usesLeft }) : "";
        const dmgSuffix = dmgAmount !== null ? t("ui.dmgEstimateSuffix", { amount: dmgAmount }) : "";
        const head = `  [${i + 1}] ${sk.name} (MP ${sk.mpCost}${usesSuffix}${dmgSuffix})`;
        if (unusable) {
          lines.push([colorChunk(`${head} — ${unusable.reason}`, PALETTE.disabled)]);
        } else {
          lines.push([plainChunk(`${head} — ${truncateText(sk.description, 34)}`)]);
        }
      });
      return joinLines(lines);
    }

    case "skillDetail": {
      const actor = getActorByRef(ui.actorRef, game.ctx) as Character;
      const { dmgAmount, usesLeft } = skillMeta(actor, ui.skill);
      const lines = [ui.skill.name, "", t("ui.skillMpCostLine", { mp: ui.skill.mpCost })];
      if (dmgAmount !== null) lines.push(t("ui.skillDamageLine", { amount: dmgAmount }));
      if (usesLeft !== null) lines.push(t("ui.skillUsesLeftLine", { count: usesLeft }));
      const effectLines = (ui.skill.effects ?? []).map((e) => skillEffectLine(e, ui.skill)).filter((l): l is string => l !== null);
      if (effectLines.length > 0) lines.push("", t("ui.skillEffectsLabel"), ...effectLines);
      lines.push("", t("ui.descriptionLabel"), ui.skill.description);
      lines.push("", t("ui.skillDetailEnterOption"));
      return lines.join("\n");
    }

    case "pickItemInCombat": {
      const { pageItems, page: p, pages } = paginate(inventoryEntries(s.inventory), page);
      const lines = [t("ui.chooseItemToUse")];
      pageItems.forEach(({ item, qty }, i) => {
        lines.push(t("ui.inventoryLine", { i: i + 1, name: `${itemIcon(item)} ${item.name}`, qty }));
      });
      if (pages > 1) lines.push(t("ui.pageIndicator", { page: p + 1, pages }));
      return lines.join("\n");
    }

    case "pickTarget": {
      const sourceName = ui.source.kind === "skill" ? ui.source.skill.name : ui.source.item.name;
      const sourceTarget = ui.source.kind === "skill" ? ui.source.skill.target : ui.source.item.target;
      const lines = [t("ui.chooseTargetFor", { source: sourceName })];
      const isDualRelation = sourceTarget === "singleAllyOrEnemy";
      ui.candidates.forEach((ref, i) => {
        const target = getActorByRef(ref, game.ctx);
        const hpInfo = "hp" in target ? t("ui.hpSuffix", { hp: target.hp, maxHp: target.maxHp }) : "";
        const sidePrefix = isDualRelation ? (ref.kind === "character" ? t("ui.allySidePrefix") : t("ui.enemySidePrefix")) : "";
        lines.push(`  [${i + 1}] ${sidePrefix}${target.name}${hpInfo}`);
      });
      return lines.join("\n");
    }
  }
}

export function renderFooter(ui: CombatUiState): string {
  switch (ui.kind) {
    case "pickAction":
      return t("ui.footerChooseAction");
    case "pickSkill":
      return t("ui.footerChooseSkillEsc");
    case "skillDetail":
      return t("ui.footerSkillDetail");
    case "pickItemInCombat":
      return t("ui.footerChooseItemEsc");
    case "pickTarget":
      return t("ui.footerChooseTargetEsc");
    case "roundResolved":
    case "combatOver":
      return t("ui.footerPressAnyKey");
  }
}
