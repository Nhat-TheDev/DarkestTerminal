import { expect, test } from "bun:test";
import { COMBAT_FX } from "../src/data/combatFx";
import { CLASSES } from "../src/data/classes";
import { MONSTER_ARCHETYPES } from "../src/data/monsters";
import { mergeCombatFxEffect, previewCombatFx } from "../tools/game-editor/combatFxPreview";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const options = { effect: "thrust" as const, frameIndex: 0, reverse: false, classId: CLASSES[0]!.id, monsterId: MONSTER_ARCHETYPES.find((m) => m.roles.includes("normal"))!.id };

test("saving one animation preserves mappings and other effects without mutating its source", () => {
  const before = structuredClone(COMBAT_FX);
  const animation = { palette: { A: "#123456" }, frames: [{ offsetX: 0, offsetY: 0, rows: ["A"] }] };
  const next = mergeCombatFxEffect(COMBAT_FX, "thrust", animation);
  expect(next.presets.thrust).toEqual(animation);
  expect(next.presets.slash).toEqual(before.presets.slash);
  expect(next.flash).toEqual(before.flash);
  expect(next.skills).toEqual(before.skills);
  expect(next.basicAttacks).toEqual(before.basicAttacks);
  expect(COMBAT_FX).toEqual(before);
  expect(() => mergeCombatFxEffect(COMBAT_FX, "missing", animation)).toThrow();
  expect(() => mergeCombatFxEffect(COMBAT_FX, "thrust", { ...animation, frames: [] })).toThrow();
});

test("preview draws unsaved JSON pixels through the game renderer in both directions", () => {
  const before = structuredClone(COMBAT_FX), draft = structuredClone(COMBAT_FX);
  draft.presets.thrust = { palette: { A: "#123456" }, frames: [{ offsetX: 0, offsetY: 0, rows: ["A"] }] };
  for (const reverse of [false, true]) {
    const cells = previewCombatFx(draft, { ...options, reverse });
    expect(cells).toHaveLength(20);
    expect(cells.every((row) => row.length === 113)).toBe(true);
    expect(cells.flat().some((cell) => cell.bg === "#123456")).toBe(true);
    expect(previewCombatFx(draft, { ...options, reverse, frameIndex: -1 }).flat().some((cell) => cell.bg === "#123456")).toBe(false);
  }
  expect(COMBAT_FX).toEqual(before);
});

test("flash previews use each side's draft tint and reject invalid frame indices", () => {
  const draft = structuredClone(COMBAT_FX);
  draft.flash.frames = [{ partyColor: "#123456", monsterColor: "#abcdef" }];
  expect(previewCombatFx(draft, { ...options, effect: "flash" }).flat().some((c) => c.bg === "#abcdef")).toBe(true);
  expect(previewCombatFx(draft, { ...options, effect: "flash", reverse: true }).flat().some((c) => c.bg === "#123456")).toBe(true);
  expect(() => previewCombatFx(draft, { ...options, frameIndex: 999 })).toThrow();
  expect(() => previewCombatFx(draft, { ...options, frameIndex: 0.5 })).toThrow();
});

test("a copied frame parses back unchanged and malformed frame JSON is rejected before use", () => {
  const before = structuredClone(COMBAT_FX);
  const copied = JSON.stringify(before.presets.thrust.frames[0]);
  const draft = structuredClone(before);
  draft.presets.thrust.frames[0] = JSON.parse(copied);
  expect(previewCombatFx(draft, options)).toEqual(previewCombatFx(before, options));
  draft.presets.thrust.frames[0] = JSON.parse('{"offsetX":0,"offsetY":0,"rows":["?"]}');
  expect(() => previewCombatFx(draft, options)).toThrow();
  expect(COMBAT_FX).toEqual(before);
});

test.each(["edit", "effect change"])("Reload preserves a newer draft after an in-flight %s", async (change) => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  async function reload() {");
  const source = editor.slice(start, editor.indexOf("\n  fx('Reload').onclick", start));
  let release!: (value: object) => void;
  const draft = { pixel: 0 };
  const context = {
    file: draft, effect: "thrust", dirty: false, confirm: () => true, stopPlayback: () => {},
    api: () => new Promise((resolve) => { release = resolve; }), animation: () => ({}), fx: () => ({}),
    error: () => {}, renderFrame: () => {}, renderPalette: () => {}, updateDirty: () => {}, drawPreview: () => {},
  };
  const pending = runInNewContext(source + "\nreload()", context);
  if (change === "edit") draft.pixel = 1;
  else context.effect = "slash";
  release({ pixel: 99 });
  await expect(pending).rejects.toThrow("draft changed while reloading");
  expect(context.file).toBe(draft);
});
