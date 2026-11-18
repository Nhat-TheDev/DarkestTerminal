import type { PhysicalAttackVisual } from "../types";
import { CLASSES } from "./classes";
import { MONSTER_ARCHETYPES, MONSTER_SKILLS } from "./monsters";
import { SUMMON_ARCHETYPES, SUMMON_SKILLS } from "./summons";
import combatFxJson from "../../data/combat-fx.json";

interface PixelFrame {
  offsetX: number;
  offsetY: number;
  rows: string[];
}

interface PixelAnimation {
  palette: Record<string, string>;
  frames: PixelFrame[];
}

export interface CombatFxConfig {
  flash: { mask: "target"; frames: { partyColor: string | null; monsterColor: string | null }[] };
  presets: Record<PhysicalAttackVisual, PixelAnimation>;
  skills: Record<string, PhysicalAttackVisual | null>;
  basicAttacks: Record<"classes" | "monsters" | "summons", Record<string, PhysicalAttackVisual | null>>;
}

export const COMBAT_FX = combatFxJson as CombatFxConfig;

export function validateCombatFx(file: CombatFxConfig): void {
  const catalogs = {
    skills: [...CLASSES.flatMap((c) => c.skills), ...MONSTER_SKILLS, ...SUMMON_SKILLS],
    classes: CLASSES,
    monsters: MONSTER_ARCHETYPES,
    summons: SUMMON_ARCHETYPES,
  };
  for (const [kind, entries] of Object.entries({ skills: file.skills, ...file.basicAttacks })) {
    const catalog = catalogs[kind as keyof typeof catalogs];
    if (!catalog) throw new Error(`combat-fx: unknown catalog ${kind}`);
    for (const [id, visual] of Object.entries(entries)) {
      if (!catalog.some((entry) => entry.id === id)) throw new Error(`combat-fx: unknown ${kind} id ${id}`);
      if (visual !== null && !["thrust", "slash", "blunt"].includes(visual)) throw new Error(`combat-fx: unknown visual ${visual}`);
    }
  }
  const isColor = (color: unknown): boolean => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
  if (file.flash.mask !== "target" || !Array.isArray(file.flash.frames) || file.flash.frames.length === 0) throw new Error("combat-fx: invalid flash frames or mask");
  for (const frame of file.flash.frames) {
    if (!frame || ![frame.partyColor, frame.monsterColor].every((color) => color === null || isColor(color))) throw new Error("combat-fx: invalid flash colors");
  }
  for (const name of ["thrust", "slash", "blunt"] as const) {
    const animation = file.presets[name];
    if (!animation?.palette || !Array.isArray(animation.frames) || animation.frames.length === 0) throw new Error(`combat-fx: invalid ${name} animation`);
    for (const [key, color] of Object.entries(animation.palette)) {
      if (key.length !== 1 || key === "." || !isColor(color)) throw new Error(`combat-fx: invalid ${name} palette`);
    }
    for (const frame of animation.frames) {
      if (!frame || !Number.isSafeInteger(frame.offsetX) || !Number.isSafeInteger(frame.offsetY) || !Array.isArray(frame.rows) || frame.rows.length === 0 || !frame.rows[0]?.length) throw new Error(`combat-fx: invalid ${name} frame`);
      for (const row of frame.rows) {
        if (typeof row !== "string" || row.length !== frame.rows[0].length || [...row].some((key) => key !== "." && !Object.hasOwn(animation.palette, key))) throw new Error(`combat-fx: invalid ${name} pixel grid`);
      }
    }
  }
}

validateCombatFx(COMBAT_FX);

export function getSkillAttackVisual(skillId: string, fromItem = false): PhysicalAttackVisual | null {
  return fromItem ? null : COMBAT_FX.skills[skillId] ?? null;
}

export function getBasicAttackVisual(kind: keyof CombatFxConfig["basicAttacks"], id: string): PhysicalAttackVisual | null {
  return COMBAT_FX.basicAttacks[kind][id] ?? null;
}
