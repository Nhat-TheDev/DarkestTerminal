import { RGBA, type TextChunk } from "@opentui/core";
import type { CombatEffectCue, Id } from "../types";
import { COMBAT_FX, type CombatFxConfig } from "../data/combatFx";
import type { AttackFrame, SupportFrame } from "./revealQueue";
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

export function paintCombatFx(content: TextChunk[][], anchors: ReadonlyMap<Id, CombatFxAnchor>, frames: readonly AttackFrame[], offsetX = 0, config: CombatFxConfig = COMBAT_FX, supportFrames: readonly SupportFrame[] = []): TextChunk[][] {
  if (frames.length === 0 && supportFrames.length === 0) return content;
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
  const draw = (cue: CombatEffectCue, progress: number, support = false): void => {
    const target = anchors.get(cue.targetId), animation = config.presets[cue.visual];
    if (!target || !animation) return;
    const source = cue.sourceId ? anchors.get(cue.sourceId) : undefined;
    const tx = target.x + Math.floor(spriteWidth(target.sprite) / 2);
    const ty = target.y + Math.floor(spriteHeight(target.sprite) / 2);
    const sx = source ? source.x + Math.floor(spriteWidth(source.sprite) / 2) : tx;
    const sy = source ? source.y + Math.floor(spriteHeight(source.sprite) / 2) : ty;
    const sign = support ? 1 : Math.sign(tx - sx) || (source?.side === "monster" ? -1 : 1);
    const p = Math.max(0, Math.min(1, progress));
    const frame = animation.frames[Math.round(p * (animation.frames.length - 1))]!;
    if (animation.placement === "beam") {
      const distance = Math.abs(tx - sx);
      for (let step = 0; step <= distance; step++) {
        const fraction = distance === 0 ? 0 : step / distance;
        const column = step % frame.rows[0]!.length;
        frame.rows.forEach((row, dy) => {
          const key = row[column]!;
          if (key !== ".") paint(sx + sign * (step + frame.offsetX), sy + (ty - sy) * fraction + frame.offsetY + dy, animation.palette[key]!);
        });
      }
      return;
    }
    const moving = animation.placement === "projectile";
    const x = moving ? sx + (tx - sx) * p : tx;
    const y = moving ? sy + (ty - sy) * p : ty;
    frame.rows.forEach((row, dy) => [...row].forEach((key, dx) => {
      if (key !== ".") paint(x + sign * (frame.offsetX + dx), y + frame.offsetY + dy, animation.palette[key]!);
    }));
  };
  for (const { hit, progress, impactAge } of frames) {
    const target = anchors.get(hit.targetId);
    if (!target) continue;
    if (impactAge >= 0) {
      const frame = config.flash.frames[impactAge];
      if (frame && hit.amount > (hit.overkill ?? 0)) {
        const color = target.side === "party" ? frame.partyColor : frame.monsterColor;
        if (color !== null) target.sprite.rows.forEach((row, y) => [...row].forEach((ch, x) => {
          if (ch !== ".") paint(target.x + x, target.y + y, color);
        }));
      }
    }
    if (!hit.visual || !hit.sourceId || !anchors.has(hit.sourceId)) continue;
    const animation = config.presets[hit.visual];
    if (!animation) continue;
    if (animation.phase === "impact") {
      const ticks = animation.ticks ?? animation.frames.length;
      if (impactAge >= 0 && impactAge < ticks) draw({ ...hit, visual: hit.visual }, ticks === 1 ? 0 : impactAge / (ticks - 1));
    } else if (impactAge < 0) draw({ ...hit, visual: hit.visual }, progress);
  }
  for (const { effect, age } of supportFrames) {
    const animation = config.presets[effect.visual];
    if (!animation) continue;
    const ticks = animation.ticks ?? animation.frames.length;
    if (age >= 0 && age < ticks) draw(effect, ticks === 1 ? 0 : age / (ticks - 1), true);
  }
  return rows;
}
