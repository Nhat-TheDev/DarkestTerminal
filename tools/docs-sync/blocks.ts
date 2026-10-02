import { BLOCK_BEGIN, BLOCK_END, FenceTracker } from "./lines";
import { renderMarkdown } from "./render";
import type { DocsData, Finding, GeneratorSpec } from "./types";

interface Block {
  /** Text between `docs:begin` and `-->`. */
  marker: string;
  /** 0-based line indexes of the two marker lines. */
  begin: number;
  end: number;
}

type Registry = Readonly<Record<string, GeneratorSpec>>;

function findBlocks(file: string, lines: readonly string[]): { blocks: Block[]; errors: Finding[] } {
  const blocks: Block[] = [];
  const errors: Finding[] = [];
  const fences = new FenceTracker();
  let open: { marker: string; begin: number } | null = null;
  const fail = (index: number, message: string) => errors.push({ file, line: index + 1, message, fixable: false });

  for (const [index, line] of lines.entries()) {
    if (fences.feed(line)) continue;
    const begin = BLOCK_BEGIN.exec(line);
    if (begin) {
      if (open) fail(open.begin, "docs:begin is not closed before the next docs:begin");
      open = { marker: begin[1]!, begin: index };
      continue;
    }
    if (!BLOCK_END.test(line)) continue;
    if (!open) fail(index, "docs:end has no docs:begin");
    else blocks.push({ ...open, end: index });
    open = null;
  }
  if (open) fail(open.begin, "docs:begin is never closed");
  return { blocks, errors };
}

const MARKER_ARG = /^\s+(\w+)=(?:"([^"]*)"|(\S+))/;

function parseMarker(marker: string): { name: string; args: Record<string, string> } | { error: string } {
  const text = marker.trim();
  const name = /^[A-Za-z][\w-]*/.exec(text)?.[0];
  if (!name) return { error: "docs:begin needs a generator name" };
  const args: Record<string, string> = {};
  let rest = text.slice(name.length);
  for (let arg = MARKER_ARG.exec(rest); arg; arg = MARKER_ARG.exec(rest)) {
    args[arg[1]!] = arg[2] ?? arg[3]!;
    rest = rest.slice(arg[0].length);
  }
  if (rest.trim() !== "") return { error: `cannot read the marker arguments near "${rest.trim()}"` };
  return { name, args };
}

export interface BlockSyncResult {
  text: string;
  errors: Finding[];
  /** One entry per block whose content differs from what its generator produces. */
  stale: Finding[];
}

/** Regenerates every block in `text`. Nothing outside the markers is touched. */
export function syncBlocks(file: string, text: string, registry: Registry, data: DocsData): BlockSyncResult {
  const lines = text.split("\n");
  const { blocks, errors } = findBlocks(file, lines);
  const stale: Finding[] = [];
  const fail = (block: Block, message: string) => errors.push({ file, line: block.begin + 1, message, fixable: false });

  // Last block first, so replacing one never shifts the line numbers of those before it.
  for (const block of [...blocks].reverse()) {
    const marker = parseMarker(block.marker);
    if ("error" in marker) {
      fail(block, marker.error);
      continue;
    }
    const spec = Object.hasOwn(registry, marker.name) ? registry[marker.name] : undefined;
    if (!spec) {
      fail(block, `unknown generator "${marker.name}"`);
      continue;
    }
    const unknownArg = Object.keys(marker.args).find((key) => !spec.args.includes(key));
    if (unknownArg) {
      fail(block, `generator "${marker.name}" has no argument "${unknownArg}"`);
      continue;
    }
    let body: string[];
    try {
      const notice = `*Generated from ${spec.source} by \`bun run docs:sync\`. Do not edit.*`;
      body = [notice, "", ...renderMarkdown(spec.generate(data, marker.args)).split("\n")];
    } catch (error) {
      fail(block, `generator "${marker.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const current = lines.slice(block.begin + 1, block.end);
    if (current.length === body.length && current.every((line, i) => line === body[i])) continue;
    stale.push({ file, line: block.begin + 1, message: `block "${marker.name}" is out of date`, fixable: true });
    lines.splice(block.begin + 1, block.end - block.begin - 1, ...body);
  }
  return { text: lines.join("\n"), errors, stale };
}
