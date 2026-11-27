import { expect, test } from "bun:test";
import { COMBAT_FX, validateAnimationReferences, validateReactionReferences, validateReactionAnimation, type CombatFxConfig } from "../src/data/combatFx";
import { CLASSES } from "../src/data/classes";
import { MONSTER_ARCHETYPES } from "../src/data/monsters";
import { IMPACT_TICKS, SESSION_MIN_TICKS } from "../src/ui/revealQueue";
import { editSkillEffectAnimation, editCombatFxPreset, mergeCombatFxDraft, mergeCombatFxEffect, previewCombatFx } from "../tools/game-editor/combatFxPreview";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

const options = { effect: "thrust" as const, frameIndex: 0, reverse: false, classId: CLASSES[0]!.id, monsterId: MONSTER_ARCHETYPES.find((m) => m.roles.includes("normal"))!.id };

function frameTransferEditor(effect = "thrust") {
  const html = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = html.indexOf("  function updateFrameTransfer()");
  expect(start).toBeGreaterThan(-1);
  type Control = { value: string; textContent: string; disabled: boolean; open: boolean; onclick?: () => void | Promise<void>; focus: () => void; select: () => void; removeAttribute: () => void; setAttribute: () => void };
  const controls: Record<string, Control> = {};
  const context = {
    file: structuredClone(COMBAT_FX), effect, index: 0, saving: false, presetBusy: false,
    parseBusy: false, parseBackup: null, clipboard: "", message: "", changes: 0,
    structuredClone, stopPlayback() {}, renderFrame() {}, reload() {},
    animation: () => context.effect === "flash" ? context.file.flash : context.file.presets[context.effect]!,
    frame: () => context.animation().frames[context.index],
    fx: (name: string) => controls[name] ??= { value: "", textContent: "", disabled: false, open: false, focus() {}, select() {}, removeAttribute() {}, setAttribute() {} },
    error: (message = "") => { context.message = message; },
    changed: () => { context.changes++; },
    navigator: { clipboard: { readText: async () => context.clipboard, writeText: async (text: string) => { context.clipboard = text; } } },
    apiPost: async (_url: string, body: { file: CombatFxConfig }) => { previewCombatFx(body.file, { ...options, effect: context.effect }); },
  };
  runInNewContext(html.slice(start, html.indexOf("  fx('Save').onclick", start)), context);
  return { context, controls };
}

test.each(["thrust", "flash"])("clipboard parse and Revert restore the selected %s frame", async (effect) => {
  const { context, controls } = frameTransferEditor(effect);
  const original = structuredClone(context.frame());
  const replacement = effect === "flash" ? { partyColor: "#123456", monsterColor: null } : { rows: ["A"], offsetX: 2, offsetY: -1 };
  context.clipboard = JSON.stringify(replacement);
  await controls.Parse!.onclick!();
  expect(context.frame()).toEqual(replacement);
  expect(context.message).toBe("");
  expect(context.parseBackup).not.toBeNull();
  await controls.Revert!.onclick!();
  expect(context.frame()).toEqual(original);
  expect(context.parseBackup).toBeNull();
  expect(context.changes).toBe(2);
});

test("invalid clipboard JSON leaves the draft and previous Revert intact", async () => {
  const { context, controls } = frameTransferEditor();
  const original = structuredClone(context.frame());
  context.clipboard = JSON.stringify({ rows: ["A"], offsetX: 1, offsetY: 0 });
  await controls.Parse!.onclick!();
  const parsed = structuredClone(context.frame()), backup = context.parseBackup;
  for (const text of ["{", JSON.stringify({ rows: ["?"], offsetX: 0, offsetY: 0 })]) {
    context.clipboard = text;
    await controls.Parse!.onclick!();
    expect(context.frame()).toEqual(parsed);
    expect(context.parseBackup).toBe(backup);
    expect(context.message).toStartWith("Parse:");
  }
  await controls.Revert!.onclick!();
  expect(context.frame()).toEqual(original);
});

test("Revert cannot overwrite another frame or edits made after parsing", async () => {
  const { context, controls } = frameTransferEditor();
  context.clipboard = JSON.stringify({ rows: ["A"], offsetX: 1, offsetY: 0 });
  await controls.Parse!.onclick!();
  context.index = 1;
  const other = structuredClone(context.frame());
  await controls.Revert!.onclick!();
  expect(context.frame()).toEqual(other);
  context.index = 0;
  Object.assign(context.frame()!, { offsetX: 5 });
  await controls.Revert!.onclick!();
  expect(context.frame()).toMatchObject({ offsetX: 5 });
});

test("manual paste works when clipboard access is unavailable", async () => {
  const { context, controls } = frameTransferEditor();
  context.navigator.clipboard.readText = async () => { throw new Error("Not allowed"); };
  await controls.Parse!.onclick!();
  expect(controls.TransferManual!.open).toBe(true);
  expect(context.changes).toBe(0);
  controls.FrameJson!.value = JSON.stringify({ rows: ["A"], offsetX: 2, offsetY: 0 });
  await controls.ParseManual!.onclick!();
  expect(context.frame()).toMatchObject({ rows: ["A"], offsetX: 2 });
  expect(controls.TransferManual!.open).toBe(false);
});

test.each(["selection", "reload", "edit"])("pending parse preserves the draft after a %s", async (change) => {
  const { context, controls } = frameTransferEditor();
  context.clipboard = JSON.stringify({ rows: ["A"], offsetX: 2, offsetY: 0 });
  let release!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    context.apiPost = async () => { await new Promise<void>((resolve) => { release = resolve; resolveStarted(); }); };
  });
  const pending = controls.Parse!.onclick!();
  await started;
  expect(context.parseBusy).toBe(true);
  expect(controls.Parse!.disabled).toBe(true);
  if (change === "selection") context.index = 1;
  if (change === "reload") context.file = structuredClone(context.file);
  if (change === "edit") Object.assign(context.frame()!, { offsetX: 12 });
  const before = structuredClone(context.file);
  release();
  await pending;
  expect(context.file).toEqual(before);
  expect(context.parseBackup).toBeNull();
  expect(context.message).toContain("frame changed while parsing");
  expect(context.parseBusy).toBe(false);
  expect(controls.Parse!.disabled).toBe(false);
});

test("Copy uses the clipboard without opening JSON and exposes a manual fallback on failure", async () => {
  const { context, controls } = frameTransferEditor();
  await controls.Copy!.onclick!();
  expect(JSON.parse(context.clipboard)).toEqual(context.frame());
  expect(controls.TransferManual).toBeUndefined();
  context.navigator.clipboard.writeText = async () => { throw new Error("Not allowed"); };
  await controls.Copy!.onclick!();
  expect(controls.TransferManual!.open).toBe(true);
  expect(JSON.parse(controls.FrameJson!.value)).toEqual(context.frame());
});

test.each(["palette edit", "save in progress", "saved draft"])("Revert preserves the draft after a %s", async (change) => {
  const { context, controls } = frameTransferEditor();
  context.clipboard = JSON.stringify({ rows: ["A"], offsetX: 2, offsetY: 0 });
  await controls.Parse!.onclick!();
  if (change === "palette edit") context.file.presets.thrust!.palette.A = "#123456";
  if (change === "save in progress") context.saving = true;
  if (change === "saved draft") context.file = structuredClone(context.file);
  const before = structuredClone(context.file);
  await controls.Revert!.onclick!();
  expect(controls.Revert!.disabled).toBe(true);
  expect(context.file).toEqual(before);
});

type PaletteEvent = { target?: PaletteNode; key?: string; preventDefault: () => void; stopPropagation: () => void };
type PaletteNode = {
  children: PaletteNode[]; className: string; textContent: string; value: string; focused: boolean;
  attributes: Record<string, string>; onclick?: (event: PaletteEvent) => void; onkeydown?: (event: PaletteEvent) => void;
  oninput?: () => void; onchange?: () => void;
  append: (...nodes: PaletteNode[]) => void; replaceChildren: () => void;
  setAttribute: (name: string, value: string) => void; focus: () => void;
};

