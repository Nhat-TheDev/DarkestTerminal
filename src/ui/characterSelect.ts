import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import type { CharacterClass, Id } from "../types";
import { PALETTE, colorChunk, joinLines, highlightKeyHints } from "./theme";
import { joinHints, digitHint } from "./keyHints";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

const PARTY_SIZE = BALANCE.party.size;

export function showCharacterSelect(renderer: CliRenderer, classes: CharacterClass[]): Promise<Id[]> {
  return new Promise((resolve) => {
    const root = new BoxRenderable(renderer, {
      id: "charselect-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PALETTE.bg,
    });
    renderer.root.add(root);

    const body = new TextRenderable(renderer, { id: "charselect-body", content: "" });
    root.add(body);

    const footer = new TextRenderable(renderer, { id: "charselect-footer", content: "", position: "absolute", left: 2, bottom: 1 });
    root.add(footer);

    const picked: Id[] = [];
    let showFullWarning = false;

    const render = () => {
      const lines = [[colorChunk(t("charSelect.title", { count: picked.length }), PALETTE.title)], []];
      classes.forEach((cls, i) => {
        const isPicked = picked.includes(cls.id);
        lines.push([
          colorChunk(
            t("charSelect.classLine", { i: i + 1, name: cls.name, picked: isPicked ? t("charSelect.pickedTag") : "", desc: cls.description }),
            isPicked ? PALETTE.title : PALETTE.text
          ),
        ]);
      });
      if (showFullWarning) {
        lines.push([]);
        lines.push([colorChunk(t("charSelect.fullWarning"), PALETTE.dead)]);
      }
      body.content = joinLines(lines);
      // `[Enter] Start` only appears once the party is actually full — the key does nothing before that.
      footer.content = joinLines([highlightKeyHints(joinHints(digitHint("charSelect.hint", classes.length), picked.length >= PARTY_SIZE ? t("charSelect.readyHint") : null))]);
    };
    render();

    const onKey = (key: KeyEvent) => {
      if (picked.length >= PARTY_SIZE && key.name === "return") {
        renderer.keyInput.off("keypress", onKey);
        renderer.root.remove(root);
        resolve(picked);
        return;
      }
      const digit = /^[1-9]$/.test(key.name) ? Number(key.name) : null;
      const cls = digit !== null ? classes[digit - 1] : undefined;
      if (cls) {
        const idx = picked.indexOf(cls.id);
        if (idx >= 0) {
          picked.splice(idx, 1);
          showFullWarning = false;
        } else if (picked.length < PARTY_SIZE) {
          picked.push(cls.id);
          showFullWarning = false;
        } else {
          showFullWarning = true;
        }
        render();
      }
    };
    renderer.keyInput.on("keypress", onKey);
  });
}
