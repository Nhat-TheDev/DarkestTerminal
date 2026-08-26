import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { getArtifact, formatArtifactEffect } from "../../data/artifacts";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { ownedArtifactEntries } from "../state";
import type { ScreenContext } from "./context";

export type ArtifactsUiState = Extract<UiState, { kind: "artifactMenu" } | { kind: "artifactDetail" }>;

export function handleKey(ctx: ScreenContext, ui: ArtifactsUiState, _key: KeyEvent, digit: number | null): void {
  switch (ui.kind) {
    case "artifactDetail": {
      if (digit === 1) ctx.setUi({ kind: "artifactMenu" });
      break;
    }
    case "artifactMenu": {
      if (digit === null) break;
      const entries = ownedArtifactEntries(ctx.game.state.party);
      const entry = entries[digit - 1];
      if (!entry) break;
      ctx.setUi({ kind: "artifactDetail", artifactId: entry.artifactId, origin: { kind: "owned", characterId: entry.character.id } });
      break;
    }
  }
}

export function renderMain(game: Game, ui: ArtifactsUiState): string {
  const s = game.state;
  switch (ui.kind) {
    case "artifactMenu": {
      const entries = ownedArtifactEntries(s.party);
      if (entries.length === 0) return t("ui.noArtifactsYet");
      const lines = [t("ui.artifactsListTitle")];
      entries.forEach((entry, i) => {
        const a = getArtifact(entry.artifactId);
        lines.push(`  [${i + 1}] ${a.name} (${a.rarity})${a.isCursed ? t("ui.cursedTag") : ""} — ${entry.character.name} — ${formatArtifactEffect(a)}`);
      });
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
        t("ui.artifactDetailBackOnlyOption"),
      ];
      return lines.join("\n");
    }
  }
}

export function renderFooter(ui: ArtifactsUiState): string {
  switch (ui.kind) {
    case "artifactMenu":
      return t("ui.footerChooseArtifact");
    case "artifactDetail":
      return t("ui.detailFooter");
  }
}
