import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { PALETTE, boldColorChunk, colorChunk, joinLines } from "./theme";
import { renderBigTextStacked } from "./bigText";
import { t } from "../data/strings";

/**
 * Title screen shown once before the game boots. Resolves on the first
 * keypress and tears down its own renderables so App starts on a clean root.
 */
export function showMainMenu(renderer: CliRenderer): Promise<void> {
  return new Promise((resolve) => {
    const root = new BoxRenderable(renderer, {
      id: "menu-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PALETTE.bg,
    });
    renderer.root.add(root);

    const title = new TextRenderable(renderer, {
      id: "menu-title",
      content: joinLines(renderBigTextStacked(["Darkest", "Terminal"]).map((row) => [boldColorChunk(row, PALETTE.title)])),
    });
    root.add(title);

    const subtitle = new TextRenderable(renderer, {
      id: "menu-subtitle",
      content: joinLines([[colorChunk(t("mainMenu.tagline"), PALETTE.dim)]]),
    });
    root.add(subtitle);

    const hint = new TextRenderable(renderer, {
      id: "menu-hint",
      content: joinLines([[colorChunk(t("mainMenu.pressAnyKey"), PALETTE.text)]]),
    });
    root.add(hint);

    const onKey = (_key: KeyEvent) => {
      renderer.root.remove(root);
      resolve();
    };
    renderer.keyInput.once("keypress", onKey);
  });
}
