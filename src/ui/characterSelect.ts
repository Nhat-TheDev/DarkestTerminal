import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import type { CharacterClass, Id } from "../types";
import { PALETTE, colorChunk, joinLines } from "./theme";
import { t } from "../data/strings";

const PARTY_SIZE = 4;

/**
 * New-game character select — pick exactly `PARTY_SIZE` classes, in order,
 * out of the full catalog. A digit key toggles that class's selection (so a
 * misclick can be undone, even after `PARTY_SIZE` is reached); Enter confirms
 * and resolves the chosen class ids in pick order once `PARTY_SIZE` are picked.
 */
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
      lines.push([colorChunk(picked.length >= PARTY_SIZE ? t("charSelect.readyHint") : t("charSelect.hint"), PALETTE.dim)]);
      body.content = joinLines(lines);
    };
    render();

    // A single persistent listener, removed explicitly on confirm — opentui's InternalKeyHandler
    // overrides emit() to call the unwrapped listeners from this.listeners() directly, which
    // bypasses EventEmitter's own dispatch path and with it .once()'s self-removal wrapper, so
    // re-registering via .once() from inside its own handler silently stops firing after 1 hop.
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
        if (idx >= 0) picked.splice(idx, 1);
        else if (picked.length < PARTY_SIZE) picked.push(cls.id);
        render();
      }
    };
    renderer.keyInput.on("keypress", onKey);
  });
}
