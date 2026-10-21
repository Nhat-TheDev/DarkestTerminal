import type { TextChunk } from "@opentui/core";
import type { LogEntry } from "../../types";
import { LOG_KIND_STYLE, colorChunk } from "../theme";
import { wrapText } from "../layout";

/** What a wrapped entry's later lines start with: as wide as the icon and its space. */
const CONTINUATION_INDENT = "  ";

/** Each entry opened by its kind's icon and wrapped to `width` columns. */
export function logLines(entries: LogEntry[], width: number): TextChunk[][] {
  const lines: TextChunk[][] = [];
  for (const entry of entries) {
    if (entry.hidden) continue;
    const style = LOG_KIND_STYLE[entry.kind];
    const wrapped = entry.text.split("\n").flatMap((part) => wrapText(part, width - CONTINUATION_INDENT.length));
    wrapped.forEach((line, i) => lines.push([colorChunk(i === 0 ? `${style.icon} ` : CONTINUATION_INDENT, style.color), colorChunk(line, style.color)]));
  }
  return lines;
}