function combatPaletteEditor() {
  const html = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = html.lastIndexOf("  function renderPalette()");
  const node = (): PaletteNode => ({
    children: [], className: "", textContent: "", value: "", focused: false, attributes: {},
    append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; },
    setAttribute(name, value) { this.attributes[name] = value; }, focus() { this.focused = true; },
  });
  const palette = node(), animation = structuredClone(COMBAT_FX.presets.thrust!);
  const context = {
    effect: "thrust", key: "A", changes: 0, message: "", animation: () => animation,
    fx: () => palette, document: { createElement: node }, drawEditor() {},
    changed: () => { context.changes++; }, error: (message: string) => { context.message = message; },
  };
  const render: () => void = runInNewContext(html.slice(start, html.indexOf("  function movePixels(", start)) + "\nrenderPalette", context);
  render();
  const row = (key: string) => palette.children.find((entry) => entry.children[0]?.value === key)!;
  return { context, palette, animation, render, row };
}

test("palette uses native toggle buttons and keeps focus when selecting a color or eraser", () => {
  const { context, palette, row } = combatPaletteEditor();
  const selected = row("B"), choose = selected.children[2]!;
  expect(choose.attributes["aria-label"]).toBe("Paint color B");
  expect(choose.attributes["aria-pressed"]).toBe("false");
  expect(selected.onkeydown).toBeUndefined();
  choose.onclick!({ preventDefault() {}, stopPropagation() {} });
  expect(context.key).toBe("B");
  expect(row("B").children[2]!.focused).toBe(true);
  expect(row("B").children[2]!.attributes["aria-pressed"]).toBe("true");
  expect(row("A").children[2]!.attributes["aria-pressed"]).toBe("false");
  expect(row("B").className).toContain("active");
  const eraser = palette.children[0]!.children[0]!;
  expect(eraser.attributes["aria-label"]).toBe("Erase pixels");
  eraser.onclick!({ preventDefault() {}, stopPropagation() {} });
  expect(context.key).toBe(".");
  expect(palette.children[0]!.children[0]!.focused).toBe(true);
  expect(palette.children[0]!.children[0]!.attributes["aria-pressed"]).toBe("true");
  expect(context.changes).toBe(0);
});

test("palette color edits update the hex label without selecting another paint color", () => {
  const { context, animation, row } = combatPaletteEditor();
  const selected = row("B"), input = selected.children[1]!;
  let stopped = false;
  input.onclick!({ stopPropagation() { stopped = true; }, preventDefault() {} });
  input.value = "#123456"; input.oninput!();
  expect(stopped).toBe(true);
  expect(context.key).toBe("A");
  expect(animation.palette.B).toBe("#123456");
  expect(selected.children[2]!.textContent).toBe("#123456");
  expect(context.changes).toBe(1);
});

test("palette key rename updates every frame and rejects duplicate keys", () => {
  const { context, animation, row } = combatPaletteEditor();
  const frames = structuredClone(animation.frames), input = row("A").children[0]!;
  input.value = "B"; input.onchange!();
  expect(input.value).toBe("A");
  expect(animation.frames).toEqual(frames);
  const color = animation.palette.A;
  input.value = "Z"; input.onchange!();
  expect(animation.palette.Z).toBe(color);
  expect(Object.hasOwn(animation.palette, "A")).toBe(false);
  expect(animation.frames).toEqual(frames.map((frame) => ({ ...frame, rows: frame.rows.map((row) => row.replaceAll("A", "Z")) })));
  expect(context.key).toBe("Z");
  expect(context.changes).toBe(1);
});

test("palette removal rejects used colors and removes only unused entries", () => {
  const { context, animation, row, render } = combatPaletteEditor();
  const frames = structuredClone(animation.frames), color = animation.palette.A;
  const event = { stopPropagation() {}, preventDefault() {} };
  row("A").children[3]!.onclick!(event);
  expect(animation.palette.A).toBe(color);
  expect(animation.frames).toEqual(frames);
  expect(context.message).toContain("Erase this color");
  expect(context.changes).toBe(0);
  animation.palette.Z = "#123456"; render();
  row("Z").children[3]!.onclick!(event);
  expect(Object.hasOwn(animation.palette, "Z")).toBe(false);
  expect(animation.frames).toEqual(frames);
  expect(context.changes).toBe(1);
});

test("reaction playback uses every dedicated preset without an invented flash", () => {
  const file = structuredClone(COMBAT_FX);
  file.flash.frames = [{ partyColor: "#123456", monsterColor: "#123456" }];
  for (const effect of ["reflect", "counter", "hexed", "deep-wound"]) for (const reverse of [false, true]) {
    const colors = Object.values(file.presets[effect]!.palette);
    for (let frameIndex = 0; frameIndex < 5; frameIndex++) {
      const cells = previewCombatFx(file, { ...options, effect, reverse, playback: { context: "reaction", tick: IMPACT_TICKS + frameIndex } }).flat();
      expect(cells.some((cell) => colors.includes(cell.bg ?? ""))).toBe(true);
      expect(cells.some((cell) => cell.bg === "#123456")).toBe(false);
    }
    expect(previewCombatFx(file, { ...options, effect, reverse, playback: { context: "reaction", tick: IMPACT_TICKS - 1 } }).flat().some((cell) => colors.includes(cell.bg ?? ""))).toBe(false);
  }
});

test("preview keeps resized animation bottoms on the common baseline with signed Y offsets", () => {
  const draft = structuredClone(COMBAT_FX);
  const monsters = MONSTER_ARCHETYPES.filter((monster) => monster.roles.includes("normal")).slice(0, 3);
  for (const monster of monsters) for (const reverse of [false, true]) for (const frameHeight of [1, 4]) for (const offsetY of [-3, 0, 1]) {
    draft.presets.thrust = { palette: { A: "#123456" }, frames: [{ offsetX: 0, offsetY, rows: Array(frameHeight).fill("A") }] };
    const cells = previewCombatFx(draft, { ...options, monsterId: monster.id, reverse });
    const paintedRows = cells.flatMap((row, y) => row.some((cell) => cell.bg === "#123456") ? [y] : []);
    const expected = Array.from({ length: frameHeight }, (_, y) => 16 + offsetY - frameHeight + 1 + y).filter((y) => y <= 16);
    expect(paintedRows).toEqual(expected);
  }
});

test("new animation presets start at the common baseline", () => {
  const next = editCombatFxPreset(COMBAT_FX, "create", "", "baseline-test");
  expect(next.presets["baseline-test"]!.frames[0]!.offsetY).toBe(0);
});

function movementEditor() {
  const html = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = html.indexOf("  function movePixels(");
  expect(start).toBeGreaterThan(-1);
  const selected = { rows: ["...", ".A.", "..."], offsetX: -2, offsetY: 3 };
  const other = { rows: ["BBB"], offsetX: 0, offsetY: 0 };
  const controls: Record<string, { onclick?: () => void }> = {};
  const context = {
    file: { frames: [selected, other] }, effect: "thrust", frame: () => selected,
    fx: (name: string) => controls[name] ??= {},
    changed: () => { context.changes++; }, drawEditor: () => { context.draws++; },
    error: (message: string) => { context.message = message; }, changes: 0, draws: 0, message: "",
  };
  runInNewContext(html.slice(start, html.indexOf("  function paint(", start)), context);
  return { context, selected, other, controls };
}

test.each([
  ["Left", ["...", "A..", "..."]], ["Right", ["...", "..A", "..."]],
  ["Up", [".A.", "...", "..."]], ["Down", ["...", "...", ".A."]],
])("Move %s shifts only the selected frame's pixels by one cell", (direction, expected) => {
  const { context, selected, other, controls } = movementEditor();
  controls["Move" + direction]!.onclick!();
  expect(selected.rows).toEqual(expected);
  expect([selected.offsetX, selected.offsetY]).toEqual([-2, 3]);
  expect(other).toEqual({ rows: ["BBB"], offsetX: 0, offsetY: 0 });
  expect(context.changes).toBe(1);
  expect(context.draws).toBe(1);
});

