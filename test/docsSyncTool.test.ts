import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { characterBalancePoints } from "../tools/game-editor/calc";
import { formatAbilityEffect } from "../src/data/abilities";
import { formatArtifactEffect } from "../src/data/artifacts";
import { BALANCE } from "../src/data/balanceConfig";
import { syncBlocks } from "../tools/docs-sync/blocks";
import { capitalize, formatNumber, formatPercent, formatRange, formatRounded, showValue } from "../tools/docs-sync/format";
import { basicAttacks } from "../tools/docs-sync/generators/basicAttacks";
import { coinDropByTier } from "../tools/docs-sync/generators/coinDropByTier";
import { abilities } from "../tools/docs-sync/generators/abilities";
import { artifacts } from "../tools/docs-sync/generators/artifacts";
import { balancePoints, classStats } from "../tools/docs-sync/generators/classStats";
import { classSkills } from "../tools/docs-sync/generators/classSkills";
import { eventTiers } from "../tools/docs-sync/generators/eventTiers";
import { gamblingRounds } from "../tools/docs-sync/generators/gamblingRounds";
import { map } from "../tools/docs-sync/generators/map";
import { monsterSkills, monsterTypeWeights } from "../tools/docs-sync/generators/monsters";
import { passives } from "../tools/docs-sync/generators/passives";
import { statusEffects } from "../tools/docs-sync/generators/statusEffects";
import { deathBursts, minionSkills, minions } from "../tools/docs-sync/generators/minions";
import { rarityOdds } from "../tools/docs-sync/generators/rarityOdds";
import { shopOdds } from "../tools/docs-sync/generators/shopOdds";
import { formatFinding, parseMode, runDocsSync } from "../tools/docs-sync/index";
import { checkIntentMarkers, findCandidates } from "../tools/docs-sync/coverage";
import { classifyLines, unclosedFence } from "../tools/docs-sync/lines";
import { checkPairs } from "../tools/docs-sync/pairs";
import { checkReferences } from "../tools/docs-sync/refs";
import { renderMarkdown } from "../tools/docs-sync/render";
import type { CharacterClass } from "../src/types";
import type { DocsData, GeneratorSpec } from "../tools/docs-sync/types";

// The tool's own tests carry no real balance numbers: they run on small made-up data, so a rebalance
// cannot break them. Names of docs that must not exist are built from two strings, because
// `docs:sync` scans this file for references to docs that do not exist.
const FENCE = "`".repeat(3);
const lines = (...parts: string[]) => parts.join("\n");

describe("formatNumber", () => {
  test("prints a whole number without a decimal", () => {
    expect(formatNumber(15)).toBe("15");
    expect(formatNumber(0)).toBe("0");
  });

  test("treats floating-point noise around a whole number as that number", () => {
    expect(formatNumber(15.000000000000002)).toBe("15");
    expect(formatNumber(99.99999999999999)).toBe("100");
    expect(formatNumber(-1e-12)).toBe("0");
  });

  test("prints any other value as it is, without rounding it", () => {
    expect(formatNumber(0.75)).toBe("0.75");
    expect(formatNumber(12.25)).toBe("12.25");
    expect(formatNumber(1.04)).toBe("1.04");
    expect(formatNumber(0.004)).toBe("0.004");
  });

  test("drops the noise a sum or a product leaves behind a decimal", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(0.07 * 100)).toBe("7");
    expect(formatNumber(0.29 * 100)).toBe("29");
  });
});

describe("formatRounded", () => {
  test("prints a whole number without a decimal and treats noise around it as that number", () => {
    expect(formatRounded(15)).toBe("15");
    expect(formatRounded(15.000000000000002)).toBe("15");
    expect(formatRounded(-1e-12)).toBe("0");
  });

  test("keeps one decimal for anything else, including a value that rounds to .0", () => {
    expect(formatRounded(95.69)).toBe("95.7");
    expect(formatRounded(1.04)).toBe("1.0");
    expect(formatRounded(0.004)).toBe("0.0");
  });
});

describe("showValue", () => {
  test("prints a number, a string and a flag the way a table cell shows them", () => {
    expect(showValue(0.75)).toBe("0.75");
    expect(showValue("echo")).toBe("echo");
    expect(showValue(true)).toBe("true");
  });

  test("lists an array with slashes and an object as `key value` pairs, never as [object Object]", () => {
    expect(showValue([1, 2.5])).toBe("1 / 2.5");
    expect(showValue({ min: 1, max: 2 })).toBe("min 1, max 2");
    expect(showValue({ rate: { min: 1, max: 2 }, stat: "mp" })).toBe("rate (min 1, max 2), stat mp");
  });
});

describe("formatRange", () => {
  test("joins the two ends with an en dash", () => {
    expect(formatRange(4, 6)).toBe("4–6");
    expect(formatRange(0.5, 12)).toBe("0.5–12");
  });

  test("prints a single value when both ends are the same", () => {
    expect(formatRange(7, 7)).toBe("7");
  });
});

