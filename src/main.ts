#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { App } from "./ui/app";
import { showMainMenu } from "./ui/mainMenu";
import { showCharacterSelect } from "./ui/characterSelect";
import { showAbilitySelect } from "./ui/abilitySelect";
import { showSaveSelect } from "./ui/saveSelect";
import { PALETTE } from "./ui/theme";
import { Game } from "./engine/game";
import { CLASSES, getClass } from "./data/classes";
import { loadSave, gameFromSave } from "./engine/save";

async function main() {
  const renderer = await createCliRenderer({ exitOnCtrlC: true, backgroundColor: PALETTE.bg });

  for (;;) {
    const choice = await showMainMenu(renderer);
    if (choice === "new") {
      const classIds = await showCharacterSelect(renderer, CLASSES);
      const abilityIds = await showAbilitySelect(renderer, classIds.map((id) => getClass(id).name));
      new App(renderer, new Game(Date.now(), classIds, undefined, abilityIds));
      return;
    }
    const saveMeta = await showSaveSelect(renderer);
    if (!saveMeta) continue;
    new App(renderer, gameFromSave(loadSave(saveMeta.id), saveMeta.id));
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
