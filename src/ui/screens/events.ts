import type { StyledText, KeyEvent } from "@opentui/core";
import type { Character } from "../../types";
import type { Game } from "../../engine/game";
import { MERCHANT_PRICE_PERCENT, BLOOD_ALTAR_HP_PERCENT, COLLAPSED_FLOOR_HP_PERCENT } from "../../engine/game";
import { MAX_EQUIPPED_ARTIFACTS } from "../../engine/party";
import { getArtifact } from "../../data/artifacts";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { ownedArtifactIds, cursedEquippedEntries } from "../state";
import { truncateText } from "../layout";
import type { ScreenContext } from "./context";

export type EventUiState = Extract<
  UiState,
  | { kind: "eventMerchant" }
  | { kind: "eventMerchantPickPayer" }
  | { kind: "eventCursedShrine" }
  | { kind: "eventTwinAltars" }
  | { kind: "eventTwinAltarsPickCharacter" }
  | { kind: "eventTwinAltarsPickUnequip" }
  | { kind: "eventHpGamble" }
  | { kind: "eventHpGamblePickPayer" }
  | { kind: "eventArtifactPick" }
  | { kind: "eventHermit" }
  | { kind: "eventHermitPickArtifact" }
>;

function partyHpPickerLines(party: Character[]): string[] {
  return party.map((c, i) => `  [${i + 1}] ${c.name}${t("ui.hpSuffix", { hp: c.hp, maxHp: c.maxHp })}`);
}

