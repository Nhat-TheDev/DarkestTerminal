#!/usr/bin/env bun
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { App, type RunExit } from "./ui/app";
import { showMainMenu } from "./ui/mainMenu";
import { showPartySelect } from "./ui/partySelect";
import { showSlotSelect } from "./ui/saveSelect";
import { PALETTE } from "./ui/theme";
import { Game } from "./engine/game";
import { CLASSES } from "./data/classes";
import { loadSave, gameFromSave, saveRun, clearSlot, migrateLegacyProfile } from "./engine/save";
import { beginRun } from "./engine/profile";
import type { Id } from "./types";

/** `overwrite` wipes the slot only once the party is picked, so quitting during party select keeps the old run. */
async function startRun(renderer: CliRenderer, slotId: Id, overwrite = false): Promise<Game> {
  const picks = await showPartySelect(renderer, CLASSES, overwrite ? null : slotId);
  if (overwrite) clearSlot(slotId);
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

let activeRenderer: CliRenderer | undefined;

async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: PALETTE.bg,
    // OpenTUI waits 100 ms after a resize before redrawing; until then the old frame sits clipped at the new edge.
    debounceDelay: 1,
  });
  activeRenderer = renderer;
  migrateLegacyProfile();

  for (;;) {
    const choice = await showMainMenu(renderer);
    let game: Game;
    if (choice === "new") {
      const slot = await showSlotSelect(renderer, "new");
      if (!slot) continue;
      game = await startRun(renderer, slot.id, slot.overwrite);
    } else {
      const slot = await showSlotSelect(renderer, "continue");
      if (!slot) continue;
      game = slot.hasRun ? gameFromSave(loadSave(slot.id), slot.id) : await startRun(renderer, slot.id);
    }
    // A finished run's slot stays with the player: "New Run" starts the next one in it.
    while ((await playRun(renderer, game)) === "newRun") {
      game = await startRun(renderer, game.currentSaveSlot!);
    }
  }
}

main().catch((err) => {
  // Without this the terminal stays in the alternate screen with mouse tracking on, and the error is never seen.
  activeRenderer?.destroy();
  console.error(err);
  process.exit(1);
});
