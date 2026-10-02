import { classifyLines, type LineKind } from "./lines";
import { PAIR } from "./pairs";
import type { Finding } from "./types";

export interface Candidate {
  file: string;
  /** 1-based. */
  line: number;
  token: string;
}

/** A line that ends with this says its numbers are intent or arithmetic, not a copy of the data. */
export const INTENT_MARKER = "<!-- docs:intent -->";
/** Everything between these two lines is a record of reasoning: its numbers are as of the decision, not a claim about the data. */
export const INTENT_BEGIN = "<!-- docs:intent-begin -->";
export const INTENT_END = "<!-- docs:intent-end -->";

/**
 * Which lines sit inside an intent section, and what is wrong with the markers. A marker in a fenced
 * block or a generated block is text, not a marker. A section that never closes would exempt the rest of the doc.
 */
function scanIntent(lines: readonly string[], kinds: readonly LineKind[]): { inside: boolean[]; errors: { line: number; message: string }[] } {
  const inside: boolean[] = [];
  const errors: { line: number; message: string }[] = [];
  let open = 0;
  lines.forEach((line, index) => {
    const marker = kinds[index] === "prose" ? line.trim() : "";
    if (marker === INTENT_BEGIN) {
      if (open) errors.push({ line: index + 1, message: `docs:intent-begin is already open from line ${open}` });
      else open = index + 1;
    } else if (marker === INTENT_END) {
      if (open) open = 0;
      else errors.push({ line: index + 1, message: "docs:intent-end has no docs:intent-begin" });
    }
    inside.push(open !== 0);
  });
  if (open) errors.push({ line: open, message: "docs:intent-begin is never closed" });
  return { inside, errors };
}

/** Findings for intent markers that do not pair up. */
export function checkIntentMarkers(file: string, text: string): Finding[] {
  const lines = text.split("\n");
  return scanIntent(lines, classifyLines(lines)).errors.map(({ line, message }) => ({ file, line, message, fixable: false }));
}

/** Text whose digits are not data: section references, versions, links, file names, list numbers. */
const MASKS: RegExp[] = [
  /§\s*\d+(?:\.\d+)*/g,
  /\b(?:sections?|items?|design doc|doc)\s+\d+(?:\.\d+)*(?:\s*(?:,|and|-|–)\s*\d+(?:\.\d+)*)*/gi,
  /\b\d+\.\d+\.\d+(?:\.\d+)*/g,
  /\[[^\]]*\]\([^)]*\)/g,
  /`[^`]*(?:\/|\.md|\.ts|\.json)[^`]*`/g,
  /^\s*\d+\.\s/,
];
const NUMBER = /(?<![\w.-])(\d+(?:\.\d+)?)(%?)(?![\w-])/g;

function mask(line: string): string {
  let out = line.replace(PAIR, (match) => " ".repeat(match.length));
  for (const pattern of MASKS) out = out.replace(pattern, (match) => " ".repeat(match.length));
  return out;
}

/** A whole number up to this turns up all over the data by chance; it counts only next to a name that holds it. */
const CHANCE_LIMIT = 100;
const WORD = /[A-Za-z][\w-]*/g;
/** How far from a number, in characters, a name still counts as being about it. */
const NEAR = 40;

/**
 * Numbers in prose that equal a value somewhere in `data/*.json` and so may be a copy of it. `values`
 * maps each value to the names that hold it in the data (the field name and the id of its entry).
 * A decimal, or a whole number above `CHANCE_LIMIT`, always counts; a whole number up to it (a percentage
 * included) counts only when one of its names appears within `NEAR` characters of it, because such numbers coincide
 * with the data too often to mean anything on their own.
 */
export function findCandidates(file: string, text: string, values: ReadonlyMap<number, ReadonlySet<string>>): Candidate[] {
  const lines = text.split("\n");
  const kinds = classifyLines(lines);
  const found: Candidate[] = [];
  const { inside } = scanIntent(lines, kinds);
  lines.forEach((line, index) => {
    if (inside[index] || kinds[index] !== "prose" || line.includes(INTENT_MARKER) || /^#{1,6}\s/.test(line)) return;
    for (const match of mask(line).matchAll(NUMBER)) {
      const at = match.index!;
      const nearby = new Set(line.slice(Math.max(0, at - NEAR), at + match[0].length + NEAR).match(WORD) ?? []);
      const value = Number(match[1]);
      const percent = match[2] === "%";
      const names = new Set([...(values.get(value) ?? []), ...(percent ? [...(values.get(value / 100) ?? [])] : [])]);
      if (names.size === 0) continue;
      const notable = percent || match[1]!.includes(".") || value >= 10;
      const coincidence = Number.isInteger(value) && value <= CHANCE_LIMIT;
      const named = [...names].some((name) => nearby.has(name));
      if (notable && (!coincidence || named)) found.push({ file, line: index + 1, token: match[0] });
    }
  });
  return found;
}
