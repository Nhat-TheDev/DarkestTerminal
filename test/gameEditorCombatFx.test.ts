import { expect, test } from "bun:test";
import { COMBAT_FX, type CombatFxConfig } from "../src/data/combatFx";
import { CLASSES } from "../src/data/classes";
import { MONSTER_ARCHETYPES } from "../src/data/monsters";
import { IMPACT_TICKS, SESSION_MIN_TICKS } from "../src/ui/revealQueue";
import { editCombatFxPreset, mergeCombatFxDraft, mergeCombatFxEffect, previewCombatFx } from "../tools/game-editor/combatFxPreview";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

const options = { effect: "thrust" as const, frameIndex: 0, reverse: false, classId: CLASSES[0]!.id, monsterId: MONSTER_ARCHETYPES.find((m) => m.roles.includes("normal"))!.id };

function editorServer(files: Record<string, unknown>) {
  const server = readFileSync(new URL("../tools/game-editor/server.ts", import.meta.url), "utf8");
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(server.replace(/^import .*$/gm, "").replaceAll("import.meta.dir", '"/editor"'));
  let fetch!: (req: Request) => Promise<Response>;
  runInNewContext(code, {
    Bun: { serve: (handlers: { fetch: typeof fetch }) => { fetch = handlers.fetch; } },
    path, URL, Response, DIVIDER_WIDTH: 1, console: { log() {} },
    readFile: async (filename: string) => JSON.stringify(files[path.basename(filename)]),
    writeFile: async (filename: string, data: string) => { files[path.basename(filename)] = JSON.parse(data); },
    assertMonsterDataConsistent() {}, assertMonsterKitConsistent() {}, MONSTER_ARCHETYPES: [], MONSTER_SKILLS: [],
    mergeCombatFxDraft, mergeCombatFxEffect,
  });
  return (endpoint: string, method: string, body?: unknown) => fetch(new Request("http://localhost" + endpoint, { method, body: JSON.stringify(body) }));
}

