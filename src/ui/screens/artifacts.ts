import type { KeyEvent } from "@opentui/core";
import type { Character, Id } from "../../types";
import type { Game } from "../../engine/game";
import { getArtifact, formatArtifactEffect } from "../../data/artifacts";
import { MAX_EQUIPPED_ARTIFACTS } from "../../engine/party";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

export type ArtifactsUiState = Extract<UiState, { kind: "artifactMenu" } | { kind: "artifactDetail" } | { kind: "pickCharacterForArtifact" }>;

function equippedArtifactPairAt(party: Character[], position: number): { characterId: Id; artifactId: Id } | null {
  let remaining = position;
  for (const c of party) {
    if (remaining <= c.equippedArtifactIds.length) return { characterId: c.id, artifactId: c.equippedArtifactIds[remaining - 1]! };
    remaining -= c.equippedArtifactIds.length;
  }
  return null;
}

export function handleKey(ctx: ScreenContext, ui: ArtifactsUiState, _key: KeyEvent, digit: number | null): void {
  switch (ui.kind) {
    case "artifactDetail": {
      if (digit === 1) {
        if (ui.origin.kind === "unequipped") {
          ctx.setUi({ kind: "pickCharacterForArtifact", artifactId: ui.artifactId });
        } else {
          const err = ctx.game.unequipArtifact(ui.origin.characterId, ui.artifactId);
          if (err) ctx.reportUnusable(err.reason);
          ctx.syncUiToGameState();
        }
      } else if (digit === 2) {
        ctx.setUi({ kind: "artifactMenu" });
      }
      break;
    }
    case "artifactMenu": {
      if (digit === null) break;
      const unequipped = ctx.game.state.unequippedArtifactIds;
      if (digit <= unequipped.length) {
        ctx.setUi({ kind: "artifactDetail", artifactId: unequipped[digit - 1]!, origin: { kind: "unequipped" } });
      } else {
        const pair = equippedArtifactPairAt(ctx.game.state.party, digit - unequipped.length);
        if (!pair) break;
        ctx.setUi({ kind: "artifactDetail", artifactId: pair.artifactId, origin: { kind: "equipped", characterId: pair.characterId } });
      }
      break;
    }
    case "pickCharacterForArtifact": {
      if (digit === null) break;
      const character = ctx.game.state.party[digit - 1];
      if (!character) break;
      const err = ctx.game.equipArtifact(character.id, ui.artifactId);
      if (err) ctx.reportUnusable(err.reason);
      ctx.syncUiToGameState();
      break;
    }
  }
}

export function renderMain(game: Game, ui: ArtifactsUiState): string {
  const s = game.state;
  switch (ui.kind) {
    case "artifactMenu": {
      const lines = [t("ui.manageArtifacts")];
      let i = 0;
      s.unequippedArtifactIds.forEach((id) => {
        i++;
        const a = getArtifact(id);
        lines.push(t("ui.equipOption", { i, name: a.name, rarity: a.rarity }));
      });
      s.party.forEach((c) => {
        c.equippedArtifactIds.forEach((id) => {
          i++;
          lines.push(t("ui.unequipOption", { i, name: getArtifact(id).name, character: c.name }));
        });
      });
      if (i === 0) lines.push(t("ui.noArtifactsYet"));
      return lines.join("\n");
    }

    case "artifactDetail": {
      const artifact = getArtifact(ui.artifactId);
      const lines = [
        `${artifact.name} (${artifact.rarity})${artifact.isCursed ? t("ui.cursedTag") : ""}`,
        "",
        t("ui.effectLabel"),
        formatArtifactEffect(artifact),
        "",
        t("ui.descriptionLabel"),
        artifact.description,
        "",
        ui.origin.kind === "unequipped" ? t("ui.artifactDetailEquipOption") : t("ui.artifactDetailUnequipOption"),
        t("ui.artifactDetailBackOption"),
      ];
      return lines.join("\n");
    }

    case "pickCharacterForArtifact": {
      const artifact = getArtifact(ui.artifactId);
      const lines = [t("ui.equipPrompt", { artifact: artifact.name })];
      s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name} ${t("ui.artifactSlotsTag", { count: c.equippedArtifactIds.length, max: MAX_EQUIPPED_ARTIFACTS })}`));
      return lines.join("\n");
    }
  }
}

export function renderFooter(ui: ArtifactsUiState): string {
  switch (ui.kind) {
    case "artifactMenu":
      return t("ui.footerEquipUnequipEsc");
    case "artifactDetail":
      return t("ui.detailFooter");
    case "pickCharacterForArtifact":
      return t("ui.footerChooseCharacterEsc");
  }
}
