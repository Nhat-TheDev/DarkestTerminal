import { RGBA, type TextChunk } from "@opentui/core";
import { COMBAT_FX, validateCombatFx, type CombatFxConfig } from "../../src/data/combatFx";
import { CLASSES, getClass } from "../../src/data/classes";
import { BACKDROPS } from "../../src/data/backdrops";
import { getArchetype } from "../../src/data/monsters";
import { BALANCE } from "../../src/data/balanceConfig";
import { paintCombatFx, sideCombatFxAnchors } from "../../src/ui/combatFx";
import { DIVIDER_WIDTH, SLOT_GAP, SLOT_WIDTH } from "../../src/ui/layout";
import { IMPACT_TICKS } from "../../src/ui/revealQueue";
import { spriteForClass, spriteForMonster, spriteSlotLayout } from "../../src/ui/sprites";
import { previewScene, type PreviewCell } from "./backdropPreview";

type Effect = string;
export type CombatFxPlayback = { context: "attack" | "support"; tick: number };

export function isCombatFxEffect(value: unknown, file: CombatFxConfig = COMBAT_FX): value is Effect {
  return typeof value === "string" && (value === "flash" || Object.hasOwn(file.presets, value));
}

export function mergeCombatFxEffect(file: CombatFxConfig, effect: unknown, animation: unknown): CombatFxConfig {
  if (!isCombatFxEffect(effect, file)) throw new Error("Choose an authored combat effect.");
  const next = { ...file, presets: { ...file.presets } };
  if (effect === "flash") next.flash = animation as CombatFxConfig["flash"];
  else next.presets[effect] = animation as CombatFxConfig["presets"][typeof effect];
  validateCombatFx(next);
  return next;
}

function mappingTables(file: CombatFxConfig): Record<string, Record<string, unknown>> {
  return {
    skills: file.skills, items: file.items, statuses: file.statuses, outcomes: file.outcomes, damageTypes: file.damageTypes,
    "basicAttacks.classes": file.basicAttacks.classes,
    "basicAttacks.monsters": file.basicAttacks.monsters,
    "basicAttacks.summons": file.basicAttacks.summons,
  };
}

function checkedConfig(value: unknown, fullValidation = true): CombatFxConfig {
  const record = (entry: unknown): boolean => !!entry && typeof entry === "object" && !Array.isArray(entry);
  if (!record(value)) throw new Error("Combat effects must be an object.");
  const file = value as CombatFxConfig;
  const sameKeys = (a: object, b: object): boolean => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort());
  if (!sameKeys(file, COMBAT_FX) || !record(file.basicAttacks) || !sameKeys(file.basicAttacks, COMBAT_FX.basicAttacks) || !record(file.presets) || !record(file.flash)) throw new Error("Invalid combat effect sections.");
  if (!Object.values(mappingTables(file)).every(record) || !sameKeys(file.outcomes, COMBAT_FX.outcomes)) throw new Error("Invalid combat effect mappings.");
  for (const [path, table] of Object.entries(mappingTables(file))) {
    const nullable = path === "skills" || path === "items" || path.startsWith("basicAttacks.");
    if (Object.values(table).some((visual) => typeof visual !== "string" && !(nullable && visual === null))) throw new Error(`Invalid ${path} mapping value.`);
  }
  if (Object.values(file.presets).some((animation) => !record(animation) || !record(animation.palette))) throw new Error("Invalid preset or palette.");
  if (fullValidation) validateCombatFx(file);
  return file;
}

export function mergeCombatFxDraft(current: CombatFxConfig, baseline: unknown, draft: unknown): CombatFxConfig {
  const base = checkedConfig(baseline, false), edited = checkedConfig(draft, false);
  const next = structuredClone(checkedConfig(current));
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const merge = (target: Record<string, unknown>, before: Record<string, unknown>, after: Record<string, unknown>, path: string): void => {
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (same(before[id], after[id])) continue;
      if (!same(target[id], before[id]) && !same(target[id], after[id])) throw new Error(`Conflict at ${path}${id}. Reload and review the current file; your draft has not been saved.`);
      if (Object.hasOwn(after, id)) target[id] = structuredClone(after[id]);
      else delete target[id];
    }
  };
  const flash = { flash: next.flash };
  merge(flash, { flash: base.flash }, { flash: edited.flash }, "");
  next.flash = flash.flash;
  const targets: Record<string, Record<string, unknown>> = { presets: next.presets, ...mappingTables(next) };
  const befores: Record<string, Record<string, unknown>> = { presets: base.presets, ...mappingTables(base) };
  const afters: Record<string, Record<string, unknown>> = { presets: edited.presets, ...mappingTables(edited) };
  for (const [path, table] of Object.entries(targets)) merge(table, befores[path]!, afters[path]!, `${path}.`);
  return checkedConfig(next);
}

