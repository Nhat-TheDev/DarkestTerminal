import type { TextChunk } from "@opentui/core";
import type { CombatantSnapshot, Id, LogSession, MonsterTier } from "../types";
import { ICON_BAND_ROWS } from "./layout";
import { MAX_BOSS_HEIGHT, MAX_ELITE_HEIGHT, MAX_UNIT_HEIGHT, compositeSpriteRow, spriteSlotLayout, spriteWidth, type Sprite } from "./sprites";
import { t } from "../data/strings";
import { PALETTE, colorChunk, plainChunk } from "./theme";

export type UnitSide = "party" | "monster";

export interface FocusIcon {
  glyph: string;
  color: string;
}

export interface UnitFocus {
  dim: boolean;
  icons: FocusIcon[];
  /** The session's outcome for the unit once it lands: "-12", "+8" or "miss", written after the icons. */
  marker: FocusIcon | null;
}

export const FOCUS_GLYPH = {
  sword: "⚔",
  shield: "⛨",
  buff: "▲",
  debuff: "▼",
  heal: "✚",
  support: "⚚",
  dot: "☣",
  dying: "☠",
  artifact: "✦",
  lifesteal: "♥",
} as const;

/** Blue is the player's side, red the enemy's — by the side of the unit wearing the icon, whoever attacks. */
export const FOCUS_COLOR: Record<UnitSide, string> = { party: PALETTE.mp, monster: PALETTE.hpLow };

/** Damage reads white on a monster and red on a character; heal is green, lighter on a character, deeper on a monster. */
export const MARKER_COLOR = {
  damage: { party: PALETTE.markerDamageParty, monster: PALETTE.markerDamageMonster } as Record<UnitSide, string>,
  heal: { party: PALETTE.markerHealParty, monster: PALETTE.markerHealMonster } as Record<UnitSide, string>,
  miss: PALETTE.dim,
};

/** Share of the original brightness a bystander keeps. */
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

/**
 * Who is lit and what each lit unit wears in `session`. With no session everyone is shown normally.
 * `delta` is the unit's HP change over the session (known from its start, so a DoT tick can pick its
 * icon at once); the marker that prints it appears only once `impact` is reached.
 */
export function unitFocus(id: Id, side: UnitSide, session: LogSession | null, delta = 0, impact = false): UnitFocus {
  if (!session) return { dim: false, icons: [], marker: null };
  const color = FOCUS_COLOR[side];
  const icon = (glyph: string): FocusIcon => ({ glyph, color });
  const icons: FocusIcon[] = [];
  const healed = session.healedIds.includes(id);

  if (session.actorId === id) {
    if (session.attackedIds.length > 0 || session.debuffedIds.length > 0) icons.push(icon(FOCUS_GLYPH.sword));
    if (session.buffedIds.length > 0 || session.healedIds.length > 0) icons.push(icon(FOCUS_GLYPH.support));
  }
  if (session.lifestealIds.includes(id)) icons.push(icon(FOCUS_GLYPH.lifesteal));
  if (session.actorId === null && session.affectedIds.includes(id)) {
    // Which ticks a unit got, not their net: a heal and a poison on one unit show both glyphs (the heal glyph comes from `healedIds` below).
    if (session.cause === "dot") {
      if (session.tickDamageIds.includes(id)) icons.push(icon(FOCUS_GLYPH.dot));
    } else if (session.cause === "dying") icons.push(icon(FOCUS_GLYPH.dying));
    else if (session.cause === "artifact") icons.push(icon(FOCUS_GLYPH.artifact));
  }
  const attacked = session.attackedIds.includes(id);
  if (attacked) icons.push(icon(FOCUS_GLYPH.shield));
  else if (session.debuffedIds.includes(id)) icons.push(icon(FOCUS_GLYPH.debuff));
  if (session.buffedIds.includes(id)) icons.push(icon(FOCUS_GLYPH.buff));
  if (healed) icons.push(icon(FOCUS_GLYPH.heal));

  const participates =
    session.actorId === id ||
    attacked ||
    delta !== 0 ||
    session.debuffedIds.includes(id) ||
    session.buffedIds.includes(id) ||
    healed ||
    session.affectedIds.includes(id);
  return { dim: !participates, icons, marker: impact ? outcomeMarker(id, side, session, delta) : null };
}

/** Each unit's HP change from `before` (what the screen shows) to `after` (where a session ends). */
export function hpDeltas(before: CombatantSnapshot[] | null, after: CombatantSnapshot[] | null): Map<Id, number> {
  const deltas = new Map<Id, number>();
  if (!before || !after) return deltas;
  const hpBefore = new Map(before.map((c) => [c.id, c.hp]));
  for (const c of after) {
    const was = hpBefore.get(c.id);
    if (was !== undefined && was !== c.hp) deltas.set(c.id, c.hp - was);
  }
  return deltas;
}

function outcomeMarker(id: Id, side: UnitSide, session: LogSession, delta: number): FocusIcon | null {
  if (delta < 0) return { glyph: `-${-delta}`, color: MARKER_COLOR.damage[side] };
  if (delta > 0) return { glyph: `+${delta}`, color: MARKER_COLOR.heal[side] };
  return session.missedIds.includes(id) ? { glyph: t("ui.focusMiss"), color: MARKER_COLOR.miss } : null;
}

export interface BattlefieldUnit {
  sprite: Sprite;
  label: string;
  labelColor: string;
  statusText: string;
  statusColor: string;
  /** Tallest sprite the unit's tier allows (`tierFrameHeight`): its icons sit one blank row above it. */
  frameHeight: number;
  icons: FocusIcon[];
  marker: FocusIcon | null;
}

/** The tallest sprite a tier may draw: characters and normal monsters share one height. */
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

/**
 * A side's sprites, bottom-aligned in `ICON_BAND_ROWS + MAX_BOSS_HEIGHT` rows, with each unit's icons
 * (then a space and its marker, e.g. `⛨ -12`) one blank row above the tallest sprite of its tier — so
 * every unit of a tier wears them on the same row, and a boss uses the whole band. The whole label is
 * centred over the middle of the unit's own sprite, not its nominal slot (a wide sprite or a boss sits
 * off the slot grid).
 */
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
    const centre = starts[i]! + Math.floor(spriteWidth(unit.sprite) / 2);
    const left = centre - Math.floor((cells.length - 1) / 2);
    cells.forEach((cell, k) => {
      const x = left + k;
      if (x >= 0 && x < row.length) row[x] = cell;
    });
  });
  return rows;
}

/** The same band for a block that has no units (campfire, chest, event, empty room). */
export function blankIconBand(width: number): TextChunk[][] {
  return Array.from({ length: ICON_BAND_ROWS }, () => [plainChunk(" ".repeat(width))]);
}
