import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { getItem, formatItemEffect } from "../../data/items";
import { getArtifact, formatArtifactEffect } from "../../data/artifacts";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { advanceFloorWithAutoSave, type ScreenContext } from "./context";

export type RewardsUiState = Extract<UiState, { kind: "roomReward" }>;

export function handleKey(ctx: ScreenContext, ui: RewardsUiState, key: KeyEvent, digit: number | null): void {
  if (ui.viewing) {
    if (digit === 1) ctx.setUi({ kind: "roomReward", entries: ui.entries, viewing: null });
    return;
  }
  if (key.name === "return") {
    if (ctx.getPendingFloorAdvance()) {
      ctx.setPendingFloorAdvance(false);
      advanceFloorWithAutoSave(ctx);
    }
    ctx.syncUiToGameState();
    return;
  }
  if (digit === null) return;
  if (digit <= ui.entries.length) {
    ctx.setUi({ kind: "roomReward", entries: ui.entries, viewing: ui.entries[digit - 1]! });
  }
}

export function renderMain(_game: Game, ui: RewardsUiState): string {
  if (ui.viewing) {
    const entry = ui.viewing;
    const lines =
      entry.kind === "item"
        ? [`${getItem(entry.id).name} x${entry.qty}`, "", t("ui.effectLabel"), formatItemEffect(getItem(entry.id)), "", t("ui.descriptionLabel"), getItem(entry.id).description]
        : [
            `${getArtifact(entry.id).name} (${getArtifact(entry.id).rarity})`,
            "",
            t("ui.effectLabel"),
            formatArtifactEffect(getArtifact(entry.id)),
            "",
            t("ui.descriptionLabel"),
            getArtifact(entry.id).description,
          ];
    lines.push("", t("ui.roomRewardBackOption"));
    return lines.join("\n");
  }
  const lines = [t("ui.roomRewardTitle")];
  ui.entries.forEach((entry, i) => {
    lines.push(entry.kind === "item" ? t("ui.roomRewardItemLine", { i: i + 1, name: getItem(entry.id).name, qty: entry.qty }) : t("ui.roomRewardArtifactLine", { i: i + 1, name: getArtifact(entry.id).name, rarity: getArtifact(entry.id).rarity }));
  });
  lines.push(t("ui.roomRewardContinueOption"));
  return lines.join("\n");
}

export function renderFooter(ui: RewardsUiState): string {
  return ui.viewing ? t("ui.detailFooter") : t("ui.roomRewardFooter");
}