test.each([
  ["Left", ["...", "A..", "..."]], ["Right", ["...", "..A", "..."]],
  ["Up", [".A.", "...", "..."]], ["Down", ["...", "...", ".A."]],
])("Move %s rejects clipping without modifying the draft", (direction, rows) => {
  const { context, selected, controls } = movementEditor();
  selected.rows = rows as string[];
  controls["Move" + direction]!.onclick!();
  expect(selected.rows).toEqual(rows);
  expect(context.changes).toBe(0);
  expect(context.message).toContain("clipped");
});

test("movement is safe before loading, for flash frames, and for an empty one-cell frame", () => {
  const { context, selected, controls } = movementEditor();
  context.file = null!;
  controls.MoveLeft!.onclick!();
  context.file = { frames: [selected] };
  context.effect = "flash";
  controls.MoveLeft!.onclick!();
  expect(context.changes).toBe(0);
  context.effect = "thrust";
  selected.rows = ["."];
  for (const direction of ["Left", "Right", "Up", "Down"]) controls["Move" + direction]!.onclick!();
  expect(selected.rows).toEqual(["."]);
});

function editorServer(files: Record<string, unknown>, beforeRead?: (filename: string) => Promise<void>) {
  files["classes.json"] ??= structuredClone(CLASSES);
  files["monster-skills.json"] ??= [];
  files["summons.json"] ??= { skills: [] };
  files["items.json"] ??= [];
  files["status-effects.json"] ??= [];
  files["artifacts.json"] ??= [];
  files["abilities.json"] ??= [];
  const server = readFileSync(new URL("../tools/game-editor/server.ts", import.meta.url), "utf8");
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(server.replace(/^import .*$/gm, "").replaceAll("import.meta.dir", '"/editor"'));
  let fetch!: (req: Request) => Promise<Response>;
  runInNewContext(code, {
    Bun: { serve: (handlers: { fetch: typeof fetch }) => { fetch = handlers.fetch; } },
    path, URL, Response, Error, DIVIDER_WIDTH: 1, console: { log() {} },
    readFile: async (filename: string) => { await beforeRead?.(path.basename(filename)); return JSON.stringify(files[path.basename(filename)]); },
    writeFile: async (filename: string, data: string) => { files[path.basename(filename)] = JSON.parse(data); },
    assertMonsterDataConsistent() {}, assertMonsterKitConsistent() {}, MONSTER_ARCHETYPES: [], MONSTER_SKILLS: [],
    mergeCombatFxDraft, mergeCombatFxEffect, editCombatFxPreset, editSkillEffectAnimation, validateAnimationReferences, validateReactionReferences, validateReactionAnimation,
  });
  return (endpoint: string, method: string, body?: unknown) => fetch(new Request("http://localhost" + endpoint, { method, body: JSON.stringify(body) }));
}

test("reaction override writes preserve default, null and concurrent catalog edits", async () => {
  const status = { id: "fixture", name: "Fixture", description: "Fixture", perTurnEffects: [{ kind: "damage", amount: 3, animation: "hexed" }] };
  const files = { "status-effects.json": [status], "combat-fx.json": structuredClone(COMBAT_FX) };
  const request = editorServer(files);
  const save = (base: typeof status, animation: string | null) => request("/api/reaction-animation", "POST", { catalog: "status-effects", id: "fixture", path: ["perTurnEffects", 0, "animation"], base, animation });
  const stale = structuredClone(status);
  expect((await save(stale, null)).status).toBe(200);
  expect(files["status-effects.json"][0]!.perTurnEffects[0]!.animation).toBeNull();
  expect((await save(stale, "burn")).status).toBe(409);
  expect((await save(structuredClone(files["status-effects.json"][0]!), "__default__")).status).toBe(200);
  expect(Object.hasOwn(files["status-effects.json"][0]!.perTurnEffects[0]!, "animation")).toBe(false);
  expect((await save(structuredClone(files["status-effects.json"][0]!), "slash")).status).toBe(400);
  const invalid = await request("/api/reaction-animation", "POST", { catalog: "status-effects", id: "fixture", path: ["__proto__", "animation"], base: files["status-effects.json"][0], animation: "hexed" });
  expect(invalid.status).toBe(400);
});

test("reaction mappings merge independently and reject approach animations", () => {
  const base = structuredClone(COMBAT_FX), current = structuredClone(base), draft = structuredClone(base);
  current.reactions.reflectDamage = null;
  draft.reactions.counterAttack = null;
  expect(mergeCombatFxDraft(current, base, draft).reactions).toMatchObject({ reflectDamage: null, counterAttack: null });
  draft.reactions.counterAttack = "slash";
  expect(() => mergeCombatFxDraft(current, base, draft)).toThrow();
});

test("preset deletion rejects reaction overrides stored only in artifacts or abilities", async () => {
  for (const catalog of ["artifacts", "abilities"]) {
    const file = editCombatFxPreset(COMBAT_FX, "create", "", "reaction-only");
    const files = { [catalog + ".json"]: [{ id: "fixture", effects: [{ kind: "autoDamage", animation: "reaction-only", amount: 2 }] }] };
    const request = editorServer(files);
    const response = await request("/api/combat-fx-preset", "POST", { file, action: "delete", id: "reaction-only" });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("gear fixture.effects.0");
  }
});

test("summon sprites save within the player slot and reject oversized rows or columns", async () => {
  const sprite = { rows: Array.from({ length: 10 }, () => "A".repeat(13)), palette: { A: "#123456" } };
  const summons = { archetypes: [{ id: "fixture-summon" }], skills: [], casts: [] };
  const files = {
    "sprites.json": { classes: { fixture: { rows: ["B"], palette: { B: "#654321" } } }, summons: {} as Record<string, typeof sprite> },
    "summons.json": summons,
  };
  const originalClass = structuredClone(files["sprites.json"].classes);
  const request = editorServer(files);
  const body = { category: "summons", id: "fixture-summon", sprite };
  expect((await request("/api/sprites", "POST", body)).status).toBe(200);
  expect(files["sprites.json"].summons[body.id]).toEqual(sprite);
  expect(files["sprites.json"].classes).toEqual(originalClass);
  const catalog = await request("/api/summons", "GET");
  expect(catalog.status).toBe(200);
  expect(await catalog.json()).toEqual(summons);
  for (const rows of [Array.from({ length: 11 }, () => "A".repeat(13)), Array.from({ length: 10 }, () => "A".repeat(14))]) {
    const response = await request("/api/sprites", "POST", { ...body, sprite: { ...sprite, rows } });
    expect(response.status).toBe(400);
    expect(files["sprites.json"].summons[body.id]).toEqual(sprite);
  }
});

test.each([
  ["item", "items.json", "items", null],
  ["status", "status-effects.json", "statuses", "heal"],
  ["monster", "monsters.json", "basicAttacks.monsters", null],
] as const)("catalog changes protect saved Combat Effects references to %s", async (type, filename, mapping, visual) => {
  const id = "fixture", entry = { id, name: "Fixture", description: "Original" };
  const fx = structuredClone(COMBAT_FX);
  const table = mapping === "basicAttacks.monsters" ? fx.basicAttacks.monsters : fx[mapping];
  Object.assign(table, { [id]: visual });
  const files = { [filename]: [entry], "combat-fx.json": fx };
  const request = editorServer(files);
  const endpoint = "/api/data/" + type + "/" + id;
  for (const method of ["PUT", "DELETE"]) {
    const response = await request(endpoint, method, method === "PUT" ? { entry: { ...entry, id: "renamed" }, base: entry } : undefined);
    expect(response.status).toBe(400);
    const { error } = await response.json() as { error: string };
    expect(error).toContain(mapping + "." + id);
    expect(error).toContain("Unmapped (game default)");
    expect(files[filename]).toEqual([entry]);
  }
  const updated = { ...entry, description: "Updated" };
  expect((await request(endpoint, "PUT", { entry: updated, base: entry })).status).toBe(200);
  expect(files[filename]).toEqual([updated]);
  delete table[id];
  expect((await request(endpoint, "DELETE")).status).toBe(200);
  expect(files[filename]).toEqual([]);
});

