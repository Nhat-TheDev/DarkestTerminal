import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { PALETTE, boldColorChunk, colorChunk, joinLines } from "./theme";
import { renderBigTextStacked } from "./bigText";
import { t } from "../data/strings";
import { listSaves } from "../engine/save";

export type MainMenuChoice = "new" | "continue";

/**
 * Title screen shown once before the game boots, followed by a New/Continue
 * choice. "Tiếp tục" only appears when at least 1 save exists on disk.
 * Resolves once the player picks, tearing down its own renderables so the
 * next screen (character select or save list) starts on a clean root.
 */
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
      content: joinLines([[colorChunk(t("mainMenu.pressAnyKey"), PALETTE.text)]]),
      marginTop: 3,
    });
    root.add(hint);

    const hasSaves = listSaves().length > 0;

    // "Button"-styled option boxes (bordered, own background) instead of bare numbered text
    // lines — otherwise the 2 choices blend into the title/subtitle block above them and are
    // easy to miss.
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

    const chooseHint = new TextRenderable(renderer, {
      id: "menu-choose-hint",
      content: joinLines([[colorChunk(t("mainMenu.chooseHint"), PALETTE.dim)]]),
      marginTop: 1,
    });

    const showChoice = () => {
      hint.content = joinLines([[colorChunk(t("mainMenu.chooseTitle"), PALETTE.title)]]);
      root.add(buttonsRow);
      root.add(chooseHint);

      // Persistent listener, removed explicitly on a valid choice — see the note on
      // characterSelect.ts's onKey: opentui's InternalKeyHandler bypasses .once()'s
      // self-removal, so re-registering .once() from inside its own handler only survives 1 hop.
      const onChoiceKey = (key: KeyEvent) => {
        if (key.name === "1") {
          renderer.keyInput.off("keypress", onChoiceKey);
          renderer.root.remove(root);
          resolve("new");
        } else if (key.name === "2" && hasSaves) {
          renderer.keyInput.off("keypress", onChoiceKey);
          renderer.root.remove(root);
          resolve("continue");
        }
      };
      renderer.keyInput.on("keypress", onChoiceKey);
    };

    const onKey = (_key: KeyEvent) => showChoice();
    renderer.keyInput.once("keypress", onKey);
  });
}
