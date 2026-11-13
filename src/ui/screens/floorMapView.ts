import type { StyledText, TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { RoomType } from "../../types";
import { FloorGraph, type Span } from "../../engine/floorGraph";
import { getRoom } from "../../engine/dungeon";
import { t } from "../../data/strings";
import { PALETTE, colorChunk, joinLines } from "../theme";

const TYPE_LABEL: Record<RoomType, string> = {
  combat: t("ui.floorMapLegendFight"),
  event: t("ui.floorMapLegendEvent"),
  rest: t("ui.floorMapLegendRest"),
  boss: t("ui.floorMapLegendGuard"),
  temple: t("ui.floorMapLegendTemple"),
};

const spanText = (span: Span): string => (span.min === span.max ? String(span.min) : `${span.min}-${span.max}`);

/** Beside the map on the Battlefield: where the party stands, what lies behind and the spread of what lies ahead. */
export function renderMain(game: Game): StyledText {
  const s = game.state;
  const here = getRoom(s.floor, s.currentRoomId);
  const lines: TextChunk[][] = [];
  const type = TYPE_LABEL[here.type];
  lines.push([colorChunk(here.cleared ? t("ui.floorMapHereCleared", { room: here.name, type }) : t("ui.floorMapHere", { room: here.name, type }), PALETTE.title)]);
  lines.push([colorChunk(t("ui.floorMapBehind", { count: Math.max(0, s.roomPath.length - 1) }), PALETTE.text)]);

  if (here.connectedRoomIds.length === 0) {
    lines.push([colorChunk(t("ui.floorMapAtGuard"), PALETTE.dim)]);
    return joinLines(lines);
  }
  const graph = new FloorGraph(
    // A hidden room counts as a fight, so the spread never gives away what it holds.
    s.floor.rooms.map((r) => ({ id: r.id, type: r.hidden ? "combat" : r.type, next: r.connectedRoomIds })),
    s.floor.entryRoomId
  );
  const nexts = here.connectedRoomIds.map((id) => graph.routeBounds(id));
  const merged = (key: "rooms" | "rest" | "event"): Span => ({ min: Math.min(...nexts.map((b) => b[key].min)), max: Math.max(...nexts.map((b) => b[key].max)) });
  lines.push([colorChunk(t("ui.floorMapAhead", { rooms: spanText(merged("rooms")), rests: spanText(merged("rest")), events: spanText(merged("event")) }), PALETTE.text)]);
  lines.push([]);
  lines.push([colorChunk(t("ui.floorMapExitsLabel"), PALETTE.text)]);
  for (const id of here.connectedRoomIds) {
    const room = getRoom(s.floor, id);
    lines.push([colorChunk(room.hidden ? t("ui.floorMapExitUnknown") : t("ui.floorMapExit", { room: room.name, type: TYPE_LABEL[room.type] }), PALETTE.dim)]);
  }
  return joinLines(lines);
}

export function renderFooter(): string {
  return t("ui.footerBackOnly");
}
