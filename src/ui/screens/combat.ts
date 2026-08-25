import { StyledText, type TextChunk, type KeyEvent } from "@opentui/core";
import type { Character, CombatantRef, SkillDefinition, ItemDefinition } from "../../types";
import type { Game } from "../../engine/game";
import { getActorByRef, checkSkillUsable, checkItemUsable } from "../../engine/combat";
import { autoSave } from "../../engine/save";
import { PALETTE, plainChunk, colorChunk, joinLines } from "../theme";
import { truncateText } from "../layout";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { inventoryEntries, skillEntries, buildRewardEntries } from "../state";
import type { ScreenContext } from "./context";

export type CombatUiState = Extract<
  UiState,
  | { kind: "pickAction" }
  | { kind: "pickSkill" }
  | { kind: "pickItemInCombat" }
  | { kind: "pickTarget" }
  | { kind: "roundResolved" }
  | { kind: "combatOver" }
>;

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

export function handleKey(ctx: ScreenContext, ui: CombatUiState, _key: KeyEvent, digit: number | null): void {
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
      trySelectSkill(ctx, ui.actorRef, skill);
      break;
    }
    case "pickItemInCombat": {
      if (digit === null) break;
      const entry = inventoryEntries(ctx.game.state.inventory)[digit - 1];
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
        const wasBossRoomVictory = ctx.game.clearFinishedCombat();
        const drops = ctx.game.state.lastRoomDrops;
        ctx.game.state.lastRoomDrops = null;
        if (drops && (drops.itemIds.length > 0 || drops.artifactIds.length > 0)) {
          ctx.setPendingFloorAdvance(wasBossRoomVictory);
          ctx.setUi({ kind: "roomReward", entries: buildRewardEntries(drops), viewing: null });
          break;
        }
        if (wasBossRoomVictory) {
          const depthBefore = ctx.game.state.floor.depth;
          ctx.game.advanceToNextFloor();
          if (ctx.game.state.floor.depth > depthBefore) autoSave(ctx.game);
        }
      }
      ctx.syncUiToGameState();
      break;
    }
  }
}

export function renderMain(game: Game, ui: CombatUiState): string | StyledText {
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
        const usesLeft = sk.usesPerCombat !== undefined ? actor.usesRemainingThisCombat[sk.id] ?? sk.usesPerCombat : null;
        const usesSuffix = usesLeft !== null ? t("ui.usesLeftSuffix", { count: usesLeft }) : "";
        const dmgEffect = sk.effects?.find((e) => e.kind === "damage");
        const offensiveStat = sk.isMagic ? actor.magicPower : actor.attack;
        const dmgSuffix = dmgEffect ? t("ui.dmgEstimateSuffix", { amount: Math.max(1, Math.round((dmgEffect.amount ?? 0) + offensiveStat)) }) : "";
        const head = `  [${i + 1}] ${sk.name} (MP ${sk.mpCost}${usesSuffix}${dmgSuffix})`;
        if (unusable) {
          lines.push([colorChunk(`${head} — ${unusable.reason}`, PALETTE.disabled)]);
        } else {
          lines.push([plainChunk(`${head} — ${truncateText(sk.description, 34)}`)]);
        }
      });
      return joinLines(lines);
    }

    case "pickItemInCombat": {
      const lines = [t("ui.chooseItemToUse")];
      inventoryEntries(s.inventory).forEach(({ item, qty }, i) => {
        lines.push(t("ui.inventoryLine", { i: i + 1, name: item.name, qty }));
      });
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
    case "pickItemInCombat":
      return t("ui.footerChooseItemEsc");
    case "pickTarget":
      return t("ui.footerChooseTargetEsc");
    case "roundResolved":
    case "combatOver":
      return t("ui.footerPressAnyKey");
  }
}
