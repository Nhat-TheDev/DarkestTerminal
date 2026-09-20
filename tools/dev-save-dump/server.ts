/**
 * Dev-only save generator, web UI — pick a level/floor/room/party (class + ability + artifacts
 * per member) in the browser instead of passing CLI flags, so testing high floors doesn't require
 * actually playing there first. Refuses to run outside dev mode (never true for a released binary
 * — see src/engine/devMode.ts), and the save it writes is itself unloadable outside dev mode
 * (src/engine/save.ts's `isDevDumpAllowed`), so this can't leak a shortcut into a published build
 * even if the file is copied out and shared.
 *
 * Usage:
 *   bun run tools/dev-save-dump/server.ts
 *   (then open http://localhost:4592)
 */
import { readFile } from "fs/promises";
import path from "path";
import { DEV_MODE } from "../../src/engine/devMode";
import { Game } from "../../src/engine/game";
import { getClass } from "../../src/data/classes";
import { ABILITIES, getAbility, formatAbilityEffect } from "../../src/data/abilities";
import { ARTIFACTS, getArtifact, formatArtifactEffect } from "../../src/data/artifacts";
import { getItem } from "../../src/data/items";
import { getEvent } from "../../src/data/events";
import { recomputeAllPartyStats, MAX_EQUIPPED_ARTIFACTS } from "../../src/engine/party";
import { writeDevDumpSave, loadSave, firstFreeSlotId } from "../../src/engine/save";
import { SAVE_DIR } from "../../src/engine/paths";
import { BALANCE } from "../../src/data/balanceConfig";
import type { GameState, Id } from "../../src/types";
import { ROOM_TYPES } from "./args";
import { applyDump } from "./applyDump";

const HTML_PATH = path.resolve(import.meta.dir, "index.html");
const DATA_DIR = path.resolve(import.meta.dir, "../../data");
const PORT = 4592;

const CATALOG_FILES = {
  classes: "classes.json",
  abilities: "abilities.json",
  artifacts: "artifacts.json",
  items: "items.json",
  events: "events.json",
  balance: "balance-config.json",
} as const;
const MAX_ITEM_COUNT = 100;
type CatalogName = keyof typeof CATALOG_FILES;

function isCatalogName(value: string): value is CatalogName {
  return value in CATALOG_FILES;
}

async function readCatalogFile(name: CatalogName): Promise<Response> {
  const raw = await readFile(path.join(DATA_DIR, CATALOG_FILES[name]), "utf8");
  return new Response(raw, { headers: { "content-type": "application/json" } });
}

function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

// Written straight into a filename (savePath, src/engine/save.ts) — reject anything but a plain
// id so a request can't write or read outside SAVE_DIR (e.g. "../../etc/passwd").
const SAFE_SAVE_ID = /^[A-Za-z0-9_-]+$/;

interface PartyMemberInput {
  classId?: unknown;
  abilityId?: unknown;
  artifactIds?: unknown;
}

interface GenerateRequestBody {
  level?: unknown;
  floor?: unknown;
  room?: unknown;
  seed?: unknown;
  id?: unknown;
  party?: unknown;
  items?: unknown;
  event?: unknown;
}

interface EventInput {
  forceEventId?: unknown;
  narrativeCounters?: unknown;
  firedOnceEventIds?: unknown;
  metNarrativeNpcIds?: unknown;
  eventOutcomes?: unknown;
}

const NARRATIVE_COUNTER_KEYS = [
  "guardianFightsSkipped",
  "artifactsSacrificed",
  "altarPaymentsCount",
  "guardianGrudgeFiredCount",
  "freeRewardsTakenCount",
] as const satisfies readonly (keyof GameState["narrativeCounters"])[];

interface ValidatedEvent {
  forceEventId?: Id;
  narrativeCounters?: Partial<GameState["narrativeCounters"]>;
  firedOnceEventIds?: Id[];
  metNarrativeNpcIds?: Id[];
  eventOutcomes?: Record<Id, string>;
}

