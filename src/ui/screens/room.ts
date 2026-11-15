import { StyledText, type KeyEvent, type TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import { getRoom } from "../../engine/dungeon";
import { t } from "../../data/strings";
import { getEvent } from "../../data/events";
import { BALANCE } from "../../data/balanceConfig";
import type { Room } from "../../types";
import type { UiState } from "../state";
import { inventoryEntries } from "../state";
import type { ScreenContext } from "./context";
import { PALETTE, colorChunk, joinLines } from "../theme";
import { digitHint } from "../keyHints";
import { chatFaith } from "../../engine/survival";
import { ANSWER_INDENT, EFFECT_SEPARATOR, statEffectText } from "../effectLine";

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
      if (digit === 4 && ctx.game.state.restRunner) {
        ctx.setUi({ kind: "runnerShop" });
        break;
      }
      const choice = key.name === "return" ? "leave" : digit === 1 ? "eat" : digit === 2 ? "chat" : digit === 3 ? "pray" : null;
      if (choice === null) break;
      ctx.game.restAction(choice);
      ctx.syncUiToGameState();
      break;
    }
  }
}

export function pathChoiceLine(index: number, room: Room): string {
  return room.hidden ? `  [${index}] ${t("ui.unknownRoomChoice")}` : `  [${index}] ${room.name} (${room.type})`;
}

export function renderMain(game: Game, ui: RoomUiState): string | StyledText {
  const s = game.state;
  switch (ui.kind) {
    case "room": {
      const room = getRoom(s.floor, s.currentRoomId);
      const choices = game.connectedRoomChoices();
      const lines: TextChunk[][] = [
        [
          colorChunk(
            room.rolledEventId ? t("ui.roomEventTitleLine", { room: room.name, event: getEvent(room.rolledEventId).name }) : t("ui.roomTitleLine", { room: room.name }),
            PALETTE.text
          ),
        ],
        [],
        [colorChunk(t("ui.pathsLabel"), PALETTE.text)],
      ];
      choices.forEach((r, i) => lines.push([colorChunk(pathChoiceLine(i + 1, r), PALETTE.text)]));
      return joinLines(lines);
    }

    case "rest": {
      const room = getRoom(s.floor, s.currentRoomId);
      const rest = BALANCE.survival;
      const pray = BALANCE.rest.pray;
      const chatFaithGain = chatFaith(s.party);
      const options: [string, string[]][] = [
        [t("ui.restOptEat"), [statEffectText("hp", 1, rest.eatDrinkRestoreFraction), statEffectText("mp", 1, rest.eatDrinkRestoreFraction), statEffectText("satiety", 1, rest.eatDrinkSatietyRestore)]],
        [
          t("ui.restOptChat"),
          [
            statEffectText("fear", -1, rest.chatFearRelief),
            statEffectText("hp", 1, rest.chatRestoreFraction),
            statEffectText("mp", 1, rest.chatRestoreFraction),
            ...(chatFaithGain > 0 ? [statEffectText("faith", 1, chatFaithGain)] : []),
          ],
        ],
        [t("ui.restOptPray"), [statEffectText("faith", 1, pray.faith), statEffectText("fear", -1, pray.fearRelief)]],
      ];
      const color = room.rested ? PALETTE.disabled : PALETTE.text;
      const effectColor = room.rested ? PALETTE.disabled : PALETTE.dim;
      const lines: TextChunk[][] = [
        [colorChunk(t("dungeon.restEnter", { room: room.name }), PALETTE.text)],
        [],
        ...options.flatMap(([label, effects]) => [[colorChunk(label, color)], [colorChunk(`${ANSWER_INDENT}${effects.join(EFFECT_SEPARATOR)}`, effectColor)]]),
      ];
      if (s.restRunner) lines.push([colorChunk(t("ui.restOptTrade"), PALETTE.text)]);
      lines.push([colorChunk(t("ui.restOptSkip"), PALETTE.text)]);
      return joinLines(lines);
    }
  }
}

export function renderFooter(ui: RoomUiState, game: Game): string {
  switch (ui.kind) {
    case "room": {
      // `[i]` is ignored on an empty bag, so it is not advertised there.
      const itemsKey = inventoryEntries(game.state.inventory).length > 0 ? "ui.footerRoom" : "ui.footerRoomNoItems";
      return digitHint(itemsKey, game.connectedRoomChoices().length);
    }
    case "rest":
      if (getRoom(game.state.floor, game.state.currentRoomId).rested) return game.state.restRunner ? t("ui.footerRestDoneTrade") : t("ui.footerRestDone");
      return digitHint("ui.footerRest", game.state.restRunner ? 4 : 3);
  }
}
