import { StyledText, type KeyEvent, type TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { PartyActionError } from "../../engine/party";
import { getRoom } from "../../engine/dungeon";
import { templeActionsAvailable } from "../../engine/temple";
import { BALANCE } from "../../data/balanceConfig";
import { getReligion } from "../../data/religions";
import { t } from "../../data/strings";
import { digitHint } from "../keyHints";
import { PALETTE, boldColorChunk, colorChunk, joinLines } from "../theme";
import type { ScreenContext } from "./context";

const ACTION_COUNT = 2;

export function handleKey(ctx: ScreenContext, key: KeyEvent, digit: number | null): void {
  const { game } = ctx;
  const available = templeActionsAvailable(game.state);
  let err: PartyActionError | null = null;
  if (key.name === "return") game.templeLeave();
  else if (digit === 1) err = available.giveAll ? game.templeGiveAll() : game.templeGiveBlood();
  else if (digit === 2) err = game.templeAskBoon();
  else return;
  if (err) {
    ctx.reportUnusable(err.reason);
    return;
  }
  ctx.logInfo(game.state.message);
  ctx.syncUiToGameState();
}

export function renderMain(game: Game): StyledText {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  const religion = getReligion(room.templeReligionId!);
  const available = templeActionsAvailable(game.state);
  const { giveBlood, giveAll, boon } = BALANCE.temple;
  const percent = (fraction: number) => Math.round(fraction * 100);

  const lines: TextChunk[][] = [[boldColorChunk(religion.name, religion.style.color)], [], [colorChunk(religion.templeDescription, PALETTE.text)], []];
  const action = (n: number, label: string, text: string, locked: string | null) =>
    lines.push([locked === null ? colorChunk(text, PALETTE.text) : colorChunk(t("ui.templeLocked", { n, label, reason: locked }), PALETTE.disabled)]);

  if (available.giveAll) {
    lines.push([colorChunk(t("ui.templeGiveAll", { percent: percent(BALANCE.temple.giveAll.hpCost), faith: BALANCE.temple.giveAll.faithGain }), PALETTE.text)]);
  } else {
    action(
      1,
      t("ui.templeGiveBloodLabel"),
      t("ui.templeGiveBlood", {
        percent: percent(giveBlood.hpCost),
        faith: giveBlood.faithGain,
        upper: percent(giveBlood.upperHpFraction),
        lower: percent(giveBlood.lowerHpFraction),
        floor: percent(giveBlood.hpFloor),
        lowerFaith: giveBlood.lowerFaithGain,
      }),
      available.giveBlood === "locked" ? t("ui.templeTooWeak") : null,
    );
  }
  action(2, t("ui.templeBoonLabel"), t("ui.templeBoon", { cost: boon.faithCost }), available.boon ? null : t("ui.templeNoFaith", { cost: boon.faithCost }));
  lines.push([], [colorChunk(t("ui.templeLeave"), PALETTE.text)]);
  return joinLines(lines);
}

export function renderFooter(_game: Game): string {
  return digitHint("ui.footerTemple", ACTION_COUNT);
}
