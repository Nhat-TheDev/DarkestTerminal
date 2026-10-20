import type { TextChunk } from "@opentui/core";
import type { CombatantSnapshot, HitMark, Id, LogSession, MonsterTier } from "../types";
import { ICON_BAND_ROWS } from "./layout";
import { MAX_BOSS_HEIGHT, MAX_ELITE_HEIGHT, MAX_UNIT_HEIGHT, compositeSpriteRow, spriteSlotLayout, spriteWidth, type Sprite } from "./sprites";
import { t } from "../data/strings";
import { PALETTE, colorChunk, plainChunk } from "./theme";
import { formatFear, roundFear } from "../engine/survival";

export type UnitSide = "party" | "monster";

export interface FocusIcon {
  glyph: string;
  color: string;
}

export interface UnitFocus {
  dim: boolean;
  icons: FocusIcon[];
  marker: FocusIcon | null;
}

export const FOCUS_GLYPH = {
  sword: "⚔",
  shield: "⛨",
  buff: "▲",
  debuff: "▼",
  heal: "✚",
  support: "⚚",
  skip: "⊘",
  dot: "⁂",
  dying: "☠",
  artifact: "✦",
  lifesteal: "♥",
  summon: "♙",
  fear: "◉",
} as const;

/** `beat`: the owner's own marker has shown, so the summons' may replace it. */
export interface SummonFocus {
  delta: number;
  crit?: boolean;
  beat: boolean;
}

const NO_SUMMON: SummonFocus = { delta: 0, beat: false };

/** By the side of the unit wearing the icon, not the attacker's. */
export const FOCUS_COLOR: Record<UnitSide, string> = { party: PALETTE.mp, monster: PALETTE.hpLow };

export const MARKER_COLOR = {
  damage: { party: PALETTE.markerDamageParty, monster: PALETTE.markerDamageMonster } as Record<UnitSide, string>,
  heal: { party: PALETTE.markerHealParty, monster: PALETTE.markerHealMonster } as Record<UnitSide, string>,
  miss: PALETTE.dim,
  fearUp: PALETTE.fearUneasy,
  fearDown: PALETTE.markerHealParty,
};

const DIM_FACTOR = 0.55;

export function dimColor(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const grey = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * DIM_FACTOR);
  const h = grey.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

export function dimSprite(sprite: Sprite): Sprite {
  return { rows: sprite.rows, palette: Object.fromEntries(Object.entries(sprite.palette).map(([key, color]) => [key, dimColor(color)])) };
}

