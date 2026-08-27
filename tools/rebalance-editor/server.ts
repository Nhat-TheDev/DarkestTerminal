import { readFile, writeFile } from "fs/promises";
import path from "path";
import { getCatalog, computeCharacter, computeMonster, computeDamage, computeSkillPreview, computeMatchup, simulateLevelByDepth } from "./calc";
import type { MonsterTier } from "../../src/types";
import type { FearTier } from "../../src/engine/resolver";

const HTML_PATH = path.resolve(import.meta.dir, "index.html");
const DATA_DIR = path.resolve(import.meta.dir, "../../data");
const PORT = 4591;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

function toFearTier(value: unknown): FearTier {
  const n = Number(value);
  return (n === 1 || n === 2 || n === 3 || n === 4 ? n : 1) as FearTier;
}

// ---------------------------------------------------------------------------
// Parameter editor — writes straight to the same JSON files the real game
// reads (data/classes.json, data/monsters.json, data/balance-config.json,
// data/level-growth.json), same pattern as tools/sprite-editor/server.ts.
// Only whitelisted numeric fields can be written; everything else is rejected.
// ---------------------------------------------------------------------------

async function readJsonFile(name: string): Promise<unknown> {
  const raw = await readFile(path.join(DATA_DIR, name), "utf8");
  return JSON.parse(raw);
}