test("an effect save cannot restore a mapping after the catalog ID disappears", async () => {
  const id = Object.keys(COMBAT_FX.items)[0]!;
  const base = structuredClone(COMBAT_FX);
  delete base.items[id];
  const draft = structuredClone(base);
  draft.items[id] = "thrust";
  const files = { "combat-fx.json": base, "items.json": [{ id }] };
  const request = editorServer(files);
  expect((await request("/api/data/item/" + id, "DELETE")).status).toBe(200);
  const save = await request("/api/combat-fx", "POST", { base, draft });
  expect(save.status).toBe(400);
  const { error } = await save.json() as { error: string };
  expect(error).toContain("items." + id);
  expect(files["combat-fx.json"]).toEqual(base);
});

test("playback combines an impact attack with damage flash and keeps its flash tail", () => {
  const draft = structuredClone(COMBAT_FX);
  const preset = draft.presets["fire-pillar"]!;
  preset.ticks = 1;
  draft.flash.frames = [{ partyColor: "#123456", monsterColor: "#abcdef" }, { partyColor: "#123456", monsterColor: "#abcdef" }];
  const params = { ...options, effect: "fire-pillar" };
  const draw = (tick: number) => previewCombatFx(draft, { ...params, playback: { context: "attack", tick } }).flat();
  const hasFlame = (cells: ReturnType<typeof draw>) => cells.some((cell) => cell.bg === preset.palette.A);
  const hasFlash = (cells: ReturnType<typeof draw>) => cells.some((cell) => cell.bg === "#abcdef");
  expect(hasFlame(draw(IMPACT_TICKS - 1))).toBe(false);
  expect(hasFlame(draw(IMPACT_TICKS))).toBe(true);
  expect(hasFlash(draw(IMPACT_TICKS))).toBe(true);
  expect(hasFlame(draw(IMPACT_TICKS + 1))).toBe(false);
  expect(hasFlash(draw(IMPACT_TICKS + 1))).toBe(true);
  expect(hasFlash(draw(IMPACT_TICKS + 2))).toBe(false);
  expect(hasFlash(previewCombatFx(draft, params).flat())).toBe(false);
});

test("shared Holy animation can play as an attack or as support", () => {
  const draft = structuredClone(COMBAT_FX);
  draft.flash.frames = [{ partyColor: "#123456", monsterColor: "#abcdef" }];
  for (const effect of ["holy", "heal", "buff"]) {
    const params = { ...options, effect };
    const supportCells = previewCombatFx(draft, { ...params, playback: { context: "support", tick: IMPACT_TICKS } }).flat();
    expect(supportCells.some(({ bg }) => bg && Object.values(draft.presets[effect]!.palette).includes(bg))).toBe(true);
    expect(supportCells.some(({ bg }) => bg === "#123456" || bg === "#abcdef")).toBe(false);
  }
  const params = { ...options, effect: "holy" };
  expect(previewCombatFx(draft, { ...params, playback: { context: "attack", tick: IMPACT_TICKS } }).flat().some(({ bg }) => bg === "#abcdef")).toBe(true);
});

test("saving one animation preserves mappings and other effects without mutating its source", () => {
  const before = structuredClone(COMBAT_FX);
  const animation = { palette: { A: "#123456" }, frames: [{ offsetX: 0, offsetY: 0, rows: ["A"] }] };
  const next = mergeCombatFxEffect(COMBAT_FX, "thrust", animation);
  expect(next.presets.thrust).toEqual(animation);
  expect(next.presets.slash).toEqual(before.presets.slash);
  expect(next.flash).toEqual(before.flash);
  expect(next.items).toEqual(before.items);
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
  const result = new Promise((resolve) => { release = resolve; });
  const draft = { pixel: 0 };
  const context = {
    file: draft, effect: "thrust", dirty: false, saveEpoch: 0, confirm: () => true, stopPlayback: () => {},
    api: () => result, reloading: false, catalogRequest: 0, animation: () => ({}), fx: () => ({}),
    error: () => {}, renderFrame: () => {}, renderPalette: () => {}, updateDirty: () => {}, drawPreview: () => {},
  };
  const pending = runInNewContext(source + "\nreload()", context);
  if (change === "edit") draft.pixel = 1;
  else context.effect = "slash";
  release({ pixel: 99 });
  await expect(pending).rejects.toThrow("draft changed while reloading");
  expect(context.file).toBe(draft);
});

test("catalog refresh updates preview choices and mappings while returning to the tab preserves the draft", async () => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  async function reload() {");
  const source = editor.slice(start, editor.indexOf("\n  fx('Reload').onclick", start));
  const observerStart = editor.indexOf("  const panel = document.getElementById('panel-combat-fx');", start);
  const observer = editor.slice(observerStart, editor.indexOf("\n  fx('Play').disabled", observerStart));
  const oldFile = { pixel: 0 }, loaded = { pixel: 1 };
  const classes = [{ id: "first-class", name: "First class" }, { id: "selected-class", name: "Selected class" }];
  const oldCatalogs = { classes, items: [{ id: "old" }], monsters: [{ id: "old-monster", name: "Old monster", roles: ["normal"] }] };
  const newCatalogs = { classes, items: [{ id: "new" }], monsters: [
    { id: "boss", name: "Boss", roles: ["boss"] }, { id: "new-monster", name: "New monster", roles: ["normal"] },
  ] };
  const select = (value: string) => ({
    value, options: [] as { value: string }[],
    replaceChildren(...entries: { value: string }[]) { this.options = entries; this.value = entries[0]?.value ?? ""; },
  });
  const fields = { Class: select("selected-class"), Monster: select("old-monster") };
  let offline = true, activate!: () => Promise<void>;
  const context = {
    file: oldFile, catalogs: oldCatalogs, effect: "thrust", dirty: false, saveEpoch: 0, catalogRequest: 0, reloading: false,
    confirm: () => true, stopPlayback: () => {}, refreshEffectList: () => {}, renderFrame: () => {},
    renderPalette: () => {}, renderMappings: () => {}, updateDirty: () => {}, drawPreview: () => {}, error: () => {},
    fx: (id: keyof typeof fields) => fields[id],
    document: { getElementById: () => ({ classList: { contains: () => true } }), createElement: () => ({}) },
    MutationObserver: class { constructor(callback: () => Promise<void>) { activate = callback; } observe() {} },
    api: async (url: string) => {
      if (!url.startsWith("/api/combat-fx-catalogs")) return loaded;
      if (offline) throw new Error("Catalog unavailable");
      return newCatalogs;
    },
  };
  const reload = () => runInNewContext(source + "\nreload()", context);
  await expect(reload()).rejects.toThrow("Catalog unavailable");
  expect(context.file).toBe(oldFile);
  expect(context.catalogs).toBe(oldCatalogs);
  expect(fields.Monster.value).toBe("old-monster");
  offline = false;
  await reload();
  expect(context.file).toBe(loaded);
  expect(context.catalogs).toBe(newCatalogs);
  expect(fields.Class.value).toBe("selected-class");
  expect(fields.Monster.value).toBe("new-monster");
  expect(fields.Monster.options.map((option) => option.value)).toEqual(["new-monster"]);
  const unsaved = { pixel: 2 };
  Object.assign(context, { file: unsaved, catalogs: oldCatalogs, dirty: true });
  Object.assign(fields.Monster, select("old-monster"));
  runInNewContext(source + observer, context);
  await activate();
  expect(context.file).toBe(unsaved);
  expect(context.catalogs).toBe(newCatalogs);
  expect(fields.Monster.value).toBe("new-monster");
});

