import type { DamageType, PhysicalAttackVisual } from "../types";
import { CLASSES } from "./classes";
import { MONSTER_ARCHETYPES, MONSTER_SKILLS } from "./monsters";
import { SUMMON_ARCHETYPES, SUMMON_SKILLS } from "./summons";
import { ITEMS } from "./items";
import { STATUS_EFFECTS } from "./statusEffects";
import combatFxJson from "../../data/combat-fx.json";

interface PixelFrame {
  offsetX: number;
  offsetY: number;
  rows: string[];
}

export interface PixelAnimation {
  placement?: "target" | "projectile" | "beam";
  phase?: "approach" | "impact";
  ticks?: number;
  palette: Record<string, string>;
  frames: PixelFrame[];
}

export interface CombatFxConfig {
  flash: { mask: "target"; frames: { partyColor: string | null; monsterColor: string | null }[] };
  presets: Record<PhysicalAttackVisual, PixelAnimation> & Record<string, PixelAnimation>;
  skills: Record<string, string | null>;
  items: Record<string, string | null>;
  statuses: Record<string, string>;
  outcomes: Record<"heal" | "mana" | "buff" | "debuff" | "cleanse" | "dispel", string>;
  damageTypes: Record<DamageType, string>;
  basicAttacks: Record<"classes" | "monsters" | "summons", Record<string, string | null>>;
}

export const COMBAT_FX = combatFxJson as CombatFxConfig;

export function validateCombatFx(file: CombatFxConfig): void {
  const catalogs = {
    skills: [...CLASSES.flatMap((c) => c.skills), ...MONSTER_SKILLS, ...SUMMON_SKILLS],
    items: ITEMS,
    statuses: STATUS_EFFECTS,
    classes: CLASSES,
    monsters: MONSTER_ARCHETYPES,
    summons: SUMMON_ARCHETYPES,
  };
  for (const [kind, entries] of Object.entries({ skills: file.skills, items: file.items, statuses: file.statuses, ...file.basicAttacks })) {
    const catalog = catalogs[kind as keyof typeof catalogs];
    if (!catalog) throw new Error(`combat-fx: unknown catalog ${kind}`);
    for (const [id, visual] of Object.entries(entries)) {
      if (!catalog.some((entry) => entry.id === id)) throw new Error(`combat-fx: unknown ${kind} id ${id}`);
      if (visual !== null && (typeof visual !== "string" || !Object.hasOwn(file.presets, visual))) throw new Error(`combat-fx: unknown visual ${visual}`);
    }
  }
  const damageTypes: DamageType[] = ["physical", "magic", "fire", "ice", "lightning", "poison", "bleed", "holy"];
  if (Object.keys(file.damageTypes).length !== damageTypes.length || damageTypes.some((kind) => !Object.hasOwn(file.damageTypes, kind))) throw new Error("combat-fx: incomplete or unknown damage types");
  for (const visual of [...Object.values(file.outcomes), ...Object.values(file.damageTypes)]) {
    if (typeof visual !== "string" || !Object.hasOwn(file.presets, visual)) throw new Error(`combat-fx: unknown visual ${visual}`);
  }
  const { heal, mana, buff, debuff, cleanse, dispel } = file.outcomes;
  if (!heal || !mana || !buff || !debuff || !cleanse || !dispel) throw new Error("combat-fx: missing outcome visual");
  for (const visual of [...Object.values(file.outcomes), ...Object.values(file.statuses)]) {
    const animation = file.presets[visual];
    if (animation?.phase !== "impact" || (animation.placement ?? "target") !== "target") throw new Error(`combat-fx: support ${visual} must play at the target on impact`);
  }
  const isColor = (color: unknown): boolean => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
  if (file.flash.mask !== "target" || !Array.isArray(file.flash.frames) || file.flash.frames.length === 0) throw new Error("combat-fx: invalid flash frames or mask");
  for (const frame of file.flash.frames) {
    if (!frame || ![frame.partyColor, frame.monsterColor].every((color) => color === null || isColor(color))) throw new Error("combat-fx: invalid flash colors");
  }
  for (const name of ["thrust", "slash", "blunt"]) if (!file.presets[name]) throw new Error(`combat-fx: missing ${name}`);
  for (const [name, animation] of Object.entries(file.presets)) {
    if (name === "flash" || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("combat-fx: invalid preset id");
    if (animation.placement !== undefined && !["target", "projectile", "beam"].includes(animation.placement)) throw new Error(`combat-fx: invalid ${name} placement`);
    if (animation.phase !== undefined && !["approach", "impact"].includes(animation.phase)) throw new Error(`combat-fx: invalid ${name} phase`);
    if (animation.ticks !== undefined && (!Number.isSafeInteger(animation.ticks) || animation.ticks < 1 || animation.ticks > 100)) throw new Error(`combat-fx: invalid ${name} duration`);
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

export function getSkillAttackVisual(skillId: string, fromItem = false): string | null {
  return (fromItem ? COMBAT_FX.items : COMBAT_FX.skills)[skillId] ?? null;
}

export function getBasicAttackVisual(kind: keyof CombatFxConfig["basicAttacks"], id: string): string | null {
  return COMBAT_FX.basicAttacks[kind][id] ?? null;
}

export function getStatusVisual(statusId: string, helpful: boolean): string {
  return COMBAT_FX.statuses[statusId] ?? COMBAT_FX.outcomes[helpful ? "buff" : "debuff"];
}

export function getDamageAttackVisual(damageType: DamageType): string | null {
  return COMBAT_FX.damageTypes[damageType] ?? null;
}
