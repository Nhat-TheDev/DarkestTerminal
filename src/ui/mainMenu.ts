import { BoxRenderable, CliRenderEvents, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { PALETTE, boldColorChunk, colorChunk, joinLines, highlightKeyHints } from "./theme";
import { joinHints } from "./keyHints";
import { renderBigTextStacked } from "./bigText";
import { t } from "../data/strings";
import { listSaves, APP_VERSION } from "../engine/save";

export type MainMenuChoice = "new" | "continue";

/** Below this width the battlefield/event panels start clipping content, so nudge the player to widen. */
const NARROW_TERMINAL_WIDTH = 100;

export function showMainMenu(renderer: CliRenderer): Promise<MainMenuChoice> {
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

    const version = new TextRenderable(renderer, {
      id: "menu-version",
      content: joinLines([[colorChunk(t("mainMenu.version", { version: APP_VERSION }), PALETTE.dim)]]),
      position: "absolute",
      right: 1,
      bottom: 0,
    });
    root.add(version);

    const terminalHint = new BoxRenderable(renderer, {
      id: "menu-terminal-hint",
      position: "absolute",
      bottom: 1,
      left: 0,
      right: 0,
      alignItems: "center",
      visible: renderer.width < NARROW_TERMINAL_WIDTH,
    });
    terminalHint.add(
      new TextRenderable(renderer, {
        id: "menu-terminal-hint-text",
        content: joinLines([[colorChunk(t("mainMenu.terminalSizeHint"), PALETTE.dim)]]),
      })
    );
    root.add(terminalHint);

    const onResize = (width: number) => {
      terminalHint.visible = width < NARROW_TERMINAL_WIDTH;
    };
    renderer.on(CliRenderEvents.RESIZE, onResize);

    const title = new TextRenderable(renderer, {
      id: "menu-title",
      content: joinLines(renderBigTextStacked(["Darkest", "Terminal"]).map((row) => [boldColorChunk(row, PALETTE.title)])),
    });
    root.add(title);

    const subtitle = new TextRenderable(renderer, {
      id: "menu-subtitle",
      content: joinLines([[colorChunk(t("mainMenu.tagline"), PALETTE.dim)]]),
      marginTop: 1,
    });
    root.add(subtitle);

    const hint = new TextRenderable(renderer, {
      id: "menu-hint",
      content: "",
      marginTop: 3,
    });
    root.add(hint);

    const hasSaves = listSaves().length > 0;

    // Pre-game screens have no `App` footer bar, so they anchor their own in the same bottom-left
    // spot the in-game one occupies — the key hints never move between screens.
    const footer = new TextRenderable(renderer, {
      id: "menu-footer",
      content: joinLines([highlightKeyHints(t("mainMenu.pressAnyKey"))]),
      position: "absolute",
      left: 2,
      bottom: 1,
    });
    root.add(footer);

    const buttonsRow = new BoxRenderable(renderer, {
      id: "menu-buttons",
      flexDirection: "row",
      gap: 3,
      marginTop: 3,
    });

    const makeButton = (id: string, label: string) => {
      const box = new BoxRenderable(renderer, {
        id,
        border: true,
        borderColor: PALETTE.borderAccent,
        backgroundColor: PALETTE.panelBg,
        paddingX: 3,
        paddingY: 1,
        alignItems: "center",
        justifyContent: "center",
      });
      box.add(new TextRenderable(renderer, { id: `${id}-label`, content: joinLines([[colorChunk(label, PALETTE.text)]]) }));
      return box;
    };

    buttonsRow.add(makeButton("menu-btn-new", t("mainMenu.newGameOption").trim()));
    if (hasSaves) buttonsRow.add(makeButton("menu-btn-continue", t("mainMenu.continueOption").trim()));

    const showChoice = () => {
      hint.content = joinLines([[colorChunk(t("mainMenu.chooseTitle"), PALETTE.title)]]);
      root.add(buttonsRow);
      footer.content = joinLines([highlightKeyHints(joinHints(t("mainMenu.chooseHint"), hasSaves ? t("mainMenu.continueHint") : null))]);

      const onChoiceKey = (key: KeyEvent) => {
        if (key.name === "1") {
          renderer.keyInput.off("keypress", onChoiceKey);
          renderer.off(CliRenderEvents.RESIZE, onResize);
          renderer.root.remove(root);
          resolve("new");
        } else if (key.name === "2" && hasSaves) {
          renderer.keyInput.off("keypress", onChoiceKey);
          renderer.off(CliRenderEvents.RESIZE, onResize);
          renderer.root.remove(root);
          resolve("continue");
        }
      };
      renderer.keyInput.on("keypress", onChoiceKey);
    };

    // Never `.once()` here: `InternalKeyHandler.emit` calls the unwrapped listeners directly, so a
    // `once` wrapper never removes itself — it would keep re-running `showChoice()` on every key
    // for the rest of the session, stacking a fresh `onChoiceKey` each time. Persistent `on` plus
    // an explicit `off` is the pattern every other screen in this codebase uses.
    const onKey = (_key: KeyEvent) => {
      renderer.keyInput.off("keypress", onKey);
      showChoice();
    };
    renderer.keyInput.on("keypress", onKey);
  });
}
