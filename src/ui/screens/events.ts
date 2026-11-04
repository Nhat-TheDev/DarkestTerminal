import type { StyledText, KeyEvent } from "@opentui/core";
import type { Character, GameState } from "../../types";
import type { Game } from "../../engine/game";
import { MERCHANT_PRICE_COINS, BLOOD_ALTAR_HP_PERCENT, COLLAPSED_FLOOR_HP_PERCENT } from "../../engine/game";
import { getArtifact } from "../../data/artifacts";
import { getEvent } from "../../data/events";
import { getRoom, pickEventText } from "../../engine/dungeon";
import { getJournalEcho } from "../../data/journal";
import { pickReflectionPrompt } from "../../engine/events/shared";
import { t } from "../../data/strings";
import { BALANCE } from "../../data/balanceConfig";
import type { UiState } from "../state";
import { ownedArtifactEntries } from "../state";
import { digitHint } from "../keyHints";
import { truncateText } from "../layout";
import { paginate, PAGE_SIZE } from "../pagination";
import type { ScreenContext } from "./context";

/** Reserves digit 9 on every page for the trailing "Leave" option. */
const SACRIFICE_PAGE_SIZE = PAGE_SIZE - 1;

const GAMBLING_DEN_ROUNDS = BALANCE.events.gamblingDenRounds;
const MERCHANT_REFRESH_COST_COINS = BALANCE.events.merchantRefreshCostCoins;
const MERCHANT_MAX_REFRESHES = BALANCE.events.merchantMaxRefreshes;
const HERMIT_EXCHANGE_COST_COINS = BALANCE.events.wanderingHermitExchangeCostCoins;

export type EventUiState = Extract<
  UiState,
  | { kind: "eventInstantReward" }
  | { kind: "eventArtifactShop" }
  | { kind: "eventCursedOffer" }
  | { kind: "eventPairedOffer" }
  | { kind: "eventHpGamble" }
  | { kind: "eventHpGamblePickPayer" }
  | { kind: "eventArtifactSacrifice" }
  | { kind: "eventCoinGamble" }
  | { kind: "eventFortuneExchange" }
  | { kind: "eventFortuneExchangePickArtifact" }
  | { kind: "eventCombatReward" }
  | { kind: "eventReflection" }
>;

function partyHpPickerLines(party: Character[]): string[] {
  return party.map((c, i) => `  [${i + 1}] ${c.name}${t("ui.hpSuffix", { hp: c.hp, maxHp: c.maxHp })}`);
}

function currentEventDescription(state: GameState): string {
  const room = getRoom(state.floor, state.currentRoomId);
  if (!room.rolledEventId) return "";
  const text = pickEventText(state, room, getEvent(room.rolledEventId));
  const echo = room.journalEchoId ? getJournalEcho(room.journalEchoId) : undefined;
  return echo ? `${text}\n\n${echo.text}` : text;
}