describe("formatPercent", () => {
  test("turns a rate into a percentage and absorbs the noise of the product", () => {
    expect(formatPercent(0.7)).toBe("70%");
    expect(formatPercent(0.3)).toBe("30%");
    expect(formatPercent(0.125)).toBe("12.5%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("renderMarkdown", () => {
  test("renders a header, a rule and one line per row", () => {
    const table = { columns: ["A", "B"], rows: [["x", 1], ["y", 2.5]] };
    expect(renderMarkdown(table)).toBe("| A | B |\n|---|---|\n| x | 1 |\n| y | 2.5 |");
  });

  test("escapes a pipe inside a cell", () => {
    expect(renderMarkdown({ columns: ["A"], rows: [["a|b"]] })).toBe("| A |\n|---|\n| a\\|b |");
  });
});

const demo: GeneratorSpec = {
  source: "`demo`",
  args: ["n"],
  generate: (_data, args) => ({ columns: ["N"], rows: [[args.n ?? "none"]] }),
};
const boom: GeneratorSpec = {
  source: "`boom`",
  args: [],
  generate: () => {
    throw new Error("kaput");
  },
};
const GENERATORS = { demo, boom };
const NO_DATA = { balance: BALANCE } as DocsData;

describe("classifyLines", () => {
  test("marks fenced lines, block lines and prose", () => {
    const text = [
      "intro",
      `${FENCE}ts`,
      "<!-- docs:begin inside -->",
      FENCE,
      "<!-- docs:begin demo -->",
      "old",
      "<!-- docs:end -->",
      "outro",
    ];
    expect(classifyLines(text)).toEqual(["prose", "fence", "fence", "fence", "block", "block", "block", "prose"]);
  });

  test("a longer fence is not closed by a shorter one", () => {
    const four = "`".repeat(4);
    expect(classifyLines([four, FENCE, "still inside", FENCE, four, "after"])).toEqual([
      "fence",
      "fence",
      "fence",
      "fence",
      "fence",
      "prose",
    ]);
  });
});

describe("unclosedFence", () => {
  test("finds nothing when every fence is closed", () => {
    expect(unclosedFence(["intro", `${FENCE}ts`, "code", FENCE, "outro"])).toBeUndefined();
  });

  test("returns the 1-based line of a fence that never closes", () => {
    expect(unclosedFence(["intro", `${FENCE}ts`, "code", "more"])).toBe(2);
  });

  test("a longer fence is not closed by a shorter one", () => {
    const four = "`".repeat(4);
    expect(unclosedFence([four, "a", FENCE, "b"])).toBe(1);
  });
});

describe("syncBlocks", () => {
  const sync = (text: string) => syncBlocks("a.md", text, GENERATORS, NO_DATA);
  const notice = "*Generated from `demo` by `bun run docs:sync`. Do not edit.*";

  test("fills a block from its generator and leaves everything else alone", () => {
    const result = sync(lines("before", "", "<!-- docs:begin demo n=7 -->", "stale", "<!-- docs:end -->", "", "after"));
    expect(result.errors).toEqual([]);
    expect(result.text).toBe(
      lines("before", "", "<!-- docs:begin demo n=7 -->", notice, "", "| N |", "|---|", "| 7 |", "<!-- docs:end -->", "", "after"),
    );
    expect(result.stale).toEqual([{ file: "a.md", line: 3, message: 'block "demo" is out of date', fixable: true }]);
  });

  test("a second run changes nothing", () => {
    const once = sync(lines("<!-- docs:begin demo n=7 -->", "stale", "<!-- docs:end -->"));
    const twice = sync(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.stale).toEqual([]);
  });

  test("regenerates several blocks without shifting one another", () => {
    const text = lines("<!-- docs:begin demo n=1 -->", "<!-- docs:end -->", "middle", "<!-- docs:begin demo n=2 -->", "<!-- docs:end -->");
    const result = sync(text);
    expect(result.stale.map((finding) => finding.line)).toEqual([4, 1]);
    expect(result.text).toBe(
      lines(
        "<!-- docs:begin demo n=1 -->", notice, "", "| N |", "|---|", "| 1 |", "<!-- docs:end -->",
        "middle",
        "<!-- docs:begin demo n=2 -->", notice, "", "| N |", "|---|", "| 2 |", "<!-- docs:end -->",
      ),
    );
  });

  test("reads a quoted argument", () => {
    expect(sync(lines('<!-- docs:begin demo n="a b" -->', "<!-- docs:end -->")).text).toContain("| a b |");
  });

  test("ignores markers inside a fenced code block", () => {
    const text = lines(FENCE, "<!-- docs:begin demo n=1 -->", "<!-- docs:end -->", FENCE);
    const result = sync(text);
    expect(result.text).toBe(text);
    expect(result.errors).toEqual([]);
  });

  const failure = (text: string, message: string, line = 1) => {
    const result = sync(text);
    expect(result.errors).toEqual([{ file: "a.md", line, message, fixable: false }]);
    return result;
  };

  test("reports an unknown generator and leaves the block alone", () => {
    const text = lines("<!-- docs:begin nope -->", "keep", "<!-- docs:end -->");
    expect(failure(text, 'unknown generator "nope"').text).toBe(text);
  });

  test("reports an unknown argument", () => {
    failure(lines("<!-- docs:begin demo x=1 -->", "<!-- docs:end -->"), 'generator "demo" has no argument "x"');
  });

  test("reports arguments it cannot read", () => {
    failure(lines("<!-- docs:begin demo n=1 junk -->", "<!-- docs:end -->"), 'cannot read the marker arguments near "junk"');
  });

  test("reports a begin that is never closed", () => {
    failure(lines("<!-- docs:begin demo n=1 -->", "text"), "docs:begin is never closed");
  });

  test("reports an end with no begin", () => {
    failure(lines("text", "<!-- docs:end -->"), "docs:end has no docs:begin", 2);
  });

  test("reports a begin nested in another", () => {
    const text = lines("<!-- docs:begin demo n=1 -->", "<!-- docs:begin demo n=2 -->", "<!-- docs:end -->");
    expect(sync(text).errors).toEqual([
      { file: "a.md", line: 1, message: "docs:begin is not closed before the next docs:begin", fixable: false },
    ]);
  });

  test("reports a generator that throws", () => {
    failure(lines("<!-- docs:begin boom -->", "<!-- docs:end -->"), 'generator "boom" failed: kaput');
  });
});

// `section` stands in for a top-level key of data/balance-config.json.
const MADE_UP = { section: { rate: 0.3, hpPercent: 25, smallPercent: 1, count: 5, ratio: 0.667, span: [4, 6], list: [{ cost: 20 }], table: { a: 1 }, words: "x" } };
const pairs = (text: string) => checkPairs("a.md", text, MADE_UP);

describe("checkPairs", () => {
  test("accepts every spelling of a value that matches", () => {
    const text = "`section.count` (5) `section.rate` (30%) `section.ratio` (≈ 2/3) `section.span` (4–6) `section.list[0].cost` (20)";
    const result = pairs(text);
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toEqual([]);
    expect(result.text).toBe(text);
  });

  test("rewrites a number that is out of step and keeps the rest of the parentheses", () => {
    const result = pairs("`section.count` (9, `LIMIT`, more)");
    expect(result.text).toBe("`section.count` (5, `LIMIT`, more)");
    expect(result.findings).toEqual([
      { file: "a.md", line: 1, message: "`section.count` says 9 here but is 5 in data/balance-config.json", fixable: true },
    ]);
  });

  test("keeps a percentage a percentage", () => {
    expect(pairs("`section.rate` (50%)").text).toBe("`section.rate` (30%)");
  });

  test("reads a percentage on a `…Percent` field as the whole percents it stores, and on any other field as a fraction", () => {
    expect(pairs("`section.hpPercent` (25%) `section.smallPercent` (1%) `section.rate` (30%)").findings).toEqual([]);
    expect(pairs("`section.hpPercent` (50%)").text).toBe("`section.hpPercent` (25%)");
    expect(pairs("`section.smallPercent` (100%)").text).toBe("`section.smallPercent` (1%)");
  });

  test("does not take 2500% for the 25 a `…Percent` field stores", () => {
    expect(pairs("`section.hpPercent` (2500%)").findings.map((finding) => finding.fixable)).toEqual([true]);
  });

  test("reads a percentage with a space before the sign as a percentage", () => {
    expect(pairs("`section.rate` (30 %)").findings).toEqual([]);
    expect(pairs("`section.rate` (50 %)").text).toBe("`section.rate` (30%)");
  });

  test("rewrites a range with the separator it was written with", () => {
    expect(pairs("`section.span` (1-3)").text).toBe("`section.span` (4-6)");
    expect(pairs("`section.span` (1–3)").text).toBe("`section.span` (4–6)");
  });

  test("leaves a close fraction alone and rewrites a far one as a decimal", () => {
    expect(pairs("`section.ratio` (≈ 2/3)").findings).toEqual([]);
    expect(pairs("`section.ratio` (≈ 1/2)").text).toBe("`section.ratio` (≈ 0.667)");
  });

  test("fixes two pairs on one line", () => {
    expect(pairs("`section.count` (1) and `section.rate` (1%)").text).toBe("`section.count` (5) and `section.rate` (30%)");
  });

  test("keeps the line numbers of the text it was given", () => {
    expect(pairs("one\ntwo\n`section.count` (9)").findings.map((finding) => finding.line)).toEqual([3]);
  });

  test("reports a field that no longer exists and does not rewrite it", () => {
    const result = pairs("`section.gone` (3)");
    expect(result.text).toBe("`section.gone` (3)");
    expect(result.findings).toEqual([
      { file: "a.md", line: 1, message: "`section.gone` no longer exists in data/balance-config.json", fixable: false },
    ]);
  });

  test("reports a range written against a single value, which rewriting cannot fix", () => {
    const result = pairs("`section.count` (4–6)");
    expect(result.text).toBe("`section.count` (4–6)");
    expect(result.findings.map((finding) => finding.fixable)).toEqual([false]);
  });

  test("ignores what is not a pair", () => {
    const text = lines(
      "`other.field` (3)", // not a key of the config
      "`section.ts` (3)", // a file name
      "`section.count` (see `LIMIT`)", // no number in the parentheses
      "`count` (7)", // a bare name, no path
      "`section.count` (see section 3 of the rest doc)", // a number inside the words, not the value
    );
    const result = pairs(text);
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toEqual([]);
    expect(result.text).toBe(text);
  });

  test("lists a pair on an object or a string as unchecked, without failing it", () => {
    const result = pairs(lines("`section.table` (3)", "`section.words` (3)"));
    expect(result.findings).toEqual([]);
    expect(result.unchecked.map((finding) => finding.line)).toEqual([1, 2]);
  });

  test("skips fenced code and generated blocks", () => {
    const text = lines(FENCE, "`section.count` (9)", FENCE, "<!-- docs:begin demo -->", "`section.count` (9)", "<!-- docs:end -->");
    const result = pairs(text);
    expect(result.findings).toEqual([]);
    expect(result.text).toBe(text);
  });
});

const KEPT = "docs/" + "kept.md";
const GONE = "docs/" + "gone.md";
const KEPT_NUMBERED = "07-" + "kept.md";
const GONE_NUMBERED = "07-" + "gone.md";
const TARGETS = { exists: (path: string) => path === KEPT, docNames: new Set([KEPT_NUMBERED]) };
const refs = (text: string) => checkReferences([{ file: "a.ts", text }], TARGETS);

describe("checkReferences", () => {
  test("accepts a path and a numbered name that exist", () => {
    expect(refs(`see ${KEPT} and ${KEPT_NUMBERED}.`)).toEqual([]);
  });

  test("reports a missing path with its line", () => {
    expect(refs(`first\nsee ${GONE}`)).toEqual([
      { file: "a.ts", line: 2, message: `names ${GONE}, which does not exist`, fixable: false },
    ]);
  });

  test("reports a missing numbered name", () => {
    expect(refs(`see ${GONE_NUMBERED}`).map((finding) => finding.message)).toEqual([`names ${GONE_NUMBERED}, which does not exist`]);
  });

  test("does not count a trailing period as part of the name", () => {
    expect(refs(`see ${KEPT}.`)).toEqual([]);
  });

  test("does not treat a glob, a placeholder or a relative link as a reference", () => {
    expect(refs("docs/**/*.md and docs/<name>.md")).toEqual([]);
    expect(refs(`[text](./${GONE_NUMBERED})`)).toEqual([]);
  });
});

// Made-up shop: tilt 2, so one step deeper doubles each tier's weight relative to the one below it.
const SHOP = {
  floorsPerStep: 10,
  anchorFirstFloor: 21,
  tilt: 2,
  maxStepsFromAnchor: 3,
  anchorWeights: {
    consumable: { common: 50, uncommon: 50, rare: 0 },
    trophy: { common: 50, uncommon: 50, rare: 0, unique: 0, epic: 0 },
  },
};
const SHOP_DATA = { balance: { ...BALANCE, shop: SHOP } } as DocsData;

describe("shopOdds", () => {
  test("lists the anchor weights of each offer kind", () => {
    expect(shopOdds.generate(SHOP_DATA, { part: "anchors" })).toEqual({
      columns: ["Offer kind", "Tiers rolled", "Anchor at floors 21–30 (C / U / R / Un / E)"],
      rows: [
        ["Consumable", "Common to Rare", "50 / 50 / 0"],
        ["Trophy", "Common to Epic", "50 / 50 / 0 / 0 / 0"],
      ],
    });
  });

  test("names the whole step that holds the anchor floor, not just its first floor", () => {
    const data = { balance: { ...BALANCE, shop: { ...SHOP, anchorFirstFloor: 25 } } } as DocsData;
    expect(shopOdds.generate(data, { part: "anchors" }).columns[2]).toBe("Anchor at floors 21–30 (C / U / R / Un / E)");
  });

  test("shifts weight toward higher tiers one step per band of floors", () => {
    expect(shopOdds.generate(SHOP_DATA, { part: "odds", bands: "11,21,31" })).toEqual({
      columns: ["Floors", "Consumable C / U / R", "Trophy C / U / R / Un / E"],
      rows: [
        ["11–20", "66.7 / 33.3 / 0", "66.7 / 33.3 / 0 / 0 / 0"],
        ["21–30", "50 / 50 / 0", "50 / 50 / 0 / 0 / 0"],
        ["31–40", "33.3 / 66.7 / 0", "33.3 / 66.7 / 0 / 0 / 0"],
      ],
    });
  });

  test("rejects a missing or unusable argument", () => {
    expect(() => shopOdds.generate(SHOP_DATA, {})).toThrow('"part" must be');
    expect(() => shopOdds.generate(SHOP_DATA, { part: "odds" })).toThrow('"bands" must list');
    expect(() => shopOdds.generate(SHOP_DATA, { part: "odds", bands: "1,x" })).toThrow('"bands" must list');
    expect(() => shopOdds.generate(SHOP_DATA, { part: "odds", bands: "0" })).toThrow('"bands" must list');
  });
});

const COIN_DATA = {
  balance: {
    ...BALANCE,
    currency: { coinDropByTier: { weak: [1, 2], medium: [3, 3], strong: [4, 5], elite: [6, 7], boss: [8, 9] } },
  },
} as DocsData;

describe("coinDropByTier", () => {
  test("lists each monster group with its coin range", () => {
    expect(coinDropByTier.generate(COIN_DATA, {})).toEqual({
      columns: ["Monster group", "Coin drop (per kill)"],
      rows: [
        ['`powerTier: "weak"`', "1–2"],
        ['`powerTier: "medium"`', "3"],
        ['`powerTier: "strong"`', "4–5"],
        ["Elite", "6–7"],
        ["Boss", "8–9"],
      ],
    });
  });
});

const PRICE_DATA = {
  balance: { ...BALANCE, events: { ...BALANCE.events, merchantPriceCoins: { common: 1, rare: 2.5, unique: 3, epic: 4 } } },
} as DocsData;
const MAP_ARGS = { path: "events.merchantPriceCoins", keyHeader: "Rarity", valueHeader: "Cost" };

describe("map", () => {
  test("turns a map of numbers into a two-column table", () => {
    expect(map.generate(PRICE_DATA, MAP_ARGS)).toEqual({
      columns: ["Rarity", "Cost"],
      rows: [["Common", "1"], ["Rare", "2.5"], ["Unique", "3"], ["Epic", "4"]],
    });
  });

  test("rejects a missing argument, a path that is not there, and something that is not a map of numbers", () => {
    expect(() => map.generate(PRICE_DATA, { ...MAP_ARGS, valueHeader: "" })).toThrow('"valueHeader" is required');
    expect(() => map.generate(PRICE_DATA, { ...MAP_ARGS, path: "events.nothing" })).toThrow("events.nothing does not exist");
    expect(() => map.generate(PRICE_DATA, { ...MAP_ARGS, path: "events.merchantRefreshCostCoins" })).toThrow("is not a map");
    expect(() => map.generate(COIN_DATA, { ...MAP_ARGS, path: "currency.coinDropByTier" })).toThrow("is not a number");
  });
});

// Made-up artifact curve, tilt 2: one step deeper doubles each rarity's weight relative to the one below it.
const ARTIFACT_CURVE = {
  floorsPerStep: 10,
  anchorFirstFloor: 21,
  tilt: 2,
  maxStepsFromAnchor: 3,
  anchorWeights: {
    elite: { common: 50, rare: 50, unique: 0, epic: 0 },
    boss: { common: 100, rare: 0, unique: 0, epic: 0 },
    treasureOrEvent: { common: 0, rare: 0, unique: 50, epic: 50 },
  },
};
const ARTIFACT_DATA = { balance: { ...BALANCE, artifacts: ARTIFACT_CURVE } } as DocsData;

describe("rarityOdds", () => {
  test("lists the anchor weights of each source", () => {
    expect(rarityOdds.generate(ARTIFACT_DATA, { part: "anchors" })).toEqual({
      columns: ["Source", "Anchor at floors 21–30 (C / R / U / E)"],
      rows: [
        ["Elite", "50 / 50 / 0 / 0"],
        ["Boss", "100 / 0 / 0 / 0"],
        ["Treasure / Event / Merchant", "0 / 0 / 50 / 50"],
      ],
    });
  });

  test("shifts weight toward higher rarities one step per band of floors", () => {
    expect(rarityOdds.generate(ARTIFACT_DATA, { part: "odds", bands: "11,21,31" })).toEqual({
      columns: ["Floors", "Elite", "Boss", "Treasure / Event"],
      rows: [
        ["11–20", "66.7 / 33.3 / 0 / 0", "100 / 0 / 0 / 0", "0 / 0 / 66.7 / 33.3"],
        ["21–30", "50 / 50 / 0 / 0", "100 / 0 / 0 / 0", "0 / 0 / 50 / 50"],
        ["31–40", "33.3 / 66.7 / 0 / 0", "100 / 0 / 0 / 0", "0 / 0 / 33.3 / 66.7"],
      ],
    });
  });

  test("rejects a missing or unusable argument", () => {
    expect(() => rarityOdds.generate(ARTIFACT_DATA, {})).toThrow('"part" must be');
    expect(() => rarityOdds.generate(ARTIFACT_DATA, { part: "odds" })).toThrow('"bands" must list');
  });
});

const gambling = (rounds: object[]) =>
  ({ balance: { ...BALANCE, events: { ...BALANCE.events, gamblingDenRounds: rounds } } }) as DocsData;

describe("gamblingRounds", () => {
  test("lists each round, with the next stake as the pot on a win and a jackpot on the last", () => {
    const data = gambling([
      { stake: 10, winChance: 0.5 },
      { stake: 20, winChance: 0.25, jackpotArtifactCount: 2, jackpotRarity: "epic" },
    ]);
    expect(gamblingRounds.generate(data, {})).toEqual({
      columns: ["Round", "Stake (= the pot so far)", "Win chance", "On win"],
      rows: [
        [1, "10 coins", "50%", "pot → 20 coins"],
        [2, "20 coins", "25%", "**2 Epic Artifacts** — the pot converts into the jackpot reward instead of doubling again"],
      ],
    });
  });

  test("says Artifact, not Artifacts, for a jackpot of one", () => {
    const data = gambling([{ stake: 5, winChance: 0.1, jackpotArtifactCount: 1, jackpotRarity: "unique" }]);
    expect(gamblingRounds.generate(data, {}).rows[0]![3]).toStartWith("**1 Unique Artifact**");
  });

  test("rejects a round with neither a next round nor a jackpot", () => {
    expect(() => gamblingRounds.generate(gambling([{ stake: 5, winChance: 0.1 }]), {})).toThrow("round 1 has no next round and no jackpot");
  });
});

const rank = (n: 1 | 2 | 3, unlockLevel: number, mpCost: number, effects: object[]) => ({ rank: n, unlockLevel, mpCost, effects });
const TESTER = {
  id: "tester",
  name: "Tester",
  skills: [
    { id: "tester-poke", name: "Poke", slot: 0, target: "singleEnemy", mpCost: 0, unlockLevel: 1, effects: [{ kind: "damage", amount: 0 }] },
    {
      id: "tester-hit", name: "Hit", slot: 1, target: "singleEnemy", cooldownTurns: 2,
      ranks: [
        rank(1, 1, 5, [{ kind: "damage", amount: 10, offenseMultiplierPercent: 100 }]),
        rank(2, 7, 6, [{ kind: "damage", amount: 13, offenseMultiplierPercent: 105 }]),
        rank(3, 15, 7, [{ kind: "damage", amount: 16, offenseMultiplierPercent: 110 }]),
      ],
    },
    {
      id: "tester-bolt", name: "Bolt", slot: 2, target: "allEnemies", isMagic: true, isUltimate: true, cooldownTurns: 4,
      ranks: [
        rank(1, 10, 9, [
          { kind: "damage", amount: 20, offenseMultiplierPercent: 80, damageType: "fire", critChance: 0.3 },
          { kind: "applyStatusEffect", statusEffectId: "burning", durationTurns: 2, chance: 0.3 },
        ]),
        rank(2, 20, 10, [
          { kind: "damage", amount: 25, offenseMultiplierPercent: 85, damageType: "fire", critChance: 0.35 },
          { kind: "applyStatusEffect", statusEffectId: "burning", durationTurns: 2, chance: 0.4 },
        ]),
        rank(3, 30, 11, [
          { kind: "damage", amount: 30, offenseMultiplierPercent: 90, damageType: "fire", critChance: 0.4 },
          { kind: "applyStatusEffect", statusEffectId: "burning", durationTurns: 2, chance: 0.5 },
        ]),
      ],
    },
    {
      id: "tester-mend", name: "Mend", slot: 3, target: "allAllies", isBuff: true,
      ranks: [
        rank(1, 5, 4, [{ kind: "heal", amount: 15, offenseMultiplierPercent: 60, appliesToRelation: "ally" }, { kind: "modifyStat", stat: "fear", amount: -6 }]),
        rank(2, 9, 5, [{ kind: "heal", amount: 20, offenseMultiplierPercent: 70, appliesToRelation: "ally" }, { kind: "modifyStat", stat: "fear", amount: -8 }]),
        rank(3, 13, 6, [{ kind: "heal", amount: 25, offenseMultiplierPercent: 80, appliesToRelation: "ally" }, { kind: "modifyStat", stat: "fear", amount: -10 }]),
      ],
    },
    {
      id: "tester-bonus", name: "Bonus", slot: 4, target: "singleEnemy",
      conditionalBonus: { requiresStatusId: "charged", ignoreDefensePercentBonus: 30, consumesStatus: true },
      executeBonus: { hpPercentThreshold: 30, bonusDamageFlat: 30 },
      ranks: [rank(1, 1, 1, [{ kind: "damage", amount: 30, offenseMultiplierPercent: 85 }]), rank(2, 2, 2, [{ kind: "damage", amount: 40, offenseMultiplierPercent: 95 }])],
    },
  ],
} as unknown as CharacterClass;
const CLASS_DATA = { classes: [TESTER] } as unknown as DocsData;

describe("classSkills", () => {
  test("lists every ranked skill with its costs, levels, effects and flags", () => {
    expect(classSkills.generate(CLASS_DATA, { class: "tester" })).toEqual({
      columns: ["Slot", "Skill id", "Name", "Target", "Cooldown", "MP cost (R1/R2/R3)", "Unlock level (R1/R2/R3)", "Effects (R1/R2/R3)", "Flags"],
      rows: [
        [1, "`tester-hit`", "Hit", "singleEnemy", "2", "5 / 6 / 7", "1 / 7 / 15", "damage 10 / 13 / 16 + 100 / 105 / 110% ATK", "—"],
        [
          2, "`tester-bolt`", "Bolt", "allEnemies", "4", "9 / 10 / 11", "10 / 20 / 30",
          "damage 20 / 25 / 30 + 80 / 85 / 90% MAG (fire, crit 30 / 35 / 40%); status burning (2 turns, 30 / 40 / 50% chance)",
          "ultimate · magic",
        ],
        [
          3, "`tester-mend`", "Mend", "allAllies", "—", "4 / 5 / 6", "5 / 9 / 13",
          "heal 15 / 20 / 25 + 60 / 70 / 80% MAG (on allies); fear -6 / -8 / -10",
          "buff",
        ],
        [
          4, "`tester-bonus`", "Bonus", "singleEnemy", "—", "1 / 2", "1 / 2",
          "damage 30 / 40 + 85 / 95% ATK; with status charged: ignores 30% defense, consumes it; below 30% HP: +30 damage",
          "—",
        ],
      ],
    });
  });

  test("rejects a missing argument and a class that does not exist", () => {
    expect(() => classSkills.generate(CLASS_DATA, {})).toThrow('"class" is required');
    expect(() => classSkills.generate(CLASS_DATA, { class: "nobody" })).toThrow('no class "nobody"');
  });

  test("says so when an effect changes kind between ranks, instead of guessing", () => {
    const broken = {
      id: "broken", name: "Broken",
      skills: [{ id: "b", name: "B", slot: 1, target: "self", ranks: [rank(1, 1, 1, [{ kind: "damage", amount: 1 }]), rank(2, 2, 2, [{ kind: "heal", amount: 1 }])] }],
    } as unknown as CharacterClass;
    expect(() => classSkills.generate({ classes: [broken] } as unknown as DocsData, { class: "broken" })).toThrow("changes kind between ranks");
  });

  test("folds identical neighbouring effects into one with a count", () => {
    const hits = [{ kind: "damage", amount: 12 }];
    const flurry = {
      id: "flurry", name: "Flurry",
      skills: [{ id: "f", name: "F", slot: 1, target: "singleEnemy", ranks: [rank(1, 1, 1, [...hits, ...hits, ...hits])] }],
    } as unknown as CharacterClass;
    expect(classSkills.generate({ classes: [flurry] } as unknown as DocsData, { class: "flurry" }).rows[0]![7]).toBe("damage 12 + 100% ATK ×3");
  });

  test("keeps a field it has no wording for, rather than dropping it", () => {
    const odd = {
      id: "odd", name: "Odd",
      skills: [{ id: "o", name: "O", slot: 1, target: "self", ranks: [rank(1, 1, 1, [{ kind: "damage", amount: 1, brandNew: 7 }])] }],
    } as unknown as CharacterClass;
    expect(classSkills.generate({ classes: [odd] } as unknown as DocsData, { class: "odd" }).rows[0]![7]).toBe("damage 1 + 100% ATK (brandNew 7)");
  });

  test("spells out a field that holds an object", () => {
    const odd = {
      id: "odd", name: "Odd",
      skills: [{ id: "o", name: "O", slot: 1, target: "self", ranks: [rank(1, 1, 1, [{ kind: "damage", amount: 1, brandNew: { min: 1, max: 2 } }])] }],
    } as unknown as CharacterClass;
    expect(classSkills.generate({ classes: [odd] } as unknown as DocsData, { class: "odd" }).rows[0]![7]).toBe("damage 1 + 100% ATK (brandNew min 1, max 2)");
  });
});

describe("basicAttacks", () => {
  test("lists the slot 0 skill of each class and the stat its damage comes from", () => {
    expect(basicAttacks.generate(CLASS_DATA, {})).toEqual({
      columns: ["Class", "Skill id", "Name", "Damage stat"],
      rows: [["Tester", "`tester-poke`", "Poke", "attack"]],
    });
  });
});

const SUMMON_DATA = {
  summons: {
    archetypes: [
      { id: "goblin", name: "Goblin", speed: 12, actionWeights: { "rock-throw": 40, basicAttack: 60 }, signatureSkillIds: ["rock-throw"] },
      { id: "totem", name: "Totem", speed: 1, passive: true },
    ],
    skills: [
      { id: "rock-throw", name: "Rock Throw", target: "singleEnemy", effects: [{ kind: "damage", amount: 8, offenseMultiplierPercent: 110 }] },
      { id: "mend", name: "Mend", target: "singleAlly", isMagic: true, effects: [{ kind: "heal", amount: 6, offenseMultiplierPercent: 100 }] },
    ],
    casts: [
      {
        id: "cast-goblin", archetypeId: "goblin", maxActions: 3, aggro: 5,
        stat: {
          maxHp: { base: 25, percent: 30, sourceStat: "maxHp" },
          defense: { base: 2, percent: 80, sourceStat: "defense" },
          attack: { base: 5, percent: [60, 80, 100], sourceStat: "magicPower" },
          magicPower: { base: 0, percent: 0, sourceStat: "magicPower" },
        },
      },
      {
        id: "cast-totem", archetypeId: "totem", maxActions: 1, aggro: 9,
        stat: {
          maxHp: { base: 10, percent: 0, sourceStat: "maxHp" },
          defense: { base: 0, percent: 50, sourceStat: "defense" },
          attack: { base: 0, percent: 0, sourceStat: "attack" },
          magicPower: { base: 0, percent: 0, sourceStat: "magicPower" },
        },
        onDeath: { offenseMultiplierPercent: [30, 40, 50], amount: [10, 15, 22], sourceStat: "attack", statusEffectId: "bleeding", statusEffectChance: [0.3, 0.33, 0.37], durationTurns: 3 },
      },
    ],
  },
} as unknown as DocsData;

describe("minions", () => {
  test("lists each cast with its minion, its stat formulas and its action weights", () => {
    expect(minions.generate(SUMMON_DATA, {})).toEqual({
      columns: ["Cast", "Minion", "Speed", "Actions", "Aggro", "Max HP", "Defense", "Attack", "Magic power", "Action weights"],
      rows: [
        ["`cast-goblin`", "Goblin", "12", "3", "5", "30% owner maxHp + 25", "80% owner defense + 2", "60 / 80 / 100% owner magicPower + 5", "0", "rock-throw 40, basicAttack 60"],
        ["`cast-totem`", "Totem", "1", "1", "9", "10", "50% owner defense", "0", "0", "—"],
      ],
    });
  });
});

describe("minionSkills", () => {
  test("lists each minion skill with its effects and who uses it", () => {
    expect(minionSkills.generate(SUMMON_DATA, {})).toEqual({
      columns: ["Skill id", "Name", "Target", "Effects", "Used by"],
      rows: [
        ["`rock-throw`", "Rock Throw", "singleEnemy", "damage 8 + 110% ATK", "Goblin"],
        ["`mend`", "Mend", "singleAlly", "heal 6 + 100% MAG", "—"],
      ],
    });
  });
});

describe("deathBursts", () => {
  test("lists the burst a cast fires when its minion dies, at each rank", () => {
    expect(deathBursts.generate(SUMMON_DATA, {})).toEqual({
      columns: ["Cast", "On death (R1/R2/R3)"],
      rows: [["`cast-totem`", "damage 10 / 15 / 22 + 30 / 40 / 50% owner attack; status bleeding (3 turns, 30 / 33 / 37% chance)"]],
    });
  });
});

const STATS_DATA = {
  classes: [
    {
      id: "a", name: "Alpha", baseMaxHp: 100, baseMaxMp: 40, baseAttack: 12, baseDefense: 6, baseMagicPower: 0, baseAggro: 9, baseSpeed: 13,
      passiveSkill: { id: "a-passive", name: "Grit", description: "", ranks: [
        { rank: 1, unlockLevel: 5, maxHpPercent: 5, aggroFlat: 3 },
        { rank: 2, unlockLevel: 20, maxHpPercent: 10, aggroFlat: 6 },
        { rank: 3, unlockLevel: 35, maxHpPercent: 15, aggroFlat: 9 },
      ] },
    },
    {
      id: "b", name: "Beta", baseMaxHp: 80, baseMaxMp: 60, baseAttack: 4, baseDefense: 5, baseMagicPower: 14, baseAggro: 7, baseSpeed: 10,
      passiveSkill: { id: "b-passive", name: "Echo", description: "", ranks: [
        { rank: 1, unlockLevel: 5, onHitStatusEffectId: "echo", procChancePercent: 30 },
        { rank: 2, unlockLevel: 20, onHitStatusEffectId: "echo-ii", procChancePercent: 40 },
        { rank: 3, unlockLevel: 35, onHitStatusEffectId: "echo-iii", procChancePercent: 50 },
      ] },
    },
  ],
} as unknown as DocsData;

describe("classStats", () => {
  test("lists the base stats of every class", () => {
    expect(classStats.generate(STATS_DATA, {})).toEqual({
      columns: ["Class", "Max HP", "Max MP", "Attack", "Defense", "Magic power", "Aggro", "Speed"],
      rows: [
        ["Alpha", "100", "40", "12", "6", "0", "9", "13"],
        ["Beta", "80", "60", "4", "5", "14", "7", "10"],
      ],
    });
  });
});

describe("balancePoints", () => {
  test("scores each class with the game editor's own formula and compares it with the roster average", () => {
    const score = (c: { baseAttack: number; baseDefense: number; baseMaxHp: number; baseMaxMp: number; baseMagicPower: number; baseSpeed: number }) =>
      characterBalancePoints({ attack: c.baseAttack, defense: c.baseDefense, maxHp: c.baseMaxHp, maxMp: c.baseMaxMp, magicPower: c.baseMagicPower, speed: c.baseSpeed });
    const [alpha, beta] = (STATS_DATA.classes as unknown as Parameters<typeof score>[0][]).map(score) as [number, number];
    const average = (alpha + beta) / 2;
    const table = balancePoints.generate(STATS_DATA, {});
    expect(table.columns).toEqual(["Class", "Balance points", "Against the roster average"]);
    expect(table.rows[0]).toEqual(["Alpha", formatRounded(alpha), `${alpha >= average ? "+" : "−"}${formatRounded(Math.abs(((alpha - average) / average) * 100))}%`]);
    expect(table.rows[2]).toEqual(["Roster average", formatRounded(average), "—"]);
  });
});

describe("passives", () => {
  test("lists each class's passive with the unlock levels and parameters at every rank", () => {
    expect(passives.generate(STATS_DATA, {})).toEqual({
      columns: ["Class", "Passive", "Unlock level (R1/R2/R3)", "Parameters (R1/R2/R3)"],
      rows: [
        ["Alpha", "Grit", "5 / 20 / 35", "maxHpPercent 5 / 10 / 15, aggroFlat 3 / 6 / 9"],
        ["Beta", "Echo", "5 / 20 / 35", "onHitStatusEffectId echo / echo-ii / echo-iii, procChancePercent 30 / 40 / 50"],
      ],
    });
  });

  test("spells out a parameter that holds an object", () => {
    const odd = { name: "Odd", passiveSkill: { name: "Twist", ranks: [{ rank: 1, unlockLevel: 5, window: { from: 1, to: 3 } }] } };
    expect(passives.generate({ classes: [odd] } as unknown as DocsData, {}).rows).toEqual([["Odd", "Twist", "5", "window from 1, to 3"]]);
  });
});

const CATALOG_DATA = {
  abilities: [
    { id: "fierce", name: "Fierce", description: "Hits hard.", rarity: "common", effects: [{ kind: "statBoost", stat: "attack", amount: 5, minPercent: 5 }] },
    { id: "stout", name: "Stout", description: "Takes a beating.", rarity: "rare", effects: [{ kind: "debuffResist", percent: 20 }] },
  ],
  artifacts: [
    { id: "gauntlet", name: "Gauntlet", description: "Worn to the strap.", rarity: "common", effects: [{ kind: "statBoost", stat: "attack", amount: 3 }] },
    { id: "locket", name: "Locket", description: "Burned portrait.", rarity: "rare", effects: [{ kind: "statBoost", stat: "maxHp", amount: -20 }] },
  ],
  statusEffects: [
    { id: "guard", name: "Guard", description: "", perTurnEffects: [{ kind: "modifyCombatStat", combatStat: "defense", amount: 6, minPercent: 10 }] },
    { id: "bleeding", name: "Bleeding", description: "", perTurnEffects: [{ kind: "damage", amount: 6, maxHpPercent: 2.5 }] },
    { id: "stunned", name: "Stunned", description: "", perTurnEffects: [], stuns: true, stackable: true, maxStacks: 5 },
    { id: "cursed", name: "Cursed", description: "", perTurnEffects: [], drain: { stat: "mp", rate: { min: 1, max: 2 } } },
  ],
  growthWeights: { classGrowthWeights: {}, monsterGrowthWeights: { balanced: { attack: 1, defense: 1, maxHp: 1 }, tanky: { attack: 0.7, defense: 0.9, maxHp: 1.4 } } },
  monsters: {
    archetypes: [
      { id: "rat", name: "Rat", skillIds: ["bite"], aiPattern: "opportunistic" },
      { id: "bat", name: "Bat", skillIds: ["bite", "drain"], aiPattern: "aggressive" },
    ],
    skills: [
      { id: "bite", name: "Bite", target: "singleEnemy", effects: [{ kind: "damage", amount: 14 }] },
      { id: "drain", name: "Drain", target: "singleEnemy", effects: [{ kind: "damage", amount: 9, lifestealPercent: 50 }] },
    ],
  },
} as unknown as DocsData;

describe("abilities", () => {
  test("lists the abilities of one rarity with the text the game shows for their effects", () => {
    const table = abilities.generate(CATALOG_DATA, { rarity: "common" });
    expect(table.columns).toEqual(["id", "Name", "Description", "Effect"]);
    expect(table.rows).toEqual([["`fierce`", "Fierce", "Hits hard.", formatAbilityEffect(CATALOG_DATA.abilities[0]!)]]);
  });

  test("rejects a missing rarity", () => {
    expect(() => abilities.generate(CATALOG_DATA, {})).toThrow('"rarity" is required');
  });

  test("rejects a rarity no ability has, rather than printing an empty table", () => {
    expect(() => abilities.generate(CATALOG_DATA, { rarity: "mythic" })).toThrow('no ability has the rarity "mythic"');
  });
});

describe("artifacts", () => {
  test("lists the artifacts named by ids, in that order, with rarity, effect and story", () => {
    const table = artifacts.generate(CATALOG_DATA, { ids: "locket,gauntlet" });
    expect(table.columns).toEqual(["id", "Rarity", "Effect", "Story"]);
    expect(table.rows).toEqual([
      ["`locket`", "Rare", formatArtifactEffect(CATALOG_DATA.artifacts[1]!), '"Burned portrait."'],
      ["`gauntlet`", "Common", formatArtifactEffect(CATALOG_DATA.artifacts[0]!), '"Worn to the strap."'],
    ]);
  });

  test("rejects an artifact that is not in the data", () => {
    expect(() => artifacts.generate(CATALOG_DATA, { ids: "gauntlet,nothing" })).toThrow('no artifact "nothing"');
  });
});

describe("statusEffects", () => {
  test("lists the named statuses with what they do each turn", () => {
    const table = statusEffects.generate(CATALOG_DATA, { ids: "bleeding,guard,stunned" });
    expect(table.columns).toEqual(["id", "Name", "Mechanics"]);
    expect(table.rows).toEqual([
      ["`bleeding`", "Bleeding", "damage 6 or 2.5% max HP per turn"],
      ["`guard`", "Guard", "defense +6 (min 10%)"],
      ["`stunned`", "Stunned", "stuns; stackable; maxStacks 5"],
    ]);
  });

  test("spells out a field that holds an object", () => {
    expect(statusEffects.generate(CATALOG_DATA, { ids: "cursed" }).rows).toEqual([["`cursed`", "Cursed", "drain stat mp, rate (min 1, max 2)"]]);
  });

  test("rejects a status that is not in the data", () => {
    expect(() => statusEffects.generate(CATALOG_DATA, { ids: "nothing" })).toThrow('no status effect "nothing"');
  });
});

describe("monsterTypeWeights", () => {
  test("lists the stat weights of each monster type", () => {
    expect(monsterTypeWeights.generate(CATALOG_DATA, {})).toEqual({
      columns: ["Type", "attack", "defense", "maxHp"],
      rows: [
        ["`balanced`", "1", "1", "1"],
        ["`tanky`", "0.7", "0.9", "1.4"],
      ],
    });
  });
});

describe("monsterSkills", () => {
  test("lists each monster skill with its effects and the archetypes that carry it", () => {
    expect(monsterSkills.generate(CATALOG_DATA, {})).toEqual({
      columns: ["Skill id", "Name", "Target", "Effects", "Used by"],
      rows: [
        ["`bite`", "Bite", "singleEnemy", "damage 14 + 100% ATK", "Rat (opportunistic), Bat (aggressive)"],
        ["`drain`", "Drain", "singleEnemy", "damage 9 + 100% ATK (50% lifesteal)", "Bat (aggressive)"],
      ],
    });
  });
});

const EVENT_DATA = {
  balance: { ...BALANCE, events: { ...BALANCE.events, commonTierWeight: 60, rareTierWeight: 40 } },
  events: [
    { id: "chest", name: "Chest", tier: "common" },
    { id: "altar", name: "Altar", tier: "rare" },
    { id: "candle", name: "Candle", tier: "rare", minFloorDepth: 15, onceLifetime: true },
    { id: "seal", name: "Seal", tier: "rare", minFloorDepth: 35 },
  ],
} as unknown as DocsData;

describe("eventTiers", () => {
  test("lists each tier with its weight and its events, noting the gates", () => {
    expect(eventTiers.generate(EVENT_DATA, {})).toEqual({
      columns: ["Tier", "Total weight", "Includes"],
      rows: [
        ["Common", "60", "`chest`"],
        ["Rare", "40", "`altar`, `candle` (from floor 15, once per run), `seal` (from floor 35)"],
      ],
    });
  });
});

const VALUES = new Map<number, Set<string>>([
  [2.5, new Set(["tilt"])],
  [3, new Set(["rounds"])],
  [12, new Set(["share"])],
  [40, new Set(["stakeLimit"])],
  [45, new Set(["archetypes"])],
  [150, new Set(["epicPrice"])],
]);
const candidates = (text: string) => findCandidates("a.md", text, VALUES).map((candidate) => `${candidate.line}:${candidate.token}`);

describe("findCandidates", () => {
  test("flags a number in prose that equals a value in the data", () => {
    expect(candidates("It costs 150 coins.")).toEqual(["1:150"]);
  });

  test("flags a decimal, and a percentage only next to a name that holds it", () => {
    expect(candidates("The tilt is 2.5, a 12% share, and 3 rounds.")).toEqual(["1:2.5", "1:12%"]);
    expect(candidates("A 12% bonus.")).toEqual([]);
  });

  test("counts a whole number up to 100 only when a name that holds it is nearby, and a larger one always", () => {
    expect(candidates("It hits for 40 damage.")).toEqual([]);
    expect(candidates("The stakeLimit is 40 coins.")).toEqual(["1:40"]);
    expect(candidates("stakeLimit ".concat(" ".repeat(60), "40 coins"))).toEqual([]);
    expect(candidates("The epicPrice is 150 coins.")).toEqual(["1:150"]);
    expect(candidates("It costs 150.")).toEqual(["1:150"]);
  });

  test("ignores a number the data does not hold", () => {
    expect(candidates("It hits for 41 damage.")).toEqual([]);
  });

  test("ignores section references, versions, links, headings and list numbers", () => {
    const text = lines("See §150 and section 150.1 and 150.1.2 and sections 2.5 and 2.5, items 2.5, 2.5.", "[text](https://example.test/150)", "## 150 Heading", "150. Item");
    expect(candidates(text)).toEqual([]);
  });

  test("ignores a pair, which the pair check already guards", () => {
    expect(candidates("The cost is `events.merchantRefreshCostCoins` (150).")).toEqual([]);
  });

  test("ignores fenced code, generated blocks and a line marked as intent", () => {
    const text = lines(FENCE, "150", FENCE, "<!-- docs:begin demo -->", "150", "<!-- docs:end -->", "A budget of 150 <!-- docs:intent -->");
    expect(candidates(text)).toEqual([]);
  });

  test("ignores everything between intent-begin and intent-end", () => {
    const text = lines("150 here counts", "<!-- docs:intent-begin -->", "A decision record: 150.", "<!-- docs:intent-end -->", "150 counts again");
    expect(candidates(text)).toEqual(["1:150", "5:150"]);
  });

  test("still counts a number on a table row", () => {
    expect(candidates(lines("| a | b |", "|---|---|", "| x | 150 |"))).toEqual(["3:150"]);
  });

  test("does not read an intent marker inside a fence or a generated block", () => {
    const text = lines(FENCE, "<!-- docs:intent-begin -->", FENCE, "150 counts", "<!-- docs:begin demo -->", "<!-- docs:intent-begin -->", "<!-- docs:end -->", "150 still counts");
    expect(candidates(text)).toEqual(["4:150", "8:150"]);
  });
});

describe("checkIntentMarkers", () => {
  const markers = (text: string) => checkIntentMarkers("a.md", text).map((finding) => `${finding.line}:${finding.message}`);
  const BEGIN = "<!-- docs:intent-begin -->";
  const END = "<!-- docs:intent-end -->";

  test("accepts balanced sections, and markers inside a fence or a block that it ignores", () => {
    expect(markers(lines(BEGIN, "text", END, BEGIN, END, FENCE, BEGIN, FENCE, "<!-- docs:begin demo -->", END, "<!-- docs:end -->"))).toEqual([]);
  });

  test("reports a begin that is never closed, which would silently exempt the rest of the doc", () => {
    expect(markers(lines("text", BEGIN, "more"))).toEqual(["2:docs:intent-begin is never closed"]);
  });

  test("reports a begin inside an open section and an end with no begin", () => {
    expect(markers(lines(BEGIN, BEGIN, END))).toEqual(["2:docs:intent-begin is already open from line 1"]);
    expect(markers(lines("text", END))).toEqual(["2:docs:intent-end has no docs:intent-begin"]);
  });
});

describe("parseMode", () => {
  test("rewrites the docs only when run without a flag", () => {
    expect(parseMode([])).toEqual({ check: false, listCoverage: false, write: true });
    expect(parseMode(["--check"])).toEqual({ check: true, listCoverage: false, write: false });
  });

  test("listing the coverage never writes", () => {
    expect(parseMode(["--coverage"])).toEqual({ check: false, listCoverage: true, write: false });
  });
});

describe("runDocsSync", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function project(files: Record<string, string>): void {
    root = mkdtempSync(join(tmpdir(), "docs-sync-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
  }
  const A = "docs/" + "a.md";
  const SUB_NUMBERED = "docs/sub/07-" + "kept.md";
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const data = { balance: { section: { rate: 7 } } } as unknown as DocsData;
  const run = (write: boolean) => runDocsSync({ root, write, data, registry: GENERATORS });

  const DOC = lines("# Doc", "", "<!-- docs:begin demo n=7 -->", "old", "<!-- docs:end -->", "", "Rate: `section.rate` (3).");
  const FIXED = lines(
    "# Doc", "", "<!-- docs:begin demo n=7 -->",
    "*Generated from `demo` by `bun run docs:sync`. Do not edit.*", "", "| N |", "|---|", "| 7 |",
    "<!-- docs:end -->", "", "Rate: `section.rate` (7).",
  );

  test("check mode reports everything out of step and writes nothing", () => {
    project({ [A]: DOC });
    const result = run(false);
    expect(result.findings.map(formatFinding)).toEqual([
      `${A}:3  block "demo" is out of date`,
      A + ":7  `section.rate` says 3 here but is 7 in data/balance-config.json",
    ]);
    expect(result.changed).toEqual([A]);
    expect(read(A)).toBe(DOC);
  });

  test("a doc with CRLF line endings, as a Windows checkout has, is in step when its content is", () => {
    project({ [A]: FIXED.replaceAll("\n", "\r\n") });
    const result = run(false);
    expect(result.findings).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  test("write mode repairs a CRLF doc and keeps its line endings", () => {
    project({ [A]: DOC.replaceAll("\n", "\r\n") });
    expect(run(true).findings).toEqual([]);
    expect(read(A)).toBe(FIXED.replaceAll("\n", "\r\n"));
  });

  test("write mode repairs the docs, and a check afterwards is clean", () => {
    project({ [A]: DOC });
    const written = run(true);
    expect(written.findings).toEqual([]);
    expect(written.changed).toEqual([A]);
    expect(read(A)).toBe(FIXED);
    const after = run(false);
    expect(after.findings).toEqual([]);
    expect(after.changed).toEqual([]);
  });

  test("write mode reports what is left at the lines of the file as written", () => {
    const stale = lines("# Doc", "", "<!-- docs:begin demo n=7 -->", "old", "<!-- docs:end -->", "", "`section.gone` (1)");
    project({ [A]: stale });
    expect(run(false).findings.map(formatFinding)).toContain(A + ":7  `section.gone` no longer exists in data/balance-config.json");
    expect(run(true).findings.map(formatFinding)).toEqual([A + ":11  `section.gone` no longer exists in data/balance-config.json"]);
    expect(read(A).split("\n")[10]).toBe("`section.gone` (1)");
  });

  test("write mode builds a block again to report the file as written only when it rewrote the doc", () => {
    let calls = 0;
    const counted: GeneratorSpec = { source: "`demo`", args: [], generate: () => { calls++; return { columns: ["N"], rows: [["1"]] }; } };
    project({ [A]: lines("# Doc", "", "<!-- docs:begin counted -->", "old", "<!-- docs:end -->") });
    runDocsSync({ root, write: true, data, registry: { counted } });
    expect(calls).toBe(2);
    calls = 0;
    runDocsSync({ root, write: true, data, registry: { counted } });
    expect(calls).toBe(1);
  });

  test("reports a code fence that never closes, because the rest of the doc would go unchecked", () => {
    project({ [A]: lines("# Doc", `${FENCE}ts`, "code", "`section.rate` (3)") });
    expect(run(false).findings.map(formatFinding)).toEqual([`${A}:2  code fence is never closed, so the rest of the doc is not checked`]);
  });

  test("write mode still reports what only a person can fix", () => {
    project({ [A]: "`section.gone` (1)" });
    expect(run(true).findings.map(formatFinding)).toEqual([
      A + ":1  `section.gone` no longer exists in data/balance-config.json",
    ]);
  });

  test("reports a reference to a doc that does not exist, in code as well as in docs", () => {
    project({ [A]: "# Doc", "src/x.ts": `// see ${GONE}\n` });
    expect(run(false).findings.map(formatFinding)).toEqual([`src/x.ts:1  names ${GONE}, which does not exist`]);
  });

  test("resolves a numbered name against every file under docs/", () => {
    project({ [SUB_NUMBERED]: "# Doc", "src/x.ts": `// see ${KEPT_NUMBERED}\n` });
    expect(run(false).findings).toEqual([]);
  });

  describe("coverage baseline", () => {
    const BASELINE = "tools/docs-sync/coverage-baseline.json";
    const covered = { balance: { section: { rate: 7 } }, dataValues: new Map([[150, new Set(["epicPrice"])]]) } as unknown as DocsData;
    const check = (write: boolean) => runDocsSync({ root, write, data: covered, registry: GENERATORS });
    const body = (n: number) => lines("# Doc", ...Array.from({ length: n }, () => "It hits for 150 damage."));

    test("passes while the count of unprotected numbers equals the baseline", () => {
      project({ [A]: body(2), [BASELINE]: JSON.stringify({ [A]: 2 }) });
      expect(check(false).findings).toEqual([]);
    });

    test("fails when a doc gains an unprotected number", () => {
      project({ [A]: body(3), [BASELINE]: JSON.stringify({ [A]: 2 }) });
      expect(check(false).findings.map((finding) => finding.message)).toEqual([
        "3 numbers equal a value in the data but are not protected (baseline 2); list them with `bun run docs:sync --coverage`",
      ]);
    });

    test("asks for the baseline to be lowered after progress, and write mode lowers it", () => {
      project({ [A]: body(1), [BASELINE]: JSON.stringify({ [A]: 2 }) });
      expect(check(false).findings.map((finding) => finding.fixable)).toEqual([true]);
      expect(check(true).findings).toEqual([]);
      expect(JSON.parse(read(BASELINE))).toEqual({ [A]: 1 });
    });

    test("write mode never raises the baseline", () => {
      project({ [A]: body(3), [BASELINE]: JSON.stringify({ [A]: 2 }) });
      check(true);
      expect(JSON.parse(read(BASELINE))).toEqual({ [A]: 2 });
    });

    test("a missing baseline counts as empty: every unprotected number fails, and write mode does not create one", () => {
      project({ [A]: body(2) });
      expect(check(false).findings.map((finding) => finding.message)).toEqual([
        "2 numbers equal a value in the data but are not protected (baseline 0); list them with `bun run docs:sync --coverage`",
      ]);
      expect(check(true).findings).toHaveLength(1);
      expect(existsSync(join(root, BASELINE))).toBe(false);
    });

    test("reports a baseline that cannot be parsed instead of crashing, and leaves the file alone", () => {
      project({ [A]: body(1), [BASELINE]: "<<<<<<< HEAD" });
      const result = check(true);
      expect(result.findings.map((finding) => [finding.file, finding.line, finding.fixable])).toEqual([[BASELINE, 1, false]]);
      expect(result.findings[0]!.message.startsWith("cannot read the coverage baseline: ")).toBe(true);
      expect(read(BASELINE)).toBe("<<<<<<< HEAD");
    });

    test("reports a baseline that is not an object of counts", () => {
      project({ [A]: body(1), [BASELINE]: '{"a": "two"}' });
      expect(check(false).findings.map((finding) => finding.message)).toEqual(["cannot read the coverage baseline: expected an object of counts per doc"]);
    });

    test("reports a line as the file stands: on disk when checking, regenerated when writing", () => {
      const stale = lines("# Doc", "", "<!-- docs:begin demo n=7 -->", "old", "<!-- docs:end -->", "", "<!-- docs:intent-begin -->", "text");
      project({ [A]: stale, [BASELINE]: "{}" });
      const unclosed = (write: boolean) => check(write).findings.filter((finding) => finding.message.includes("never closed")).map((finding) => finding.line);
      expect(unclosed(false)).toEqual([7]);
      expect(unclosed(true)).toEqual([11]);
      expect(read(A).split("\n")[10]).toBe("<!-- docs:intent-begin -->");
    });

    test("a doc with no unprotected numbers passes without a baseline", () => {
      project({ [A]: body(0) });
      expect(check(false).findings).toEqual([]);
    });

    test("reports an unbalanced intent marker as a finding", () => {
      project({ [A]: lines("# Doc", "<!-- docs:intent-begin -->", "150"), [BASELINE]: "{}" });
      expect(check(false).findings.map(formatFinding)).toEqual([`${A}:2  docs:intent-begin is never closed`]);
    });
  });
});
