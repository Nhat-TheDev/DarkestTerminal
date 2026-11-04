import { expect, test } from "bun:test";
import { BACKDROPS } from "../src/data/backdrops";
import { BATTLEFIELD_CONTENT_WIDTH, SLOT_GAP, SLOT_WIDTH, UNIT_BLOCK_HEIGHT, ICON_BAND_ROWS } from "../src/ui/layout";
import { CLASS_SPRITES, MAX_BOSS_HEIGHT, spriteSlotLayout } from "../src/ui/sprites";
import { previewScene } from "../tools/game-editor/backdropPreview";

const sceneId = Object.keys(BACKDROPS.scenes)[0]!;
const classId = Object.keys(CLASS_SPRITES)[0]!;
const sprite = CLASS_SPRITES[classId]!;
const opts = { dimmed: false, shadow: false, party: [classId], monsters: [] };

function firstSpriteCell() {
  const { starts } = spriteSlotLayout([sprite], SLOT_WIDTH, SLOT_GAP);
  const top = ICON_BAND_ROWS + MAX_BOSS_HEIGHT - sprite.rows.length;
  for (let r = 0; r < sprite.rows.length; r++) {
    const c = sprite.rows[r]!.search(/[^.]/);
    if (c >= 0) return { x: starts[0]! + c, y: top + r, color: sprite.palette[sprite.rows[r]![c]!]! };
  }
  throw new Error("empty sprite");
}

const sum = (h: string) => [1, 3, 5].reduce((a, i) => a + parseInt(h.slice(i, i + 2), 16), 0);

test("the preview is a full battlefield grid", () => {
  const grid = previewScene(BACKDROPS, sceneId, opts);
  expect(grid).toHaveLength(UNIT_BLOCK_HEIGHT);
  for (const row of grid) expect(row).toHaveLength(BATTLEFIELD_CONTENT_WIDTH);
});

test("a sprite cell carries the sprite's palette colour", () => {
  const { x, y, color } = firstSpriteCell();
  expect(previewScene(BACKDROPS, sceneId, opts)[y]![x]!.bg).toBe(color.toLowerCase());
});

test("unit shadow darkens a backdrop cell next to a sprite only when on", () => {
  const { x, y } = firstSpriteCell();
  const off = previewScene(BACKDROPS, sceneId, opts)[y]![x - 1]!.bg!;
  const on = previewScene(BACKDROPS, sceneId, { ...opts, shadow: true })[y]![x - 1]!.bg!;
  expect(sum(on)).toBeLessThan(sum(off));
  expect(previewScene(BACKDROPS, sceneId, opts)[y]![x - 1]!.bg).toBe(off);
});

test("label and status rows carry no backdrop", () => {
  const grid = previewScene(BACKDROPS, sceneId, opts);
  for (const y of [UNIT_BLOCK_HEIGHT - 2, UNIT_BLOCK_HEIGHT - 1]) for (const cell of grid[y]!) expect(cell.bg).toBeNull();
});

test("left unforced, the preview shadow follows the scene's own unitShadow, as the game does", () => {
  const { x, y } = firstSpriteCell();
  const file = structuredClone(BACKDROPS);
  file.scenes[sceneId]!.render = { ...file.scenes[sceneId]!.render, unitShadow: { enabled: true } };
  const { shadow: _, ...unforced } = opts;
  const sceneShadow = previewScene(file, sceneId, unforced)[y]![x - 1]!.bg!;
  expect(sceneShadow).toBe(previewScene(file, sceneId, { ...opts, shadow: true })[y]![x - 1]!.bg!);
  expect(sum(sceneShadow)).toBeLessThan(sum(previewScene(file, sceneId, opts)[y]![x - 1]!.bg!));
});
