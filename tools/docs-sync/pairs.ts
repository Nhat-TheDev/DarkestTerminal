import { formatNumber } from "./format";
import { classifyLines } from "./lines";
import { resolvePath } from "./paths";
import type { Finding } from "./types";

/** A backticked field path followed by parentheses: `section.field` (value). */
export const PAIR = /`([A-Za-z_]\w*(?:\.\w+|\[\d+\])+)`\s*\(([^)]*)\)/g;
/** The number the parentheses open with (after an optional `≈`), plus what makes it a percentage, a fraction or a range. */
const WRITTEN = /(?<=^\s*(?:[≈~]\s*)?)(-?\d+(?:\.\d+)?)(?:\s*([–-])\s*(\d+(?:\.\d+)?)|\s*\/\s*(\d+(?:\.\d+)?)|\s*(%))?/;
const FILE_EXTENSIONS = new Set(["ts", "json", "md", "html"]);
const EXACT = 1e-9;
/** `≈ 2/3` and 0.667 are the same value: a written fraction may differ from the data by this share. */
const FRACTION_TOLERANCE = 0.005;

interface Written {
  kind: "number" | "percent" | "fraction" | "range";
  a: number;
  b: number;
  separator: string;
  /** Where the written value sits inside the parentheses. */
  start: number;
  end: number;
}

function readWritten(inner: string): Written | null {
  const match = WRITTEN.exec(inner);
  if (!match) return null;
  const kind = match[2] ? "range" : match[4] ? "fraction" : match[5] ? "percent" : "number";
  return {
    kind,
    a: Number(match[1]),
    b: Number(match[3] ?? match[4] ?? 0),
    separator: match[2] ?? "",
    start: match.index,
    end: match.index + match[0].length,
  };
}

const isNumber = (value: unknown): value is number => typeof value === "number";
const close = (x: number, y: number) => Math.abs(x - y) < EXACT;

interface Verdict {
  ok: boolean;
  /** What to write instead; undefined when the mismatch cannot be repaired by rewriting. */
  replacement?: string;
  shown: string;
}

/** A field named `…Percent` stores whole percents (25 is 25%); any other number is a fraction (0.3 is 30%). */
const isPercentField = (path: string) => path.endsWith("Percent");

function compare(written: Written, value: unknown, path: string): Verdict | "unchecked" {
  if (isNumber(value)) {
    switch (written.kind) {
      case "number":
        return { ok: close(written.a, value), replacement: String(value), shown: String(value) };
      case "percent": {
        const whole = isPercentField(path);
        const shown = `${formatNumber(whole ? value : value * 100)}%`;
        return { ok: close(whole ? written.a : written.a / 100, value), replacement: shown, shown };
      }
      case "fraction": {
        const near = written.b !== 0 && Math.abs(written.a / written.b - value) <= Math.abs(value) * FRACTION_TOLERANCE;
        return { ok: near, replacement: String(value), shown: String(value) };
      }
      case "range":
        return { ok: false, shown: String(value) };
    }
  }
  if (Array.isArray(value) && value.length === 2 && value.every(isNumber) && written.kind === "range") {
    const [low, high] = value as [number, number];
    return { ok: close(written.a, low) && close(written.b, high), replacement: `${low}${written.separator}${high}`, shown: `${low}–${high}` };
  }
  return "unchecked";
}

export interface PairResult {
  /** `text` with every repairable pair rewritten. */
  text: string;
  findings: Finding[];
  /** Pairs on a field whose shape the check cannot compare. Information only. */
  unchecked: Finding[];
}

export function checkPairs(file: string, text: string, balance: unknown): PairResult {
  const lines = text.split("\n");
  const kinds = classifyLines(lines);
  const findings: Finding[] = [];
  const unchecked: Finding[] = [];

  lines.forEach((line, index) => {
    if (kinds[index] !== "prose") return;
    const where = index + 1;
    const edits: { start: number; end: number; replacement: string }[] = [];

    for (const pair of line.matchAll(PAIR)) {
      const path = pair[1]!;
      const inner = pair[2]!;
      const top = /^\w+/.exec(path)![0];
      if (!Object.hasOwn(balance as object, top) || FILE_EXTENSIONS.has(path.split(".").pop()!)) continue;
      const written = readWritten(inner);
      if (!written) continue;

      const resolved = resolvePath(balance, path);
      if (!resolved.found) {
        findings.push({ file, line: where, message: `\`${path}\` no longer exists in data/balance-config.json`, fixable: false });
        continue;
      }
      const verdict = compare(written, resolved.value, path);
      if (verdict === "unchecked") {
        unchecked.push({ file, line: where, message: `\`${path}\` is not a single number or a two-number range, so its value is not checked`, fixable: false });
        continue;
      }
      if (verdict.ok) continue;
      const shownInDoc = inner.slice(written.start, written.end);
      findings.push({
        file,
        line: where,
        message: `\`${path}\` says ${shownInDoc} here but is ${verdict.shown} in data/balance-config.json`,
        fixable: verdict.replacement !== undefined,
      });
      if (verdict.replacement !== undefined) {
        const innerStart = pair.index! + pair[0].length - 1 - inner.length;
        edits.push({ start: innerStart + written.start, end: innerStart + written.end, replacement: verdict.replacement });
      }
    }

    let fixed = line;
    for (const edit of edits.reverse()) fixed = fixed.slice(0, edit.start) + edit.replacement + fixed.slice(edit.end);
    lines[index] = fixed;
  });

  return { text: lines.join("\n"), findings, unchecked };
}
