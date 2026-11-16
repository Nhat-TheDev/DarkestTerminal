import type { StyledText, KeyEvent, TextChunk } from "@opentui/core";
import type { Character, GameState, ReflectionOption } from "../../types";
import type { Game } from "../../engine/game";
import { MERCHANT_PRICE_COINS, BLOOD_ALTAR_HP_PERCENT, COLLAPSED_FLOOR_HP_PERCENT } from "../../engine/game";
import { getArtifact, formatArtifactEffect } from "../../data/artifacts";
import { getEvent } from "../../data/events";
import { getItem } from "../../data/items";
import { getRoom, pickEventText } from "../../engine/dungeon";
import { getJournalEcho } from "../../data/journal";
import { pickReflectionPrompt } from "../../engine/events/shared";
import { shownOptions } from "../../engine/reflection";
import { t } from "../../data/strings";
import { gamblingJackpot } from "../../engine/events/gamblingDen";
import { BALANCE } from "../../data/balanceConfig";
import type { UiState } from "../state";
import { ownedArtifactEntries } from "../state";
import { digitHint } from "../keyHints";
import { answerLines, formatEffectLine, optionDetailLines } from "../effectLine";
import { PALETTE, boldColorChunk, colorChunk, joinLines } from "../theme";
import { truncateText } from "../layout";
import { paginate, PAGE_SIZE } from "../pagination";
import type { ScreenContext } from "./context";

/** Reserves digit 9 on every page for the trailing "Leave" option. */
const SACRIFICE_PAGE_SIZE = PAGE_SIZE - 1;

const GAMBLING_DEN_ROUNDS = BALANCE.events.gamblingDenRounds;
const MERCHANT_REFRESH_COST_COINS = BALANCE.events.merchantRefreshCostCoins;
const MERCHANT_MAX_REFRESHES = BALANCE.events.merchantMaxRefreshes;
const HERMIT_EXCHANGE_COST_COINS = BALANCE.events.wanderingHermitExchangeCostCoins;

