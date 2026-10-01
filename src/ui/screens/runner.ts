import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { ShopOffer } from "../../types";
import { barterBuffFor, barterCost } from "../../engine/events/barter";
import { BALANCE } from "../../data/balanceConfig";
import { describeItemEffects, getItem } from "../../data/items";
import { t } from "../../data/strings";
import { buybackPrice, shopPrice } from "../../engine/events/runner";
import type { UiState } from "../state";
import { inventoryEntries } from "../state";
import { digitHint, digitRange, joinHints } from "../keyHints";
import { truncateText } from "../layout";
import { paginate } from "../pagination";
import type { ScreenContext } from "./context";

export type RunnerUiState = Extract<UiState, { kind: "runnerNotice" } | { kind: "runnerShop" } | { kind: "runnerSell" } | { kind: "runnerBarter" }>;

/** Offers still on the cloth, numbered on screen in order; `index` is the offer's place in the runner's stock. */
function unsoldOffers(game: Game): { offer: ShopOffer; index: number }[] {
  return (game.state.restRunner?.offers ?? []).map((offer, index) => ({ offer, index })).filter(({ offer }) => !offer.sold);
}

/** Inventory items the runner will buy. */
export function sellableEntries(game: Game) {
  return inventoryEntries(game.state.inventory).filter(({ item }) => buybackPrice(item) !== null);
}

/** Barter offers still open, numbered on screen in order; `index` is the offer's place in the runner's list. */
function openBarterOffers(game: Game): { itemId: string; index: number }[] {
  return (game.state.restRunner?.barterOffers ?? []).map((offer, index) => ({ itemId: offer.itemId, index, done: offer.done })).filter((offer) => !offer.done);
}

function describeBarterBuff(itemId: string): string {
  const labels = { attack: t("ui.barterStatAttack"), defense: t("ui.barterStatDefense"), speed: t("ui.barterStatSpeed") };
  return barterBuffFor(itemId)
    .map((effect) => (effect.kind === "healOverTime" ? t("ui.barterRegen", { percent: effect.maxHpPercentPerTurn }) : t("ui.barterStat", { stat: labels[effect.stat], percent: effect.percent })))
    .join(", ");
}

function offerName(offer: ShopOffer): string {
  const name = getItem(offer.itemId).name;
  return offer.lot ? `${name} ×${BALANCE.runner.lotSize}` : name;
}

function refreshesLeft(game: Game): number {
  return BALANCE.events.merchantMaxRefreshes - (game.state.restRunner?.refreshCount ?? 0);
}

function report(ctx: ScreenContext, err: { reason: string } | null): void {
  if (err) ctx.reportUnusable(err.reason);
  else ctx.logInfo(ctx.game.state.message);
}

export function handleKey(ctx: ScreenContext, ui: RunnerUiState, key: KeyEvent, digit: number | null): void {
  switch (ui.kind) {
    case "runnerNotice": {
      if (key.name !== "return") break;
      ctx.game.dismissRunnerNotice();
      ctx.syncUiToGameState();
      break;
    }
    case "runnerShop": {
      if (key.name === "return") {
        ctx.game.leaveRunner();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      } else if (key.name === "r") {
        report(ctx, ctx.game.runnerRefresh());
        ctx.syncUiToGameState();
      } else if (key.name === "x") {
        if (sellableEntries(ctx.game).length > 0) ctx.setUi({ kind: "runnerSell" });
      } else if (key.name === "t") {
        if (openBarterOffers(ctx.game).length > 0) ctx.setUi({ kind: "runnerBarter" });
      } else if (digit !== null) {
        const picked = unsoldOffers(ctx.game)[digit - 1];
        if (!picked) break;
        report(ctx, ctx.game.runnerBuy(picked.index));
        ctx.syncUiToGameState();
      }
      break;
    }
    case "runnerBarter": {
      if (digit === null) break;
      const picked = openBarterOffers(ctx.game)[digit - 1];
      if (!picked) break;
      report(ctx, ctx.game.runnerBarter(picked.index));
      if (openBarterOffers(ctx.game).length === 0) ctx.setUi({ kind: "runnerShop" });
      ctx.syncUiToGameState();
      break;
    }
    case "runnerSell": {
      if (digit === null) break;
      const { pageItems } = paginate(sellableEntries(ctx.game), ctx.getListPage());
      const picked = pageItems[digit - 1];
      if (!picked) break;
      report(ctx, ctx.game.runnerSell(picked.item.id));
      if (sellableEntries(ctx.game).length === 0) ctx.setUi({ kind: "runnerShop" });
      ctx.syncUiToGameState();
      break;
    }
  }
}