export function handleKey(ctx: ScreenContext, ui: EventUiState, key: KeyEvent, digit: number | null): void {
  switch (ui.kind) {
    case "eventInstantReward": {
      if (digit === 1) {
        const err = ctx.game.openChest();
        if (err) ctx.reportUnusable(err.reason);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventArtifactShop": {
      const offers = ctx.game.state.activeEvent?.offerArtifactIds ?? [];
      if (ui.viewingOfferIndex !== null) {
        const offerIndex = ui.viewingOfferIndex;
        if (offerIndex >= offers.length) {
          ctx.setUi({ kind: "eventArtifactShop", viewingOfferIndex: null });
          ctx.syncUiToGameState();
          break;
        }
        if (digit === 1) {
          const err = ctx.game.merchantPurchase(offerIndex);
          if (err) ctx.reportUnusable(err.reason);
          else ctx.logInfo(ctx.game.state.message);
          ctx.syncUiToGameState();
        } else if (digit === 2 || key.name === "escape") {
          ctx.setUi({ kind: "eventArtifactShop", viewingOfferIndex: null });
        }
        break;
      }
      if (key.name === "r") {
        const err = ctx.game.merchantRefresh();
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
        break;
      }
      if (key.name === "escape") {
        ctx.game.merchantLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
        break;
      }
      if (digit === null) break;
      if (digit <= offers.length) {
        ctx.setUi({ kind: "eventArtifactShop", viewingOfferIndex: digit - 1 });
      } else if (digit === offers.length + 1) {
        ctx.game.merchantLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventCursedOffer": {
      if (digit === 1 || digit === 2) {
        ctx.game.cursedShrineDecide(digit === 1);
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventPairedOffer": {
      if (digit === 1 || digit === 2) {
        const err = ctx.game.twinAltarsChoose((digit - 1) as 0 | 1);
        if (err) ctx.reportUnusable(err.reason);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventHpGamble": {
      if (digit === 1) {
        ctx.setUi({ kind: "eventHpGamblePickPayer", gamble: ui.gamble });
      } else if (digit === 2) {
        if (ui.gamble === "hpGamble") ctx.game.bloodAltarLeave();
        else ctx.game.collapsedFloorLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventHpGamblePickPayer": {
      if (digit === null) break;
      const character = ctx.game.state.party[digit - 1];
      if (!character) break;
      const err = ui.gamble === "hpGamble" ? ctx.game.bloodAltarPay(character.id) : ctx.game.collapsedFloorAttempt(character.id);
      if (err) ctx.reportUnusable(err.reason);
      else ctx.logInfo(ctx.game.state.message);
      ctx.syncUiToGameState();
      break;
    }
    case "eventArtifactSacrifice": {
      if (digit === null) break;
      const { pageItems } = paginate(ownedArtifactEntries(ctx.game.state.party), ctx.getListPage(), SACRIFICE_PAGE_SIZE);
      if (digit <= pageItems.length) {
        const err = ctx.game.sacrifice(pageItems[digit - 1]!.artifactId);
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      } else if (digit === pageItems.length + 1) {
        ctx.game.sacrificeLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventCoinGamble": {
      const gamble = ctx.game.state.activeEvent?.gambleState;
      if (!gamble) {
        if (digit === 1) {
          const err = ctx.game.gamblingDenEnter();
          if (err) ctx.reportUnusable(err.reason);
          else ctx.logInfo(ctx.game.state.message);
          ctx.syncUiToGameState();
        } else if (digit === 2) {
          ctx.game.gamblingDenLeave();
          ctx.logInfo(ctx.game.state.message);
          ctx.syncUiToGameState();
        }
        break;
      }
      if (digit === 1) {
        const err = ctx.game.gamblingDenStop();
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      } else if (digit === 2) {
        const err = ctx.game.gamblingDenContinue();
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventFortuneExchange": {
      if (digit === 1) {
        if (ownedArtifactEntries(ctx.game.state.party).length === 0) {
          ctx.reportUnusable(t("ui.noArtifactToReroll"));
          break;
        }
        ctx.setUi({ kind: "eventFortuneExchangePickArtifact" });
      } else if (digit === 2) {
        ctx.game.hermitLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventFortuneExchangePickArtifact": {
      if (digit === null) break;
      const { pageItems } = paginate(ownedArtifactEntries(ctx.game.state.party), ctx.getListPage());
      const entry = pageItems[digit - 1];
      if (!entry) break;
      const err = ctx.game.hermitExchangeFortune(entry.artifactId);
      if (err) ctx.reportUnusable(err.reason);
      else ctx.logInfo(ctx.game.state.message);
      ctx.syncUiToGameState();
      break;
    }
    case "eventCombatReward": {
      if (digit === 1) {
        const err = ctx.game.enterGuardianFight();
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      } else if (digit === 2 || key.name === "escape") {
        const err = ctx.game.skipGuardianFight();
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventReflection": {
      const stances = ["curious", "wary", "dismissive"] as const;
      const stance = digit !== null ? stances[digit - 1] : undefined;
      if (stance) {
        ctx.game.pickReflectionStance(stance);
        ctx.syncUiToGameState();
      }
      break;
    }
  }
}

export function renderMain(game: Game, ui: EventUiState, page = 0): string | StyledText {
  const s = game.state;
  switch (ui.kind) {
    case "eventInstantReward": {
      const room = getRoom(s.floor, s.currentRoomId);
      const event = room.rolledEventId ? getEvent(room.rolledEventId) : undefined;
      return [currentEventDescription(s), "", event?.instantRewardActionLabel ?? t("ui.openChestOption")].join("\n");
    }

    case "eventArtifactShop": {
      const offers = s.activeEvent?.offerArtifactIds ?? [];
      if (ui.viewingOfferIndex !== null) {
        const artifactId = offers[ui.viewingOfferIndex];
        if (!artifactId) return "";
        const a = getArtifact(artifactId);
        const price = MERCHANT_PRICE_COINS[a.rarity];
        const cursedTag = a.isCursed ? t("ui.merchantDetailCursedTag") : "";
        const lines = [
          t("ui.merchantDetailTitle", { name: a.name, rarity: a.rarity, price }) + cursedTag,
          "",
          t("ui.merchantDetailDesc", { desc: a.description }),
          "",
          t("ui.merchantDetailBuyOption"),
          t("ui.merchantDetailCancelOption"),
        ];
        return lines.join("\n");
      }
      const refreshCount = s.activeEvent?.refreshCount ?? 0;
      const lines = [currentEventDescription(s), "", t("ui.merchantOffers")];
      offers.forEach((id, i) => {
        const a = getArtifact(id);
        lines.push(t("ui.merchantOfferLineCoins", { i: i + 1, name: a.name, rarity: a.rarity, price: MERCHANT_PRICE_COINS[a.rarity], desc: truncateText(a.description, 34) }));
      });
      lines.push(t("ui.leaveEmptyHandedOption", { i: offers.length + 1 }));
      lines.push(
        refreshCount >= MERCHANT_MAX_REFRESHES
          ? t("ui.merchantMaxRefreshesReached")
          : t("ui.merchantRefreshOption", { cost: MERCHANT_REFRESH_COST_COINS, remaining: MERCHANT_MAX_REFRESHES - refreshCount })
      );
      return lines.join("\n");
    }

    case "eventCursedOffer": {
      const artifactId = s.activeEvent?.offerArtifactIds[0];
      const a = artifactId ? getArtifact(artifactId) : null;
      const curseTag = a?.isCursed ? t("ui.cursedTag") : "";
      return [
        currentEventDescription(s),
        "",
        a ? `${a.name} (${a.rarity})${curseTag} — ${a.description}` : "...",
        "",
        t("ui.acceptOption"),
        t("ui.declineOption"),
      ].join("\n");
    }

    case "eventPairedOffer": {
      const offers = s.activeEvent?.offerArtifactIds ?? [];
      const lines = [currentEventDescription(s), "", t("ui.twinAltarsIntro")];
      offers.forEach((id, i) => {
        const a = getArtifact(id);
        lines.push(`  [${i + 1}] ${a.name} (${a.rarity}) — ${truncateText(a.description, 40)}`);
      });
      return lines.join("\n");
    }

    case "eventHpGamble": {
      const percent = ui.gamble === "hpGamble" ? BLOOD_ALTAR_HP_PERCENT : COLLAPSED_FLOOR_HP_PERCENT;
      const resultLine = ui.gamble === "hpGamble" ? t("ui.bloodAltarResult") : t("ui.collapsedFloorResult", { chance: Math.round(BALANCE.events.collapsedFloorSuccessChance * 100) });
      return [currentEventDescription(s), "", t("ui.payToTry", { percent }), resultLine, "", t("ui.payOption"), t("ui.leaveOption")].join("\n");
    }

    case "eventHpGamblePickPayer": {
      const lines = [t("ui.whoPays"), ...partyHpPickerLines(s.party)];
      return lines.join("\n");
    }

    case "eventArtifactSacrifice": {
      const candidates = ownedArtifactEntries(s.party);
      const { pageItems, page: p, pages } = paginate(candidates, page, SACRIFICE_PAGE_SIZE);
      const lines = [currentEventDescription(s), "", t("ui.chooseSacrifice")];
      pageItems.forEach(({ artifactId }, i) => {
        const a = getArtifact(artifactId);
        lines.push(`  [${i + 1}] ${a.name} (${a.rarity})`);
      });
      lines.push(`  [${pageItems.length + 1}] ${t("ui.leaveRitualOption")}`);
      if (candidates.length === 0) lines.push(t("ui.noSuitableArtifacts"));
      if (pages > 1) lines.push(t("ui.pageIndicator", { page: p + 1, pages }));
      return lines.join("\n");
    }

    case "eventCoinGamble": {
      const gamble = s.activeEvent?.gambleState;
      if (!gamble) {
        const round1 = GAMBLING_DEN_ROUNDS[0]!;
        return [
          currentEventDescription(s),
          "",
          t("ui.gamblingDenEntryPrompt", { stake: round1.stake, chance: Math.round(round1.winChance * 100) }),
          "",
          t("ui.gamblingDenEnterOption", { stake: round1.stake }),
          t("ui.gamblingDenLeaveOption"),
        ].join("\n");
      }
      const nextRound = GAMBLING_DEN_ROUNDS[gamble.round]!;
      return [
        t("ui.gamblingDenRoundLine", { round: gamble.round, pot: gamble.pot, chance: Math.round(nextRound.winChance * 100) }),
        "",
        t("ui.gamblingDenStopOption", { pot: gamble.pot }),
        t("ui.gamblingDenContinueOption"),
      ].join("\n");
    }

    case "eventFortuneExchange": {
      const hasAny = ownedArtifactEntries(s.party).length > 0;
      return [
        currentEventDescription(s),
        "",
        t("ui.hermitExchangeOnlyIntro"),
        t("ui.hermitExchangeOption", { cost: HERMIT_EXCHANGE_COST_COINS, suffix: hasAny ? "" : t("ui.hermitNoArtifactSuffix") }),
        t("ui.hermitLeaveOption"),
      ].join("\n");
    }

    case "eventFortuneExchangePickArtifact": {
      const { pageItems, page: p, pages } = paginate(ownedArtifactEntries(s.party), page);
      const lines = [t("ui.hermitExchangeIntro", { cost: HERMIT_EXCHANGE_COST_COINS })];
      pageItems.forEach(({ artifactId }, i) => lines.push(`  [${i + 1}] ${getArtifact(artifactId).name} (${getArtifact(artifactId).rarity})`));
      if (pages > 1) lines.push(t("ui.pageIndicator", { page: p + 1, pages }));
      return lines.join("\n");
    }

    case "eventCombatReward": {
      const room = getRoom(s.floor, s.currentRoomId);
      const lines = [t("ui.guardianFightIntro", { room: room.name }), "", currentEventDescription(s), "", t("ui.guardianFightEnterOption")];
      // Skip is hidden past the forced threshold; `guardianFightSkip` also rejects it.
      if (room.chainVariant !== "forced" && room.chainVariant !== "forced2" && room.chainVariant !== "forced3") lines.push(t("ui.guardianFightSkipOption"));
      return lines.join("\n");
    }

    case "eventReflection": {
      const pending = s.pendingReflection;
      if (!pending) return "";
      const event = getEvent(pending.eventId);
      if (!event.reflection) return "";
      const room = getRoom(s.floor, s.currentRoomId);
      const prompt = pickReflectionPrompt(s, room, event) ?? "";
      const { curious, wary, dismissive } = event.reflection.options;
      return [prompt, "", `  [1] ${curious}`, `  [2] ${wary}`, `  [3] ${dismissive}`].join("\n");
    }
  }
}

export function renderFooter(ui: EventUiState, game: Game, page = 0): string {
  const s = game.state;
  switch (ui.kind) {
    case "eventHpGamblePickPayer":
      return digitHint("ui.footerChooseCharacter", s.party.length);
    case "eventArtifactShop": {
      if (ui.viewingOfferIndex !== null) return digitHint("ui.detailFooter", 2);
      const options = (s.activeEvent?.offerArtifactIds.length ?? 0) + 1;
      return digitHint((s.activeEvent?.refreshCount ?? 0) >= MERCHANT_MAX_REFRESHES ? "ui.footerChoose" : "ui.footerMerchant", options);
    }
    case "eventArtifactSacrifice": {
      const { pageItems } = paginate(ownedArtifactEntries(s.party), page, SACRIFICE_PAGE_SIZE);
      return digitHint("ui.footerChoose", pageItems.length + 1);
    }
    case "eventFortuneExchangePickArtifact": {
      const { pageItems } = paginate(ownedArtifactEntries(s.party), page);
      return digitHint("ui.footerChooseArtifact", pageItems.length);
    }
    case "eventCombatReward": {
      const room = getRoom(s.floor, s.currentRoomId);
      const forced = room.chainVariant === "forced" || room.chainVariant === "forced2" || room.chainVariant === "forced3";
      return digitHint("ui.footerChoose", forced ? 1 : 2);
    }
    case "eventPairedOffer":
      return digitHint("ui.footerChoose", s.activeEvent?.offerArtifactIds.length ?? 0);
    case "eventInstantReward":
      return digitHint("ui.footerChoose", 1);
    case "eventReflection":
      return digitHint("ui.footerChoose", 3);
    case "eventCursedOffer":
    case "eventHpGamble":
    case "eventCoinGamble":
    case "eventFortuneExchange":
      return digitHint("ui.footerChoose", 2);
  }
}