test.each([
  ["item", "items.json", "items", null],
  ["status", "status-effects.json", "statuses", "heal"],
  ["monster", "monsters.json", "basicAttacks.monsters", null],
  ["monster-skill", "monster-skills.json", "skills", "thrust"],
] as const)("catalog changes protect saved Combat Effects references to %s", async (type, filename, mapping, visual) => {
  const id = "fixture", entry = { id, name: "Fixture", description: "Original" };
  const fx = structuredClone(COMBAT_FX);
  const table = mapping === "basicAttacks.monsters" ? fx.basicAttacks.monsters : fx[mapping];
  Object.assign(table, { [id]: visual });
  const files = { [filename]: [entry], "combat-fx.json": fx };
  const request = editorServer(files);
  const endpoint = "/api/data/" + type + "/" + id;
  for (const method of ["PUT", "DELETE"]) {
    const response = await request(endpoint, method, method === "PUT" ? { ...entry, id: "renamed" } : undefined);
    expect(response.status).toBe(400);
    const { error } = await response.json() as { error: string };
    expect(error).toContain(mapping + "." + id);
    expect(error).toContain("Unmapped (game default)");
    expect(files[filename]).toEqual([entry]);
  }
  const updated = { ...entry, description: "Updated" };
  expect((await request(endpoint, "PUT", updated)).status).toBe(200);
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
      Preview: { getContext: () => ({ fillRect: () => {} }) }, PreviewLabel: {}, Play: {}, Error: { textContent: "" },
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
  draft.skills.slash = "thrust";
  draft.items[Object.keys(draft.items)[0]!] = "arrow";
  draft.basicAttacks.classes.knight = null;
  disk.presets.slash.palette.A = "#123456";
  const saved = mergeCombatFxDraft(disk, base, draft);
  expect(saved.skills.slash).toBe("thrust");
  expect(saved.basicAttacks.classes.knight).toBeNull();
  expect(saved.presets.slash.palette.A).toBe("#123456");
  expect(disk.skills.slash).toBe(base.skills.slash);
  expect(base).toEqual(COMBAT_FX);
  disk.skills.slash = "blunt";
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
  draft.skills.slash = "custom-heal";
  draft.items[Object.keys(draft.items)[0]!] = "custom-heal";
  draft.statuses.weakened = "custom-heal";
  draft.outcomes.heal = "custom-heal";
  draft.damageTypes.holy = "custom-heal";
  draft.basicAttacks.classes.knight = "custom-heal";
  expect(() => previewCombatFx(draft, { ...options, effect: "custom-heal" })).not.toThrow();
  const renamed = editCombatFxPreset(draft, "rename", "custom-heal", "renamed-heal");
  expect(renamed.presets["custom-heal"]).toBeUndefined();
  for (const visual of [renamed.skills.slash, renamed.items[Object.keys(draft.items)[0]!], renamed.statuses.weakened, renamed.outcomes.heal, renamed.damageTypes.holy, renamed.basicAttacks.classes.knight]) expect(visual).toBe("renamed-heal");
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
  for (const patch of [{ basicAttacks: {} }, { outcomes: {} }, { presets: [] }, { extra: 1 }]) expect(() => mergeCombatFxDraft(base, base, { ...base, ...patch })).toThrow();
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
  draft.skills.slash = "thrust"; disk.statuses.weakened = "poison";
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
  expect(context.file.skills.slash).toBe("thrust");
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

test("class slot-zero skills link to the class basic attack and can explicitly clear a stored skill override", () => {
  const editor = readFileSync(new URL("../tools/game-editor/index.html", import.meta.url), "utf8");
  const start = editor.indexOf("  function mappingTable(");
  const source = editor.slice(start, editor.indexOf("  fx('MapGroup').onchange", start));
  const preset = "stored-slot-zero-fixture";
  const draft = editCombatFxPreset(COMBAT_FX, "duplicate", "thrust", preset);
  const owner = CLASSES.find((entry) => entry.skills.some((skill) => skill.slot === 0))!;
  const basic = owner.skills.find((skill) => skill.slot === 0)!;
  draft.skills[basic.id] = preset;
  draft.basicAttacks.classes[owner.id] = "slash";
  type Node = { tag: string; value: string; textContent: string; dataset: Record<string, string>; children: Node[]; onclick?: () => void; append: (...children: Node[]) => void; replaceChildren: () => void; setAttribute: () => void; focus: () => void };
  const node = (tag = ""): Node => ({
    tag, value: "", textContent: "", dataset: {}, children: [], setAttribute() {}, focus() {},
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
  });
  let focusedSelector = "";
  let edits = 0;
  const rows = { ...node(), querySelector: (selector: string) => ({ focus: () => { focusedSelector = selector; } }) };
  const fields = { MapGroup: { ...node(), value: "skills" }, MapSearch: { ...node(), value: basic.id }, MapHint: node(), MapCount: node(), MappingRows: rows };
  const context = {
    file: draft, catalogs: { classes: [owner], monsterSkills: [], summons: { skills: [] } },
    fx: (id: keyof typeof fields) => fields[id], document: { createElement: node }, CSS: { escape: (id: string) => id }, changed: () => edits++,
  };
  const render = runInNewContext(source + "\nrenderMappings", context) as () => void;
  render();
  const [action, effect, preview] = rows.children[0]!.children;
  expect(action?.children[0]?.textContent).toBe(basic.id);
  expect(effect?.textContent).toBe("slash");
  expect(effect?.children[0]?.textContent).toContain(preset);
  expect(effect?.children.some((child) => child.tag === "select")).toBe(false);
  expect(() => editCombatFxPreset(draft, "delete", preset)).toThrow("skills." + basic.id);
  preview?.children[0]?.onclick?.();
  expect(fields.MapGroup.value).toBe("basicAttacks.classes");
  expect(fields.MapSearch.value).toBe(owner.id);
  expect(rows.children[0]?.children[1]?.children[0]?.value).toBe("slash");
  expect(focusedSelector).toContain(owner.id);
  expect(draft.skills[basic.id]).toBe(preset);
  expect(edits).toBe(0);

  fields.MapGroup.value = "skills";
  fields.MapSearch.value = preset;
  render();
  const clear = rows.children[0]?.children[2]?.children.find((button) => button.textContent === "Clear stored skill override");
  expect(clear).toBeDefined();
  clear?.onclick?.();
  expect(Object.hasOwn(draft.skills, basic.id)).toBe(false);
  expect(draft.basicAttacks.classes[owner.id]).toBe("slash");
  expect(edits).toBe(1);
  expect(editCombatFxPreset(draft, "delete", preset).presets[preset]).toBeUndefined();
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
