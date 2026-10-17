import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import { getEvent } from "../../data/events";
import { getStatusEffect } from "../../data/statusEffects";
import { BALANCE } from "../../data/balanceConfig";
import { GATEKEEPER_EVENT_ID } from "../../engine/events/gatekeeper";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

/** The Gatekeeper scene before floor 1 (`the-gatekeeper`): leave the toll or keep it, then a single Enter steps into the dungeon. */
export type GatekeeperUiState = Extract<UiState, { kind: "gatekeeper" }>;

export function handleKey(ctx: ScreenContext, _ui: GatekeeperUiState, _key: KeyEvent, digit: number | null): void {
  if (ctx.game.state.gatekeeperAnswer === null) {
    if (digit === 1) {
      ctx.game.answerGatekeeper("paid");
      // The blessing's numbers go to the log, so the Dungeon panel keeps room for his words and [1] Enter.
      ctx.logInfo(t("ui.gatekeeperBlessing", { defense: blessingPercent("defense"), attack: blessingPercent("attack"), rooms: BALANCE.gatekeeper.blessingRooms }));
    } else if (digit === 2) ctx.game.answerGatekeeper("refused");
    return;
  }
  if (digit === 1) {
    ctx.game.enterDungeon();
    ctx.syncUiToGameState();
  }
}

/** The blessing's percentages, read from its status entry so the text never drifts from what the fight applies. */
function blessingPercent(stat: "defense" | "attack"): number {
  const effect = getStatusEffect(BALANCE.gatekeeper.blessingStatusId).perTurnEffects.find((e) => e.kind === "modifyCombatStat" && e.combatStat === stat);
  return effect?.minPercent ?? 0;
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
  return [answer === "paid" ? t("ui.gatekeeperPaid") : t("ui.gatekeeperRefused"), "", t("ui.gatekeeperEnter")].join("\n");
}

export function renderFooter(_ui: GatekeeperUiState, game: Game): string {
  return game.state.gatekeeperAnswer === null ? t("ui.footerGatekeeperChoice") : t("ui.footerGatekeeperEnter");
}