test("Play sends elapsed ticks and an explicit attack or support context to the renderer", () => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  function playbackStep()");
  const source = editor.slice(start, editor.indexOf("\n  fx('Play').onclick", start));
  const draft = structuredClone(COMBAT_FX);
  draft.presets.holy!.ticks = 2;
  draft.flash.frames = Array.from({ length: SESSION_MIN_TICKS }, () => ({ partyColor: null, monsterColor: null }));
  for (const mode of ["attack", "support"]) {
    const calls: unknown[][] = [];
    const context = {
      effect: "holy", file: draft, index: 0, playTick: IMPACT_TICKS + 2, previewBusy: false,
      animation: () => draft.presets.holy,
      timing: { minTicks: SESSION_MIN_TICKS, impactTicks: IMPACT_TICKS },
      fx: () => ({ value: mode, disabled: false }), renderFrame: () => {}, supportPreset: () => true,
      drawPreview: (...args: unknown[]) => calls.push(args),
    };
    runInNewContext(source + "\nplaybackStep()", context);
    expect(calls[0]?.[0]).toBe("holy");
    expect(calls[0]?.[2]).toBe(mode === "attack" ? "Impact" : "Rest");
    expect(calls[0]?.[4]).toEqual({ context: mode, tick: IMPACT_TICKS + 2 });
  }
});

test("every authored effect supports draft preview, copy/parse and selected-effect saving", () => {
  for (const [effect, animation] of Object.entries(COMBAT_FX.presets)) {
    const next = mergeCombatFxEffect(COMBAT_FX, effect, JSON.parse(JSON.stringify(animation)));
    expect(next.presets[effect]).toEqual(animation);
    for (const reverse of [false, true]) {
      const cells = previewCombatFx(next, { ...options, effect, reverse });
      expect(cells).toHaveLength(20);
      expect(cells.every((row) => row.length === 113)).toBe(true);
    }
  }
  expect(COMBAT_FX.presets.heal).toBeDefined();
  const draft = structuredClone(COMBAT_FX);
  Object.assign(draft.presets.heal!, { ticks: 0 });
  expect(() => mergeCombatFxEffect(COMBAT_FX, "heal", draft.presets.heal)).toThrow();
});

test("impact beam previews keep the source span and reverse direction", () => {
  const draft = structuredClone(COMBAT_FX);
  draft.presets.lightning = { ...draft.presets.lightning!, phase: "impact", ticks: 1, palette: { A: "#123456", B: "#234567", C: "#345678" } };
  for (const reverse of [false, true]) {
    const cells = previewCombatFx(draft, { ...options, effect: "lightning", reverse, frameIndex: 0 });
    const colors = Object.values(draft.presets.lightning.palette);
    const xs = cells.flatMap((row) => row.flatMap((cell, x) => colors.includes(cell.bg ?? "") ? [x] : []));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(30);
  }
});

test("selected-frame preview does not lose frames when duration is shorter than the frame count", () => {
  const draft = structuredClone(COMBAT_FX);
  draft.presets.heal = { phase: "impact", ticks: 1, palette: { A: "#123456", B: "#abcdef" }, frames: [{ offsetX: 0, offsetY: 0, rows: ["A"] }, { offsetX: 0, offsetY: 0, rows: ["B"] }] };
  const cells = previewCombatFx(draft, { ...options, effect: "heal", frameIndex: 1 });
  expect(cells.flat().some((cell) => cell.bg === "#abcdef")).toBe(true);
});

test("a pending Reload cannot overwrite the draft after Save starts", async () => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  async function reload() {");
  const source = editor.slice(start, editor.indexOf("\n  fx('Reload').onclick", start));
  let release!: (value: object) => void;
  const result = new Promise((resolve) => { release = resolve; });
  const draft = structuredClone(COMBAT_FX);
  const context = {
    file: draft, effect: "thrust", dirty: false, saveEpoch: 0, confirm: () => true, stopPlayback: () => {},
    api: () => result, reloading: false, catalogRequest: 0, animation: () => draft.presets.thrust,
    fx: () => ({ replaceChildren: () => {} }), document: { createElement: () => ({}) },
    error: () => {}, renderFrame: () => {}, renderPalette: () => {}, updateDirty: () => {}, drawPreview: () => {},
  };
  const pending = runInNewContext(source + "\nreload()", context);
  context.saveEpoch++;
  release(structuredClone(COMBAT_FX));
  await expect(pending).rejects.toThrow("draft changed while reloading");
  expect(context.file).toBe(draft);
});

test("preview reconnects after the editor server restarts without retrying invalid drafts", async () => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.lastIndexOf("  async function drawPreview(");
  const source = editor.slice(start, editor.indexOf("\n  function playbackStep()", start));
  for (const network of [true, false]) {
    let calls = 0;
    const fields: Record<string, { value?: string; textContent?: string; disabled?: boolean; getAttribute?: () => string; getContext?: () => object }> = {
      Class: { value: options.classId }, Monster: { value: options.monsterId }, Reverse: { getAttribute: () => "false" },
      Preview: { getContext: () => ({ fillRect: () => {} }) }, PreviewContext: { value: "auto" }, PreviewLabel: {}, Play: {}, Error: { textContent: "" },
    };
    const context = {
      file: COMBAT_FX, effect: "heal", index: 0, previewSeq: 0, previewBusy: 0, previewTimer: null, timing: null,
      fx: (name: string) => fields[name], TypeError, setTimeout: (fn: () => void) => setTimeout(fn, 1),
      error: (message = "") => { fields.Error!.textContent = message; },
      apiPost: async () => {
        calls++;
        if (network && calls < 3) throw new TypeError("Failed to fetch");
        if (!network) throw new Error("invalid frame");
        return { timing: {}, cells: [] };
      },
    };
    await runInNewContext(source + "\ndrawPreview()", context);
    for (let i = 0; i < 30 && network && !fields.PreviewLabel!.textContent; i++) await new Promise((resolve) => setTimeout(resolve, 2));
    expect(calls).toBe(network ? 3 : 1);
    expect(fields.Error!.textContent ?? "").toBe(network ? "" : "Preview: invalid frame");
  }
});

test("saving a complete draft merges independent disk edits and rejects a conflicting mapping", () => {
  const base = structuredClone(COMBAT_FX), draft = structuredClone(base), disk = structuredClone(base);
  draft.basicAttacks.monsters["skeleton-archer"] = "slash";
  draft.items[Object.keys(draft.items)[0]!] = "arrow";
  draft.basicAttacks.monsters["skeleton-warrior"] = null;
  disk.presets.slash.palette.A = "#123456";
  const saved = mergeCombatFxDraft(disk, base, draft);
  expect(saved.basicAttacks.monsters["skeleton-archer"]).toBe("slash");
  expect(saved.basicAttacks.monsters["skeleton-warrior"]).toBeNull();
  expect(saved.presets.slash.palette.A).toBe("#123456");
  expect(disk.basicAttacks.monsters["skeleton-archer"]).toBe(base.basicAttacks.monsters["skeleton-archer"]);
  expect(base).toEqual(COMBAT_FX);
  disk.basicAttacks.monsters["skeleton-archer"] = "blunt";
  expect(() => mergeCombatFxDraft(disk, base, draft)).toThrow("Conflict");
});

test("a stale draft can save unrelated edits after an unmapped catalog entry is deleted", () => {
  const removed = "deleted-item-fixture";
  const disk = structuredClone(COMBAT_FX);
  const old = structuredClone(disk);
  old.items[removed] = "thrust";
  const draft = structuredClone(old);
  draft.presets.thrust.palette.A = "#123456";
  const saved = mergeCombatFxDraft(disk, old, draft);
  expect(saved.presets.thrust.palette.A).toBe("#123456");
  expect(Object.hasOwn(saved.items, removed)).toBe(false);
  expect(() => mergeCombatFxDraft(disk, disk, draft)).toThrow("unknown items id " + removed);
  draft.presets.thrust.frames[0]!.rows = ["?"];
  expect(() => mergeCombatFxDraft(disk, old, draft)).toThrow("invalid thrust pixel grid");
});

