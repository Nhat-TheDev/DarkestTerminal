import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { getItem, formatItemEffect } from "../../data/items";
import { getArtifact, formatArtifactEffect } from "../../data/artifacts";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { itemIcon, ARTIFACT_ICON } from "../state";
import { paginate } from "../pagination";
import { proceedAfterVictory, type ScreenContext } from "./context";

export type RewardsUiState = Extract<UiState, { kind: "roomReward" }>;

export function handleKey(ctx: ScreenContext, ui: RewardsUiState, key: KeyEvent, digit: number | null): void {
  if (ui.viewing) {
    if (digit === 1) ctx.setUi({ kind: "roomReward", entries: ui.entries, viewing: null });
    return;
  }
  if (key.name === "return") {
    proceedAfterVictory(ctx);
    return;
  }
  if (digit === null) return;
  const { pageItems } = paginate(ui.entries, ctx.getListPage());
  const entry = pageItems[digit - 1];
  if (entry) ctx.setUi({ kind: "roomReward", entries: ui.entries, viewing: entry });
}

export function renderMain(_game: Game, ui: RewardsUiState, page = 0): string {
  if (ui.viewing) {
    const entry = ui.viewing;
    const lines =
      entry.kind === "item"
        ? [
            `${itemIcon(getItem(entry.id))} ${getItem(entry.id).name} x${entry.qty}`,
            "",
            t("ui.effectLabel"),
            formatItemEffect(getItem(entry.id)),
            "",
            t("ui.descriptionLabel"),
            getItem(entry.id).description,
          ]
        : [
            `${ARTIFACT_ICON} ${getArtifact(entry.id).name} (${getArtifact(entry.id).rarity})`,
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
  const { pageItems, page: p, pages } = paginate(ui.entries, page);
  const lines = [t("ui.roomRewardTitle")];
  pageItems.forEach((entry, i) => {
    lines.push(
      entry.kind === "item"
        ? t("ui.roomRewardItemLine", { i: i + 1, name: `${itemIcon(getItem(entry.id))} ${getItem(entry.id).name}`, qty: entry.qty })
        : t("ui.roomRewardArtifactLine", { i: i + 1, name: `${ARTIFACT_ICON} ${getArtifact(entry.id).name}`, rarity: getArtifact(entry.id).rarity })
    );
  });
  if (pages > 1) lines.push(t("ui.pageIndicator", { page: p + 1, pages }));
  lines.push(t("ui.roomRewardContinueOption"));
  return lines.join("\n");
}

export function renderFooter(ui: RewardsUiState): string {
  return ui.viewing ? t("ui.detailFooter") : t("ui.roomRewardFooter");
}
