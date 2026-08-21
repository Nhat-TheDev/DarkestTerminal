import { readFile, writeFile } from "fs/promises";
import path from "path";

const DATA_PATH = path.resolve(import.meta.dir, "../../data/sprites.json");
const HTML_PATH = path.resolve(import.meta.dir, "index.html");
const PORT = 4590;

interface SpriteData {
  rows: string[];
  palette: Record<string, string>;
}

interface SpritesFile {
  classes: Record<string, SpriteData>;
  monsters: Record<string, SpriteData>;
  elites: Record<string, SpriteData>;
  bosses: Record<string, SpriteData>;
}

type Category = "classes" | "monsters" | "elites" | "bosses";
const CATEGORIES: Category[] = ["classes", "monsters", "elites", "bosses"];

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as string[]).includes(value);
}

const MAX_HEIGHT: Record<Category, number> = { classes: 10, monsters: 10, elites: 11, bosses: 13 };

function validateSprite(sprite: unknown, category: Category): string | null {
  if (typeof sprite !== "object" || sprite === null) return "Missing sprite data.";
  const { rows, palette } = sprite as Record<string, unknown>;
  if (!Array.isArray(rows) || rows.length === 0) return "Sprite needs at least 1 row.";
  if (rows.length > MAX_HEIGHT[category]) return `Sprite height must be at most ${MAX_HEIGHT[category]} rows for this category.`;
  const width = typeof rows[0] === "string" ? rows[0].length : 0;
  if (width === 0) return "Sprite width must be greater than 0.";
  for (const row of rows) {
    if (typeof row !== "string" || row.length !== width) return "All rows must have the same width.";
  }
  if (typeof palette !== "object" || palette === null) return "Missing palette.";
  const paletteEntries = Object.entries(palette as Record<string, unknown>);
  for (const [key, value] of paletteEntries) {
    if (key === ".") return `Can't use "." as a color character (reserved for empty cells).`;
    if (key.length !== 1) return `Palette character "${key}" must be exactly 1 character.`;
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) return `Invalid color for "${key}": ${String(value)}`;
  }
  const used = new Set((rows as string[]).join("").split("").filter((c) => c !== "."));
  const paletteKeys = new Set(paletteEntries.map(([key]) => key));
  for (const c of used) {
    if (!paletteKeys.has(c)) return `Character "${c}" is used in the sprite but has no color in the palette.`;
  }
  return null;
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(HTML_PATH, "utf8");
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (req.method === "GET" && url.pathname === "/api/sprites") {
      const json = await readFile(DATA_PATH, "utf8");
      return new Response(json, { headers: { "content-type": "application/json" } });
    }

    if (req.method === "POST" && url.pathname === "/api/sprites") {
      let body: { category?: unknown; id?: unknown; sprite?: unknown };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return badRequest("Body is not valid JSON.");
      }

      const { category, id, sprite } = body;
      if (!isCategory(category)) return badRequest(`category must be one of: ${CATEGORIES.join(", ")}.`);
      if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
        return badRequest("id must start with a lowercase letter and contain only lowercase letters/digits/hyphens.");
      }
      const validationError = validateSprite(sprite, category);
      if (validationError) return badRequest(validationError);
      const cleanSprite = sprite as SpriteData;

      const raw = await readFile(DATA_PATH, "utf8");
      const data = JSON.parse(raw) as SpritesFile;
      data[category][id] = cleanSprite;
      await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Sprite editor running at http://localhost:${PORT}`);