async function writeJsonFile(name: string, data: unknown): Promise<void> {
  await writeFile(path.join(DATA_DIR, name), JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Copies only the whitelisted numeric keys from `patch` onto `target`, in place. Returns an error message, or null on success. */
function applyNumericPatch(target: Record<string, unknown>, patch: Record<string, unknown>, allowedKeys: readonly string[]): string | null {
  for (const [key, value] of Object.entries(patch)) {
    if (!allowedKeys.includes(key)) return `Field "${key}" is not editable.`;
    if (typeof value !== "number" || !Number.isFinite(value)) return `Field "${key}" must be a finite number.`;
    target[key] = value;
  }
  return null;
}

const CLASS_BASE_FIELDS = ["baseAttack", "baseDefense", "baseMaxHp", "baseMaxMp", "baseMagicPower", "baseAggro", "baseSpeed"] as const;
const CLASS_GROWTH_FIELDS = ["attack", "defense", "maxHp", "maxMp", "magicPower"] as const;
const MONSTER_BASE_FIELDS = ["baseHp", "baseAttack", "baseDefense", "baseSpeed", "expReward"] as const;
const BALANCE_COMBAT_FIELDS = ["defenseMitigationX", "defenseMitigationY", "executeCooldownTurns", "defensiveLowHpSkillChance"] as const;
const BALANCE_SURVIVAL_FIELDS = [
  "initialFear",
  "initialSatiety",
  "satietyDrainCombat",
  "satietyDrainEvent",
  "exhaustedThreshold",
  "exhaustedStatMultiplier",
  "dyingThreshold",
  "dyingDamagePerRound",
  "campSatietyRestore",
  "eatDrinkRestorePercent",
  "eatDrinkSatietyRestore",
  "chatRestorePercent",
  "chatFearRelief",
  "fearPerRoundBase",
  "fearPerRoundLowHp",
  "fearPerRoundBaseCap",
  "fearPerRoundLowHpCap",
  "fearPerRoundDepthGrowth",
  "fearLowHpThresholdPercent",
  "fearVictoryRelief",
  "fearVictoryReliefQuick",
  "fearQuickVictoryRoundThreshold",
  "fearEliteOrBossVictoryRelief",
  "fearEliteOrBossVictoryReliefQuick",
  "fearEliteOrBossQuickVictoryRoundThreshold",
] as const;
const BALANCE_PARTY_FIELDS = ["maxEquippedArtifacts", "startingExplorationKits"] as const;
const BALANCE_ITEMS_FIELDS = ["itemDropChance", "itemWeightDepthGrowth"] as const;
const BALANCE_FLOOR_GENERATION_FIELDS = [
  "minPathRooms",
  "maxPathRooms",
  "maxBranches",
  "minBranchStartStage",
  "minBranchSpacing",
  "maxEventRoomsPerPath",
  "minRestRoomsPerPath",
  "maxRestRoomsPerPath",
] as const;
const BALANCE_EVENTS_FIELDS = [
  "commonTierWeight",
  "rareTierWeight",
  "merchantOfferCount",
  "merchantRefreshCostCoins",
  "merchantMaxRefreshes",
  "bloodAltarHpPercent",
  "collapsedFloorHpPercent",
  "collapsedFloorSuccessChance",
  "eventGuardianStatMultiplier",
  "wanderingHermitExchangeCostCoins",
] as const;
const COIN_DROP_TIERS = ["weak", "medium", "strong", "elite", "boss"] as const;
const LEVEL_GROWTH_MULTIPLIER_FIELDS = ["maxHp", "attack", "defense", "exp"] as const;
const LEVEL_GROWTH_TOP_FIELDS = ["expRewardDepthRate", "bossFloorInterval"] as const;

/** Like applyNumericPatch, but for `data/balance-config.json`'s `currency.coinDropByTier` shape — each tier is a `[min, max]` pair, not a single number. */
function applyTierRangePatch(target: Record<string, unknown>, patch: Record<string, unknown>, allowedTiers: readonly string[]): string | null {
  for (const [tier, value] of Object.entries(patch)) {
    if (!allowedTiers.includes(tier)) return `Tier "${tier}" is not editable.`;
    if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return `coinDropByTier.${tier} must be a [min, max] pair of finite numbers.`;
    }
    const [min, max] = value as [number, number];
    if (min > max) return `coinDropByTier.${tier}: min (${min}) must be <= max (${max}).`;
    target[tier] = [min, max];
  }
  return null;
}

async function handleEditClass(req: Request): Promise<Response> {
  let body: { classId?: unknown; base?: unknown; growthWeights?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Body is not valid JSON.");
  }
  if (typeof body.classId !== "string") return badRequest("classId is required.");

  const classes = (await readJsonFile("classes.json")) as Record<string, unknown>[];
  const cls = classes.find((c) => c.id === body.classId);
  if (!cls) return badRequest(`Unknown class id "${body.classId}".`);

  if (body.base !== undefined) {
    if (typeof body.base !== "object" || body.base === null) return badRequest("base must be an object.");
    const err = applyNumericPatch(cls, body.base as Record<string, unknown>, CLASS_BASE_FIELDS);
    if (err) return badRequest(err);
  }
  if (body.growthWeights !== undefined) {
    if (typeof body.growthWeights !== "object" || body.growthWeights === null) return badRequest("growthWeights must be an object.");
    const err = applyNumericPatch(cls.growthWeights as Record<string, unknown>, body.growthWeights as Record<string, unknown>, CLASS_GROWTH_FIELDS);
    if (err) return badRequest(err);
  }

  await writeJsonFile("classes.json", classes);
  return json({ ok: true });
}

async function handleEditMonster(req: Request): Promise<Response> {
  let body: { archetypeId?: unknown; base?: unknown; actionWeights?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Body is not valid JSON.");
  }
  if (typeof body.archetypeId !== "string") return badRequest("archetypeId is required.");

  const monsters = (await readJsonFile("monsters.json")) as Record<string, unknown>[];
  const monster = monsters.find((m) => m.id === body.archetypeId);
  if (!monster) return badRequest(`Unknown monster archetype id "${body.archetypeId}".`);

  if (body.base !== undefined) {
    if (typeof body.base !== "object" || body.base === null) return badRequest("base must be an object.");
    const err = applyNumericPatch(monster, body.base as Record<string, unknown>, MONSTER_BASE_FIELDS);
    if (err) return badRequest(err);
  }
  if (body.actionWeights !== undefined) {
    if (typeof body.actionWeights !== "object" || body.actionWeights === null) return badRequest("actionWeights must be an object.");
    const existingWeights = (monster.actionWeights ?? {}) as Record<string, unknown>;
    for (const [tier, tierPatch] of Object.entries(body.actionWeights as Record<string, unknown>)) {
      if (typeof tierPatch !== "object" || tierPatch === null) return badRequest(`actionWeights.${tier} must be an object.`);
      const existingTier = (existingWeights[tier] ?? {}) as Record<string, unknown>;
      const allowedActionKeys = Object.keys(existingTier);
      const err = applyNumericPatch(existingTier, tierPatch as Record<string, unknown>, allowedActionKeys);
      if (err) return badRequest(err);
      existingWeights[tier] = existingTier;
    }
    monster.actionWeights = existingWeights;
  }

  await writeJsonFile("monsters.json", monsters);
  return json({ ok: true });
}

async function handleEditBalance(req: Request): Promise<Response> {
  let body: { combat?: unknown; survival?: unknown; party?: unknown; items?: unknown; floorGeneration?: unknown; events?: unknown; currency?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Body is not valid JSON.");
  }

  const balance = (await readJsonFile("balance-config.json")) as Record<string, unknown>;

  const flatSections: [string, readonly string[]][] = [
    ["combat", BALANCE_COMBAT_FIELDS],
    ["survival", BALANCE_SURVIVAL_FIELDS],
    ["party", BALANCE_PARTY_FIELDS],
    ["items", BALANCE_ITEMS_FIELDS],
    ["floorGeneration", BALANCE_FLOOR_GENERATION_FIELDS],
    ["events", BALANCE_EVENTS_FIELDS],
  ];
  for (const [key, allowed] of flatSections) {
    const patch = (body as Record<string, unknown>)[key];
    if (patch === undefined) continue;
    if (typeof patch !== "object" || patch === null) return badRequest(`${key} must be an object.`);
    const err = applyNumericPatch(balance[key] as Record<string, unknown>, patch as Record<string, unknown>, allowed);
    if (err) return badRequest(err);
  }

  if (body.currency !== undefined) {
    if (typeof body.currency !== "object" || body.currency === null) return badRequest("currency must be an object.");
    const currencyPatch = body.currency as { coinDropByTier?: unknown };
    if (currencyPatch.coinDropByTier !== undefined) {
      if (typeof currencyPatch.coinDropByTier !== "object" || currencyPatch.coinDropByTier === null) return badRequest("currency.coinDropByTier must be an object.");
      const currency = balance.currency as Record<string, unknown>;
      const err = applyTierRangePatch(currency.coinDropByTier as Record<string, unknown>, currencyPatch.coinDropByTier as Record<string, unknown>, COIN_DROP_TIERS);
      if (err) return badRequest(err);
    }
  }

  await writeJsonFile("balance-config.json", balance);
  return json({ ok: true });
}

async function handleEditLevelGrowth(req: Request): Promise<Response> {
  let body: { eliteMultiplier?: unknown; bossMultiplier?: unknown; top?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Body is not valid JSON.");
  }

  const levelGrowth = (await readJsonFile("level-growth.json")) as Record<string, unknown>;
  for (const [field, key] of [
    ["eliteMultiplier", body.eliteMultiplier],
    ["bossMultiplier", body.bossMultiplier],
  ] as const) {
    if (key === undefined) continue;
    if (typeof key !== "object" || key === null) return badRequest(`${field} must be an object.`);
    const err = applyNumericPatch(levelGrowth[field] as Record<string, unknown>, key as Record<string, unknown>, LEVEL_GROWTH_MULTIPLIER_FIELDS);
    if (err) return badRequest(err);
  }
  if (body.top !== undefined) {
    if (typeof body.top !== "object" || body.top === null) return badRequest("top must be an object.");
    const err = applyNumericPatch(levelGrowth, body.top as Record<string, unknown>, LEVEL_GROWTH_TOP_FIELDS);
    if (err) return badRequest(err);
  }

  await writeJsonFile("level-growth.json", levelGrowth);
  return json({ ok: true });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(HTML_PATH, "utf8");
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (req.method === "GET" && url.pathname === "/api/meta") {
      return json(getCatalog());
    }

    if (req.method === "GET" && url.pathname === "/api/character") {
      const classId = url.searchParams.get("classId") ?? "";
      const level = Number(url.searchParams.get("level") ?? "1");
      const result = computeCharacter(classId, level);
      if ("error" in result) return badRequest(result.error);
      return json(result);
    }

    if (req.method === "GET" && url.pathname === "/api/monster") {
      const archetypeId = url.searchParams.get("archetypeId") ?? "";
      const depth = Number(url.searchParams.get("depth") ?? "1");
      const tier = (url.searchParams.get("tier") ?? "normal") as MonsterTier;
      const result = computeMonster(archetypeId, depth, tier);
      if ("error" in result) return badRequest(result.error);
      return json(result);
    }

    if (req.method === "GET" && url.pathname === "/api/matchup") {
      const classId = url.searchParams.get("classId") ?? "";
      const level = Number(url.searchParams.get("level") ?? "1");
      const archetypeId = url.searchParams.get("archetypeId") ?? "";
      const depth = Number(url.searchParams.get("depth") ?? "1");
      const tier = (url.searchParams.get("tier") ?? "normal") as MonsterTier;
      const fearTier = toFearTier(url.searchParams.get("fearTier"));
      const result = computeMatchup({ classId, level, archetypeId, depth, tier, fearTier });
      if ("error" in result) return badRequest(result.error);
      return json(result);
    }

    if (req.method === "GET" && url.pathname === "/api/skill-preview") {
      const skillId = url.searchParams.get("skillId") ?? "";
      const sourceAttack = Number(url.searchParams.get("sourceAttack") ?? "0");
      const sourceMagicPowerRaw = url.searchParams.get("sourceMagicPower");
      const targetDefense = Number(url.searchParams.get("targetDefense") ?? "0");
      const targetMaxHpRaw = url.searchParams.get("targetMaxHp");
      const fearTier = toFearTier(url.searchParams.get("fearTier"));
      const sourceIsCharacter = url.searchParams.get("sourceIsCharacter") !== "false";
      const characterLevelRaw = url.searchParams.get("characterLevel");
      const result = computeSkillPreview({
        skillId,
        sourceAttack,
        sourceMagicPower: sourceMagicPowerRaw !== null ? Number(sourceMagicPowerRaw) : undefined,
        targetDefense,
        targetMaxHp: targetMaxHpRaw !== null && targetMaxHpRaw !== "" ? Number(targetMaxHpRaw) : undefined,
        fearTier,
        sourceIsCharacter,
        characterLevel: characterLevelRaw !== null && characterLevelRaw !== "" ? Number(characterLevelRaw) : undefined,
      });
      if ("error" in result) return badRequest(result.error);
      return json(result);
    }

    if (req.method === "POST" && url.pathname === "/api/damage") {
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return badRequest("Body is not valid JSON.");
      }
      const result = computeDamage({
        offense: Number(body.offense),
        defense: Number(body.defense),
        amount: Number(body.amount),
        ignoreDefensePercent: body.ignoreDefensePercent !== undefined ? Number(body.ignoreDefensePercent) : undefined,
        fearTier: toFearTier(body.fearTier),
        sourceIsCharacter: body.sourceIsCharacter !== undefined ? Boolean(body.sourceIsCharacter) : undefined,
        targetMaxHp: body.targetMaxHp !== undefined && body.targetMaxHp !== null && body.targetMaxHp !== "" ? Number(body.targetMaxHp) : undefined,
      });
      if ("error" in result) return badRequest(result.error);
      return json(result);
    }

    if (req.method === "POST" && url.pathname === "/api/edit/class") return handleEditClass(req);
    if (req.method === "POST" && url.pathname === "/api/edit/monster") return handleEditMonster(req);
    if (req.method === "POST" && url.pathname === "/api/edit/balance") return handleEditBalance(req);
    if (req.method === "POST" && url.pathname === "/api/edit/level-growth") return handleEditLevelGrowth(req);

    if (req.method === "GET" && url.pathname === "/api/level-by-depth") {
      const seeds = Number(url.searchParams.get("seeds") ?? "20");
      const maxDepth = Number(url.searchParams.get("maxDepth") ?? "60");
      try {
        const rows = simulateLevelByDepth(seeds, maxDepth);
        return json({ seeds, maxDepth, rows });
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : String(err));
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Rebalance editor running at http://localhost:${PORT}`);
