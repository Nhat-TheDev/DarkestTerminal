import { RGBA, type TextChunk } from "@opentui/core";
import type { Id } from "../types";
import { COMBAT_FX, type CombatFxConfig } from "../data/combatFx";
import type { AttackFrame } from "./revealQueue";
import { BATTLEFIELD_CONTENT_WIDTH, ICON_BAND_ROWS, SLOT_GAP, SLOT_WIDTH } from "./layout";
import { MAX_BOSS_HEIGHT, spriteHeight, spriteSlotLayout, spriteWidth, type Sprite } from "./sprites";

export interface CombatFxAnchor {
  x: number;
  y: number;
  sprite: Sprite;
  side: "party" | "monster";
}

export function sideCombatFxAnchors(units: { id: Id; sprite: Sprite }[], side: CombatFxAnchor["side"], left = 0): Map<Id, CombatFxAnchor> {
  const { starts } = spriteSlotLayout(units.map((u) => u.sprite), SLOT_WIDTH, SLOT_GAP);
  return new Map(units.map((unit, i) => [unit.id, { x: left + starts[i]!, y: ICON_BAND_ROWS + MAX_BOSS_HEIGHT - spriteHeight(unit.sprite), sprite: unit.sprite, side }]));
}

export function paintCombatFx(content: TextChunk[][], anchors: ReadonlyMap<Id, CombatFxAnchor>, frames: readonly AttackFrame[], offsetX = 0, config: CombatFxConfig = COMBAT_FX): TextChunk[][] {
  if (frames.length === 0) return content;
  const rows = [...content];
  const expanded = new Set<number>();
  const paint = (x: number, y: number, color: string): void => {
    x = Math.round(x) + offsetX;
    y = Math.round(y);
    if (x < offsetX || x >= offsetX + BATTLEFIELD_CONTENT_WIDTH || y < ICON_BAND_ROWS || y >= ICON_BAND_ROWS + MAX_BOSS_HEIGHT || !rows[y]) return;
    if (!expanded.has(y)) {
      rows[y] = rows[y]!.flatMap((chunk) => Array.from(chunk.text, (text) => ({ ...chunk, text })));
      expanded.add(y);
    }
    const cell = rows[y]![x];
    if (cell) rows[y]![x] = { ...cell, text: " ", bg: RGBA.fromHex(color) };
  };
  for (const { hit, progress, impactAge } of frames) {
    const target = anchors.get(hit.targetId);
    if (!target) continue;
    if (impactAge >= 0) {
      const frame = config.flash.frames[impactAge];
      if (!frame || hit.amount <= (hit.overkill ?? 0)) continue;
      const color = target.side === "party" ? frame.partyColor : frame.monsterColor;
      if (color === null) continue;
      target.sprite.rows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch !== ".") paint(target.x + x, target.y + y, color);
      }));
      continue;
    }
    const source = hit.sourceId ? anchors.get(hit.sourceId) : undefined;
    if (!source || !hit.visual) continue;
    const x = target.x + Math.floor(spriteWidth(target.sprite) / 2);
    const y = target.y + Math.floor(spriteHeight(target.sprite) / 2);
    const sourceX = source.x + Math.floor(spriteWidth(source.sprite) / 2);
    const sign = Math.sign(x - sourceX) || (source.side === "party" ? 1 : -1);
    const p = Math.max(0, Math.min(1, progress));
    const animation = config.presets[hit.visual];
    const frame = animation.frames[Math.round(p * (animation.frames.length - 1))]!;
    frame.rows.forEach((row, dy) => [...row].forEach((key, dx) => {
      if (key !== ".") paint(x + sign * (frame.offsetX + dx), y + frame.offsetY + dy, animation.palette[key]!);
    }));
  }
  return rows;
}
