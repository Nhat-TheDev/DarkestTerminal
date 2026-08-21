// A tiny 5-row block font — just enough letters to spell the splash-screen
// title. Each glyph's rows must all share the same width (enforced by
// test/bigText.test.ts) so renderBigText can line them up column by column.
const GLYPH_HEIGHT = 5;

// Every stroke is 2 columns wide — terminal cells are 1x2 (tall, not square,
// see darkest-terminal-sprite-layout notes), so single-column strokes read as
// thin hairlines next to the already-"thick" (2-cell-tall) rows. Doubling
// stroke width balances the two axes and makes the banner read as bold.
const FONT: Record<string, string[]> = {
  D: ["█████ ", "██  ██", "██  ██", "██  ██", "█████ "],
  A: [" ████ ", "██  ██", "██████", "██  ██", "██  ██"],
  R: ["█████ ", "██  ██", "█████ ", "██ ██ ", "██  ██"],
  K: ["██  ██", "██ ██ ", "████  ", "██ ██ ", "██  ██"],
  E: ["██████", "██    ", "█████ ", "██    ", "██████"],
  S: [" █████", "██    ", " ████ ", "    ██", "█████ "],
  T: ["██████", "  ██  ", "  ██  ", "  ██  ", "  ██  "],
  M: ["██    ██", "███  ███", "██ ██ ██", "██    ██", "██    ██"],
  I: ["██", "██", "██", "██", "██"],
  N: ["██    ██", "███   ██", "██ ██ ██", "██   ███", "██    ██"],
  L: ["██    ", "██    ", "██    ", "██    ", "██████"],
  " ": ["    ", "    ", "    ", "    ", "    "],
};

/** Renders `text` (case-insensitive) as GLYPH_HEIGHT rows of block-letter art, 1 column of gap between letters. */
export function renderBigText(text: string): string[] {
  const rows = new Array(GLYPH_HEIGHT).fill("") as string[];
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[" "]!;
    for (let r = 0; r < GLYPH_HEIGHT; r++) {
      rows[r] += glyph[r] + " ";
    }
  }
  // Every row got the exact same "+1 gap column" appended per letter, so they're
  // all the same length — safe to drop the final trailing gap uniformly (a
  // per-row trimEnd would trim different amounts and break column alignment).
  return rows.map((r) => r.slice(0, -1));
}

/**
 * Renders each word on its own stacked block (one blank row between blocks),
 * every row centered to the widest word — the 2-thick-stroke font is ~7
 * columns/letter, too wide for 1 line at "DarkestTerminal" length (104 cols)
 * to fit an 80-column terminal, but each word alone fits comfortably.
 */
export function renderBigTextStacked(words: string[]): string[] {
  const blocks = words.map(renderBigText);
  const width = Math.max(...blocks.flat().map((r) => r.length));
  const center = (r: string) => {
    const pad = width - r.length;
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + r + " ".repeat(pad - left);
  };
  const rows: string[] = [];
  blocks.forEach((block, i) => {
    if (i > 0) rows.push(" ".repeat(width));
    rows.push(...block.map(center));
  });
  return rows;
}
