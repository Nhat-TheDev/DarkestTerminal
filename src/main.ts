#!/usr/bin/env bun
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { App, type RunExit } from "./ui/app";
import { showMainMenu } from "./ui/mainMenu";
import { showPartySelect } from "./ui/partySelect";
import { showSlotSelect, type SlotSelectMode } from "./ui/saveSelect";
import { PALETTE } from "./ui/theme";
import { Game } from "./engine/game";
import { CLASSES } from "./data/classes";
import { loadSave, gameFromSave, saveRun, clearSlot, migrateLegacyProfile } from "./engine/save";
import { beginRun } from "./engine/profile";
import type { Id } from "./types";

/** `overwrite` wipes the slot only once the party is picked, so leaving party select keeps the old run. Null means the player left it. */
async function startRun(renderer: CliRenderer, slotId: Id, overwrite = false, exitHint?: string): Promise<Game | null> {
  const picks = await showPartySelect(renderer, CLASSES, overwrite ? null : slotId, exitHint);
  if (!picks) return null;
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

/** Leaving party select lands back on the slot list; null means the player left that too. */
async function chooseRun(renderer: CliRenderer, mode: SlotSelectMode): Promise<Game | null> {
  for (;;) {
    const slot = await showSlotSelect(renderer, mode);
    if (!slot) return null;
    if (mode === "continue" && slot.hasRun) return gameFromSave(loadSave(slot.id), slot.id);
    const game = await startRun(renderer, slot.id, slot.overwrite);
    if (game) return game;
  }
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
    let game = await chooseRun(renderer, await showMainMenu(renderer));
    // A finished run's slot stays with the player: "New Run" starts the next one in it.
    while (game && (await playRun(renderer, game)) === "newRun") {
      game = await startRun(renderer, game.currentSaveSlot!, false, "partySelect.mainMenuHint");
    }
  }
}

main().catch((err) => {
  // Without this the terminal stays in the alternate screen with mouse tracking on, and the error is never seen.
  activeRenderer?.destroy();
  console.error(err);
  process.exit(1);
});
