import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { getArtifact, formatArtifactEffect } from "../../data/artifacts";
import { MAX_EQUIPPED_ARTIFACTS } from "../../engine/party";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { proceedAfterVictory, type ScreenContext } from "./context";

export type ArtifactDecisionUiState = Extract<UiState, { kind: "artifactDecision" } | { kind: "artifactDecisionPickCharacter" } | { kind: "artifactDecisionPickReplace" }>;

export function handleKey(ctx: ScreenContext, ui: ArtifactDecisionUiState, _key: KeyEvent, digit: number | null): void {
  const pending = ctx.game.state.pendingArtifactDecision;
  if (!pending) {
    ctx.syncUiToGameState();
    return;
  }
  switch (ui.kind) {
    case "artifactDecision": {
      if (digit === 1) {
        ctx.setUi({ kind: "artifactDecisionPickCharacter" });
      } else if (digit === 2 && !pending.forceEquip) {
        const err = ctx.game.discardPendingArtifact();
        if (err) ctx.reportUnusable(err.reason);
        proceedAfterVictory(ctx);
      }
      break;
    }
    case "artifactDecisionPickCharacter": {
      if (digit === null) break;
      const character = ctx.game.state.party[digit - 1];
      if (!character) break;
      if (character.equippedArtifactIds.length < MAX_EQUIPPED_ARTIFACTS) {
        const err = ctx.game.resolveArtifactEquip(character.id);
        if (err) ctx.reportUnusable(err.reason);
        proceedAfterVictory(ctx);
      } else {
        ctx.setUi({ kind: "artifactDecisionPickReplace", characterId: character.id });
      }
      break;
    }
    case "artifactDecisionPickReplace": {
      if (digit === null) break;
      const character = ctx.game.state.party.find((c) => c.id === ui.characterId);
      const ordinary = character?.equippedArtifactIds.filter((id) => !getArtifact(id).isCursed) ?? [];
      const replaceArtifactId = ordinary[digit - 1];
      if (!replaceArtifactId) break;
      const err = ctx.game.resolveArtifactEquip(ui.characterId, replaceArtifactId);
      if (err) ctx.reportUnusable(err.reason);
      proceedAfterVictory(ctx);
      break;
    }
  }
}

export function renderMain(game: Game, ui: ArtifactDecisionUiState): string {
  const s = game.state;
  const pending = s.pendingArtifactDecision;
  if (!pending) return "";
  switch (ui.kind) {
    case "artifactDecision": {
      const artifact = getArtifact(pending.artifactId);
      const header = pending.forceEquip
        ? t("ui.artifactForcedEquipTitle", { artifact: artifact.name, rarity: artifact.rarity })
        : t("ui.artifactDecisionTitle", { artifact: artifact.name, rarity: artifact.rarity });
      const lines = [
        `${header}${artifact.isCursed ? t("ui.cursedTag") : ""}`,
        "",
        t("ui.effectLabel"),
        formatArtifactEffect(artifact),
        "",
        t("ui.descriptionLabel"),
        artifact.description,
        "",
        t("ui.artifactDecisionEquipOption"),
      ];
      if (!pending.forceEquip) lines.push(t("ui.artifactDecisionDiscardOption"));
      return lines.join("\n");
    }

    case "artifactDecisionPickCharacter": {
      const artifact = getArtifact(pending.artifactId);
      const lines = [t("ui.artifactForcedEquipChooseCharacter", { artifact: artifact.name }), "", formatArtifactEffect(artifact), ""];
      s.party.forEach((c, i) =>
        lines.push(`  [${i + 1}] ${c.name} (${game.className(c.classId)}) ${t("ui.artifactSlotsTag", { count: c.equippedArtifactIds.length, max: MAX_EQUIPPED_ARTIFACTS })}`)
      );
      return lines.join("\n");
    }

    case "artifactDecisionPickReplace": {
      const character = s.party.find((c) => c.id === ui.characterId);
      const ordinary = character?.equippedArtifactIds.filter((id) => !getArtifact(id).isCursed) ?? [];
      const lines = [t("ui.artifactReplaceChooseOwn", { character: character?.name ?? "" })];
      ordinary.forEach((id, i) => {
        const a = getArtifact(id);
        lines.push(t("ui.artifactReplaceOptionLine", { i: i + 1, name: a.name, rarity: a.rarity }));
      });
      if (ordinary.length === 0) lines.push(t("ui.noSuitableArtifacts"));
      return lines.join("\n");
    }
  }
}

export function renderFooter(ui: ArtifactDecisionUiState): string {
  switch (ui.kind) {
    case "artifactDecision":
      return t("ui.footerChoose");
    case "artifactDecisionPickCharacter":
      return t("ui.footerChooseCharacter");
    case "artifactDecisionPickReplace":
      return t("ui.footerChooseArtifact");
  }
}
