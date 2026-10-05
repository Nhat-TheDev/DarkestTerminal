import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { syncBlocks } from "./blocks";
import { checkIntentMarkers, findCandidates, type Candidate } from "./coverage";
import { loadDocsData } from "./data";
import { REGISTRY } from "./generators";
import { unclosedFence } from "./lines";
import { checkPairs } from "./pairs";
import { checkReferences, type RefSource } from "./refs";
import type { DocsData, Finding, GeneratorSpec } from "./types";

/** How many findings the command prints before it summarises the rest. */
const MAX_PRINTED = 20;

/** Repo-relative paths (always with `/`) of the files under `dir` that `keep` accepts. */
function listFiles(root: string, dir: string, keep: (name: string) => boolean): string[] {
  const start = join(root, dir);
  if (!existsSync(start)) return [];
  const found: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") visit(full);
      } else if (keep(entry.name)) {
        found.push(relative(root, full).split(sep).join("/"));
      }
    }
  };
  visit(start);
  return found.sort();
}

const isMarkdown = (name: string) => name.endsWith(".md");
/** Docs the coverage check leaves alone: specs under `docs/specs/`, and the narrative docs, which hold no balance numbers. */
const NOT_COVERED = (file: string) => file.startsWith("docs/specs/") || file.endsWith("10-event-narrative.md") || file.endsWith("11-world-bible.md");
const BASELINE_PATH = "tools/docs-sync/coverage-baseline.json";
const isSource = (name: string) => name.endsWith(".ts") || name.endsWith(".html");

export interface RunOptions {
  root: string;
  /** Rewrite what is out of step. When false nothing is written and every finding is reported. */
  write: boolean;
  data: DocsData;
  registry?: Readonly<Record<string, GeneratorSpec>>;
}

export interface RunResult {
  /** Numbers in prose that equal a value in the data and are not protected, in the docs the coverage check covers. */
  candidates: Candidate[];
  findings: Finding[];
  /** Pairs the check could not compare. Information only. */
  unchecked: Finding[];
  /** Docs whose text is, or in write mode was, rewritten. */
  changed: string[];
}

/** The recorded counts per doc; a missing file is an empty baseline, an unreadable one throws. */
function readBaseline(path: string): Record<string, number> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || Object.values(parsed).some((count) => typeof count !== "number")) {
    throw new Error("expected an object of counts per doc");
  }
  return parsed as Record<string, number>;
}

/**
 * Compares the count of unprotected numbers per doc with the recorded baseline; progress lowers it, a rise is a finding.
 * A doc, or the whole file, missing from the baseline counts as zero, so nothing here can raise it.
 */
