import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent, type TextChunk } from "@opentui/core";
import type { AbilityDefinition, Id } from "../types";
import { ABILITIES, formatAbilityEffect } from "../data/abilities";
import { loadProfile } from "../engine/profile";
import { PALETTE, colorChunk, joinLines, highlightKeyHints } from "./theme";
import { t } from "../data/strings";

const PAGE_SIZE = 9;

/** Every `common` ability, plus every non-`common` id currently in the persistent profile, minus whatever the party has already picked this screen — `11-abilities.md` §11.1 "Character-select flow". */
function selectableAbilities(alreadyPicked: Id[]): AbilityDefinition[] {
  const profile = loadProfile();
  return ABILITIES.filter((a) => (a.rarity === "common" || profile.unlockedAbilityIds.includes(a.id)) && !alreadyPicked.includes(a.id));
}

/**
 * 1 ability pick per character, in party order, run right after `showCharacterSelect` and before
 * `Game` construction. No 2 characters may end up with the same id (enforced by narrowing the
 * options list as each pick locks in), commons included. `0` skips — a character can enter the run
 * with no ability equipped.
 */
export function showAbilitySelect(renderer: CliRenderer, classNames: string[]): Promise<(Id | null)[]> {
  return new Promise((resolve) => {
    const root = new BoxRenderable(renderer, {
      id: "abilityselect-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PALETTE.bg,
    });
    renderer.root.add(root);

    const body = new TextRenderable(renderer, { id: "abilityselect-body", content: "" });
    root.add(body);

    const picks: (Id | null)[] = [];
    let page = 0;

    const currentOptions = (): AbilityDefinition[] => selectableAbilities(picks.filter((id): id is Id => id !== null));

    const render = () => {
      const characterIndex = picks.length;
      const options = currentOptions();
      const totalPages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
      const pageOptions = options.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      const lines: TextChunk[][] = [
        [colorChunk(t("abilitySelect.title", { character: classNames[characterIndex] ?? "", index: characterIndex + 1, total: classNames.length }), PALETTE.title)],
        [],
      ];
      pageOptions.forEach((ability, i) => {
        lines.push([colorChunk(t("abilitySelect.optionLine", { i: i + 1, name: ability.name, rarity: ability.rarity }), PALETTE.text)]);
        lines.push([colorChunk(`      ${formatAbilityEffect(ability)}`, PALETTE.dim)]);
      });
      if (pageOptions.length === 0) lines.push([colorChunk(t("abilitySelect.noneAvailable"), PALETTE.dim)]);
      lines.push([]);
      lines.push([colorChunk(t("abilitySelect.skipOption"), PALETTE.dim)]);
      if (totalPages > 1) lines.push([colorChunk(t("abilitySelect.pageTag", { page: page + 1, total: totalPages }), PALETTE.dim)]);
      lines.push([]);
      lines.push(highlightKeyHints(t("abilitySelect.hint")));
      body.content = joinLines(lines);
    };
    render();

    const onKey = (key: KeyEvent) => {
      if (picks.length >= classNames.length) return;
      const options = currentOptions();
      const totalPages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));

      if ((key.name === "left" || key.name === "right") && totalPages > 1) {
        page = (page + (key.name === "right" ? 1 : -1) + totalPages) % totalPages;
        render();
        return;
      }

      let picked: Id | null | undefined;
      if (key.name === "0") {
        picked = null;
      } else {
        const digit = /^[1-9]$/.test(key.name) ? Number(key.name) : null;
        if (digit === null) return;
        const pageOptions = options.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
        const chosen = pageOptions[digit - 1];
        if (!chosen) return;
        picked = chosen.id;
      }

      picks.push(picked);
      page = 0;
      if (picks.length >= classNames.length) {
        renderer.keyInput.off("keypress", onKey);
        renderer.root.remove(root);
        resolve(picks);
        return;
      }
      render();
    };
    renderer.keyInput.on("keypress", onKey);
  });
}
