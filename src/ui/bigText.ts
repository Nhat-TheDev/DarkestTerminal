const GLYPH_HEIGHT = 5;

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

export function renderBigText(text: string): string[] {
  const rows = new Array(GLYPH_HEIGHT).fill("") as string[];
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[" "]!;
    for (let r = 0; r < GLYPH_HEIGHT; r++) {
      rows[r] += glyph[r] + " ";
    }
  }
  return rows.map((r) => r.slice(0, -1));
}

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
