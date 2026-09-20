import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { PALETTE, colorChunk, joinLines, highlightKeyHints } from "./theme";
import { digitHint } from "./keyHints";
import { t } from "../data/strings";
import { getClass } from "../data/classes";
import { listSlots, type SlotEntry } from "../engine/save";
import type { Id } from "../types";

export type SlotSelectMode = "new" | "continue";

function formatPlayTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function slotNumber(id: Id): number {
  return Number(id.replace("slot", ""));
}

/**
 * "new" lists all five slots (an occupied one asks before it is overwritten); "continue" lists only
 * the occupied ones. Resolves to the chosen slot id, or null on Esc.
 */
export function showSlotSelect(renderer: CliRenderer, mode: SlotSelectMode): Promise<Id | null> {
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

    const footer = new TextRenderable(renderer, { id: "saveselect-footer", content: "", position: "absolute", left: 2, bottom: 1 });
    root.add(footer);

    const slots: SlotEntry[] = listSlots().filter((slot) => mode === "new" || slot.meta !== null);
    let pendingOverwrite: SlotEntry | null = null;

    function draw(): void {
      const lines = [[colorChunk(t(mode === "new" ? "saveSelect.titleNew" : "saveSelect.titleContinue"), PALETTE.title)], []];
      slots.forEach((slot, i) => {
        const n = slotNumber(slot.id);
        if (!slot.meta) {
          lines.push([colorChunk(t("saveSelect.emptyLine", { i: i + 1, slot: n }), PALETTE.dim)]);
          return;
        }
        const { floorDepth, playTime, partyClassIds, timestamp } = slot.meta;
        lines.push([colorChunk(t("saveSelect.entryLine", { i: i + 1, slot: n, depth: floorDepth, playTime: formatPlayTime(playTime) }), PALETTE.text)]);
        lines.push([
          colorChunk(t("saveSelect.entryDetail", { classes: partyClassIds.map((id) => getClass(id).name).join(", "), time: new Date(timestamp).toLocaleString() }), PALETTE.dim),
        ]);
      });
      if (pendingOverwrite) {
        lines.push([], [colorChunk(t("saveSelect.overwriteWarning", { slot: slotNumber(pendingOverwrite.id) }), PALETTE.title)]);
      }
      body.content = joinLines(lines);
      footer.content = joinLines([highlightKeyHints(pendingOverwrite ? t("saveSelect.confirmHint") : digitHint("saveSelect.hint", slots.length))]);
    }
    draw();

    const finish = (result: Id | null) => {
      renderer.keyInput.off("keypress", onKey);
      renderer.root.remove(root);
      resolve(result);
    };

    const onKey = (key: KeyEvent) => {
      if (pendingOverwrite) {
        if (key.name === "1") finish(pendingOverwrite.id);
        else if (key.name === "escape") {
          pendingOverwrite = null;
          draw();
        }
        return;
      }
      if (key.name === "escape") {
        finish(null);
        return;
      }
      const slot = /^[1-9]$/.test(key.name) ? slots[Number(key.name) - 1] : undefined;
      if (!slot) return;
      if (mode === "new" && slot.meta) {
        pendingOverwrite = slot;
        draw();
        return;
      }
      finish(slot.id);
    };
    renderer.keyInput.on("keypress", onKey);
  });
}