interface ValidatedMember {
  classId: Id;
  abilityId: Id | null;
  artifactIds: Id[];
}

function validateParty(party: unknown): ValidatedMember[] | { error: string } {
  if (!Array.isArray(party) || party.length !== BALANCE.party.size) {
    return { error: `party must have exactly ${BALANCE.party.size} members, got ${Array.isArray(party) ? party.length : typeof party}.` };
  }
  const members: ValidatedMember[] = [];
  for (const [i, raw] of (party as unknown[]).entries()) {
    if (typeof raw !== "object" || raw === null) return { error: `party[${i}] must be an object.` };
    const member = raw as PartyMemberInput;
    if (typeof member.classId !== "string") return { error: `party[${i}].classId is required.` };
    try {
      getClass(member.classId);
    } catch {
      return { error: `party[${i}].classId "${member.classId}" is unknown.` };
    }

    let abilityId: Id | null = null;
    if (member.abilityId !== undefined && member.abilityId !== null) {
      if (typeof member.abilityId !== "string") return { error: `party[${i}].abilityId must be a string or null.` };
      try {
        getAbility(member.abilityId);
      } catch {
        return { error: `party[${i}].abilityId "${member.abilityId}" is unknown.` };
      }
      abilityId = member.abilityId;
    }

    const artifactIdsRaw = member.artifactIds ?? [];
    if (!Array.isArray(artifactIdsRaw)) return { error: `party[${i}].artifactIds must be an array.` };
    if (artifactIdsRaw.length > MAX_EQUIPPED_ARTIFACTS) {
      return { error: `party[${i}].artifactIds has ${artifactIdsRaw.length}, max is ${MAX_EQUIPPED_ARTIFACTS}.` };
    }
    const artifactIds: Id[] = [];
    const seenArtifactIds = new Set<Id>();
    for (const artifactId of artifactIdsRaw) {
      if (typeof artifactId !== "string") return { error: `party[${i}].artifactIds must all be strings.` };
      try {
        getArtifact(artifactId);
      } catch {
        return { error: `party[${i}].artifactIds "${artifactId}" is unknown.` };
      }
      if (seenArtifactIds.has(artifactId)) return { error: `party[${i}].artifactIds has "${artifactId}" more than once.` };
      seenArtifactIds.add(artifactId);
      artifactIds.push(artifactId);
    }

    members.push({ classId: member.classId, abilityId, artifactIds });
  }
  return members;
}

/** `items` is optional — omitted entirely means "keep Game's own default starting inventory";
    provided (even `{}`) means "replace it with exactly this". Only counts > 0 are kept. */
function validateItems(items: unknown): { inventory: Record<Id, number> } | { error: string } | undefined {
  if (items === undefined) return undefined;
  if (typeof items !== "object" || items === null || Array.isArray(items)) return { error: "items must be an object of {itemId: count}." };
  const inventory: Record<Id, number> = {};
  for (const [itemId, countRaw] of Object.entries(items as Record<string, unknown>)) {
    try {
      getItem(itemId);
    } catch {
      return { error: `items has unknown item id "${itemId}".` };
    }
    const count = Number(countRaw);
    if (!Number.isInteger(count) || count < 0 || count > MAX_ITEM_COUNT) {
      return { error: `items.${itemId} must be an integer between 0 and ${MAX_ITEM_COUNT}, got ${String(countRaw)}.` };
    }
    if (count > 0) inventory[itemId] = count;
  }
  return { inventory };
}

function validateEventId(id: unknown, field: string): Id | { error: string } {
  if (typeof id !== "string") return { error: `${field} must be a string.` };
  try {
    getEvent(id);
  } catch {
    return { error: `${field} "${id}" is unknown.` };
  }
  return id;
}

/** `event` is optional and only ever pins a room whose destination turns out to actually be an
    event room — landing on any other room type, this is validated but simply unused. */
