import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import type { CharacterClass, Id } from "../types";
import { PALETTE, colorChunk, joinLines } from "./theme";
import { t } from "../data/strings";

const PARTY_SIZE = 4;

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
      lines.push([]);
      const hintText = showFullWarning ? t("charSelect.fullWarning") : picked.length >= PARTY_SIZE ? t("charSelect.readyHint") : t("charSelect.hint");
      lines.push([colorChunk(hintText, showFullWarning ? PALETTE.dead : PALETTE.dim)]);
      body.content = joinLines(lines);
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