test("different mapping rows merge independently but concurrent changes to a preset conflict", () => {
  const base = structuredClone(COMBAT_FX), draft = structuredClone(base), disk = structuredClone(base);
  draft.statuses.weakened = "poison";
  disk.statuses.breached = "fear";
  const saved = mergeCombatFxDraft(disk, base, draft);
  expect(saved.statuses.weakened).toBe("poison");
  expect(saved.statuses.breached).toBe("fear");
  draft.presets.thrust.palette.A = "#123456";
  disk.presets.thrust.frames[0]!.offsetX++;
  expect(() => mergeCombatFxDraft(disk, base, draft)).toThrow("Conflict");
  expect(() => mergeCombatFxDraft(base, base, { ...draft, statuses: { ...draft.statuses, weakened: "missing-preset" } })).toThrow();
});

test("new presets can preview before saving and rename updates every reference", () => {
  const draft = editCombatFxPreset(COMBAT_FX, "duplicate", "heal", "custom-heal");
  draft.basicAttacks.monsters["skeleton-archer"] = "custom-heal";
  draft.items[Object.keys(draft.items)[0]!] = "custom-heal";
  draft.statuses.weakened = "custom-heal";
  draft.outcomes.heal = "custom-heal";
  draft.damageTypes.holy = "custom-heal";
  draft.basicAttacks.monsters["skeleton-warrior"] = "custom-heal";
  expect(() => previewCombatFx(draft, { ...options, effect: "custom-heal" })).not.toThrow();
  const renamed = editCombatFxPreset(draft, "rename", "custom-heal", "renamed-heal");
  expect(renamed.presets["custom-heal"]).toBeUndefined();
  for (const visual of [renamed.basicAttacks.monsters["skeleton-archer"], renamed.items[Object.keys(draft.items)[0]!], renamed.statuses.weakened, renamed.outcomes.heal, renamed.damageTypes.holy, renamed.basicAttacks.monsters["skeleton-warrior"]]) expect(visual).toBe("renamed-heal");
  expect(() => editCombatFxPreset(renamed, "delete", "renamed-heal")).toThrow("used");
  expect(COMBAT_FX.presets["custom-heal"]).toBeUndefined();
});

test("preset creation and deletion enforce valid ids and required presets", () => {
  const draft = editCombatFxPreset(COMBAT_FX, "create", "", "new-effect");
  expect(draft.presets["new-effect"]?.frames.length).toBeGreaterThan(0);
  expect(editCombatFxPreset(draft, "delete", "new-effect").presets["new-effect"]).toBeUndefined();
  for (const id of ["__proto__", "flash", "Bad Id", "thrust"]) expect(() => editCombatFxPreset(COMBAT_FX, "create", "", id)).toThrow();
  expect(() => editCombatFxPreset(COMBAT_FX, "delete", "thrust")).toThrow();
  expect(() => editCombatFxPreset(COMBAT_FX, "rename", "slash", "renamed")).toThrow();
});

test("complete draft validation rejects malformed maps and support references", () => {
  const base = structuredClone(COMBAT_FX);
  for (const patch of [{ basicAttacks: {} }, { basicAttacks: { ...base.basicAttacks, classes: {} } }, { outcomes: {} }, { presets: [] }, { extra: 1 }]) expect(() => mergeCombatFxDraft(base, base, { ...base, ...patch })).toThrow();
  const draft = structuredClone(base);
  draft.outcomes.heal = "arrow";
  expect(() => mergeCombatFxDraft(base, base, draft)).toThrow();
  delete draft.presets.heal;
  expect(() => mergeCombatFxDraft(base, base, draft)).toThrow();
});

function draftHelpers() {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  function draftChanges(");
  return editor.slice(start, editor.indexOf("  function refreshEffectList()", start));
}

test("client draft rebasing preserves newer local edits and unrelated saved edits", () => {
  const base = structuredClone(COMBAT_FX), sent = structuredClone(base), live = structuredClone(sent), saved = structuredClone(base);
  live.items[Object.keys(live.items)[0]!] = "arrow";
  live.presets.thrust.palette.A = "#123456";
  saved.statuses.weakened = "poison";
  const context = { structuredClone, sent, live, saved };
  const result = runInNewContext(draftHelpers() + "\napplyDraftChanges(saved, draftChanges(sent, live))", context);
  expect(result.items[Object.keys(live.items)[0]!]).toBe("arrow");
  expect(result.presets.thrust.palette.A).toBe("#123456");
  expect(result.statuses.weakened).toBe("poison");
  expect(saved.items).toEqual(base.items);
});

test.each([false, true])("Save preserves newer edits without silently accepting overlap (conflict=%s)", async (conflict) => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  fx('Save').onclick = async () => {", editor.indexOf("  const fx = (id)"));
  const source = editor.slice(start, editor.indexOf("  window.addEventListener('beforeunload'", start));
  const base = structuredClone(COMBAT_FX), draft = structuredClone(base), disk = structuredClone(base);
  draft.basicAttacks.monsters["skeleton-archer"] = "slash"; disk.statuses.weakened = "poison";
  if (conflict) disk.presets.thrust.palette.A = "#123456";
  const saved = mergeCombatFxDraft(disk, base, draft);
  let release!: () => void;
  const fields: Record<string, { textContent?: string; disabled?: boolean; onclick?: () => Promise<void> }> = {};
  let lastError = "";
  const context = {
    file: draft, baseline: JSON.stringify(base), effect: "thrust", index: 0, dirty: true, saving: false, presetBusy: false, saveEpoch: 0,
    structuredClone, stopPlayback: () => {}, error: (message = "") => { lastError = message; }, fx: (id: string) => fields[id] ??= {},
    apiPost: () => new Promise<void>((resolve) => { release = resolve; }), api: async () => saved,
    refreshEffectList: () => {}, renderFrame: () => {}, renderPalette: () => {}, renderMappings: () => {}, drawPreview: () => {},
    animation: () => context.file.presets.thrust,
    updateDirty: () => { context.dirty = JSON.stringify(context.file) !== context.baseline; },
  };
  const pending = runInNewContext(draftHelpers() + source + "\nfx('Save').onclick()", context);
  context.file.items[Object.keys(draft.items)[0]!] = "arrow";
  if (conflict) context.file.presets.thrust.frames[0]!.offsetX++;
  release(); await pending;
  if (conflict) {
    expect(lastError).toContain("presets.thrust");
    expect(() => mergeCombatFxDraft(saved, JSON.parse(context.baseline), context.file)).toThrow("Conflict");
    expect(context.file.presets.thrust.frames[0]!.offsetX).toBe(base.presets.thrust.frames[0]!.offsetX + 1);
    return;
  }
  expect(context.file.basicAttacks.monsters["skeleton-archer"]).toBe("slash");
  expect(context.file.statuses.weakened).toBe("poison");
  expect(context.file.items[Object.keys(draft.items)[0]!]).toBe("arrow");
  expect(context.baseline).toBe(JSON.stringify(saved));
  expect(context.dirty).toBe(true);
  expect(fields.Dirty?.textContent).toBe("Saved; newer edits remain unsaved");
});

test.each(["heal-", "heal--two"])("valid preset id %s displays without breaking selection", (id) => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  function refreshEffectList()");
  const source = editor.slice(start, editor.indexOf("  function updateDirty()", start));
  const select = { value: "", options: [] as { value: string; textContent: string }[], replaceChildren(...entries: { value: string; textContent: string }[]) { this.options = entries; } };
  const context = { file: editCombatFxPreset(COMBAT_FX, "create", "", id), effect: id, fx: () => select, document: { createElement: () => ({ value: "", textContent: "" }) } };
  expect(() => runInNewContext(source + "\nrefreshEffectList()", context)).not.toThrow();
  expect(select.options.find((option) => option.value === id)?.textContent).toBeTruthy();
});


