import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DATA_DIR = join(ROOT, "data");
const SRC_DIR = join(ROOT, "src");

// Version remaps must name the historical ids they rewrite.
const EXEMPT_FILES = new Set(["src/engine/migration.ts"]);

/** Blanks out comments, keeping line breaks and string contents, so a quoted id in a comment never counts. */
export function stripComments(code: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (quote) {
      out += c;
      if (c === "\\") out += code[++i] ?? "";
      else if (c === quote) quote = null;
    } else if (c === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out += code.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
    }
  }
  return out;
}

/** The literals a type union in `src/types.ts` declares: mechanic names (an effect kind, a damage type), not references to one record. */
export function mechanicNames(typesSource: string): Set<string> {
  return new Set([...stripComments(typesSource).matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]!));
}

// A mechanic name that is also an id still counts when it sits where only an id can: compared to an id, passed to a lookup, or used as an index.
const ID_POSITION_BEFORE = /(?:\.id|[a-z]Id|Ids)\s*[!=]==?\s*$|(?:\bget[A-Z]\w*|\bspawnMonster|\.includes|\.has)\(\s*$|\[\s*$/;
const ID_POSITION_AFTER = /^\s*[!=]==?\s*[\w.?]*(?:\.id|Id)\b/;

/** For each index of `code` (comments already stripped), the innermost open bracket around it, so an object key can be told from a parameter annotation. */
function enclosingBrackets(code: string): string[] {
  const stack: string[] = [];
  const at: string[] = new Array(code.length).fill("");
  let quote: string | null = null;
  let escaped = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    at[i] = stack.at(-1) ?? "";
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{" || c === "(" || c === "[") stack.push(c);
    else if (c === "}" || c === ")" || c === "]") stack.pop();
  }
  return at;
}

/** Every place in `code` that names one of `ids`: a quoted literal (any quote style) or an unquoted object key. */
export function findContentIdRefs(code: string, ids: ReadonlySet<string>, mechanics: ReadonlySet<string>): { line: number; id: string }[] {
  const refs: { line: number; id: string }[] = [];
  const stripped = stripComments(code);
  const brackets = enclosingBrackets(stripped);
  let offset = 0;
  stripped.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/(["'`])([a-z0-9][a-z0-9-]*)\1/g)) {
      const id = m[2]!;
      if (!ids.has(id)) continue;
      const inIdPosition = ID_POSITION_BEFORE.test(line.slice(0, m.index)) || ID_POSITION_AFTER.test(line.slice(m.index! + m[0].length));
      if (!mechanics.has(id) || inIdPosition) refs.push({ line: i + 1, id });
    }
    for (const m of line.matchAll(/(?:^|[{,])\s*([a-z][a-z0-9]*)\s*:(?!:)/g)) {
      const id = m[1]!;
      const keyIndex = offset + m.index! + m[0].indexOf(id);
      if (ids.has(id) && !mechanics.has(id) && brackets[keyIndex] === "{") refs.push({ line: i + 1, id });
    }
    offset += line.length + 1;
  });
  return refs;
}

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
  test("no file in src/ names an id from data/*.json", () => {
    const ids = new Set<string>();
    for (const file of readdirSync(DATA_DIR)) {
      if (!file.endsWith(".json") || file === "strings.json" || file === "sprites.json") continue;
      collectIds(JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")), ids);
    }
    const mechanics = mechanicNames(readFileSync(join(SRC_DIR, "types.ts"), "utf8"));

    const offenders: string[] = [];
    for (const path of sourceFiles(SRC_DIR)) {
      const file = relative(ROOT, path);
      if (EXEMPT_FILES.has(file)) continue;
      for (const { line, id } of findContentIdRefs(readFileSync(path, "utf8"), ids, mechanics)) offenders.push(`${file}:${line} ${id}`);
    }
    expect(offenders).toEqual([]);
  });

  describe("the scan", () => {
    const ids = new Set(["knight", "mage", "waystone-shard", "merchant", "heal"]);
    const mechanics = mechanicNames(`export type EffectKind = "damage" | "heal" | "merchant";\n/** e.g. "knight" in a comment */`);
    const scan = (code: string) => findContentIdRefs(code, ids, mechanics).map((r) => r.id);

    test("catches every quote style", () => {
      expect(scan(`if (c.classId === "knight") {}`)).toEqual(["knight"]);
      expect(scan(`const x = 'mage';`)).toEqual(["mage"]);
      expect(scan("const x = `waystone-shard`;")).toEqual(["waystone-shard"]);
    });

    test("catches an unquoted object key", () => {
      expect(scan(`const STYLE = {\n  knight: { abbr: "KN" },\n};`)).toEqual(["knight"]);
      expect(scan(`const STYLE = { mage: 1, other: 2 };`)).toEqual(["mage"]);
      expect(scan(`function f(a: number, mage: Character) {}`)).toEqual([]);
      expect(scan(`function f(\n  mage: Character,\n) {}`)).toEqual([]);
    });

    test("a mechanic name is allowed as a mechanic, not as an id", () => {
      expect(scan(`if (effect.kind === "heal") {}`)).toEqual([]);
      expect(scan(`switch (event.kind) {\n  case "merchant":\n}`)).toEqual([]);
      expect(scan(`if (event.id === "merchant") {}`)).toEqual(["merchant"]);
      expect(scan(`if (eventId !== "merchant") {}`)).toEqual(["merchant"]);
      expect(scan(`getEvent("merchant");`)).toEqual(["merchant"]);
      expect(scan(`state.eventOutcomes["merchant"] = "paid";`)).toEqual(["merchant"]);
      expect(scan(`ids.includes("heal");`)).toEqual(["heal"]);
      expect(scan(`if ("merchant" === event.id) {}`)).toEqual(["merchant"]);
    });

    test("comments never count, in source or in types.ts", () => {
      expect(scan(`// classId === "knight"\n/* "mage" */ const x = 1; // "waystone-shard"`)).toEqual([]);
      expect(mechanics.has("knight")).toBe(false);
    });
  });
});
