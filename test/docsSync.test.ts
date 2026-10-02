import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { BALANCE } from "../src/data/balanceConfig";
import { loadDocsData } from "../tools/docs-sync/data";
import { formatFinding, runDocsSync } from "../tools/docs-sync/index";

// The one test that checks the real docs against the real data. It goes red after a rebalance until
// `bun run docs:sync` has rewritten the numbers the docs mirror; that is its job.
test("the docs are in step with data/balance-config.json (fix with `bun run docs:sync`)", () => {
  const result = runDocsSync({ root: resolve(import.meta.dir, ".."), write: false, data: loadDocsData() });
  expect(result.findings.map(formatFinding)).toEqual([]);
});

// The pair check reads a `…Percent` field as whole percents and any other field as a fraction, so a field that stores
// a fraction must not carry the suffix: call it `…Fraction` or `…Chance`.
test("no `…Percent` field in the balance config stores a fraction", () => {
  const fractions: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === "number") {
      if (path.endsWith("Percent") && value > 0 && value < 1) fractions.push(`${path} (${value})`);
    } else if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) visit(item, path === "" ? key : `${path}.${key}`);
    }
  };
  visit(BALANCE, "");
  expect(fractions).toEqual([]);
});
