import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { BACKDROPS } from "../src/data/backdrops";
import { BATTLEFIELD_CONTENT_WIDTH, DIVIDER_WIDTH, ICON_BAND_ROWS, SLOT_GAP, SLOT_WIDTH } from "../src/ui/layout";
import { compositeSpriteRow, MAX_BOSS_HEIGHT, spriteForClass, spriteForMonster, type Sprite } from "../src/ui/sprites";
import { previewScene } from "../tools/game-editor/backdropPreview";

const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
const saveStart = editor.indexOf("  async function saveHandler() {");
const saveEnd = editor.indexOf('\n  categoryEl.addEventListener("change"', saveStart);
const saveSource = editor.slice(saveStart, saveEnd);

test.each(["during", "after"])("sprite cache retains the submitted palette when colors change %s saving", async (when) => {
  expect(saveStart).toBeGreaterThan(-1);
  expect(saveEnd).toBeGreaterThan(saveStart);
  const palette: Record<string, string> = { A: "#ffff00", B: "#79502d" };
  const section: Record<string, Sprite> = { full: { rows: ["AB"], palette: { ...palette } } };
  const requests: Sprite[] = [];
  const statuses: string[] = [];
  const saving = runInNewContext(`${saveSource}\nsaveHandler()`, {
    grid: [["A", "B"]], palette, category: "torch",
    idInputEl: { value: "full" }, existingIdEl: { value: "full" },
    currentSection: () => section,
    populateExistingIds: () => {},
    setStatus: (message: string) => statuses.push(message),
    fetch: async (_url: string, options: { body: string }) => {
      requests.push(JSON.parse(options.body).sprite);
      return { json: async () => ({ ok: true }) };
    },
  }) as Promise<void>;
  if (when === "after") await saving;
  palette.A = "#ff0000";
  delete palette.B;
  await saving;
  expect(requests).toHaveLength(1);
  expect(section.full).toEqual(requests[0]);
  expect(section.full!.palette).not.toBe(palette);
  expect(section.full!.palette).toEqual({ A: "#ffff00", B: "#79502d" });
  expect(statuses).toEqual(['Saved "full" to data/sprites.json']);
});

test.each(["category", "sprite"])("saving preserves the original cache and selection after switching %s", async (change) => {
  const sections: Record<string, Record<string, Sprite>> = {
    torch: { full: { rows: ["A"], palette: { A: "#79502d" } } },
    temple: { shrine: { rows: ["B"], palette: { B: "#ffffff" } } },
  };
  const templeBefore = structuredClone(sections.temple);
  const requests: { category: string; id: string; sprite: Sprite }[] = [];
  let populated = 0;
  const editorState = {
    grid: [["A"]], palette: { A: "#ffff00" }, category: "torch",
    idInputEl: { value: "full" }, existingIdEl: { value: "full" },
    currentSection: (): Record<string, Sprite> => sections[editorState.category]!,
    populateExistingIds: () => { populated++; },
    setStatus: () => {},
    fetch: async (_url: string, options: { body: string }) => {
      requests.push(JSON.parse(options.body));
      return { json: async () => ({ ok: true }) };
    },
  };
  const saving = runInNewContext(`${saveSource}\nsaveHandler()`, editorState) as Promise<void>;
  editorState.category = change === "category" ? "temple" : "torch";
  editorState.idInputEl.value = change === "category" ? "shrine" : "embers";
  editorState.existingIdEl.value = editorState.idInputEl.value;
  const selection = editorState.idInputEl.value;
  await saving;
  expect(requests).toHaveLength(1);
  expect(requests[0]!.category).toBe("torch");
  expect(requests[0]!.id).toBe("full");
  expect(sections.torch!.full).toEqual(requests[0]!.sprite);
  expect(sections.temple).toEqual(templeBefore);
  expect(editorState.idInputEl.value).toBe(selection);
  expect(editorState.existingIdEl.value).toBe(selection);
  expect(populated).toBe(0);
});

test("a full backdrop preview keeps every enemy pixel at its in-game position", () => {
  const party = ["knight", "plague-doctor", "viking", "paladin"];
  const monsters = Array.from({ length: 3 }, () => ({ id: "vampire-lord", tier: "elite" as const }));
  const height = ICON_BAND_ROWS + MAX_BOSS_HEIGHT;
  const partyRow = compositeSpriteRow(party.map(spriteForClass), SLOT_WIDTH, height, SLOT_GAP);
  const enemyRows = compositeSpriteRow(monsters.map((m) => spriteForMonster(m.id, m.tier)), SLOT_WIDTH, height, SLOT_GAP);
  const enemyLeft = partyRow[0]!.reduce((width, chunk) => width + chunk.text.length, 0) + DIVIDER_WIDTH;
  const grid = previewScene(BACKDROPS, Object.keys(BACKDROPS.scenes)[0]!, { dimmed: false, shadow: false, party, monsters });
  for (const row of grid) expect(row).toHaveLength(BATTLEFIELD_CONTENT_WIDTH);
  let pixels = 0;
  for (const [y, row] of enemyRows.entries()) {
    let x = enemyLeft;
    for (const chunk of row) {
      if (chunk.bg) {
        const color = "#" + chunk.bg.toInts().slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("");
        for (let i = 0; i < chunk.text.length; i++) {
          expect(grid[y]?.[x + i]?.bg).toBe(color);
          pixels++;
        }
      }
      x += chunk.text.length;
    }
  }
  expect(pixels).toBeGreaterThan(0);
});