function validateEvent(event: unknown): ValidatedEvent | { error: string } | undefined {
  if (event === undefined) return undefined;
  if (typeof event !== "object" || event === null) return { error: "event must be an object." };
  const raw = event as EventInput;
  const result: ValidatedEvent = {};

  if (raw.forceEventId !== undefined && raw.forceEventId !== null) {
    const validated = validateEventId(raw.forceEventId, "event.forceEventId");
    if (typeof validated !== "string") return validated;
    result.forceEventId = validated;
  }

  if (raw.narrativeCounters !== undefined) {
    if (typeof raw.narrativeCounters !== "object" || raw.narrativeCounters === null) return { error: "event.narrativeCounters must be an object." };
    const counters: Partial<GameState["narrativeCounters"]> = {};
    for (const [key, value] of Object.entries(raw.narrativeCounters as Record<string, unknown>)) {
      if (!(NARRATIVE_COUNTER_KEYS as readonly string[]).includes(key)) return { error: `event.narrativeCounters has unknown field "${key}".` };
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return { error: `event.narrativeCounters.${key} must be an integer >= 0, got ${String(value)}.` };
      counters[key as (typeof NARRATIVE_COUNTER_KEYS)[number]] = n;
    }
    result.narrativeCounters = counters;
  }

  for (const field of ["firedOnceEventIds", "metNarrativeNpcIds"] as const) {
    const list = raw[field];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return { error: `event.${field} must be an array.` };
    const ids: Id[] = [];
    for (const id of list) {
      const validated = validateEventId(id, `event.${field}`);
      if (typeof validated !== "string") return validated;
      ids.push(validated);
    }
    result[field] = ids;
  }

  if (raw.eventOutcomes !== undefined) {
    if (typeof raw.eventOutcomes !== "object" || raw.eventOutcomes === null || Array.isArray(raw.eventOutcomes)) {
      return { error: "event.eventOutcomes must be an object of {eventId: outcome}." };
    }
    const outcomes: Record<Id, string> = {};
    for (const [eventId, outcome] of Object.entries(raw.eventOutcomes as Record<string, unknown>)) {
      // "camp-reflection" isn't a real event id — it's a synthetic tag Camp Reflection writes
      // straight into eventOutcomes (Game.pickCampReflectionChoice, game.ts) for events'
      // campReflectionUnawareEcho to read; every other key must be a real event id.
      if (eventId !== "camp-reflection") {
        const validated = validateEventId(eventId, "event.eventOutcomes key");
        if (typeof validated !== "string") return validated;
      }
      if (typeof outcome !== "string" || outcome.length === 0) return { error: `event.eventOutcomes.${eventId} must be a non-empty string.` };
      outcomes[eventId] = outcome;
    }
    result.eventOutcomes = outcomes;
  }

  return result;
}

