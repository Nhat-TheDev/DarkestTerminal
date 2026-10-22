#!/usr/bin/env bun
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { App, type RunExit } from "./ui/app";
import { showMainMenu } from "./ui/mainMenu";
import { showPartySelect } from "./ui/partySelect";
import { showSlotSelect } from "./ui/saveSelect";
import { PALETTE } from "./ui/theme";
import { Game } from "./engine/game";
import { CLASSES } from "./data/classes";
import { loadSave, gameFromSave, saveRun, clearSlot, listSlots, migrateLegacyProfile } from "./engine/save";
import { beginRun } from "./engine/profile";
import type { Id } from "./types";

async function startRun(renderer: CliRenderer, slotId: Id): Promise<Game> {
  const picks = await showPartySelect(renderer, CLASSES, slotId);
  beginRun(slotId);
  const game = new Game(
    Date.now(),
    picks.map((p) => p.classId),
    undefined,
    picks.map((p) => p.abilityId),
    true,
    slotId
  );
  // Claim the slot now, so a death before the first save doesn't leave the previous run's file in it.
  saveRun(game);
  return game;
}

function playRun(renderer: CliRenderer, game: Game): Promise<RunExit> {
  return new Promise((resolve) => new App(renderer, game, { onExit: resolve }));
}

async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: PALETTE.bg,
    // OpenTUI waits 100 ms after a resize before redrawing; until then the old frame sits clipped at the new edge.
    debounceDelay: 1,
  });
  migrateLegacyProfile();

  for (;;) {
    const choice = await showMainMenu(renderer);
    let game: Game;
    if (choice === "new") {
      const slotId = await showSlotSelect(renderer, "new");
      if (!slotId) continue;
      // Only a slot holding a run asks before it is overwritten, and overwriting starts the slot over.
      if (listSlots().find((slot) => slot.id === slotId)?.meta) clearSlot(slotId);
      game = await startRun(renderer, slotId);
    } else {
      const slotId = await showSlotSelect(renderer, "continue");
      if (!slotId) continue;
      game = gameFromSave(loadSave(slotId), slotId);
    }
    // A finished run's slot stays with the player: "New run" starts the next one in it.
    while ((await playRun(renderer, game)) === "newRun") {
      game = await startRun(renderer, game.currentSaveSlot!);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
