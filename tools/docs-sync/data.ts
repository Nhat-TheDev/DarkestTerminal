import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ABILITIES } from "../../src/data/abilities";
import { ARTIFACTS } from "../../src/data/artifacts";
import { BALANCE } from "../../src/data/balanceConfig";
import { CLASSES } from "../../src/data/classes";
import { EVENTS } from "../../src/data/events";
import { GROWTH_WEIGHTS } from "../../src/data/growthWeights";
import { MONSTER_ARCHETYPES, MONSTER_SKILLS } from "../../src/data/monsters";
import { STATUS_EFFECTS } from "../../src/data/statusEffects";
import { SUMMON_ARCHETYPES, SUMMON_CASTS, SUMMON_SKILLS } from "../../src/data/summons";
import type { DocsData } from "./types";

const DATA_DIR = resolve(import.meta.dir, "../../data");
/** Large files with no balance numbers in them. */
const NOT_BALANCE = new Set(["sprites.json", "strings.json"]);

/** Names too generic to say anything about which number a doc means. */
const GENERIC = new Set(["amount", "percent", "chance", "base", "min", "max", "rank", "value", "kind"]);

function collect(value: unknown, into: Map<number, Set<string>>, key?: string, owner?: string): void {
  if (typeof value === "number") {
    const names = into.get(value) ?? new Set<string>();
    for (const name of [key, owner]) if (name && !GENERIC.has(name)) names.add(name);
    into.set(value, names);
  } else if (Array.isArray(value)) {
    for (const item of value) collect(item, into, key, owner);
  } else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : typeof record.itemId === "string" ? record.itemId : owner;
    for (const [name, item] of Object.entries(record)) collect(item, into, name, id);
  }
}

/** Every number in `data/*.json` except the sprites and the UI strings, with the names that hold it. */
function loadDataValues(): Map<number, Set<string>> {
  const values = new Map<number, Set<string>>();
  for (const name of readdirSync(DATA_DIR)) {
    if (name.endsWith(".json") && !NOT_BALANCE.has(name)) collect(JSON.parse(readFileSync(join(DATA_DIR, name), "utf8")), values);
  }
  return values;
}

/** Everything the generators read, from the same loaders the game uses. */
export function loadDocsData(): DocsData {
  return {
    balance: BALANCE,
    classes: CLASSES,
    abilities: ABILITIES,
    events: EVENTS,
    artifacts: ARTIFACTS,
    statusEffects: STATUS_EFFECTS,
    growthWeights: GROWTH_WEIGHTS,
    monsters: { archetypes: MONSTER_ARCHETYPES, skills: MONSTER_SKILLS },
    dataValues: loadDataValues(),
    summons: { archetypes: SUMMON_ARCHETYPES, skills: SUMMON_SKILLS, casts: SUMMON_CASTS },
  };
}
