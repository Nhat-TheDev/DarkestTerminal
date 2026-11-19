import type { KeyEvent, StyledText } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import { optionDetailLines, ANSWER_INDENT } from "../effectLine";
import { PALETTE, colorChunk, boldColorChunk, joinLines } from "../theme";
import type { ScreenContext } from "./context";

export function handleKey(ctx: ScreenContext, key: KeyEvent): void {
  if (key.name !== "return") return;
  ctx.game.acknowledgeChoiceNarration();
  ctx.syncUiToGameState();
}

export function renderMain(game: Game): StyledText {
  const passage = game.state.pendingChoiceNarration;
  if (!passage) return joinLines([]);
  const result = passage.result;
  const signed = (value: number) => value > 0 ? `+${value}` : `−${Math.abs(value)}`;
  const details: string[] = [];
  if (result.coinsDelta) details.push(t("ui.choiceNarrationCoins", { delta: signed(result.coinsDelta) }));
  if (result.faithDelta) details.push(t("ui.choiceNarrationFaith", { delta: signed(result.faithDelta) }));
  for (const hp of result.hpChanges ?? []) details.push(t("ui.choiceNarrationHp", { character: hp.name, before: hp.before, after: hp.after }));
  for (const artifact of result.offeredArtifacts ?? []) details.push(t("ui.choiceNarrationArtifactOffered", { artifact: artifact.name }));
  for (const artifact of result.removedArtifacts ?? []) details.push(t("ui.choiceNarrationArtifactRemoved", { artifact: artifact.name }));
  for (const item of result.receivedItems ?? []) details.push(t("ui.choiceNarrationItemReceived", { item: item.name, count: item.count }));
  if (result.gamble) {
    const gamble = result.gamble;
    const key = { win: "ui.choiceNarrationGamble", loss: "ui.choiceNarrationGamble", banked: "ui.choiceNarrationGambleBankedLine", jackpot: "ui.choiceNarrationGambleJackpotLine" }[gamble.outcome];
    details.push(t(key, { ...gamble, count: result.offeredArtifacts?.length ?? 0, outcome: t(`ui.choiceNarrationGamble${{ win: "Win", loss: "Loss", banked: "Banked", jackpot: "Jackpot" }[gamble.outcome]}`) }));
  }
  if (result.boon) details.push(t("ui.choiceNarrationBoon", { religion: result.boon.name }));
  return joinLines([
    [boldColorChunk(passage.title, PALETTE.title)], [],
    ...passage.text.split("\n").map((line) => [colorChunk(line, PALETTE.text)]),
    ...(details.length ? [[], ...optionDetailLines(null, details[0]!), ...details.slice(1).map((line) => [colorChunk(`${ANSWER_INDENT}${line}`, PALETTE.dim)])] : []),
  ]);
}

export function renderFooter(): string {
  return t("ui.footerChoiceNarration");
}
