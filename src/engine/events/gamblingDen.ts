import type { GameState } from "../../types";
import { grantArtifact, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { pickArtifactOfRarity } from "../../data/artifacts";
import { t } from "../../data/strings";
import { BALANCE } from "../../data/balanceConfig";
import { closeEvent } from "./shared";

const ROUNDS = BALANCE.events.gamblingDenRounds;

function activeGambleOrError(state: GameState): PartyActionError | NonNullable<GameState["activeEvent"]> {
  const active = state.activeEvent;
  if (!active || active.eventId !== "gambling-den") return { reason: t("errors.noActiveChoice") };
  return active;
}

/** Rolls the round at `roundIndex` (0-based) against the already-staked pot, and resolves the outcome. */
function rollRound(state: GameState, ctx: EngineContext, roundIndex: number, pot: number): void {
  const cfg = ROUNDS[roundIndex]!;
  const won = ctx.rng.chance(cfg.winChance);
  if (!won) {
    state.message = t("game.gamblingDenLost");
    if (state.activeEvent) state.activeEvent.gambleState = undefined;
    closeEvent(state);
    return;
  }
  const isFinalRound = roundIndex === ROUNDS.length - 1;
  if (isFinalRound) {
    state.message = t("game.gamblingDenJackpot");
    if (state.activeEvent) state.activeEvent.gambleState = undefined;
    const rarity = cfg.jackpotRarity ?? "epic";
    const [first, second] = [pickArtifactOfRarity(rarity, ctx.rng), pickArtifactOfRarity(rarity, ctx.rng)];
    state.secondJackpotArtifactId = second;
    grantArtifact(state, first, "event");
    closeEvent(state);
    return;
  }
  const newPot = pot * 2;
  // gambleState.round (1-indexed, round just won) doubles as the 0-based index of the next round.
  if (state.activeEvent) state.activeEvent.gambleState = { round: roundIndex + 1, pot: newPot, maxRounds: ROUNDS.length };
  state.message = t("game.gamblingDenPotDoubled", { pot: newPot });
}

export function gamblingDenEnter(state: GameState, ctx: EngineContext): PartyActionError | null {
  const active = activeGambleOrError(state);
  if ("reason" in active) return active;
  const round1 = ROUNDS[0]!;
  if (state.coins < round1.stake) return { reason: t("errors.notEnoughCoins") };
  state.coins -= round1.stake;
  rollRound(state, ctx, 0, round1.stake);
  return null;
}

export function gamblingDenContinue(state: GameState, ctx: EngineContext): PartyActionError | null {
  const active = activeGambleOrError(state);
  if ("reason" in active) return active;
  const gamble = active.gambleState;
  if (!gamble) return { reason: t("errors.noActiveChoice") };
  const nextRoundIndex = gamble.round;
  rollRound(state, ctx, nextRoundIndex, gamble.pot);
  return null;
}

export function gamblingDenStop(state: GameState): PartyActionError | null {
  const active = activeGambleOrError(state);
  if ("reason" in active) return active;
  const gamble = active.gambleState;
  if (!gamble) return { reason: t("errors.noActiveChoice") };
  state.coins += gamble.pot;
  state.message = t("game.gamblingDenBanked", { pot: gamble.pot });
  active.gambleState = undefined;
  closeEvent(state);
  return null;
}

export function gamblingDenLeave(state: GameState): void {
  state.message = t("game.leftNoBet");
  closeEvent(state);
}