export function pendingReflectionOptions(s: GameState): ReflectionOption[] {
  const reflection = s.pendingEventExit?.withReflection ? getEvent(s.pendingEventExit.eventId).reflection : undefined;
  return reflection ? shownOptions(s, reflection.options) : [];
}

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
  | { kind: "eventExit" }
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
        if (!ctx.confirm(key.name)) break;
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
          if (ctx.game.state.coins < MERCHANT_PRICE_COINS[getArtifact(offers[offerIndex]!).rarity]) {
            ctx.reportUnusable(t("errors.notEnoughCoins"));
            break;
          }
          if (!ctx.confirm(key.name)) break;
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
        if ((ctx.game.state.activeEvent?.refreshCount ?? 0) >= MERCHANT_MAX_REFRESHES) {
          ctx.reportUnusable(t("errors.merchantMaxRefreshesReached"));
          break;
        }
        if (ctx.game.state.coins < MERCHANT_REFRESH_COST_COINS) {
          ctx.reportUnusable(t("errors.notEnoughCoins"));
          break;
        }
        if (!ctx.confirm(key.name)) break;
        const err = ctx.game.merchantRefresh();
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
        break;
      }
      if (key.name === "escape") {
        if (!ctx.confirm(key.name)) break;
        ctx.game.merchantLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
        break;
      }
      if (digit === null) break;
      if (digit <= offers.length) {
        ctx.setUi({ kind: "eventArtifactShop", viewingOfferIndex: digit - 1 });
      } else if (digit === offers.length + 1) {
        if (!ctx.confirm(key.name)) break;
        ctx.game.merchantLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventCursedOffer": {
      if (digit === 1 || digit === 2) {
        if (!ctx.confirm(key.name)) break;
        ctx.game.cursedShrineDecide(digit === 1);
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventPairedOffer": {
      if (digit === 1 || digit === 2) {
        if (!ctx.confirm(key.name)) break;
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
        if (!ctx.confirm(key.name)) break;
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
      if (!ctx.confirm(key.name)) break;
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
        if (!ctx.confirm(key.name)) break;
        const err = ctx.game.sacrifice(pageItems[digit - 1]!.artifactId);
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      } else if (digit === pageItems.length + 1) {
        if (!ctx.confirm(key.name)) break;
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
          if (ctx.game.state.coins < GAMBLING_DEN_ROUNDS[0]!.stake) {
            ctx.reportUnusable(t("errors.notEnoughCoins"));
            break;
          }
          if (!ctx.confirm(key.name)) break;
          const err = ctx.game.gamblingDenEnter();
          if (err) ctx.reportUnusable(err.reason);
          else ctx.logInfo(ctx.game.state.message);
          ctx.syncUiToGameState();
        } else if (digit === 2) {
          if (!ctx.confirm(key.name)) break;
          ctx.game.gamblingDenLeave();
          ctx.logInfo(ctx.game.state.message);
          ctx.syncUiToGameState();
        }
        break;
      }
      if (digit === 1) {
        if (!ctx.confirm(key.name)) break;
        const err = ctx.game.gamblingDenStop();
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      } else if (digit === 2) {
        if (!ctx.confirm(key.name)) break;
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
        if (!ctx.confirm(key.name)) break;
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
      if (ctx.game.state.coins < HERMIT_EXCHANGE_COST_COINS) {
        ctx.reportUnusable(t("errors.notEnoughCoins"));
        break;
      }
      if (!ctx.confirm(key.name)) break;
      const err = ctx.game.hermitExchangeFortune(entry.artifactId);
      if (err) ctx.reportUnusable(err.reason);
      else ctx.logInfo(ctx.game.state.message);
      ctx.syncUiToGameState();
      break;
    }
    case "eventCombatReward": {
      if (digit === 1) {
        if (!ctx.confirm(key.name)) break;
        const err = ctx.game.enterGuardianFight();
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      } else if (digit === 2 || key.name === "escape") {
        if (!ctx.confirm(key.name)) break;
        const err = ctx.game.skipGuardianFight();
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventExit": {
      if (key.name === "return") {
        ctx.game.leaveEventRoom();
      } else if (digit !== null && digit <= pendingReflectionOptions(ctx.game.state).length) {
        const outcome = ctx.game.pickReflectionAnswer(digit - 1);
        if (outcome) ctx.logInfo(t("reflection.result", { effects: formatEffectLine(ctx.game.state, [outcome]) }));
      } else {
        break;
      }
      ctx.syncUiToGameState();
      break;
    }
  }
}

const text = (line: string): TextChunk[] => [colorChunk(line, PALETTE.text)];
const textLines = (block: string): TextChunk[][] => block.split("\n").map(text);
const coins = (amount: number) => t("ui.coinsCost", { coins: amount });

function chestResult(eventId: string | undefined): string | null {
  if (!eventId) return null;
  const event = getEvent(eventId);
  const parts: string[] = [];
  if (!event.noArtifactReward) parts.push(event.guaranteedArtifactId ? getArtifact(event.guaranteedArtifactId).name : t("ui.randomArtifact"));
  for (const { itemId, count } of event.guaranteedItems ?? []) parts.push(t("ui.itemCount", { name: getItem(itemId).name, count }));
  return parts.length > 0 ? parts.join(", ") : null;
}