/** `delta` is known from the session start, but its marker shows only once `impact` is reached. A non-zero `fearChange` replaces everything else the unit wears. */
export function unitFocus(id: Id, side: UnitSide, session: LogSession | null, delta = 0, impact = false, summon: SummonFocus = NO_SUMMON, fearChange = 0, crit = false): UnitFocus {
  if (!session) return { dim: false, icons: [], marker: null };
  const color = FOCUS_COLOR[side];
  const icon = (glyph: string): FocusIcon => ({ glyph, color });
  if (fearChange !== 0) {
    const marker = fearChange > 0 ? { glyph: `+${formatFear(fearChange)}`, color: MARKER_COLOR.fearUp } : { glyph: formatFear(fearChange), color: MARKER_COLOR.fearDown };
    return { dim: false, icons: [icon(FOCUS_GLYPH.fear)], marker };
  }
  const icons: FocusIcon[] = [];
  const healed = session.healedIds.includes(id);

  if (session.actorId === id) {
    // A debuff every target threw off, or a damage-over-time status every target was immune to, was still an attack.
    const harmed =
      session.attackedIds.length > 0 ||
      session.debuffedIds.length > 0 ||
      session.missedIds.length > 0 ||
      session.dotLandedIds.length > 0 ||
      session.immuneIds.length > 0;
    if (harmed) icons.push(icon(FOCUS_GLYPH.sword));
    if (session.buffedIds.length > 0 || session.healedIds.length > 0) icons.push(icon(FOCUS_GLYPH.support));
  }
  if (session.lifestealIds.includes(id)) icons.push(icon(FOCUS_GLYPH.lifesteal));
  if (session.actorId === null && session.affectedIds.includes(id)) {
    // Which ticks a unit got, not their net: a heal and a poison on one unit show both glyphs.
    if (session.cause === "dot") {
      if (session.tickDamageIds.includes(id)) icons.push(icon(FOCUS_GLYPH.dot));
    } else if (session.cause === "dying") icons.push(icon(FOCUS_GLYPH.dying));
    else if (session.cause === "artifact") icons.push(icon(FOCUS_GLYPH.artifact));
    else if (session.cause === "fear") icons.push(icon(FOCUS_GLYPH.fear));
  }
  const attacked = session.attackedIds.includes(id);
  const debuffLanded = session.debuffLandedIds.includes(id);
  const dotLanded = session.dotLandedIds.includes(id);
  // `debuffedIds` is the aim of a debuff-only skill; beside an attack only a debuff that landed shows.
  const debuffed = (session.debuffedIds.includes(id) && !attacked) || debuffLanded;
  if (attacked) icons.push(icon(FOCUS_GLYPH.shield));
  if (debuffed) icons.push(icon(FOCUS_GLYPH.debuff));
  if (dotLanded) icons.push(icon(FOCUS_GLYPH.dot));
  if (session.buffedIds.includes(id)) icons.push(icon(FOCUS_GLYPH.buff));
  if (session.lostTurnIds.includes(id)) icons.push(icon(FOCUS_GLYPH.skip));
  if (session.buffLostIds.includes(id) && !debuffed) icons.push(icon(FOCUS_GLYPH.debuff));
  if (healed) icons.push(icon(FOCUS_GLYPH.heal));
  // The unit is drawn for its owner: this marks the summon's part.
  if (session.summonIds.includes(id)) icons.push(icon(FOCUS_GLYPH.summon));

  const participates =
    session.actorId === id ||
    attacked ||
    delta !== 0 ||
    summon.delta !== 0 ||
    debuffed ||
    dotLanded ||
    session.immuneIds.includes(id) ||
    session.buffedIds.includes(id) ||
    session.buffLostIds.includes(id) ||
    session.lostTurnIds.includes(id) ||
    healed ||
    session.affectedIds.includes(id);
  return { dim: !participates, icons, marker: impact ? outcomeMarker(id, side, session, delta, summon, crit) : null };
}

function snapshotDeltas(before: CombatantSnapshot[] | null, after: CombatantSnapshot[] | null, read: (c: CombatantSnapshot) => number | undefined): Map<Id, number> {
  const deltas = new Map<Id, number>();
  if (!before || !after) return deltas;
  const was = new Map(before.map((c) => [c.id, read(c)]));
  for (const c of after) {
    const from = was.get(c.id);
    const to = read(c);
    if (from !== undefined && to !== undefined && from !== to) deltas.set(c.id, to - from);
  }
  return deltas;
}

export function hpDeltas(before: CombatantSnapshot[] | null, after: CombatantSnapshot[] | null): Map<Id, number> {
  return snapshotDeltas(before, after, (c) => c.hp);
}

export function fearDeltas(before: CombatantSnapshot[] | null, after: CombatantSnapshot[] | null): Map<Id, number> {
  const deltas = snapshotDeltas(before, after, (c) => (c.isAlive ? c.fear : undefined));
  for (const [id, delta] of deltas) deltas.set(id, roundFear(delta));
  return deltas;
}

export interface MarkerReading {
  amount: number;
  crit: boolean;
}

/** Hits read one at a time at full damage only when, minus overkill, they add up to `net`; otherwise (e.g. a heal in the same session) the net shows. */
export function markerReading(hits: readonly HitMark[] | undefined, net: number, step: number, healCrit = false): MarkerReading {
  if (hits && hits.length > 0 && hits.reduce((sum, hit) => sum + hit.amount - (hit.overkill ?? 0), 0) === -net) {
    const hit = hits[Math.min(step, hits.length - 1)]!;
    return { amount: -hit.amount, crit: hit.crit === true };
  }
  return { amount: net, crit: healCrit || (hits?.some((hit) => hit.crit) ?? false) };
}