async function handleGenerate(req: Request): Promise<Response> {
  if (!DEV_MODE) return badRequest("dev-save-dump: only available in dev mode.");

  let body: GenerateRequestBody;
  try {
    body = (await req.json()) as GenerateRequestBody;
  } catch {
    return badRequest("Body is not valid JSON.");
  }

  const level = Number(body.level ?? 1);
  const floorDepth = Number(body.floor ?? level);
  const seed = body.seed !== undefined && body.seed !== null && body.seed !== "" ? Number(body.seed) : Date.now();
  if (!Number.isFinite(level)) return badRequest(`level must be a number, got "${body.level}".`);
  if (!Number.isFinite(floorDepth)) return badRequest(`floor must be a number, got "${body.floor}".`);
  if (!Number.isFinite(seed)) return badRequest(`seed must be a number, got "${body.seed}".`);
  const roomArg = typeof body.room === "string" && body.room.length > 0 ? body.room : "entry";
  const saveId = typeof body.id === "string" && body.id.length > 0 ? body.id : firstFreeSlotId();
  if (saveId === null) return badRequest("All save slots are full — pass an explicit id (e.g. slot1) to overwrite one.");
  if (!SAFE_SAVE_ID.test(saveId)) return badRequest(`id must match ${SAFE_SAVE_ID} (letters, digits, "-", "_" only), got "${saveId}".`);

  const members = validateParty(body.party);
  if (!Array.isArray(members)) return badRequest(members.error);

  const itemsResult = validateItems(body.items);
  if (itemsResult && "error" in itemsResult) return badRequest(itemsResult.error);

  const eventResult = validateEvent(body.event);
  if (eventResult && "error" in eventResult) return badRequest(eventResult.error);

  const classIds = members.map((m) => m.classId);
  const abilityIds = members.map((m) => m.abilityId);

  const game = new Game(seed, classIds, undefined, abilityIds);
  // firedOnceEventIds/metNarrativeNpcIds are unioned onto the Game constructor's own defaults
  // (e.g. its one-time exclusion of "the-one-who-stayed" for an eligible retired-character profile)
  // rather than replacing them outright — the UI always sends both fields once Room=event, even as
  // an empty array when the user never touched those pickers, and a plain replace would silently
  // wipe a default the player never asked to clear.
  if (eventResult?.narrativeCounters) Object.assign(game.state.narrativeCounters, eventResult.narrativeCounters);
  if (eventResult?.firedOnceEventIds) {
    game.state.firedOnceEventIds = Array.from(new Set([...game.state.firedOnceEventIds, ...eventResult.firedOnceEventIds]));
  }
  if (eventResult?.metNarrativeNpcIds) {
    game.state.metNarrativeNpcIds = Array.from(new Set([...game.state.metNarrativeNpcIds, ...eventResult.metNarrativeNpcIds]));
  }
  if (eventResult?.eventOutcomes) Object.assign(game.state.eventOutcomes, eventResult.eventOutcomes);

  try {
    const room = applyDump(game, { level, floorDepth, roomArg, forceEventId: eventResult?.forceEventId });

    members.forEach((member, i) => {
      game.state.party[i]!.equippedArtifactIds = [...member.artifactIds];
    });
    if (itemsResult) game.state.inventory = itemsResult.inventory;
    recomputeAllPartyStats(game.state);
    for (const c of game.state.party) {
      c.hp = c.maxHp;
      c.mp = c.maxMp;
    }

    const meta = writeDevDumpSave(game, saveId);
    const save = loadSave(meta.id);
    const eventNote = room.type === "event" && room.rolledEventId ? ` — event "${room.rolledEventId}"` : "";
    return Response.json({
      ok: true,
      meta,
      save,
      message: `Wrote dev-dump save "${meta.id}" to ${SAVE_DIR} — level ${game.state.party[0]!.level} · floor ${game.state.floor.depth} · room ${room.id} (${room.type}, "${room.name}")${game.state.combat ? " — ambushed" : ""}${eventNote}`,
    });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : String(err));
  }
}

if (!DEV_MODE) {
  console.error("dev-save-dump: only available in dev mode (this binary was built for release).");
  process.exit(1);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(HTML_PATH, "utf8");
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (req.method === "GET" && url.pathname === "/api/room-types") {
      return Response.json({ roomTypes: ROOM_TYPES });
    }

    if (req.method === "GET" && url.pathname === "/api/effects") {
      return Response.json({
        abilities: Object.fromEntries(ABILITIES.map((a) => [a.id, formatAbilityEffect(a)])),
        artifacts: Object.fromEntries(ARTIFACTS.map((a) => [a.id, formatArtifactEffect(a)])),
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice("/api/".length);
      if (isCatalogName(name)) return readCatalogFile(name);
    }

    if (req.method === "POST" && url.pathname === "/api/generate") return handleGenerate(req);

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Dev save dump running at http://localhost:${PORT}`);
