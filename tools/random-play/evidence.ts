// Screen evidence: every screen the bot reaches, keyed by screen kind, event and case, written as PNGs
// with a manifest and a gallery README, and compared against another run's manifest for the PR comment.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { TextAttributes } from "@opentui/core";
import { getRoom } from "../../src/engine/dungeon";
import { EVENTS } from "../../src/data/events";
import { t } from "../../src/data/strings";
import type { Game } from "../../src/engine/game";
import type { Id, MonsterTier } from "../../src/types";
import type { UiState } from "../../src/ui/state";
import { parseArgs } from "../dev-save-dump/args";
import type { FrameCapture, GalleryEntry } from "./report";

export interface ScreenKey {
  kind: string;
  event: Id | null;
  screenCase: string | null;
}

/** Which screen this is: its kind, the event room it shows (if any), and the case it is drawn in. */
const TIER_ORDER: MonsterTier[] = ["normal", "elite", "boss"];

export function screenKeyOf(ui: UiState, game: Game): ScreenKey {
  const state = game.state;
  const room = getRoom(state.floor, state.currentRoomId);
  const event = room.type === "event" ? (room.rolledEventId ?? null) : null;
  const combat = state.combat;
  let screenCase: string | null = null;
  if (ui.kind === "combatOver") screenCase = combat?.outcome ?? null;
  else if (ui.kind === "roomReward") screenCase = ui.entries.length > 0 ? "reward" : "empty";
  else if (combat && !combat.outcome) {
    // The fight's tier is its strongest monster's: an elite ambush is an elite fight wherever it happens.
    const ids = new Set(combat.combatants.map((c) => c.ref.id));
    const tiers = game.ctx.monsters.filter((m) => ids.has(m.id)).map((m) => TIER_ORDER.indexOf(m.tier));
    screenCase = TIER_ORDER[Math.max(0, ...tiers)]!;
  }
  return { kind: ui.kind, event, screenCase };
}

export const screenLabel = (k: ScreenKey) => [k.kind, k.event, k.screenCase].filter(Boolean).join(" · ");
export const screenFile = (k: ScreenKey, size: string) => `${[k.kind, k.event, k.screenCase].filter(Boolean).join("--")}@${size}.png`;

const CELL_W = 8;
const CELL_H = 16;
const FONT_SIZE = 13;
const BASELINE = 12;
const FONT_FAMILY = "DejaVu Sans Mono, Menlo, monospace";
/** Block glyphs are drawn as rectangles, so sprites come out solid whatever the font. */
const BLOCKS: Record<string, [number, number]> = { "█": [0, 1], "▀": [0, 0.5], "▄": [0.5, 1] };

type Rgba = [number, number, number, number];
const fill = ([r, g, b, a]: Rgba) => `fill="rgb(${r},${g},${b})"${a < 255 ? ` fill-opacity="${(a / 255).toFixed(2)}"` : ""}`;
const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function frameToSvg(frame: FrameCapture): string {
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.cols * CELL_W}" height="${frame.rows * CELL_H}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">`,
    `<rect width="100%" height="100%" fill="rgb(0,0,0)"/>`,
  ];
  frame.lines.forEach((line, row) => {
    const y = row * CELL_H;
    let col = 0;
    for (const span of line) {
      const chars = Array.from(span.text);
      const x = col * CELL_W;
      if (span.bg[3] > 0) out.push(`<rect x="${x}" y="${y}" width="${chars.length * CELL_W}" height="${CELL_H}" ${fill(span.bg)}/>`);
      chars.forEach((ch, i) => {
        const block = BLOCKS[ch];
        if (block) out.push(`<rect x="${x + i * CELL_W}" y="${y + block[0] * CELL_H}" width="${CELL_W}" height="${(block[1] - block[0]) * CELL_H}" ${fill(span.fg)}/>`);
      });
      const text = chars.map((ch) => (BLOCKS[ch] ? " " : ch)).join("");
      if (text.trim().length > 0) {
        const style = [
          span.attributes & TextAttributes.BOLD ? ` font-weight="bold"` : "",
          span.attributes & TextAttributes.DIM ? ` opacity="0.6"` : "",
          span.attributes & TextAttributes.UNDERLINE ? ` text-decoration="underline"` : "",
        ].join("");
        // One run per span, stretched to its cells, so a font whose advance is not exactly one cell still lines up.
        out.push(`<text x="${x}" y="${y + BASELINE}" textLength="${chars.length * CELL_W}" lengthAdjust="spacingAndGlyphs" xml:space="preserve" ${fill(span.fg)}${style}>${escapeXml(text)}</text>`);
      }
      col += chars.length;
    }
  });
  out.push("</svg>");
  return out.join("\n");
}

