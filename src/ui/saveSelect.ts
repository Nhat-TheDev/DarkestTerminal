import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { PALETTE, colorChunk, joinLines } from "./theme";
import { t } from "../data/strings";
import { listSaves, QUICKSAVE_ID, AUTOSAVE_ID, type SaveMeta } from "../engine/save";

function kindLabel(id: string): string {
  if (id === QUICKSAVE_ID) return t("saveSelect.kindQuick");
  if (id === AUTOSAVE_ID) return t("saveSelect.kindAuto");
  return t("saveSelect.kindManual");
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function showSaveSelect(renderer: CliRenderer): Promise<SaveMeta | null> {
  return new Promise((resolve) => {
    const root = new BoxRenderable(renderer, {
      id: "saveselect-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PALETTE.bg,
    });
    renderer.root.add(root);

    const body = new TextRenderable(renderer, { id: "saveselect-body", content: "" });
    root.add(body);

    const saves = listSaves();
    const lines = [[colorChunk(t("saveSelect.title"), PALETTE.title)], []];
    if (saves.length === 0) {
      lines.push([colorChunk(t("saveSelect.empty"), PALETTE.dim)]);
    } else {
      saves.forEach((save, i) => {
        lines.push([
          colorChunk(
            t("saveSelect.entryLine", { i: i + 1, label: kindLabel(save.id), depth: save.floorDepth, level: save.partyLevel, time: formatTime(save.timestamp) }),
            PALETTE.text
          ),
        ]);
      });
    }
    lines.push([]);
    lines.push([colorChunk(t("saveSelect.hint"), PALETTE.dim)]);
    body.content = joinLines(lines);

    const onKey = (key: KeyEvent) => {
      if (key.name === "escape") {
        renderer.keyInput.off("keypress", onKey);
        renderer.root.remove(root);
        resolve(null);
        return;
      }
      const digit = /^[1-9]$/.test(key.name) ? Number(key.name) : null;
      const save = digit !== null ? saves[digit - 1] : undefined;
      if (save) {
        renderer.keyInput.off("keypress", onKey);
        renderer.root.remove(root);
        resolve(save);
      }
    };
    renderer.keyInput.on("keypress", onKey);
  });
}
