import { StyledText, type KeyEvent, type TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import { getRoom } from "../../engine/dungeon";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { inventoryEntries } from "../state";
import type { ScreenContext } from "./context";
import { PALETTE, colorChunk, joinLines } from "../theme";
import { digitHint } from "../keyHints";

export type RoomUiState = Extract<UiState, { kind: "room" } | { kind: "rest" }>;

export function handleKey(ctx: ScreenContext, ui: RoomUiState, key: KeyEvent, digit: number | null): void {
  switch (ui.kind) {
    case "room": {
      if (key.name === "i") {
        if (inventoryEntries(ctx.game.state.inventory).length > 0) ctx.setUi({ kind: "pickItemOutOfCombat" });
        break;
      }
      if (key.name === "a") {
        ctx.setUi({ kind: "artifactMenu" });
        break;
      }
      if (digit === null) break;
      const choices = ctx.game.connectedRoomChoices();
      const choice = choices[digit - 1];
      if (choice) {
        ctx.game.move(choice.id);
        ctx.logInfo(ctx.game.state.message);
      }
      ctx.syncUiToGameState();
      break;
    }
    case "rest": {
      const choice = key.name === "return" ? "skip" : digit === 1 ? "eat" : digit === 2 ? "chat" : null;
      if (choice === null) break;
      ctx.game.restAction(choice);
      ctx.syncUiToGameState();
      break;
    }
  }
}

export function renderMain(game: Game, ui: RoomUiState): string | StyledText {
  const s = game.state;
  switch (ui.kind) {
    case "room": {
      const room = getRoom(s.floor, s.currentRoomId);
      const choices = game.connectedRoomChoices();
      const lines: TextChunk[][] = [
        [colorChunk(t("ui.roomTypeLine", { type: room.type, clearedTag: room.cleared ? t("ui.clearedTag") : "" }), PALETTE.text)],
        [],
        [colorChunk(t("ui.pathsLabel"), PALETTE.text)],
      ];
      choices.forEach((r, i) => lines.push([colorChunk(`  [${i + 1}] ${r.name} (${r.type})`, PALETTE.text)]));
      return joinLines(lines);
    }

    case "rest": {
      const room = getRoom(s.floor, s.currentRoomId);
      return [t("dungeon.restEnter", { room: room.name }), "", t("ui.restOptEat"), t("ui.restOptChat"), t("ui.restOptSkip")].join("\n");
    }
  }
}

export function renderFooter(ui: RoomUiState, game: Game): string {
  switch (ui.kind) {
    case "room": {
      // `[i]` is silently ignored on an empty bag (see handleKey), so it is not advertised there.
      const itemsKey = inventoryEntries(game.state.inventory).length > 0 ? "ui.footerRoom" : "ui.footerRoomNoItems";
      return digitHint(itemsKey, game.connectedRoomChoices().length);
    }
    case "rest":
      return t("ui.footerChooseActivity");
  }
}
