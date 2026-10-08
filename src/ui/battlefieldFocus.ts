import type { TextChunk } from "@opentui/core";
import type { Id, LogSession } from "../types";
import { ICON_BAND_ROWS } from "./layout";
import { spriteSlotLayout, spriteWidth, type Sprite } from "./sprites";
import { colorChunk, plainChunk } from "./theme";

export type UnitSide = "party" | "monster";

export interface FocusIcon {
  glyph: string;
  color: string;
}

export interface UnitFocus {
  dim: boolean;
  icons: FocusIcon[];
}

export const FOCUS_GLYPH = { sword: "⚔", shield: "⛨", buff: "▲", debuff: "▼", heal: "✚", support: "⚚" } as const;

/** Blue is the player's side, red the enemy's — by the side of the unit wearing the icon, whoever attacks. */
export const FOCUS_COLOR: Record<UnitSide, string> = { party: "#5b8fc9", monster: "#c0392b" };

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

/** Who is lit and what each lit unit wears in `session`. With no session everyone is shown normally. */
export function unitFocus(id: Id, side: UnitSide, session: LogSession | null): UnitFocus {
  if (!session) return { dim: false, icons: [] };
  const color = FOCUS_COLOR[side];
  const icon = (glyph: string): FocusIcon => ({ glyph, color });
  const icons: FocusIcon[] = [];

  if (session.actorId === id) {
    if (session.attackedIds.length > 0 || session.debuffedIds.length > 0) icons.push(icon(FOCUS_GLYPH.sword));
    if (session.buffedIds.length > 0 || session.healedIds.length > 0) icons.push(icon(FOCUS_GLYPH.support));
  }
  const attacked = session.attackedIds.includes(id);
  if (attacked) icons.push(icon(FOCUS_GLYPH.shield));
  else if (session.debuffedIds.includes(id)) icons.push(icon(FOCUS_GLYPH.debuff));
  if (session.buffedIds.includes(id)) icons.push(icon(FOCUS_GLYPH.buff));
  if (session.healedIds.includes(id)) icons.push(icon(FOCUS_GLYPH.heal));

  const participates =
    session.actorId === id ||
    attacked ||
    session.debuffedIds.includes(id) ||
    session.buffedIds.includes(id) ||
    session.healedIds.includes(id) ||
    session.affectedIds.includes(id);
  return { dim: !participates, icons };
}

export interface BattlefieldUnit {
  sprite: Sprite;
  label: string;
  labelColor: string;
  statusText: string;
  statusColor: string;
  icons: FocusIcon[];
}

export function focusedUnit(unit: Omit<BattlefieldUnit, "icons">, focus: UnitFocus): BattlefieldUnit {
  if (!focus.dim) return { ...unit, icons: focus.icons };
  return { ...unit, sprite: dimSprite(unit.sprite), labelColor: dimColor(unit.labelColor), statusColor: dimColor(unit.statusColor), icons: focus.icons };
}

/**
 * The `ICON_BAND_ROWS` rows above a side's sprites: each unit's icons centred over the middle of its
 * own sprite (not its nominal slot — a wide sprite or a boss sits off the slot grid), the rest blank.
 * As wide as the sprite canvas, so it lines up with the sprite rows below it.
 */
export function buildSideIconBand(icons: FocusIcon[][], sprites: Sprite[], slotWidth: number, gap: number): TextChunk[][] {
  const { starts, canvasWidth } = spriteSlotLayout(sprites, slotWidth, gap);
  const cells: (FocusIcon | null)[] = new Array(canvasWidth).fill(null);
  icons.forEach((unitIcons, i) => {
    const centre = starts[i]! + Math.floor(spriteWidth(sprites[i]!) / 2);
    const left = centre - Math.floor((unitIcons.length - 1) / 2);
    unitIcons.forEach((icon, k) => {
      const x = left + k;
      if (x >= 0 && x < canvasWidth) cells[x] = icon;
    });
  });
  const iconRow = cells.map((cell) => (cell ? colorChunk(cell.glyph, cell.color) : plainChunk(" ")));
  return [iconRow, ...Array.from({ length: ICON_BAND_ROWS - 1 }, () => [plainChunk(" ".repeat(canvasWidth))])];
}

/** The same band for a block that has no units (campfire, chest, event, empty room). */
export function blankIconBand(width: number): TextChunk[][] {
  return Array.from({ length: ICON_BAND_ROWS }, () => [plainChunk(" ".repeat(width))]);
}
