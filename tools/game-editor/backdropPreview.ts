import type { TextChunk } from "@opentui/core";
import type { MonsterTier } from "../../src/types";
import { resolveScene, type BackdropsFile } from "../../src/data/backdrops";
import { getClass } from "../../src/data/classes";
import { t } from "../../src/data/strings";
import { composeBattlefield, paintBackdrop } from "../../src/ui/backdrop";
import { mergeBlocksHorizontally, centerText, monsterStyle, BATTLEFIELD_CONTENT_WIDTH, ICON_BAND_ROWS, SLOT_GAP, SLOT_WIDTH, torchDividerBlock } from "../../src/ui/layout";
import { compositeSpriteRow, spriteForClass, spriteForMonster, MAX_BOSS_HEIGHT, TORCH_SPRITES, type Sprite } from "../../src/ui/sprites";
import { colorChunk, hpColorFor, plainChunk, PALETTE } from "../../src/ui/theme";

export interface PreviewCell {
  bg: string | null;
  fg: string | null;
  ch: string;
}

export interface PreviewOptions {
  dimmed: boolean;
  /** Forces the unit shadow on or off; left out, the scene's own `render.unitShadow` decides, as in the game. */
  shadow?: boolean;
  party: string[];
  monsters: { id: string; tier: MonsterTier }[];
}

interface Unit {
  sprite: Sprite;
  label: string;
  color: string;
}

const SAMPLE_HP = "40/40";

function sideBlock(units: Unit[]): TextChunk[][] {
  const sprites = compositeSpriteRow(units.map((u) => u.sprite), SLOT_WIDTH, ICON_BAND_ROWS + MAX_BOSS_HEIGHT, SLOT_GAP);
  const meta = mergeBlocksHorizontally(
    units.map((u) => [
      [plainChunk(" ".repeat(SLOT_WIDTH))],
      [colorChunk(centerText(u.label, SLOT_WIDTH), u.color)],
      [colorChunk(centerText(SAMPLE_HP, SLOT_WIDTH), hpColorFor(40, 40))],
    ]),
    SLOT_GAP,
  );
  return [...sprites, ...meta];
}

function hex(c: { toInts(): number[] } | undefined): string | null {
  if (!c) return null;
  const [r, g, b] = c.toInts();
  return "#" + [r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("");
}

export function previewScene(file: BackdropsFile, sceneId: string, opts: PreviewOptions): PreviewCell[][] {
  const scene = resolveScene(file, sceneId);
  const party: Unit[] = opts.party.map((id) => {
    const style = getClass(id).style;
    return { sprite: spriteForClass(id), label: style.abbr, color: style.color };
  });
  const monsters: Unit[] = opts.monsters.map((m) => {
    const style = monsterStyle({ tier: m.tier, archetypeId: m.id } as Parameters<typeof monsterStyle>[0]);
    return { sprite: spriteForMonster(m.id, m.tier), label: style.abbr, color: style.color };
  });

  const content = mergeBlocksHorizontally([sideBlock(party), torchDividerBlock(TORCH_SPRITES["full"]!), sideBlock(monsters)], SLOT_GAP);
  const backdrop = paintBackdrop(scene, BATTLEFIELD_CONTENT_WIDTH, 0, opts.dimmed);
  const shadow = opts.shadow === undefined ? scene.render.unitShadow : { ...scene.render.unitShadow, enabled: opts.shadow };
  const rows = composeBattlefield(content, backdrop, BATTLEFIELD_CONTENT_WIDTH, 0, shadow);

  return rows.map((row) =>
    row.flatMap((chunk) => Array.from(chunk.text, (ch) => ({ bg: hex(chunk.bg), fg: hex(chunk.fg), ch }))),
  );
}