function hpMarker(amount: number, side: UnitSide, prefix = "", crit = false): FocusIcon {
  const mark = crit ? "!" : "";
  return amount < 0 ? { glyph: `${prefix}-${-amount}${mark}`, color: MARKER_COLOR.damage[side] } : { glyph: `${prefix}+${amount}${mark}`, color: MARKER_COLOR.heal[side] };
}

/** A summon is drawn as its owner: when both changed, the owner's number shows first and the summon's replaces it on the summon beat. */
function outcomeMarker(id: Id, side: UnitSide, session: LogSession, delta: number, summon: SummonFocus, crit: boolean): FocusIcon | null {
  if (delta !== 0 && summon.delta !== 0 && summon.beat) return hpMarker(summon.delta, side, FOCUS_GLYPH.summon, summon.crit);
  if (delta !== 0) return hpMarker(delta, side, "", crit);
  if (summon.delta !== 0) return hpMarker(summon.delta, side, "", summon.crit);
  if (session.missedIds.includes(id)) return { glyph: t("ui.focusMiss"), color: MARKER_COLOR.miss };
  return session.immuneIds.includes(id) ? { glyph: t("ui.focusImmune"), color: MARKER_COLOR.miss } : null;
}

export interface BattlefieldUnit {
  sprite: Sprite;
  label: string;
  labelColor: string;
  statusText: string;
  statusColor: string;
  /** From `tierFrameHeight`; icons sit one blank row above it. */
  frameHeight: number;
  icons: FocusIcon[];
  marker: FocusIcon | null;
}

export function tierFrameHeight(tier: MonsterTier | "party"): number {
  if (tier === "boss") return MAX_BOSS_HEIGHT;
  if (tier === "elite") return MAX_ELITE_HEIGHT;
  return MAX_UNIT_HEIGHT;
}

export function focusedUnit(unit: Omit<BattlefieldUnit, "icons" | "marker">, focus: UnitFocus): BattlefieldUnit {
  const worn = { icons: focus.icons, marker: focus.marker };
  if (!focus.dim) return { ...unit, ...worn };
  return { ...unit, sprite: dimSprite(unit.sprite), labelColor: dimColor(unit.labelColor), statusColor: dimColor(unit.statusColor), ...worn };
}

/** Icons sit above the tier's tallest sprite, so a tier shares one row; they centre on the sprite itself, not its slot (wide sprites sit off the grid). */
export function buildSideSpriteArea(
  units: Pick<BattlefieldUnit, "sprite" | "icons" | "marker" | "frameHeight">[],
  slotWidth: number,
  gap: number
): TextChunk[][] {
  const height = ICON_BAND_ROWS + MAX_BOSS_HEIGHT;
  const sprites = units.map((u) => u.sprite);
  const rows = compositeSpriteRow(sprites, slotWidth, height, gap);
  const { starts } = spriteSlotLayout(sprites, slotWidth, gap);
  units.forEach((unit, i) => {
    const cells = unit.icons.map((icon) => colorChunk(icon.glyph, icon.color));
    if (unit.marker) {
      if (cells.length > 0) cells.push(plainChunk(" "));
      for (const ch of unit.marker.glyph) cells.push(colorChunk(ch, unit.marker.color));
    }
    if (cells.length === 0) return;
    const row = rows[height - unit.frameHeight - ICON_BAND_ROWS]!;
    const left = starts[i]! + Math.ceil((spriteWidth(unit.sprite) - cells.length) / 2);
    cells.forEach((cell, k) => {
      const x = left + k;
      if (x >= 0 && x < row.length) row[x] = cell;
    });
  });
  return rows;
}

export function blankIconBand(width: number): TextChunk[][] {
  return Array.from({ length: ICON_BAND_ROWS }, () => [plainChunk(" ".repeat(width))]);
}
