// Local dev tool: a tiny pixel-sprite editor for data/sprites.json. Run with
// `bun run sprite-editor`, then open the printed URL. Not part of the game
// itself — this only touches the repo's own filesystem, on localhost.
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
  /** Only the 5 archetypes with both eliteSkillIds and bossSkillIds (see GUARD_ROOM_ARCHETYPES in src/data/floor.ts) ever resolve to these. */
  elites: Record<string, SpriteData>;
  bosses: Record<string, SpriteData>;
}

type Category = "classes" | "monsters" | "elites" | "bosses";
const CATEGORIES: Category[] = ["classes", "monsters", "elites", "bosses"];

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as string[]).includes(value);
}

/** height cap per category — mirrors MAX_UNIT_HEIGHT/MAX_ELITE_HEIGHT/MAX_BOSS_HEIGHT in src/ui/sprites.ts. */
const MAX_HEIGHT: Record<Category, number> = { classes: 10, monsters: 10, elites: 11, bosses: 13 };

/** Mirrors the invariants test/sprites.test.ts checks — reject anything that would fail that suite. */
function validateSprite(sprite: unknown, category: Category): string | null {
  if (typeof sprite !== "object" || sprite === null) return "Thiếu dữ liệu sprite.";
  const { rows, palette } = sprite as Record<string, unknown>;
  if (!Array.isArray(rows) || rows.length === 0) return "Sprite cần ít nhất 1 dòng.";
  if (rows.length > MAX_HEIGHT[category]) return `Sprite cao tối đa ${MAX_HEIGHT[category]} dòng cho loại này.`;
  const width = typeof rows[0] === "string" ? rows[0].length : 0;
  if (width === 0) return "Chiều rộng sprite phải lớn hơn 0.";
  for (const row of rows) {
    if (typeof row !== "string" || row.length !== width) return "Tất cả các dòng phải có cùng chiều rộng.";
  }
  if (typeof palette !== "object" || palette === null) return "Thiếu palette.";
  const paletteEntries = Object.entries(palette as Record<string, unknown>);
  for (const [key, value] of paletteEntries) {
    if (key === ".") return `Không thể dùng "." làm ký tự màu (dành cho ô trống).`;
    if (key.length !== 1) return `Ký tự palette "${key}" phải là đúng 1 ký tự.`;
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) return `Màu của "${key}" không hợp lệ: ${String(value)}`;
  }
  const used = new Set((rows as string[]).join("").split("").filter((c) => c !== "."));
  const paletteKeys = new Set(paletteEntries.map(([key]) => key));
  for (const c of used) {
    if (!paletteKeys.has(c)) return `Ký tự "${c}" được dùng trong hình nhưng chưa có màu trong palette.`;
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
        return badRequest("Body không phải JSON hợp lệ.");
      }

      const { category, id, sprite } = body;
      if (!isCategory(category)) return badRequest(`category phải là 1 trong: ${CATEGORIES.join(", ")}.`);
      if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
        return badRequest("id phải bắt đầu bằng chữ thường, chỉ gồm chữ thường/số/dấu gạch ngang.");
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
