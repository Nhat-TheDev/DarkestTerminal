import { RGBA, type TextChunk } from "@opentui/core";
import { validateCombatFx, type CombatFxConfig } from "../../src/data/combatFx";
import { CLASSES, getClass } from "../../src/data/classes";
import { BACKDROPS } from "../../src/data/backdrops";
import { getArchetype } from "../../src/data/monsters";
import { BALANCE } from "../../src/data/balanceConfig";
import { paintCombatFx, sideCombatFxAnchors } from "../../src/ui/combatFx";
import { DIVIDER_WIDTH, SLOT_GAP, SLOT_WIDTH } from "../../src/ui/layout";
import { spriteForClass, spriteForMonster, spriteSlotLayout } from "../../src/ui/sprites";
import { previewScene, type PreviewCell } from "./backdropPreview";

export const COMBAT_FX_EFFECTS = ["thrust", "slash", "blunt", "flash"] as const;
type Effect = typeof COMBAT_FX_EFFECTS[number];

export function isCombatFxEffect(value: unknown): value is Effect {
  return COMBAT_FX_EFFECTS.some((name) => name === value);
}

export function mergeCombatFxEffect(file: CombatFxConfig, effect: unknown, animation: unknown): CombatFxConfig {
  if (!isCombatFxEffect(effect)) throw new Error("Choose thrust, slash, blunt or flash.");
  const next = { ...file, presets: { ...file.presets } };
  if (effect === "flash") next.flash = animation as CombatFxConfig["flash"];
  else next.presets[effect] = animation as CombatFxConfig["presets"][typeof effect];
  validateCombatFx(next);
  return next;
}

export function previewCombatFx(file: CombatFxConfig, options: { effect: Effect; frameIndex: number; reverse: boolean; classId: string; monsterId: string }): PreviewCell[][] {
  validateCombatFx(file);
  if (!isCombatFxEffect(options.effect)) throw new Error("Unknown combat effect.");
  const animation = options.effect === "flash" ? file.flash : file.presets[options.effect];
  if (!Number.isSafeInteger(options.frameIndex) || options.frameIndex < -1 || options.frameIndex >= animation.frames.length) throw new Error("Invalid frame index.");
  getClass(options.classId);
  if (!getArchetype(options.monsterId).roles.includes("normal")) throw new Error("Choose a normal monster for the preview.");
  const party = [options.classId, ...CLASSES.filter((c) => c.id !== options.classId).slice(0, BALANCE.party.size - 1).map((c) => c.id)];
  const base = previewScene(BACKDROPS, Object.keys(BACKDROPS.scenes)[0]!, { dimmed: false, party, monsters: [{ id: options.monsterId, tier: "normal" }] });
  if (options.frameIndex === -1) return base;
  const content: TextChunk[][] = base.map((row) => row.map((cell) => ({ __isChunk: true, text: cell.ch, ...(cell.bg ? { bg: RGBA.fromHex(cell.bg) } : {}), ...(cell.fg ? { fg: RGBA.fromHex(cell.fg) } : {}) })));
  const units = party.map((id, i) => ({ id: `party${i}`, sprite: spriteForClass(id) }));
  const { canvasWidth } = spriteSlotLayout(units.map((u) => u.sprite), SLOT_WIDTH, SLOT_GAP);
  const partyWidth = Math.max(canvasWidth, party.length * SLOT_WIDTH + (party.length - 1) * SLOT_GAP);
  const anchors = sideCombatFxAnchors(units, "party");
  for (const [id, anchor] of sideCombatFxAnchors([{ id: "monster", sprite: spriteForMonster(options.monsterId, "normal") }], "monster", partyWidth + DIVIDER_WIDTH)) anchors.set(id, anchor);
  const hit = { sourceId: options.reverse ? "monster" : "party0", targetId: options.reverse ? "party0" : "monster", amount: 10, ...(options.effect === "flash" ? {} : { visual: options.effect }) };
  const rows = paintCombatFx(content, anchors, [{ hit, progress: animation.frames.length === 1 ? 0 : options.frameIndex / (animation.frames.length - 1), impactAge: options.effect === "flash" ? options.frameIndex : -1 }], 0, file);
  const hex = (color: RGBA | undefined): string | null => color ? "#" + color.toInts().slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("") : null;
  return rows.map((row) => row.flatMap((chunk) => Array.from(chunk.text, (ch) => ({ ch, bg: hex(chunk.bg), fg: hex(chunk.fg) }))));
}