export function handleKey(ctx: ScreenContext, ui: EventUiState, _key: KeyEvent, digit: number | null): void {
  switch (ui.kind) {
    case "eventMerchant": {
      if (digit === null) break;
      const offers = ctx.game.state.activeEvent?.offerArtifactIds ?? [];
      if (digit <= offers.length) {
        ctx.setUi({ kind: "eventMerchantPickPayer", offerIndex: digit - 1 });
      } else if (digit === offers.length + 1) {
        ctx.game.merchantLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventMerchantPickPayer": {
      if (digit === null) break;
      const payer = ctx.game.state.party[digit - 1];
      if (!payer) break;
      const err = ctx.game.merchantPurchase(ui.offerIndex, payer.id);
      if (err) ctx.reportUnusable(err.reason);
      else ctx.logInfo(ctx.game.state.message);
      ctx.syncUiToGameState();
      break;
    }
    case "eventCursedShrine": {
      if (digit === 1 || digit === 2) {
        ctx.game.cursedShrineDecide(digit === 1);
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventTwinAltars": {
      if (digit === 1 || digit === 2) ctx.setUi({ kind: "eventTwinAltarsPickCharacter", offerIndex: (digit - 1) as 0 | 1 });
      break;
    }
    case "eventTwinAltarsPickCharacter": {
      if (digit === null) break;
      const character = ctx.game.state.party[digit - 1];
      if (!character) break;
      if (character.equippedArtifactIds.length >= MAX_EQUIPPED_ARTIFACTS) {
        ctx.setUi({ kind: "eventTwinAltarsPickUnequip", offerIndex: ui.offerIndex, characterId: character.id });
        break;
      }
      const err = ctx.game.twinAltarsChoose(ui.offerIndex, character.id);
      if (err) ctx.reportUnusable(err.reason);
      else ctx.logInfo(ctx.game.state.message);
      ctx.syncUiToGameState();
      break;
    }
    case "eventTwinAltarsPickUnequip": {
      if (digit === null) break;
      const { offerIndex, characterId } = ui;
      const character = ctx.game.state.party.find((c) => c.id === characterId);
      const artifactId = character?.equippedArtifactIds[digit - 1];
      if (!artifactId) break;
      const err = ctx.game.twinAltarsChoose(offerIndex, characterId, artifactId);
      if (err) ctx.reportUnusable(err.reason);
      else ctx.logInfo(ctx.game.state.message);
      ctx.syncUiToGameState();
      break;
    }
    case "eventHpGamble": {
      if (digit === 1) {
        ctx.setUi({ kind: "eventHpGamblePickPayer", eventId: ui.eventId });
      } else if (digit === 2) {
        if (ui.eventId === "blood-altar") ctx.game.bloodAltarLeave();
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
      const err = ui.eventId === "blood-altar" ? ctx.game.bloodAltarPay(character.id) : ctx.game.collapsedFloorAttempt(character.id);
      if (err) ctx.reportUnusable(err.reason);
      else ctx.logInfo(ctx.game.state.message);
      ctx.syncUiToGameState();
      break;
    }
    case "eventArtifactPick": {
      if (digit === null) break;
      const isSacrifice = ui.eventId === "sacrificial-circle";
      const candidates = isSacrifice ? ownedArtifactIds(ctx.game.state.party, ctx.game.state.unequippedArtifactIds) : ctx.game.state.unequippedArtifactIds;
      if (digit <= candidates.length) {
        const artifactId = candidates[digit - 1]!;
        const err = isSacrifice ? ctx.game.sacrifice(artifactId) : ctx.game.gamblingDenBet(artifactId);
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      } else if (digit === candidates.length + 1) {
        if (isSacrifice) ctx.game.sacrificeLeave();
        else ctx.game.gamblingDenLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventHermit": {
      if (digit === 1) {
        if (cursedEquippedEntries(ctx.game.state.party).length === 0) {
          ctx.reportUnusable(t("ui.noCursedToRemove"));
          break;
        }
        ctx.setUi({ kind: "eventHermitPickArtifact", service: "removeCurse" });
      } else if (digit === 2) {
        if (ownedArtifactIds(ctx.game.state.party, ctx.game.state.unequippedArtifactIds).length === 0) {
          ctx.reportUnusable(t("ui.noArtifactToReroll"));
          break;
        }
        ctx.setUi({ kind: "eventHermitPickArtifact", service: "reroll" });
      } else if (digit === 3) {
        ctx.game.hermitLeave();
        ctx.logInfo(ctx.game.state.message);
        ctx.syncUiToGameState();
      }
      break;
    }
    case "eventHermitPickArtifact": {
      if (digit === null) break;
      if (ui.service === "removeCurse") {
        const entry = cursedEquippedEntries(ctx.game.state.party)[digit - 1];
        if (!entry) break;
        const err = ctx.game.hermitRemoveCurse(entry.character.id, entry.artifactId);
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
      } else {
        const artifactId = ownedArtifactIds(ctx.game.state.party, ctx.game.state.unequippedArtifactIds)[digit - 1];
        if (!artifactId) break;
        const err = ctx.game.hermitRerollFortune(artifactId);
        if (err) ctx.reportUnusable(err.reason);
        else ctx.logInfo(ctx.game.state.message);
      }
      ctx.syncUiToGameState();
      break;
    }
  }
}

export function renderMain(game: Game, ui: EventUiState): string | StyledText {
  const s = game.state;
  switch (ui.kind) {
    case "eventMerchant": {
      const offers = s.activeEvent?.offerArtifactIds ?? [];
      const lines = [t("ui.merchantOffers")];
      offers.forEach((id, i) => {
        const a = getArtifact(id);
        lines.push(t("ui.merchantOfferLine", { i: i + 1, name: a.name, rarity: a.rarity, price: MERCHANT_PRICE_PERCENT[a.rarity], desc: truncateText(a.description, 34) }));
      });
      lines.push(t("ui.leaveEmptyHandedOption", { i: offers.length + 1 }));
      return lines.join("\n");
    }

    case "eventMerchantPickPayer": {
      const artifactId = s.activeEvent?.offerArtifactIds[ui.offerIndex];
      const lines = [t("ui.whoPaysFor", { artifact: artifactId ? getArtifact(artifactId).name : t("ui.unknownArtifact") }), ...partyHpPickerLines(s.party)];
      return lines.join("\n");
    }

    case "eventCursedShrine": {
      const artifactId = s.activeEvent?.offerArtifactIds[0];
      const a = artifactId ? getArtifact(artifactId) : null;
      const curseTag = a?.isCursed ? t("ui.cursedTag") : "";
      return [
        a ? `${a.name} (${a.rarity})${curseTag} — ${a.description}` : "...",
        "",
        t("ui.acceptOption"),
        t("ui.declineOption"),
      ].join("\n");
    }

    case "eventTwinAltars": {
      const offers = s.activeEvent?.offerArtifactIds ?? [];
      const lines = [t("ui.twinAltarsIntro")];
      offers.forEach((id, i) => {
        const a = getArtifact(id);
        lines.push(`  [${i + 1}] ${a.name} (${a.rarity}) — ${truncateText(a.description, 40)}`);
      });
      return lines.join("\n");
    }

    case "eventTwinAltarsPickCharacter": {
      const lines = [t("ui.equipNowPrompt")];
      s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name} ${t("ui.artifactSlotsTag", { count: c.equippedArtifactIds.length, max: MAX_EQUIPPED_ARTIFACTS })}`));
      return lines.join("\n");
    }

    case "eventTwinAltarsPickUnequip": {
      const { characterId } = ui;
      const character = s.party.find((c) => c.id === characterId);
      const lines = [t("ui.maxSlotsPrompt", { character: character?.name ?? "" })];
      character?.equippedArtifactIds.forEach((id, i) => lines.push(`  [${i + 1}] ${getArtifact(id).name}`));
      return lines.join("\n");
    }

    case "eventHpGamble": {
      const percent = ui.eventId === "blood-altar" ? BLOOD_ALTAR_HP_PERCENT : COLLAPSED_FLOOR_HP_PERCENT;
      const resultLine = ui.eventId === "blood-altar" ? t("ui.bloodAltarResult") : t("ui.collapsedFloorResult");
      return [t("ui.payToTry", { percent }), resultLine, "", t("ui.payOption"), t("ui.leaveOption")].join("\n");
    }

    case "eventHpGamblePickPayer": {
      const lines = [t("ui.whoPays"), ...partyHpPickerLines(s.party)];
      return lines.join("\n");
    }

    case "eventArtifactPick": {
      const isSacrifice = ui.eventId === "sacrificial-circle";
      const candidates = isSacrifice ? ownedArtifactIds(s.party, s.unequippedArtifactIds) : s.unequippedArtifactIds;
      const lines = [isSacrifice ? t("ui.chooseSacrifice") : t("ui.chooseBet")];
      candidates.forEach((id, i) => {
        const a = getArtifact(id);
        lines.push(`  [${i + 1}] ${a.name} (${a.rarity})`);
      });
      lines.push(`  [${candidates.length + 1}] ${isSacrifice ? t("ui.leaveRitualOption") : t("ui.leaveNoBetOption")}`);
      if (candidates.length === 0) lines.push(t("ui.noSuitableArtifacts"));
      return lines.join("\n");
    }

    case "eventHermit": {
      const hasCursed = cursedEquippedEntries(s.party).length > 0;
      const hasAny = ownedArtifactIds(s.party, s.unequippedArtifactIds).length > 0;
      return [
        t("ui.hermitIntro"),
        t("ui.hermitRemoveCurseOption", { suffix: hasCursed ? "" : t("ui.hermitNoCursedSuffix") }),
        t("ui.hermitRerollOption", { suffix: hasAny ? "" : t("ui.hermitNoArtifactSuffix") }),
        t("ui.hermitLeaveOption"),
      ].join("\n");
    }

    case "eventHermitPickArtifact": {
      if (ui.service === "removeCurse") {
        const lines = [t("ui.removeCurseIntro")];
        cursedEquippedEntries(s.party).forEach(({ character, artifactId }, i) => lines.push(t("ui.removeCurseLine", { i: i + 1, name: getArtifact(artifactId).name, character: character.name })));
        return lines.join("\n");
      }
      const lines = [t("ui.rerollIntro")];
      ownedArtifactIds(s.party, s.unequippedArtifactIds).forEach((id, i) => lines.push(`  [${i + 1}] ${getArtifact(id).name} (${getArtifact(id).rarity})`));
      return lines.join("\n");
    }
  }
}

export function renderFooter(ui: EventUiState): string {
  switch (ui.kind) {
    case "eventMerchantPickPayer":
    case "eventTwinAltarsPickCharacter":
    case "eventHpGamblePickPayer":
      return t("ui.footerChooseCharacter");
    case "eventMerchant":
    case "eventArtifactPick":
      return t("ui.footerChoose");
    case "eventCursedShrine":
    case "eventTwinAltars":
    case "eventHpGamble":
    case "eventHermit":
      return t("ui.footerChoose");
    case "eventTwinAltarsPickUnequip":
      return t("ui.footerChooseArtifactToRemove");
    case "eventHermitPickArtifact":
      return t("ui.footerChooseArtifact");
  }
}