/**
 * One monospace .ttf, so resvg neither scans every system font nor parses a large font collection on each
 * render; the CI runner has DejaVu.
 */
const FONT_FILES = ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/System/Library/Fonts/Supplemental/Andale Mono.ttf", "C:\\Windows\\Fonts\\consola.ttf"];
const fontFile = FONT_FILES.find((path) => existsSync(path));

export function frameToPng(frame: FrameCapture): Buffer {
  const font = fontFile ? { fontFiles: [fontFile], loadSystemFonts: false } : { loadSystemFonts: true };
  return new Resvg(frameToSvg(frame), { font: { ...font, defaultFontFamily: "DejaVu Sans Mono" } }).render().asPng();
}

const frameHash = (frame: FrameCapture) => createHash("sha1").update(JSON.stringify(frame.lines)).digest("hex");

export interface ManifestEntry extends ScreenKey {
  label: string;
  size: string;
  file: string;
  hash: string;
}

export interface Manifest {
  /** Failures the evidence runs found, so the comment can say so. */
  failures: number;
  screens: ManifestEntry[];
}

const entryKey = (e: ManifestEntry) => `${e.label}@${e.size}`;

const galleryLabel = (g: GalleryEntry) => screenLabel({ kind: g.uiKind, event: g.event, screenCase: g.screenCase });
/** Lower is plainer: outside an event room first, then a normal fight or no case at all. */
const plainness = (g: GalleryEntry) => (g.event === null ? 0 : 2) + (g.screenCase === null || g.screenCase === "normal" ? 0 : 1);
const textLines = (g: GalleryEntry) => g.content.split("\n").filter((line) => /[^\s│─┌┐└┘]/.test(line)).length;

/**
 * One screen per distinct content: screens of a kind whose main panel and footer read the same at every
 * size keep only their plainest one. The run log is kept once, from a cleared room, with the most lines.
 */
export function pickEvidence(gallery: GalleryEntry[]): GalleryEntry[] {
  const byLabel = new Map<string, GalleryEntry[]>();
  for (const g of gallery) byLabel.set(galleryLabel(g), [...(byLabel.get(galleryLabel(g)) ?? []), g]);
  const groups = new Map<string, GalleryEntry[][]>();
  for (const shots of byLabel.values()) {
    const first = shots[0]!;
    if (first.uiKind === "fullLog" && !shots.every((s) => s.roomCleared && !s.content.includes(t("ui.fullLogEmpty")))) continue;
    const signature = first.uiKind === "fullLog" ? "fullLog" : JSON.stringify([first.uiKind, ...shots.map((s) => [s.size, s.content]).sort()]);
    groups.set(signature, [...(groups.get(signature) ?? []), shots]);
  }
  const lines = (shots: GalleryEntry[]) => shots.reduce((sum, s) => sum + textLines(s), 0);
  const kept = new Set(
    [...groups.values()].map(
      (labels) =>
        labels.sort((a, b) => lines(b) - lines(a) || plainness(a[0]!) - plainness(b[0]!) || galleryLabel(a[0]!).localeCompare(galleryLabel(b[0]!)))[0]!
    )
  );
  return gallery.filter((g) => kept.has(byLabel.get(galleryLabel(g))!));
}

/** Writes `screens/*.png`, `manifest.json` and a gallery `README.md` into `dir`, one per screen `pickEvidence` keeps. */
export function writeEvidence(dir: string, all: GalleryEntry[], failures: number): Manifest {
  mkdirSync(join(dir, "screens"), { recursive: true });
  const gallery = pickEvidence(all);
  const screens = gallery
    .map((g): ManifestEntry => {
      const key = { kind: g.uiKind, event: g.event, screenCase: g.screenCase };
      return { ...key, label: screenLabel(key), size: g.size, file: `screens/${screenFile(key, g.size)}`, hash: frameHash(g.frame) };
    })
    .sort((a, b) => a.label.localeCompare(b.label) || b.size.localeCompare(a.size));
  for (const g of gallery) {
    writeFileSync(join(dir, "screens", screenFile({ kind: g.uiKind, event: g.event, screenCase: g.screenCase }, g.size)), frameToPng(g.frame));
  }
  const manifest: Manifest = { failures, screens };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, "README.md"), galleryReadme(manifest));
  return manifest;
}

