import { StyledText, type TextChunk, type KeyEvent } from "@opentui/core";
import type { Character, CombatantRef, CombatStat, SkillDefinition, SkillEffect, SkillTarget, ItemDefinition } from "../../types";
import type { Game } from "../../engine/game";
import { getActorByRef, checkSkillUsable, checkItemUsable } from "../../engine/combat";
import { PALETTE, plainChunk, colorChunk, joinLines } from "../theme";
import { t } from "../../data/strings";
import { signed } from "../../data/items";
import { getStatusEffect, statusDisplayName, statusMechanicsParts } from "../../data/statusEffects";
import { getSummonArchetype, getSummonCast, getSummonSkill } from "../../data/summons";
import type { UiState } from "../state";
import { inventoryEntries, skillEntries, buildRewardEntries, itemIcon } from "../state";
import { paginate } from "../pagination";
import { proceedAfterVictory, type ScreenContext } from "./context";
import { digitHint } from "../keyHints";
import { targetChoiceLines } from "../targetPicker";

const COMBAT_STAT_LABEL: Record<CombatStat, string> = {
  attack: t("ui.statLabelAttack"),
  defense: t("ui.statLabelDefense"),
  aggro: t("ui.statLabelAggro"),
  speed: t("ui.statLabelSpeed"),
  magicPower: t("ui.statLabelMagicPower"),
};
const SURVIVAL_STAT_LABEL: Record<string, string> = { fear: t("ui.statLabelFear"), satiety: t("ui.statLabelSatiety") };

/** Who a skill's effects land on, derived from the skill's own `target` field — every effect in a skill shares the same targets. */
const TARGET_SUFFIX: Partial<Record<SkillTarget, string>> = {
  self: t("ui.targetSuffixSelf"),
  singleAlly: t("ui.targetSuffixSingleAlly"),
  allAllies: t("ui.targetSuffixAllAllies"),
  singleEnemy: t("ui.targetSuffixSingleEnemy"),
  allEnemies: t("ui.targetSuffixAllEnemies"),
};

/**
 * Who this specific effect lands on — usually just the skill's own `target`, but an effect can
 * override that (`effect.target`, e.g. a `summon` effect that always lands on the caster) or narrow
 * it to 1 side of an already-resolved population (`effect.appliesToRelation`, e.g. Purify's ally-only
 * `removeStatusEffect` vs its enemy-only `damage`) — the plurality (1 ally vs "your party") still
 * follows the skill's own target, since `appliesToRelation` only filters, it doesn't resolve its own set.
 */
function targetSuffixFor(e: SkillEffect, sk: SkillDefinition): string {
  if (e.target) return TARGET_SUFFIX[e.target] ?? "";
  if (e.appliesToRelation) {
    const isAllTargets = sk.target.startsWith("all");
    const target: SkillTarget =
      e.appliesToRelation === "ally" ? (isAllTargets ? "allAllies" : "singleAlly") : isAllTargets ? "allEnemies" : "singleEnemy";
    return TARGET_SUFFIX[target]!;
  }
  return TARGET_SUFFIX[sk.target] ?? "";
}

/**
 * One bulleted line per skill effect, built entirely from the skill's own data — never the caster's
 * live stats. Damage gets its own shape — "80% Base Attack + 10" — describing the damage formula
 * itself (the effect's own offenseMultiplierPercent, absent/100 meaning unscaled, of the caster's
 * Attack stat, plus the skill's own flat `amount`), not a trigger chance. Every other effect kind is
 * prefixed with its actual trigger chance (100% when guaranteed), and every bullet ends with who it targets.
 */
export function skillEffectLine(e: SkillEffect, sk: SkillDefinition): string | null {
  const targetSuffix = targetSuffixFor(e, sk);
  if (e.kind === "damage") {
    const statLabel = sk.isMagic ? "Magic Power" : "Attack";
    const percent = e.offenseMultiplierPercent ?? 100;
    const base = e.amount ?? 0;
    return base === 0
      ? t("ui.skillEffectDamageScalingOnly", { percent, statLabel, targetSuffix })
      : t("ui.skillEffectDamageScaling", { percent, statLabel, statAmount: base, targetSuffix });
  }
  if (e.kind === "heal" && sk.isMagic) {
    return t("ui.skillEffectHealScaling", { percent: e.offenseMultiplierPercent ?? 100, amount: e.amount ?? 0, targetSuffix });
  }
  if (e.kind === "summon") return e.summonCastId ? summonEffectLine(e.summonCastId) : null;
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
      const applied = `${t("ui.skillEffectApplyStatus", { status: statusDisplayName(def) })} (${e.durationTurns ?? 1}t)`;
      const bullet = t("ui.skillEffectBullet", { chance, body: applied, targetSuffix });
      const parts = statusMechanicsParts(def, { amount: e.amount, minPercent: e.minPercent });
      return [bullet, ...parts.map((mechanics) => t("ui.skillEffectStatusDetail", { mechanics }))].join("\n");
    }
    case "removeStatusEffect":
      body = t("ui.skillEffectRemoveStatus");
      break;
    default:
      body = null;
  }
  return body === null ? null : t("ui.skillEffectBullet", { chance, body, targetSuffix });
}