test("a saved optional status mapping can return to the game default", () => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  function renderMappings()");
  const source = editor.slice(start, editor.indexOf("  fx('MapGroup').onchange", start));
  const draft = structuredClone(COMBAT_FX), selects: { value: string; children: { value?: string }[]; onchange?: () => void }[] = [];
  const node = () => ({ value: "", textContent: "", dataset: {}, children: [] as { value?: string }[], setAttribute: () => {}, append(...children: { value?: string }[]) { this.children.push(...children); }, replaceChildren() { this.children = []; } });
  const fields: Record<string, ReturnType<typeof node>> = { MapGroup: { ...node(), value: "statuses" }, MapSearch: { ...node(), value: "weakened" }, MapHint: node(), MapCount: node(), MappingRows: node() };
  const context = {
    file: draft, catalogs: { statuses: [{ id: "weakened", name: "Weakened" }] }, mappingTable: () => draft.statuses,
    fx: (id: string) => fields[id], document: { createElement: (tag: string) => { const entry = node(); if (tag === "select") selects.push(entry); return entry; } },
    renderFrame: () => {}, changed: () => {}, selectEffect: () => {},
  };
  runInNewContext(source + "\nrenderMappings()", context);
  const select = selects[0]!;
  expect(select.children.some((option) => option.value === "__unmapped__")).toBe(true);
  select.value = "__unmapped__"; select.onchange!();
  expect(Object.hasOwn(draft.statuses, "weakened")).toBe(false);
  expect(() => mergeCombatFxDraft(COMBAT_FX, COMBAT_FX, draft)).not.toThrow();
});

test("reaction override controls expose inherited, disabled and impact-only choices", async () => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  function renderReactionMappings()");
  const source = editor.slice(start, editor.indexOf("  function mappingTable(", start));
  const node = () => ({ value: "", textContent: "", disabled: false, children: [] as { value?: string }[], onchange: undefined as (() => Promise<void>) | undefined, setAttribute() {}, append(...children: { value?: string }[]) { this.children.push(...children); }, replaceChildren() { this.children = []; } });
  const selects: ReturnType<typeof node>[] = [];
  const fields: Record<string, ReturnType<typeof node>> = { MapSearch: node(), MappingRows: node(), MapHint: node(), MapCount: node() };
  const status = { id: "fixture", name: "Fixture", perTurnEffects: [{ kind: "damage", amount: 3, animation: undefined as string | null | undefined }] };
  let saved: { catalog?: string; animation?: string | null; path?: (string | number)[] } = {};
  const context = {
    file: structuredClone(COMBAT_FX), catalogs: { statuses: [status], classes: [{ id: "passive", passiveSkill: { name: "Passive", requiresTargetStatusId: "fixture", cloneSummonCastId: "fixture" } }], artifacts: [{ id: "artifact", effects: [{ kind: "autoDamage" }] }], abilities: [{ id: "ability", effects: [{ kind: "autoDamage" }] }] },
    fx: (id: string) => fields[id], document: { createElement: (tag: string) => { const entry = node(); if (tag === "select") selects.push(entry); return entry; } },
    error: () => {}, apiPost: async (_url: string, body: typeof saved) => { saved = body; return { entry: { ...status, perTurnEffects: [{ kind: "damage", amount: 3, animation: null }] } }; },
  };
  runInNewContext(source + "\nrenderReactionMappings()", context);
  expect(selects).toHaveLength(5);
  const select = selects[0]!;
  expect(select.value).toBe("__default__");
  expect(select.children.map((entry) => entry.value)).toContain("hexed");
  expect(select.children.map((entry) => entry.value)).not.toContain("arrow");
  expect(select.children.map((entry) => entry.value)).not.toContain("slash");
  select.value = "";
  await select.onchange!();
  expect(saved).toMatchObject({ catalog: "status-effects", animation: null, path: ["perTurnEffects", 0, "animation"] });
  expect(status.perTurnEffects[0]!.animation).toBeNull();
});

test("a preset named null cannot make a null status reference valid", () => {
  const draft = JSON.parse(JSON.stringify(editCombatFxPreset(COMBAT_FX, "create", "", "null")));
  draft.statuses.weakened = null;
  expect(() => mergeCombatFxDraft(COMBAT_FX, COMBAT_FX, draft)).toThrow();
});

test("selected beam frames preview repeated native tiles in both directions and survive copy/parse", () => {
  const file = structuredClone(COMBAT_FX);
  file.presets.lightning = { placement: "beam", phase: "impact", ticks: 1, palette: { A: "#123456", B: "#234567" }, frames: [
    { offsetX: 0, offsetY: 0, rows: ["AB"] }, { offsetX: 0, offsetY: 0, rows: ["BA"] },
  ] };
  file.presets.lightning.frames[1] = JSON.parse(JSON.stringify(file.presets.lightning.frames[1]));
  for (const reverse of [false, true]) for (const frameIndex of [0, 1]) {
    const cells = previewCombatFx(file, { ...options, effect: "lightning", reverse, frameIndex });
    const stripe = cells[0]!.map((_, x) => cells.map((row) => row[x]!).find((cell) => ["#123456", "#234567"].includes(cell.bg ?? ""))).filter((cell) => cell !== undefined);
    const fromSource = reverse ? [...stripe].reverse() : stripe;
    expect(fromSource.length).toBeGreaterThan(20);
    for (const [i, cell] of fromSource.entries()) expect(cell.bg).toBe((i + frameIndex) % 2 === 0 ? "#123456" : "#234567");
  }
});

test.each([
  ["classes", 2, "effects"], ["monster-skills", undefined, "chargeEffects"], ["summons", undefined, "effects"],
] as const)("skill animation saves update only the chosen effect in %s", async (catalog, rank, section) => {
  const effect = { kind: "damage", amount: 17, chance: 0.7, animation: "thrust" };
  const skill = { id: "fixture", name: "Fixture", effects: [effect], chargeEffects: [effect], ranks: [{ rank: 2, effects: [effect, { ...effect, amount: 19 }] }] };
  const data = catalog === "classes" ? [{ id: "fixture-class", skills: [skill] }] : catalog === "summons" ? { skills: [skill] } : [skill];
  const files: Record<string, unknown> = { [catalog + ".json"]: structuredClone(data), "combat-fx.json": structuredClone(COMBAT_FX) };
  const request = editorServer(files);
  const body = { catalog, skillId: "fixture", rank, section, index: 0, base: effect, animation: "fireball" };
  const response = await request("/api/skill-animation", "POST", body);
  expect(response.status).toBe(200);
  const expected = JSON.parse(JSON.stringify(data)) as typeof data;
  const chosen = catalog === "classes" ? (expected as { skills: typeof skill[] }[])[0]!.skills[0]! : catalog === "summons" ? (expected as { skills: typeof skill[] }).skills[0]! : (expected as typeof skill[])[0]!;
  if (rank) chosen.ranks[0]!.effects[0]!.animation = "fireball";
  else chosen[section][0]!.animation = "fireball";
  expect(files[catalog + ".json"]).toEqual(expected);
  const saved = structuredClone(files);
  expect((await request("/api/skill-animation", "POST", { ...body, animation: null })).status).toBe(409);
  expect(files).toEqual(saved);
  for (const animation of ["unknown-effect", false]) {
    expect((await request("/api/skill-animation", "POST", { ...body, base: { ...effect, animation: "fireball" }, animation })).status).toBe(400);
    expect(files).toEqual(saved);
  }
});

