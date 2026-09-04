import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { PALETTE, colorChunk, joinLines, highlightKeyHints } from "./theme";
import { t } from "../data/strings";
import { listSaves, QUICKSAVE_ID, AUTOSAVE_ID, type SaveMeta } from "../engine/save";
import { paginate, pageCount, clampPage } from "./pagination";

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
    let page = 0;

    function draw(): void {
      const lines = [[colorChunk(t("saveSelect.title"), PALETTE.title)], []];
      if (saves.length === 0) {
        lines.push([colorChunk(t("saveSelect.empty"), PALETTE.dim)]);
      } else {
        const { pageItems, page: p, pages } = paginate(saves, page);
        pageItems.forEach((save, i) => {
          lines.push([
            colorChunk(
              t("saveSelect.entryLine", { i: i + 1, label: kindLabel(save.id), depth: save.floorDepth, level: save.partyLevel, time: formatTime(save.timestamp) }),
              PALETTE.text
            ),
          ]);
        });
        if (pages > 1) lines.push([colorChunk(t("ui.pageIndicator", { page: p + 1, pages }), PALETTE.dim)]);
      }
      lines.push([]);
      lines.push(highlightKeyHints(t("saveSelect.hint")));
      body.content = joinLines(lines);
    }
    draw();

    const onKey = (key: KeyEvent) => {
      if (key.name === "escape") {
        renderer.keyInput.off("keypress", onKey);
        renderer.root.remove(root);
        resolve(null);
        return;
      }
      if (key.name === "left" || key.name === "right") {
        if (pageCount(saves.length) > 1) {
          page = clampPage(page + (key.name === "right" ? 1 : -1), saves.length);
          draw();
        }
        return;
      }
      const digit = /^[1-9]$/.test(key.name) ? Number(key.name) : null;
      const { pageItems } = paginate(saves, page);
      const save = digit !== null ? pageItems[digit - 1] : undefined;
      if (save) {
        renderer.keyInput.off("keypress", onKey);
        renderer.root.remove(root);
        resolve(save);
      }
    };
    renderer.keyInput.on("keypress", onKey);
  });
}