export function editCombatFxPreset(file: CombatFxConfig, action: unknown, id: unknown, newId?: unknown): CombatFxConfig {
  const next = structuredClone(checkedConfig(file));
  if (!["create", "duplicate", "rename", "delete"].includes(String(action)) || typeof id !== "string") throw new Error("Choose a preset action.");
  if (action !== "create" && !Object.hasOwn(next.presets, id)) throw new Error("Choose an existing preset.");
  if (action === "rename" || action === "delete") {
    if (["thrust", "slash", "blunt"].includes(id)) throw new Error("This preset is required by the game schema.");
  }
  if (action !== "delete") {
    if (typeof newId !== "string" || !/^[a-z][a-z0-9-]*$/.test(newId) || newId === "flash") throw new Error("Use a lowercase preset id with letters, digits and hyphens.");
    if (Object.hasOwn(next.presets, newId)) throw new Error("That preset id already exists.");
    next.presets[newId] = action === "create"
      ? { placement: "target", phase: "impact", ticks: 5, palette: { A: "#ffffff" }, frames: [{ offsetX: -2, offsetY: -2, rows: [".....", ".....", ".....", ".....", "....."] }] }
      : structuredClone(next.presets[id]!);
  }
  if (action === "rename" || action === "delete") {
    for (const [path, table] of Object.entries(mappingTables(next))) {
      for (const [key, visual] of Object.entries(table)) {
        if (visual !== id) continue;
        if (action === "delete") throw new Error(`Preset is still used by ${path}.${key}. Change that mapping first.`);
        table[key] = newId;
      }
    }
    delete next.presets[id];
  }
  return checkedConfig(next);
}

export function previewCombatFx(file: CombatFxConfig, options: { effect: Effect; frameIndex?: number; playback?: CombatFxPlayback; reverse: boolean; classId: string; monsterId: string }): PreviewCell[][] {
  checkedConfig(file);
  if (!isCombatFxEffect(options.effect, file)) throw new Error("Unknown combat effect.");
  const animation = options.effect === "flash" ? file.flash : file.presets[options.effect];
  if (!animation) throw new Error("Unknown combat animation.");
  const { frameIndex = -2, playback } = options;
  if (playback !== undefined) {
    if (!playback || !Number.isSafeInteger(playback.tick) || playback.tick < 0 || !["attack", "support"].includes(playback.context)) throw new Error("Invalid playback options.");
    const preset = file.presets[options.effect];
    if (playback.context === "support" && (preset?.phase !== "impact" || (preset.placement ?? "target") !== "target")) throw new Error("Support playback requires a target effect on impact.");
  } else if (!Number.isSafeInteger(frameIndex) || frameIndex < -1 || frameIndex >= animation.frames.length) throw new Error("Invalid frame index.");
  getClass(options.classId);
  if (!getArchetype(options.monsterId).roles.includes("normal")) throw new Error("Choose a normal monster for the preview.");
  const party = [options.classId, ...CLASSES.filter((c) => c.id !== options.classId).slice(0, BALANCE.party.size - 1).map((c) => c.id)];
  const base = previewScene(BACKDROPS, Object.keys(BACKDROPS.scenes)[0]!, { dimmed: false, party, monsters: [{ id: options.monsterId, tier: "normal" }] });
  if (!playback && frameIndex === -1) return base;
  const content: TextChunk[][] = base.map((row) => row.map((cell) => ({ __isChunk: true, text: cell.ch, ...(cell.bg ? { bg: RGBA.fromHex(cell.bg) } : {}), ...(cell.fg ? { fg: RGBA.fromHex(cell.fg) } : {}) })));
  const units = party.map((id, i) => ({ id: `party${i}`, sprite: spriteForClass(id) }));
  const { canvasWidth } = spriteSlotLayout(units.map((u) => u.sprite), SLOT_WIDTH, SLOT_GAP);
  const partyWidth = Math.max(canvasWidth, party.length * SLOT_WIDTH + (party.length - 1) * SLOT_GAP);
  const anchors = sideCombatFxAnchors(units, "party");
  for (const [id, anchor] of sideCombatFxAnchors([{ id: "monster", sprite: spriteForMonster(options.monsterId, "normal") }], "monster", partyWidth + DIVIDER_WIDTH)) anchors.set(id, anchor);
  const support = playback ? playback.context === "support" : options.effect !== "flash" && [...Object.values(file.outcomes), ...Object.values(file.statuses)].includes(options.effect);
  const recovery = support && [file.outcomes.heal, file.outcomes.mana, file.outcomes.buff, file.outcomes.cleanse].includes(options.effect);
  const targetId = options.reverse !== recovery ? "party0" : "monster";
  const progress = playback ? Math.min(1, playback.tick / (IMPACT_TICKS - 1)) : animation.frames.length === 1 ? 0 : frameIndex / (animation.frames.length - 1);
  const impactAge = playback ? playback.tick - IMPACT_TICKS : options.effect === "flash" ? frameIndex : -1;
  const hit = { sourceId: options.reverse ? "monster" : "party0", targetId, amount: 10, ...(options.effect === "flash" ? {} : { visual: options.effect }) };
  const selected = playback || options.effect === "flash" ? file : { ...file, presets: { ...file.presets, [options.effect]: { ...file.presets[options.effect]!, frames: [file.presets[options.effect]!.frames[frameIndex]!], ticks: 1, phase: support ? "impact" as const : "approach" as const } } };
  const rows = paintCombatFx(content, anchors, support ? [] : [{ hit, progress, impactAge }], 0, selected, support ? [{ effect: { targetId, visual: options.effect }, age: playback ? impactAge : 0 }] : []);
  const hex = (color: RGBA | undefined): string | null => color ? "#" + color.toInts().slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("") : null;
  return rows.map((row) => row.flatMap((chunk) => Array.from(chunk.text, (ch) => ({ ch, bg: hex(chunk.bg), fg: hex(chunk.fg) }))));
}
