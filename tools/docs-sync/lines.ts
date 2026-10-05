export const BLOCK_BEGIN = /^\s*<!--\s*docs:begin\b(.*?)-->\s*$/;
export const BLOCK_END = /^\s*<!--\s*docs:end\s*-->\s*$/;

/**
 * Follows fenced code blocks line by line. A fence opened with N backticks closes only on a line
 * of at least N backticks and nothing else, so a four-backtick fence can show a three-backtick one.
 */
export class FenceTracker {
  private openLength = 0;

  get isOpen(): boolean {
    return this.openLength > 0;
  }

  /** Feeds the next line; true when it is a fence delimiter or sits inside a fenced block. */
  feed(line: string): boolean {
    const fence = /^\s*(`{3,})(.*)$/.exec(line);
    if (this.openLength === 0) {
      if (!fence) return false;
      this.openLength = fence[1]!.length;
      return true;
    }
    if (fence && fence[1]!.length >= this.openLength && fence[2]!.trim() === "") this.openLength = 0;
    return true;
  }
}

/** The 1-based line of a fence that never closes: everything after it counts as code and escapes every check. */
export function unclosedFence(lines: readonly string[]): number | undefined {
  const fences = new FenceTracker();
  let opened: number | undefined;
  lines.forEach((line, index) => {
    const wasOpen = fences.isOpen;
    fences.feed(line);
    if (!wasOpen && fences.isOpen) opened = index + 1;
  });
  return fences.isOpen ? opened : undefined;
}

export type LineKind = "prose" | "fence" | "block";

/** Marks each line as prose, as part of a fenced code block, or as part of a generated block (markers included). */
export function classifyLines(lines: readonly string[]): LineKind[] {
  const fences = new FenceTracker();
  let inBlock = false;
  return lines.map((line) => {
    if (fences.feed(line)) return "fence";
    if (BLOCK_BEGIN.test(line)) {
      inBlock = true;
      return "block";
    }
    if (BLOCK_END.test(line)) {
      inBlock = false;
      return "block";
    }
    return inBlock ? "block" : "prose";
  });
}
