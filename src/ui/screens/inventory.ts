import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { formatItemEffect } from "../../data/items";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { inventoryEntries } from "../state";
import type { ScreenContext } from "./context";
import { trySelectItem } from "./combat";

export type InventoryUiState = Extract<UiState, { kind: "pickItemOutOfCombat" } | { kind: "itemDetail" }>;

export function handleKey(ctx: ScreenContext, ui: InventoryUiState, _key: KeyEvent, digit: number | null): void {
  switch (ui.kind) {
    case "pickItemOutOfCombat": {
      if (digit === null) break;
      const entry = inventoryEntries(ctx.game.state.inventory)[digit - 1];
      if (!entry) break;
      ctx.setUi({ kind: "itemDetail", item: entry.item, origin: { kind: "outOfCombat" } });
      break;
    }
    case "itemDetail": {
      if (ui.origin.kind === "outOfCombat") {
        if (digit === 1) ctx.setUi({ kind: "pickItemOutOfCombat" });
      } else if (digit === 1) {
        trySelectItem(ctx, ui.origin.actorRef, ui.item);
      } else if (digit === 2) {
        ctx.setUi({ kind: "pickItemInCombat", actorRef: ui.origin.actorRef });
      }
      break;
    }
  }
}

export function renderMain(game: Game, ui: InventoryUiState): string {
  const s = game.state;
  switch (ui.kind) {
    case "pickItemOutOfCombat": {
      const lines = [t("ui.chooseItemToUse")];
      inventoryEntries(s.inventory).forEach(({ item, qty }, i) => {
        lines.push(t("ui.inventoryLine", { i: i + 1, name: item.name, qty }));
      });
      return lines.join("\n");
    }

    case "itemDetail": {
      const { item, origin } = ui;
      const lines = [item.name, "", t("ui.effectLabel"), formatItemEffect(item), "", t("ui.descriptionLabel"), item.description, ""];
      if (origin.kind === "outOfCombat") {
        lines.push(t("ui.itemOutOfCombatViewOnlyHint"), "", t("ui.itemDetailBackOnlyOption"));
      } else {
        lines.push(t("ui.itemDetailUseOption"), t("ui.itemDetailBackOption"));
      }
      return lines.join("\n");
    }
  }
}

export function renderFooter(ui: InventoryUiState): string {
  switch (ui.kind) {
    case "pickItemOutOfCombat":
      return t("ui.footerChooseItemEsc");
    case "itemDetail":
      return t("ui.detailFooter");
  }
}