function checkBaseline(root: string, write: boolean, candidates: readonly Candidate[], covered: readonly string[]): Finding[] {
  const path = join(root, BASELINE_PATH);
  let baseline: Record<string, number>;
  try {
    baseline = readBaseline(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [{ file: BASELINE_PATH, line: 1, message: `cannot read the coverage baseline: ${reason}`, fixable: false }];
  }
  const counts = new Map<string, number>(covered.map((file) => [file, 0]));
  for (const candidate of candidates) counts.set(candidate.file, (counts.get(candidate.file) ?? 0) + 1);

  const findings: Finding[] = [];
  const next: Record<string, number> = {};
  for (const [file, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    const recorded = baseline[file] ?? 0;
    if (count > recorded) {
      const first = candidates.find((candidate) => candidate.file === file)!;
      findings.push({
        file,
        line: first.line,
        message: `${count} numbers equal a value in the data but are not protected (baseline ${recorded}); list them with \`bun run docs:sync --coverage\``,
        fixable: false,
      });
    } else if (count < recorded) {
      findings.push({ file, line: 1, message: `the coverage baseline says ${recorded} unprotected numbers but there are ${count}`, fixable: true });
    }
    const kept = Math.min(recorded, count);
    if (kept > 0) next[file] = kept;
  }
  const serialised = `${JSON.stringify(next, null, 2)}\n`;
  if (write && serialised !== `${JSON.stringify(baseline, null, 2)}\n`) writeFileSync(path, serialised);
  return findings;
}

export function runDocsSync({ root, write, data, registry = REGISTRY }: RunOptions): RunResult {
  const findings: Finding[] = [];
  const unchecked: Finding[] = [];
  const changed: string[] = [];
  const sources: RefSource[] = [];
  const candidates: Candidate[] = [];

  const docs = listFiles(root, "docs", isMarkdown);
  for (const file of docs) {
    // A Windows checkout has CRLF endings; the checks work on LF text and a rewrite keeps the file's own endings.
    const raw = readFileSync(join(root, file), "utf8");
    const crlf = raw.includes("\r\n");
    const original = crlf ? raw.replaceAll("\r\n", "\n") : raw;
    // Pairs first: their rewrites never change a line count, so the pair and block findings carry the file's own line numbers.
    const check = (text: string) => {
      const pairs = checkPairs(file, text, data.balance);
      return { pairs, blocks: syncBlocks(file, pairs.text, registry, data) };
    };
    const first = check(original);
    // When it rewrote the doc, report what is left in the file as written, so the lines are the ones the reader opens.
    const { pairs, blocks } = write && first.blocks.text !== original ? check(first.blocks.text) : first;
    findings.push(...[...pairs.findings, ...blocks.errors, ...blocks.stale].sort((a, b) => a.line - b.line));
    unchecked.push(...pairs.unchecked);
    // The checks below read the file as it stands once this run is over, for the same reason.
    const current = write ? blocks.text : original;
    sources.push({ file, text: current });
    const fenceLine = unclosedFence(current.split("\n"));
    if (fenceLine !== undefined) {
      findings.push({ file, line: fenceLine, message: "code fence is never closed, so the rest of the doc is not checked", fixable: false });
    }
    if (!NOT_COVERED(file)) {
      findings.push(...checkIntentMarkers(file, current));
      if (data.dataValues) candidates.push(...findCandidates(file, current, data.dataValues));
    }
    if (blocks.text === original) continue;
    changed.push(file);
    if (write) writeFileSync(join(root, file), crlf ? blocks.text.replaceAll("\n", "\r\n") : blocks.text);
  }

  const others = [
    ...["src", "test", "tools"].flatMap((dir) => listFiles(root, dir, isSource)),
    ...["CLAUDE.md", "README.md"].filter((file) => existsSync(join(root, file))),
  ];
  for (const file of others) sources.push({ file, text: readFileSync(join(root, file), "utf8") });
  findings.push(
    ...checkReferences(sources, {
      exists: (path) => existsSync(join(root, path)),
      docNames: new Set(docs.map((file) => basename(file))),
    }),
  );

  if (data.dataValues) findings.push(...checkBaseline(root, write, candidates, docs.filter((file) => !NOT_COVERED(file))));

  return { candidates, findings: write ? findings.filter((finding) => !finding.fixable) : findings, unchecked, changed };
}

export function formatFinding({ file, line, message }: Finding): string {
  return `${file}:${line}  ${message}`;
}

/** `--check` and `--coverage` only read; with neither, the command rewrites what is out of step. */
export function parseMode(argv: readonly string[]): { check: boolean; listCoverage: boolean; write: boolean } {
  const check = argv.includes("--check");
  const listCoverage = argv.includes("--coverage");
  return { check, listCoverage, write: !check && !listCoverage };
}

if (import.meta.main) {
  const { check, listCoverage, write } = parseMode(process.argv);
  const result = runDocsSync({ root: resolve(import.meta.dir, "../.."), write, data: loadDocsData() });
  if (listCoverage) {
    for (const candidate of result.candidates) console.log(`${candidate.file}:${candidate.line}  ${candidate.token}`);
    console.log(`${result.candidates.length} unprotected numbers`);
    process.exit(0);
  }
  for (const finding of result.findings.slice(0, MAX_PRINTED)) console.log(formatFinding(finding));
  if (result.findings.length > MAX_PRINTED) console.log(`... and ${result.findings.length - MAX_PRINTED} more`);
  if (result.unchecked.length > 0) console.log(`unchecked:\n${result.unchecked.map((finding) => `  ${formatFinding(finding)}`).join("\n")}`);
  if (!check) console.log(result.changed.length > 0 ? `updated: ${result.changed.join(", ")}` : "docs already in step");
  if (check && result.findings.some((finding) => finding.fixable)) console.log("run `bun run docs:sync`");
  process.exitCode = result.findings.length > 0 ? 1 : 0;
}