/** A summon effect's bullet: the minion, how often it acts and how much aggro it draws, then its signature skills — all from data/summons.json, never the caster's live stats. */
function summonEffectLine(castId: string): string {
  const cast = getSummonCast(castId);
  const archetype = getSummonArchetype(cast.archetypeId);
  const head = archetype.passive
    ? t("ui.skillEffectSummonPassive", { name: archetype.name, aggro: cast.aggro })
    : t("ui.skillEffectSummon", { name: archetype.name, actions: cast.maxActions, aggro: cast.aggro });
  const skills = (archetype.signatureSkillIds ?? []).map((id) => getSummonSkill(id).name);
  return skills.length > 0 ? `${head}\n${t("ui.skillEffectSummonSkills", { skills: skills.join(", ") })}` : head;
}

/** Skill-level mechanics no `SkillEffect` bullet carries: the ultimate's always-hit/fear rule, `executeBonus`, `conditionalBonus`, and each distinct `critChance` among its damage effects. */
export function skillMechanicLines(sk: SkillDefinition): string[] {
  const lines: string[] = [];
  if (sk.isUltimate) lines.push(t("ui.skillUltimateLine"));
  if (sk.executeBonus) {
    const { hpPercentThreshold, bonusDamageFlat, bonusDamagePercent } = sk.executeBonus;
    const bonus = [bonusDamageFlat ? `+${bonusDamageFlat}` : null, bonusDamagePercent ? `+${bonusDamagePercent}%` : null].filter((b) => b !== null).join(" and ");
    if (bonus !== "") lines.push(t("ui.skillExecuteBonusLine", { bonus, threshold: hpPercentThreshold }));
  }
  if (sk.conditionalBonus) {
    const status = statusDisplayName(getStatusEffect(sk.conditionalBonus.requiresStatusId));
    lines.push(t("ui.skillConditionalBonusLine", { percent: sk.conditionalBonus.ignoreDefensePercentBonus, status }));
    if (sk.conditionalBonus.consumesStatus) lines.push(t("ui.skillConsumesStatusLine", { status }));
  }
  const critPercents = new Set((sk.effects ?? []).filter((e) => e.kind === "damage" && (e.critChance ?? 0) > 0).map((e) => Math.round((e.critChance ?? 0) * 100)));
  for (const percent of critPercents) lines.push(t("ui.skillCritChanceLine", { percent }));
  return lines;
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
  const dmgAmount = dmgEffect ? Math.max(1, Math.round((dmgEffect.amount ?? 0) + offensiveStat * ((dmgEffect.offenseMultiplierPercent ?? 100) / 100))) : null;
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
        if (drops && (drops.itemIds.length > 0 || drops.artifactIds.length > 0 || drops.abilityIds.length > 0)) {
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
        const { usesLeft } = skillMeta(actor, sk);
        const usesSuffix = usesLeft !== null ? t("ui.usesLeftSuffix", { count: usesLeft }) : "";
        const head = `  [${i + 1}] ${sk.name} (MP ${sk.mpCost}${usesSuffix})`;
        if (unusable) {
          lines.push([colorChunk(`${head} — ${unusable.reason}`, PALETTE.disabled)]);
        } else {
          lines.push([plainChunk(`${head} — ${sk.shortDescription ?? sk.description}`)]);
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
      const effectLines = [...(ui.skill.effects ?? []).map((e) => skillEffectLine(e, ui.skill)).filter((l): l is string => l !== null), ...skillMechanicLines(ui.skill)];
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
      const effects = ui.source.kind === "skill" ? ui.source.skill.effects ?? [] : ui.source.item.effects;
      const candidates = ui.candidates.map((ref) => ({ ref, actor: getActorByRef(ref, game.ctx) }));
      return joinLines([[plainChunk(t("ui.chooseTargetFor", { source: sourceName }))], ...targetChoiceLines(candidates, effects, sourceTarget === "singleAllyOrEnemy")]);
    }
  }
}

export function renderFooter(ui: CombatUiState, game: Game, page = 0): string {
  switch (ui.kind) {
    // "Use item" stays on the list even with an empty bag (it renders with a "no items" tag), so
    // the footer counts what the panel actually shows rather than hiding a visible option.
    case "pickAction":
      return digitHint("ui.footerChooseAction", 2);
    case "pickSkill": {
      const actor = getActorByRef(ui.actorRef, game.ctx) as Character;
      return digitHint("ui.footerChooseSkillEsc", skillEntries(actor).length);
    }
    case "skillDetail":
      return t("ui.footerSkillDetail");
    case "pickItemInCombat": {
      const { pageItems } = paginate(inventoryEntries(game.state.inventory), page);
      return digitHint("ui.footerChooseItemEsc", pageItems.length);
    }
    case "pickTarget":
      return digitHint("ui.footerChooseTargetEsc", ui.candidates.length);
    case "roundResolved":
    case "combatOver":
      return t("ui.footerPressAnyKey");
  }
}
