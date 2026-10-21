#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { App } from "./ui/app";
import { showMainMenu } from "./ui/mainMenu";
import { showPartySelect } from "./ui/partySelect";
import { showSlotSelect } from "./ui/saveSelect";
import { PALETTE } from "./ui/theme";
import { Game } from "./engine/game";
import { CLASSES } from "./data/classes";
import { loadSave, gameFromSave, saveRun } from "./engine/save";

async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: PALETTE.bg,
    // OpenTUI waits 100 ms after a resize before redrawing; until then the old frame sits clipped at the new edge.
    debounceDelay: 1,
  });

  for (;;) {
    const choice = await showMainMenu(renderer);
    if (choice === "new") {
      const slotId = await showSlotSelect(renderer, "new");
      if (!slotId) continue;
      const picks = await showPartySelect(renderer, CLASSES);
      const game = new Game(
        Date.now(),
        picks.map((p) => p.classId),
        undefined,
        picks.map((p) => p.abilityId),
        true
      );
      // Claim the slot now, so a death before the first save doesn't leave the previous run's file in it.
      game.currentSaveSlot = slotId;
      saveRun(game);
      new App(renderer, game);
      return;
    }
    const slotId = await showSlotSelect(renderer, "continue");
    if (!slotId) continue;
    new App(renderer, gameFromSave(loadSave(slotId), slotId));
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