test("support effect animation validation rejects attack presets and permits explicit suppression", () => {
  const effects = [{ kind: "applyStatusEffect" as const, statusEffectId: "weakened", animation: "debuff" }];
  expect(() => editSkillEffectAnimation(effects, 0, effects[0], "arrow", COMBAT_FX)).toThrow("target on impact");
  expect(editSkillEffectAnimation(effects, 0, effects[0], null, COMBAT_FX)[0]!.animation).toBeNull();
  expect(effects[0]!.animation).toBe("debuff");
  expect(() => editSkillEffectAnimation(effects, -1, effects[0], "fear", COMBAT_FX)).toThrow();
});

test("a Data Editor save is refused when the entry changed on disk after it was loaded", async () => {
  const loaded = { id: "fixture", name: "Fixture", description: "Original", effects: [{ kind: "heal", amount: 5 }] };
  const onDisk = { ...loaded, effects: [{ kind: "heal", amount: 5, animation: "heal" }] };
  const files: Record<string, unknown> = { "combat-fx.json": COMBAT_FX, "items.json": [onDisk] };
  const request = editorServer(files);
  const stale = await request("/api/data/item/fixture", "PUT", { entry: { ...loaded, description: "Edited" }, base: loaded });
  expect(stale.status).toBe(409);
  expect((await stale.json() as { error: string }).error).toContain("changed on disk");
  expect(files["items.json"]).toEqual([onDisk]);
  expect((await request("/api/data/item/fixture", "PUT", { entry: loaded })).status).toBe(400);
  expect((await request("/api/data/item/fixture", "PUT", { entry: { ...onDisk, description: "Edited" }, base: onDisk })).status).toBe(200);
});

test("item and status effects are held to the same animation rules as skill effects", async () => {
  const heal = (animation: string) => [{ effects: [{ kind: "heal" as const, amount: 5, animation }] }];
  expect(() => validateAnimationReferences([], heal("missing-preset"), [], COMBAT_FX)).toThrow("Unknown effect animation missing-preset");
  expect(() => validateAnimationReferences([], heal("arrow"), [], COMBAT_FX)).toThrow("target on impact");
  expect(() => validateAnimationReferences([], [], [{ perTurnEffects: [{ kind: "heal", amount: 5, animation: "arrow" }] }], COMBAT_FX)).toThrow("target on impact");
  expect(() => validateAnimationReferences([], heal("heal"), [], COMBAT_FX)).not.toThrow();
  const entry = { id: "fixture", name: "Fixture", description: "Original" };
  const files: Record<string, unknown> = { "combat-fx.json": COMBAT_FX, "items.json": [entry] };
  const request = editorServer(files);
  const response = await request("/api/data/item/fixture", "PUT", { entry: { ...entry, effects: heal("arrow")[0]!.effects }, base: entry });
  expect(response.status).toBe(400);
  expect(files["items.json"]).toEqual([entry]);
});

test.each([
  ["items.json", { id: "fixture", effects: [{ kind: "heal", animation: "item-only-animation" }] }],
  ["status-effects.json", { id: "fixture", perTurnEffects: [{ kind: "heal", animation: "item-only-animation" }] }],
])("preset edits cannot orphan an animation referenced from %s", async (filename, entry) => {
  const fx = editCombatFxPreset(COMBAT_FX, "duplicate", "heal", "item-only-animation");
  const files: Record<string, unknown> = { "combat-fx.json": fx, [filename]: [entry] };
  const request = editorServer(files);
  for (const action of ["delete", "rename"]) {
    const response = await request("/api/combat-fx-preset", "POST", { file: fx, action, id: "item-only-animation", newId: "renamed-animation" });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("item-only-animation");
  }
});

test("preset edits cannot orphan an animation referenced by a skill on disk", async () => {
  const fx = editCombatFxPreset(COMBAT_FX, "duplicate", "fireball", "skill-only-animation");
  const files: Record<string, unknown> = { "combat-fx.json": fx, "classes.json": [{ skills: [{ id: "fixture", effects: [{ kind: "damage", animation: "skill-only-animation" }] }] }] };
  const request = editorServer(files);
  for (const action of ["delete", "rename"]) {
    const response = await request("/api/combat-fx-preset", "POST", { file: fx, action, id: "skill-only-animation", newId: "renamed-animation" });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("skill-only-animation");
    expect(files["combat-fx.json"]).toEqual(fx);
  }
});

test("skill effect controls save a rank-specific animation and preserve other effects", async () => {
  const html = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = html.indexOf("  function renderSkillMappings()");
  const source = html.slice(start, html.indexOf("  function mappingTable", start));
  type Node = { value: string; textContent: string; children: Node[]; disabled?: boolean; onchange?: () => Promise<void>; append: (...children: Node[]) => void; replaceChildren: () => void; setAttribute: () => void };
  const node = (): Node => ({ value: "", textContent: "", children: [], append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; }, setAttribute() {} });
  const fields: Record<string, Node> = { MappingRows: node(), MapSearch: node(), MapCount: node(), MapHint: node() };
  const entry = { kind: "damage", amount: 13, animation: "thrust" };
  const catalogs = { classes: [{ skills: [{ id: "fixture", name: "Fixture", ranks: [{ rank: 2, effects: [entry] }] }] }], monsterSkills: [], summons: { skills: [] } };
  let sent: Record<string, unknown> = {};
  runInNewContext(source + "\nrenderSkillMappings()", {
    file: COMBAT_FX, catalogs, fx: (id: string) => fields[id], document: { createElement: node }, renderMappings() {}, error() {},
    apiPost: async (url: string, body: typeof sent) => { expect(url).toBe("/api/skill-animation"); sent = body; return { effect: { ...body.base as object, animation: body.animation } }; },
  });
  const select = fields.MappingRows!.children[0]!.children[1]!.children[0]!;
  select.value = "fireball";
  await select.onchange!();
  expect(sent).toMatchObject({ catalog: "classes", skillId: "fixture", rank: 2, section: "effects", index: 0, animation: "fireball" });
  expect(entry).toEqual({ kind: "damage", amount: 13, animation: "fireball" });
});

test.each(["monster-skills", "classes"] as const)("animation saves preserve concurrent catalog changes in %s", async (catalog) => {
  const effect = { kind: "damage", amount: 10, animation: "thrust" };
  const skill = { id: "fixture-skill", name: "Fixture", description: "Fixture skill", effects: [effect] };
  const files: Record<string, unknown> = {
    "combat-fx.json": structuredClone(COMBAT_FX),
    [catalog + ".json"]: catalog === "classes" ? [{ id: "fixture-class", baseAttack: 1, skills: [skill] }] : [skill],
  };
  let release!: () => void, reached!: () => void;
  const blocked = new Promise<void>((resolve) => { reached = resolve; });
  let reads = 0;
  const request = editorServer(files, async (filename) => {
    if (filename === "combat-fx.json" && ++reads === 1) {
      reached();
      await new Promise<void>((resolve) => { release = resolve; });
    }
  });
  const animation = request("/api/skill-animation", "POST", { catalog, skillId: skill.id, section: "effects", index: 0, base: effect, animation: "fireball" });
  await blocked;
  const edit = catalog === "classes"
    ? request("/api/edit/class", "POST", { classId: "fixture-class", base: { baseAttack: 42 } })
    : request("/api/data/monster-skill", "POST", { ...skill, id: "new-fixture-skill" });
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  release();
  const responses = await Promise.all([animation, edit]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  if (catalog === "classes") {
    const saved = files["classes.json"] as { baseAttack: number; skills: typeof skill[] }[];
    expect(saved[0]!.baseAttack).toBe(42);
    expect(saved[0]!.skills[0]!.effects[0]!.animation).toBe("fireball");
  } else {
    const saved = files["monster-skills.json"] as typeof skill[];
    expect(saved.map((entry) => entry.id)).toEqual([skill.id, "new-fixture-skill"]);
    expect(saved[0]!.effects[0]!.animation).toBe("fireball");
  }
});
