import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DATA_DIR = join(ROOT, "data");
const SRC_DIR = join(ROOT, "src");

// Version remaps must name the historical ids they rewrite.
const EXEMPT_FILES = new Set(["src/engine/migration.ts"]);

function collectIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectIds(v, into);
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key === "id" && typeof v === "string") into.add(v);
      collectIds(v, into);
    }
  }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("engine and UI code never name a content id", () => {
  test("no string literal in src/ is an id from data/*.json", () => {
    const ids = new Set<string>();
    for (const file of readdirSync(DATA_DIR)) {
      if (!file.endsWith(".json") || file === "strings.json" || file === "sprites.json") continue;
      collectIds(JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")), ids);
    }
    // A literal declared in a type union is a mechanic name (an effect kind, an event kind, a damage type), not a reference to one record.
    const typeLiterals = new Set([...readFileSync(join(SRC_DIR, "types.ts"), "utf8").matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]!));

    const offenders: string[] = [];
    for (const path of sourceFiles(SRC_DIR)) {
      const file = relative(ROOT, path);
      if (EXEMPT_FILES.has(file)) continue;
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
          for (const [, literal] of line.matchAll(/"([a-z0-9][a-z0-9-]*)"/g)) {
            if (ids.has(literal!) && !typeLiterals.has(literal!)) offenders.push(`${file}:${i + 1} "${literal}"`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