export function renderMain(game: Game, ui: RunnerUiState, page = 0): string {
  const s = game.state;
  switch (ui.kind) {
    case "runnerNotice":
      return t(`runner.notice${s.restRunner?.noticeVariant ?? 0}`);
    case "runnerShop": {
      const offers = unsoldOffers(game);
      const lines = [t("ui.runnerCoins", { coins: s.coins }), "", t("ui.runnerGoods")];
      if (offers.length === 0) lines.push(t("ui.runnerNothingLeft"));
      offers.forEach(({ offer }, i) => {
        const item = getItem(offer.itemId);
        lines.push(t("ui.runnerOfferLine", { i: i + 1, name: offerName(offer), price: shopPrice(item.tier, offer.lot) }));
        lines.push(t("ui.runnerOfferEffect", { effect: truncateText(describeItemEffects(item), 72) }));
      });
      lines.push("");
      lines.push(
        refreshesLeft(game) > 0
          ? t("ui.runnerRefreshOption", { cost: BALANCE.events.merchantRefreshCostCoins, remaining: refreshesLeft(game) })
          : t("ui.runnerRefreshNone")
      );
      if (sellableEntries(game).length > 0) lines.push(t("ui.runnerSellOption"));
      if (openBarterOffers(game).length > 0) lines.push(t("ui.runnerBarterOption"));
      lines.push(t("ui.runnerLeaveOption"));
      return lines.join("\n");
    }
    case "runnerBarter": {
      const lines = [t("ui.runnerBarterTitle")];
      openBarterOffers(game).forEach(({ itemId }, i) => {
        const item = getItem(itemId);
        lines.push(t("ui.runnerBarterLine", { i: i + 1, name: item.name, cost: barterCost(itemId), have: s.inventory[itemId] ?? 0 }));
        lines.push(t("ui.runnerBarterEffect", { effect: describeBarterBuff(itemId) }));
      });
      return lines.join("\n");
    }
    case "runnerSell": {
      const { pageItems } = paginate(sellableEntries(game), page);
      const lines = [t("ui.runnerCoins", { coins: s.coins }), "", t("ui.runnerSellTitle")];
      pageItems.forEach(({ item, qty }, i) => lines.push(t("ui.runnerSellLine", { i: i + 1, name: item.name, qty, price: buybackPrice(item) ?? 0 })));
      return lines.join("\n");
    }
  }
}

/** Only keys that do something right now are advertised: `[r]` while a refresh is left, `[x]` while there is something to sell. */
export function renderFooter(ui: RunnerUiState, game: Game, page = 0): string {
  switch (ui.kind) {
    case "runnerNotice":
      return t("ui.footerRunnerNotice");
    case "runnerShop": {
      const buy = unsoldOffers(game).length;
      return joinHints(
        buy > 0 ? t("ui.footerRunnerBuy", { keys: digitRange(buy)! }) : null,
        refreshesLeft(game) > 0 ? t("ui.footerRunnerRefresh") : null,
        sellableEntries(game).length > 0 ? t("ui.footerRunnerSell") : null,
        openBarterOffers(game).length > 0 ? t("ui.footerRunnerBarter") : null,
        t("ui.footerRunnerLeave")
      );
    }
    case "runnerBarter":
      return joinHints(t("ui.footerRunnerTrade", { keys: digitRange(openBarterOffers(game).length) ?? "1" }), t("ui.footerBackOnly"));
    case "runnerSell": {
      const { pageItems } = paginate(sellableEntries(game), page);
      return joinHints(digitHint("ui.footerRunnerSellPick", pageItems.length, "ui.footerBackOnly"), pageItems.length > 0 ? t("ui.footerBackOnly") : null);
    }
  }
}