export function renderMain(game: Game, ui: EventUiState, page = 0): string | StyledText {
  const s = game.state;
  switch (ui.kind) {
    case "eventInstantReward": {
      const room = getRoom(s.floor, s.currentRoomId);
      const event = room.rolledEventId ? getEvent(room.rolledEventId) : undefined;
      return joinLines([...textLines(currentEventDescription(s)), [], text(event?.instantRewardActionLabel ?? t("ui.openChestOption")), ...optionDetailLines(null, chestResult(room.rolledEventId))]);
    }

    case "eventArtifactShop": {
      const offers = s.activeEvent?.offerArtifactIds ?? [];
      if (ui.viewingOfferIndex !== null) {
        const artifactId = offers[ui.viewingOfferIndex];
        if (!artifactId) return "";
        const a = getArtifact(artifactId);
        const cursedTag = a.isCursed ? t("ui.merchantDetailCursedTag") : "";
        return joinLines([
          text(t("ui.merchantDetailTitle", { name: a.name, rarity: a.rarity }) + cursedTag),
          [],
          ...textLines(t("ui.merchantDetailDesc", { desc: a.description })),
          [],
          text(t("ui.merchantDetailBuyOption")),
          ...optionDetailLines(coins(MERCHANT_PRICE_COINS[a.rarity]), a.name),
          text(t("ui.merchantDetailCancelOption")),
        ]);
      }
      const refreshCount = s.activeEvent?.refreshCount ?? 0;
      const lines = [...textLines(currentEventDescription(s)), [], text(t("ui.merchantOffers"))];
      offers.forEach((id, i) => {
        const a = getArtifact(id);
        lines.push(text(t("ui.merchantOfferLine", { i: i + 1, name: a.name, rarity: a.rarity, desc: truncateText(a.description, 34) })), ...optionDetailLines(coins(MERCHANT_PRICE_COINS[a.rarity]), null));
      });
      lines.push(text(t("ui.leaveEmptyHandedOption", { i: offers.length + 1 })));
      if (refreshCount >= MERCHANT_MAX_REFRESHES) lines.push(text(t("ui.merchantMaxRefreshesReached")));
      else {
        const remaining = MERCHANT_MAX_REFRESHES - refreshCount - 1;
        lines.push(text(t("ui.merchantRefreshOption")), ...optionDetailLines(coins(MERCHANT_REFRESH_COST_COINS), t("ui.merchantRefreshResult", { count: BALANCE.events.merchantOfferCount, remaining })));
      }
      return joinLines(lines);
    }

    case "eventCursedOffer": {
      const artifactId = s.activeEvent?.offerArtifactIds[0];
      const a = artifactId ? getArtifact(artifactId) : null;
      const curseTag = a?.isCursed ? t("ui.cursedTag") : "";
      return joinLines([
        ...textLines(currentEventDescription(s)),
        [],
        text(a ? `${a.name} (${a.rarity})${curseTag} — ${a.description}` : "..."),
        [],
        text(t("ui.acceptOption")),
        ...optionDetailLines(null, a ? (a.isCursed ? t("ui.cursedArtifactResult", { name: a.name }) : a.name) : null),
        text(t("ui.declineOption")),
      ]);
    }

    case "eventPairedOffer": {
      const offers = s.activeEvent?.offerArtifactIds ?? [];
      const lines = [...textLines(currentEventDescription(s)), [], text(t("ui.twinAltarsIntro"))];
      offers.forEach((id, i) => {
        const a = getArtifact(id);
        lines.push(text(t("ui.twinAltarsOfferLine", { i: i + 1, name: a.name, rarity: a.rarity, effect: formatArtifactEffect(a) })), ...optionDetailLines(null, t("ui.twinAltarsResult", { name: a.name })));
      });
      return joinLines(lines);
    }

    case "eventHpGamble": {
      const percent = ui.gamble === "hpGamble" ? BLOOD_ALTAR_HP_PERCENT : COLLAPSED_FLOOR_HP_PERCENT;
      const result = ui.gamble === "hpGamble" ? t("ui.randomArtifact") : t("ui.collapsedFloorResult", { chance: Math.round(BALANCE.events.collapsedFloorSuccessChance * 100) });
      return joinLines([...textLines(currentEventDescription(s)), [], text(t("ui.payOption")), ...optionDetailLines(t("ui.hpGambleCost", { percent }), result), text(t("ui.leaveOption"))]);
    }

    case "eventHpGamblePickPayer": {
      const lines = [t("ui.whoPays"), ...partyHpPickerLines(s.party)];
      return lines.join("\n");
    }

    case "eventArtifactSacrifice": {
      const candidates = ownedArtifactEntries(s.party);
      const { pageItems, page: p, pages } = paginate(candidates, page, SACRIFICE_PAGE_SIZE);
      const lines = [...textLines(currentEventDescription(s)), [], text(t("ui.chooseSacrifice")), ...optionDetailLines(t("ui.sacrificeCost"), t("ui.sacrificeResult"))];
      pageItems.forEach(({ artifactId }, i) => {
        const a = getArtifact(artifactId);
        lines.push(text(`  [${i + 1}] ${a.name} (${a.rarity})`));
      });
      lines.push(text(`  [${pageItems.length + 1}] ${t("ui.leaveRitualOption")}`));
      if (candidates.length === 0) lines.push(text(t("ui.noSuitableArtifacts")));
      if (pages > 1) lines.push(text(t("ui.pageIndicator", { page: p + 1, pages })));
      return joinLines(lines);
    }

    case "eventCoinGamble": {
      const gamble = s.activeEvent?.gambleState;
      const multiplier = BALANCE.events.gamblingDenPotMultiplier;
      const winLine = (roundIndex: number, pot: number) => {
        const round = GAMBLING_DEN_ROUNDS[roundIndex]!;
        const chance = Math.round(round.winChance * 100);
        return roundIndex === GAMBLING_DEN_ROUNDS.length - 1
          ? t("ui.gamblingDenWinJackpot", { chance, ...gamblingJackpot() })
          : t("ui.gamblingDenWinPot", { chance, pot: pot * multiplier });
      };
      if (!gamble) {
        const round1 = GAMBLING_DEN_ROUNDS[0]!;
        return joinLines([
          ...textLines(currentEventDescription(s)),
          [],
          text(t("ui.gamblingDenEnterOption")),
          ...optionDetailLines(coins(round1.stake), winLine(0, round1.stake)),
          text(t("ui.gamblingDenLeaveOption")),
        ]);
      }
      return joinLines([
        text(t("ui.gamblingDenRoundLine", { round: gamble.round, pot: gamble.pot })),
        [],
        text(t("ui.gamblingDenStopOption")),
        ...optionDetailLines(null, t("ui.gamblingDenBank", { pot: gamble.pot })),
        text(t("ui.gamblingDenContinueOption")),
        ...optionDetailLines(t("ui.gamblingDenPotCost", { pot: gamble.pot }), winLine(gamble.round, gamble.pot)),
      ]);
    }

    case "eventFortuneExchange": {
      const hasAny = ownedArtifactEntries(s.party).length > 0;
      return joinLines([
        ...textLines(currentEventDescription(s)),
        [],
        text(t("ui.hermitExchangeOnlyIntro")),
        text(t("ui.hermitExchangeOption", { suffix: hasAny ? "" : t("ui.hermitNoArtifactSuffix") })),
        ...optionDetailLines(t("ui.hermitExchangeCost", { cost: HERMIT_EXCHANGE_COST_COINS }), t("ui.equalOrHigherArtifact")),
        text(t("ui.hermitLeaveOption")),
      ]);
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
      const { min, max } = BALANCE.events.eventGuardianCount;
      const lines = [
        text(t("ui.guardianFightIntro", { room: room.name })),
        [],
        ...textLines(currentEventDescription(s)),
        [],
        text(t("ui.guardianFightEnterOption")),
        ...optionDetailLines(t("ui.guardianFightCost", { min, max }), t("ui.guardianFightResult")),
      ];
      // Skip is hidden past the forced threshold; `guardianFightSkip` also rejects it.
      if (room.chainVariant !== "forced" && room.chainVariant !== "forced2" && room.chainVariant !== "forced3") lines.push(text(t("ui.guardianFightSkipOption")));
      return joinLines(lines);
    }

    case "eventExit": {
      const pending = s.pendingEventExit;
      if (!pending) return "";
      const event = getEvent(pending.eventId);
      const lines: TextChunk[][] = [[boldColorChunk(event.name, PALETTE.title)]];
      if (pending.withReflection) {
        const prompt = pickReflectionPrompt(s, getRoom(s.floor, s.currentRoomId), event) ?? "";
        lines.push([], [colorChunk(prompt, PALETTE.text)], [], ...answerLines(s, pendingReflectionOptions(s)));
      }
      return joinLines(lines);
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
    case "eventExit":
      return digitHint("ui.footerEventExit", s.pendingEventExit?.withReflection ? pendingReflectionOptions(s).length : 0, "ui.footerEventLeave");
    case "eventCursedOffer":
    case "eventHpGamble":
    case "eventCoinGamble":
    case "eventFortuneExchange":
      return digitHint("ui.footerChoose", 2);
  }
}
