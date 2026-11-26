import type { DamageType, PhysicalAttackVisual, SkillEffect, SkillDefinition, StatusEffectDefinition, PassiveSkillDefinition } from "../types";
import { CLASSES } from "./classes";
import { MONSTER_ARCHETYPES, MONSTER_SKILLS } from "./monsters";
import { SUMMON_ARCHETYPES, SUMMON_SKILLS } from "./summons";
import { ITEMS } from "./items";
import { STATUS_EFFECTS } from "./statusEffects";
import { ARTIFACTS } from "./artifacts";
import { ABILITIES } from "./abilities";
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

export const REACTION_KINDS = ["damageOverTime", "woundOnHit", "reflectDamage", "counterAttack", "onHitAoeDamage", "bonusDamage", "autoDamage", "passiveSummon"] as const;
export type ReactionKind = typeof REACTION_KINDS[number];

export interface CombatFxConfig {
  flash: { mask: "target"; frames: { partyColor: string | null; monsterColor: string | null }[] };
  presets: Record<PhysicalAttackVisual, PixelAnimation> & Record<string, PixelAnimation>;
  items: Record<string, string | null>;
  statuses: Record<string, string>;
  outcomes: Record<"heal" | "mana" | "buff" | "debuff" | "cleanse" | "dispel", string>;
  damageTypes: Record<DamageType, string>;
  reactions: Record<ReactionKind, string | null>;
  basicAttacks: Record<"monsters" | "summons", Record<string, string | null>>;
}

export const COMBAT_FX = combatFxJson as CombatFxConfig;

export function getReactionVisual(kind: ReactionKind, override?: string | null, statusId?: string): string | null {
  if (override !== undefined) return override;
  return (kind === "damageOverTime" && statusId ? COMBAT_FX.statuses[statusId] : undefined) ?? COMBAT_FX.reactions[kind];
}

export function validateReactionAnimation(visual: string | null | undefined, file: CombatFxConfig, where: string): void {
  if (visual === undefined || visual === null) return;
  const preset = typeof visual === "string" && Object.hasOwn(file.presets, visual) ? file.presets[visual] : undefined;
  if (!preset || preset.phase !== "impact" || (preset.placement ?? "target") !== "target") throw new Error(`${where}: reaction animation ${visual} must play at the target on impact`);
}

type ReactionStatus = Partial<Pick<StatusEffectDefinition, "id" | "perTurnEffects" | "woundOnHit" | "counterAttack" | "onHitAoeDamage">>;

export function validateReactionReferences(
  file: CombatFxConfig,
  statuses: ReactionStatus[],
  classes: { id?: string; passiveSkill?: Pick<PassiveSkillDefinition, "bonusDamageAnimation" | "secondCloneAnimation"> }[] = [],
  gear: { id?: string; effects?: { kind: string; animation?: string | null }[] }[] = [],
): void {
  for (const status of statuses) {
    for (const [index, effect] of (status.perTurnEffects ?? []).entries()) if (effect.kind === "damage") validateReactionAnimation(effect.animation, file, `status ${status.id}.perTurnEffects.${index}`);
    for (const key of ["woundOnHit", "counterAttack", "onHitAoeDamage"] as const) validateReactionAnimation(status[key]?.animation, file, `status ${status.id}.${key}`);
  }
  for (const entry of classes) for (const key of ["bonusDamageAnimation", "secondCloneAnimation"] as const) validateReactionAnimation(entry.passiveSkill?.[key], file, `class ${entry.id}.passiveSkill.${key}`);
  for (const entry of gear) for (const [index, effect] of (entry.effects ?? []).entries()) if (effect.kind === "autoDamage") validateReactionAnimation(effect.animation, file, `gear ${entry.id}.effects.${index}`);
}

export function validateEffectAnimation(effect: SkillEffect, file: CombatFxConfig = COMBAT_FX): void {
  if (effect.animation === undefined || effect.animation === null) return;
  if (typeof effect.animation !== "string" || !Object.hasOwn(file.presets, effect.animation)) throw new Error(`Unknown effect animation ${effect.animation}`);
  const preset = file.presets[effect.animation]!;
  if (!["damage", "throwDice"].includes(effect.kind) && (preset.phase !== "impact" || (preset.placement ?? "target") !== "target")) throw new Error(`Effect animation ${effect.animation} must play at the target on impact`);
}

export function validateSkillAnimations(skills: SkillDefinition[], file: CombatFxConfig = COMBAT_FX): void {
  for (const skill of skills) for (const effect of [...(skill.effects ?? []), ...(skill.chargeEffects ?? []), ...(skill.ranks ?? []).flatMap((rank) => rank.effects ?? [])]) validateEffectAnimation(effect, file);
}

export function validateAnimationReferences(
  skills: SkillDefinition[],
  items: { effects?: SkillEffect[] }[],
  statuses: ReactionStatus[],
  file: CombatFxConfig = COMBAT_FX,
): void {
  validateSkillAnimations(skills, file);
  for (const effect of [...items.flatMap((item) => item.effects ?? []), ...statuses.flatMap((status) => status.perTurnEffects ?? [])]) validateEffectAnimation(effect, file);
  validateReactionReferences(file, statuses);
}

export function validateCombatFx(file: CombatFxConfig): void {
  if (!file.reactions || Object.keys(file.reactions).length !== REACTION_KINDS.length || REACTION_KINDS.some((kind) => !Object.hasOwn(file.reactions, kind))) throw new Error("combat-fx: incomplete or unknown reaction keys");
  for (const kind of REACTION_KINDS) {
    if (file.reactions[kind] === undefined) throw new Error(`combat-fx: missing reactions.${kind}`);
    validateReactionAnimation(file.reactions[kind], file, `reactions.${kind}`);
  }
  const catalogs = {
    items: ITEMS,
    statuses: STATUS_EFFECTS,
    monsters: MONSTER_ARCHETYPES,
    summons: SUMMON_ARCHETYPES,
  };
  for (const [kind, entries] of Object.entries({ items: file.items, statuses: file.statuses, ...file.basicAttacks })) {
    const catalog = catalogs[kind as keyof typeof catalogs];
    if (!catalog) throw new Error(`combat-fx: unknown catalog ${kind}`);
    for (const [id, visual] of Object.entries(entries)) {
      if (!catalog.some((entry) => entry.id === id)) throw new Error(`combat-fx: unknown ${kind} id ${id}`);
      if (visual !== null && (typeof visual !== "string" || !Object.hasOwn(file.presets, visual))) throw new Error(`combat-fx: unknown visual ${visual}`);
    }
  }
  validateAnimationReferences([...CLASSES.flatMap((c) => c.skills), ...MONSTER_SKILLS, ...SUMMON_SKILLS], ITEMS, STATUS_EFFECTS, file);
  validateReactionReferences(file, STATUS_EFFECTS, CLASSES, [...ARTIFACTS, ...ABILITIES]);
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

export function getBasicAttackVisual(kind: "classes" | keyof CombatFxConfig["basicAttacks"], id: string): string | null {
  if (kind === "classes") return CLASSES.find((entry) => entry.id === id)?.skills.find((skill) => skill.slot === 0)?.effects?.find((effect) => effect.kind === "damage")?.animation ?? null;
  return COMBAT_FX.basicAttacks[kind][id] ?? null;
}

export function getStatusVisual(statusId: string, helpful: boolean): string {
  return COMBAT_FX.statuses[statusId] ?? COMBAT_FX.outcomes[helpful ? "buff" : "debuff"];
}

export function getDamageAttackVisual(damageType: DamageType): string | null {
  return COMBAT_FX.damageTypes[damageType] ?? null;
}
