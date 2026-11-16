import { StyledText, type KeyEvent, type TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { PartyActionError } from "../../engine/party";
import { getRoom } from "../../engine/dungeon";
import { bloodGift, templeActionsAvailable } from "../../engine/temple";
import { BALANCE } from "../../data/balanceConfig";
import { getReligion } from "../../data/religions";
import { t } from "../../data/strings";
import { digitHint } from "../keyHints";
import { optionDetailLines } from "../effectLine";
import type { UiState } from "../state";
import { PALETTE, boldColorChunk, colorChunk, joinLines } from "../theme";
import type { ScreenContext } from "./context";

const ACTION_COUNT = 2;

type DonorsUi = Extract<UiState, { kind: "templeDonors" }>;

function finish(ctx: ScreenContext, err: PartyActionError | null): void {
  if (err) {
    ctx.reportUnusable(err.reason);
    return;
  }
  ctx.logInfo(ctx.game.state.message);
  ctx.syncUiToGameState();
}

export function handleKey(ctx: ScreenContext, key: KeyEvent, digit: number | null): void {
  const { game } = ctx;
  if (key.name === "return") {
    if (!ctx.confirm(key.name)) return;
    game.templeLeave();
    finish(ctx, null);
  } else if (digit === 1) {
    const { giveBlood } = templeActionsAvailable(game.state);
    if (giveBlood === "open") ctx.setUi({ kind: "templeDonors", selectedIds: [] });
    else ctx.reportUnusable(t(giveBlood === "full" ? "errors.templeTorchFull" : "errors.templeNoDonor"));
  } else if (digit === 2) {
    if (!templeActionsAvailable(game.state).boon) {
      ctx.reportUnusable(t("errors.templeNoFaith"));
      return;
    }
    if (!ctx.confirm(key.name)) return;
    finish(ctx, game.templeAskBoon());
  }
}

export function handleDonorKey(ctx: ScreenContext, ui: DonorsUi, key: KeyEvent, digit: number | null): void {
  const { game } = ctx;
  if (key.name === "return") {
    if (ui.selectedIds.length === 0) {
      ctx.reportUnusable(t("errors.templeNoDonor"));
      return;
    }
    if (!ctx.confirm(key.name)) return;
    finish(ctx, game.templeGiveBlood(ui.selectedIds));
    return;
  }
  const member = digit === null ? undefined : game.state.party[digit - 1];
  if (!member) return;
  if (ui.selectedIds.includes(member.id)) {
    ctx.setUi({ kind: "templeDonors", selectedIds: ui.selectedIds.filter((id) => id !== member.id) });
  } else if (bloodGift(game.state, member)) {
    ctx.setUi({ kind: "templeDonors", selectedIds: [...ui.selectedIds, member.id] });
  } else {
    ctx.reportUnusable(t("errors.templeCannotGive", { character: member.name }));
  }
}

function templeHeader(game: Game): TextChunk[][] {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  const religion = getReligion(room.templeReligionId!);
  return [[boldColorChunk(religion.name, religion.style.color)], [], [colorChunk(religion.templeDescription, PALETTE.text)], []];
}

export function renderMain(game: Game): StyledText {
  const available = templeActionsAvailable(game.state);
  const { boon } = BALANCE.temple;
  const lines = templeHeader(game);
  const action = (n: number, label: string, text: string, locked: string | null, cost: string, result: string) =>
    lines.push(
      [locked === null ? colorChunk(text, PALETTE.text) : colorChunk(t("ui.templeLocked", { n, label, reason: locked }), PALETTE.disabled)],
      ...optionDetailLines(cost, result)
    );

  const { matching, other } = BALANCE.temple.giveBlood;
  const gains = [matching.faithGain, matching.lowFaithGain, other.faithGain];
  const bloodLocked = available.giveBlood === "full" ? t("ui.templeTorchFull") : available.giveBlood === "none" ? t("ui.templeNoDonor") : null;
  action(
    1,
    t("ui.templeGiveBloodLabel"),
    t("ui.templeGiveBlood"),
    bloodLocked,
    t("ui.templeGiveBloodCost"),
    t("ui.templeGiveBloodResult", { min: Math.min(...gains), max: Math.max(...gains) })
  );
  action(
    2,
    t("ui.templeBoonLabel"),
    t("ui.templeBoon"),
    available.boon ? null : t("ui.templeNoFaith", { cost: boon.faithCost }),
    t("ui.templeBoonCost", { cost: boon.faithCost }),
    t("ui.templeBoonResult")
  );
  lines.push([], [colorChunk(t("ui.templeLeave"), PALETTE.text)]);
  return joinLines(lines);
}

export function renderDonors(game: Game, ui: DonorsUi): StyledText {
  const { state } = game;
  const room = getRoom(state.floor, state.currentRoomId);
  const religion = getReligion(room.templeReligionId!);
  const { hpFloor, matching, other } = BALANCE.temple.giveBlood;
  const percent = (fraction: number) => Math.round(fraction * 100);
  const nameWidth = Math.max(...state.party.map((c) => c.name.length));

  const lines: TextChunk[][] = [[colorChunk(t("ui.templeDonorsTitle"), PALETTE.title)]];
  state.party.forEach((c, i) => {
    const gift = bloodGift(state, c);
    const selected = ui.selectedIds.includes(c.id);
    const fields = { n: i + 1, mark: selected ? "x" : " ", name: c.name.padEnd(nameWidth), hp: c.hp, maxHp: c.maxHp };
    lines.push([
      gift
        ? colorChunk(t("ui.templeDonorRow", { ...fields, after: gift.hpAfter, faith: gift.faith }), selected ? PALETTE.title : PALETTE.text)
        : colorChunk(t("ui.templeDonorCannot", fields), PALETTE.disabled),
    ]);
  });
  lines.push([]);
  const rules = t("ui.templeDonorRules", {
    religion: religion.name,
    min: percent(matching.minHpFraction),
    cost: percent(matching.hpCost),
    faith: matching.faithGain,
    low: percent(matching.lowMinHpFraction),
    floor: percent(hpFloor),
    lowFaith: matching.lowFaithGain,
    otherMin: percent(other.minHpFraction),
    otherCost: percent(other.hpCost),
    otherFaith: other.faithGain,
  });
  for (const line of rules.split("\n")) lines.push([colorChunk(line, PALETTE.dim)]);
  return joinLines(lines);
}

export function renderFooter(_game: Game): string {
  return digitHint("ui.footerTemple", ACTION_COUNT);
}

export function renderDonorsFooter(game: Game): string {
  return digitHint("ui.footerTempleDonors", game.state.party.length);
}