export function galleryReadme(manifest: Manifest): string {
  const out = ["# Random-play screen evidence", "", `${manifest.screens.length} screens, each at every size it was captured at.`];
  for (const kind of [...new Set(manifest.screens.map((s) => s.kind))].sort()) {
    out.push("", `## ${kind}`);
    const ofKind = manifest.screens.filter((s) => s.kind === kind);
    for (const label of [...new Set(ofKind.map((s) => s.label))]) {
      out.push("", `### ${label}`, "", ...ofKind.filter((s) => s.label === label).map((s) => `![${label} @ ${s.size}](${s.file})`));
    }
  }
  return `${out.join("\n")}\n`;
}

export interface ManifestChanges {
  added: ManifestEntry[];
  removed: ManifestEntry[];
  changed: ManifestEntry[];
}

export function compareManifests(head: Manifest, base: Manifest): ManifestChanges {
  const before = new Map(base.screens.map((s) => [entryKey(s), s]));
  const now = new Map(head.screens.map((s) => [entryKey(s), s]));
  return {
    added: head.screens.filter((s) => !before.has(entryKey(s))),
    removed: base.screens.filter((s) => !now.has(entryKey(s))),
    changed: head.screens.filter((s) => before.has(entryKey(s)) && before.get(entryKey(s))!.hash !== s.hash),
  };
}

/** Changed screens shown as images in the comment; the rest are links, to stay inside GitHub's comment size. */
export const MAX_INLINE_IMAGES = 30;
export const EVIDENCE_MARKER = "<!-- random-play-evidence -->";
/** Events a run can roll into a room; a scripted scene only shows on its own floor. */
export const ROOM_EVENT_IDS = EVENTS.filter((e) => e.kind !== "scripted").map((e) => e.id);

export interface CommentInput {
  head: Manifest;
  base: Manifest | null;
  baseLabel: string;
  /** Where `screens/…` resolves: the evidence commit's raw URL. */
  imageBase: string;
  galleryUrl: string;
}

export function evidenceComment(input: CommentInput): string {
  const { head, base, imageBase, galleryUrl } = input;
  const link = (s: ManifestEntry) => `[${s.label} @ ${s.size}](${imageBase}/${s.file})`;
  const keys = new Set(head.screens.map((s) => s.label));
  const uncovered = ROOM_EVENT_IDS.filter((id) => !head.screens.some((s) => s.event === id));
  const out = [
    EVIDENCE_MARKER,
    "## Screen evidence",
    "",
    `**${head.screens.length} screens** (${keys.size} screens × the sizes each was captured at) · ${head.failures} failures · [full gallery](${galleryUrl})`,
    "",
    uncovered.length === 0 ? "Every room event has a screen." : `Room events with no screen: ${uncovered.join(", ")}.`,
  ];
  if (!base) {
    out.push("", "The base branch has no `random-play --evidence`, so there is nothing to compare against.");
    return `${out.join("\n")}\n`;
  }
  const { added, removed, changed } = compareManifests(head, base);
  out.push("", `### Against base ${input.baseLabel}`, "", `${added.length} new · ${removed.length} gone · ${changed.length} changed`);
  if (added.length > 0) out.push("", `**New:** ${added.map(link).join(", ")}`);
  if (removed.length > 0) out.push("", `**Gone:** ${removed.map((s) => `${s.label} @ ${s.size}`).join(", ")}`);
  if (changed.length > 0) {
    out.push("", "**Changed:**");
    for (const s of changed.slice(0, MAX_INLINE_IMAGES)) out.push("", `${s.label} @ ${s.size}`, "", `![${s.label} @ ${s.size}](${imageBase}/${s.file})`);
    const rest = changed.slice(MAX_INLINE_IMAGES);
    if (rest.length > 0) out.push("", `${rest.length} more: ${rest.map(link).join(", ")}`);
    out.push("", "A change that sends the bot down another path changes the screens after it too, so read the first ones first.");
  }
  return `${out.join("\n")}\n`;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.head || !args.out || !args["image-base"] || !args.gallery) {
    throw new Error("usage: --head DIR [--base DIR] [--base-label X] --image-base URL --gallery URL --out comment.md");
  }
  const read = (dir: string): Manifest => JSON.parse(readFileSync(join(resolve(dir), "manifest.json"), "utf8"));
  const base = args.base && existsSync(join(resolve(args.base), "manifest.json")) ? read(args.base) : null;
  writeFileSync(
    resolve(args.out),
    evidenceComment({
      head: read(args.head),
      base,
      baseLabel: args["base-label"] ?? "",
      imageBase: args["image-base"],
      galleryUrl: args.gallery,
    })
  );
}
