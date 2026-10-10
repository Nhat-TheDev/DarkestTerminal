import type { TextChunk } from "@opentui/core";
import type { LogEntry } from "../../types";
import { LOG_KIND_STYLE, colorChunk } from "../theme";

/** One styled line per entry — the room log box and the full-log screen render the same way. */
export function logLines(entries: LogEntry[]): TextChunk[][] {
  return entries.map((entry) => {
    const style = LOG_KIND_STYLE[entry.kind];
    return [colorChunk(`${style.icon} `, style.color), colorChunk(entry.text, style.color)];
  });
}
