import type { KeyEvent } from "@opentui/core";
import { manualSave } from "../../engine/save";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

export type SaveUiState = Extract<UiState, { kind: "saveMenu" }>;

export function handleKey(ctx: ScreenContext, ui: SaveUiState, _key: KeyEvent, digit: number | null): void {
  if (digit === 1) {
    manualSave(ctx.game);
    ctx.pushToast(t("ui.gameSavedMsg"));
    ctx.setUi(ui.previous);
  } else if (digit === 2) {
    manualSave(ctx.game);
    ctx.quit();
  } else if (digit === 3) {
    ctx.setUi(ui.previous);
  }
}

export function renderMain(): string {
  return [t("ui.saveMenuTitle"), "", t("ui.saveMenuSave"), t("ui.saveMenuSaveAndExit"), t("ui.saveMenuCancel")].join("\n");
}

export function renderFooter(): string {
  return t("ui.saveMenuFooter");
}
