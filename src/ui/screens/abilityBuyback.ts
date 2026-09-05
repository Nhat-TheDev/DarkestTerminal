import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { getAbility } from "../../data/abilities";
import { BALANCE } from "../../data/balanceConfig";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

export type AbilityBuybackUiState = Extract<UiState, { kind: "abilityBuyback" }>;

/**
 * 1 decision at a time (`Game.resolveAbilityBuyback`) — Reclaim or Skip the lost-set entry currently
 * at `pendingAbilityBuyback.resolvedIndex`. Once the last entry resolves, `pendingAbilityBuyback`
 * clears and `syncUiToGameState` routes on to the results-bearing `gameover` screen.
 * `11-abilities.md` §11.1 "Death flow" step 3.
 */
export function handleKey(ctx: ScreenContext, _ui: AbilityBuybackUiState, _key: KeyEvent, digit: number | null): void {
  const pending = ctx.game.state.pendingAbilityBuyback;
  if (!pending) {
    ctx.syncUiToGameState();
    return;
  }
  if (digit === 1) {
    const err = ctx.game.resolveAbilityBuyback("reclaim");
    if (err) {
      ctx.reportUnusable(err.reason);
      return;
    }
  } else if (digit === 2) {
    ctx.game.resolveAbilityBuyback("skip");
  } else {
    return;
  }
  ctx.syncUiToGameState();
}

export function renderMain(game: Game): string {
  const s = game.state;
  const pending = s.pendingAbilityBuyback;
  const entry = pending?.entries[pending.resolvedIndex];
  if (!pending || !entry) return "";

  const character = s.party.find((c) => c.id === entry.characterId);
  const ability = getAbility(entry.lostAbilityId);
  const cost = BALANCE.abilities.stardustCostByRarity[entry.rarity];

  const lines: string[] = [];
  if (pending.entries.length > 1) {
    lines.push(t("ui.abilityBuybackProgress", { current: pending.resolvedIndex + 1, total: pending.entries.length }));
    lines.push("");
  }
  lines.push(t("ui.abilityBuybackTitle", { character: character?.name ?? "", ability: ability.name, rarity: entry.rarity }));
  lines.push("");
  lines.push(t("ui.abilityBuybackStardust", { current: s.runStardust }));
  lines.push("");
  lines.push(t("ui.abilityBuybackReclaimOption", { cost }));
  lines.push(t("ui.abilityBuybackSkipOption"));
  return lines.join("\n");
}

export function renderFooter(): string {
  return t("ui.footerChoose");
}
