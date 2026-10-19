import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import { getEvent } from "../../data/events";
import { COMBAT_STAT_LABEL, getStatusEffect } from "../../data/statusEffects";
import { BALANCE } from "../../data/balanceConfig";
import { GATEKEEPER_EVENT_ID } from "../../engine/events/gatekeeper";
import { digitHint } from "../keyHints";
import { getRoom } from "../../engine/dungeon";
import { pathChoiceLine } from "./room";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

/** The Gatekeeper scene before floor 1 (`the-gatekeeper`): leave the toll or keep it, then move into floor 1's entry room, its only path. */
export type GatekeeperUiState = Extract<UiState, { kind: "gatekeeper" }>;

export function handleKey(ctx: ScreenContext, _ui: GatekeeperUiState, _key: KeyEvent, digit: number | null): void {
  if (ctx.game.state.gatekeeperAnswer === null) {
    if (digit === 1) {
      const err = ctx.game.answerGatekeeper("paid");
      // The blessing's numbers go to the log, so the Dungeon panel keeps room for his words and the path in.
      if (err) ctx.reportUnusable(err.reason);
      else ctx.logInfo(t("ui.gatekeeperBlessing", { stats: blessingStats(), rooms: BALANCE.gatekeeper.blessingRooms }));
    } else if (digit === 2) ctx.game.answerGatekeeper("refused");
    return;
  }
  if (digit === 1) {
    ctx.game.enterDungeon();
    ctx.syncUiToGameState();
  }
}

/** Every stat the blessing raises, read from its status entry so the text never drifts from what the fight applies. */
function blessingStats(): string {
  return getStatusEffect(BALANCE.gatekeeper.blessingStatusId)
    .perTurnEffects.map((e) => t("ui.gatekeeperBlessingStat", { percent: e.minPercent ?? 0, stat: COMBAT_STAT_LABEL[e.combatStat!] }))
    .join(", ");
}

export function renderMain(game: Game, _ui: GatekeeperUiState): string {
  const answer = game.state.gatekeeperAnswer;
  if (answer === null) {
    const toll = BALANCE.gatekeeper.tollCoins;
    return [
      getEvent(GATEKEEPER_EVENT_ID).description.replace("{{toll}}", String(toll)),
      "",
      t("ui.gatekeeperLeaveCoins", { toll }),
      t("ui.gatekeeperKeepCoins"),
    ].join("\n");
  }
  const entry = getRoom(game.state.floor, game.state.floor.entryRoomId);
  return [answer === "paid" ? t("ui.gatekeeperPaid") : t("ui.gatekeeperRefused"), "", t("ui.pathsLabel"), pathChoiceLine(1, entry)].join("\n");
}

export function renderFooter(_ui: GatekeeperUiState, game: Game): string {
  return game.state.gatekeeperAnswer === null ? digitHint("ui.footerChoose", 2) : digitHint("ui.footerGatekeeperMove", 1);
}
