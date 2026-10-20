import type { TextChunk } from "@opentui/core";
import type { LogEntry } from "../../types";
import { LOG_KIND_STYLE, colorChunk } from "../theme";

export function logLines(entries: LogEntry[]): TextChunk[][] {
  return entries.filter((entry) => !entry.hidden).map((entry) => {
    const style = LOG_KIND_STYLE[entry.kind];
    return [colorChunk(`${style.icon} `, style.color), colorChunk(entry.text, style.color)];
  });
}
