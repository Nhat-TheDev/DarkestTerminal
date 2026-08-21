#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { App } from "./ui/app";
import { showMainMenu } from "./ui/mainMenu";
import { showCharacterSelect } from "./ui/characterSelect";
import { showSaveSelect } from "./ui/saveSelect";
import { PALETTE } from "./ui/theme";
import { Game } from "./engine/game";
import { CLASSES } from "./data/classes";
import { loadSave, gameFromSave } from "./engine/save";

async function main() {
  const renderer = await createCliRenderer({ exitOnCtrlC: true, backgroundColor: PALETTE.bg });

  // Loops back to the main menu if "Tiếp tục" is chosen but the player then backs out (Esc)
  // of the save list without picking one.
  for (;;) {
    const choice = await showMainMenu(renderer);
    if (choice === "new") {
      const classIds = await showCharacterSelect(renderer, CLASSES);
      new App(renderer, new Game(Date.now(), classIds));
      return;
    }
    const saveMeta = await showSaveSelect(renderer);
    if (!saveMeta) continue;
    new App(renderer, gameFromSave(loadSave(saveMeta.id)));
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
