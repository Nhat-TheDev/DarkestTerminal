import type { SkillEffect } from "../../src/types";
import { formatNumber, showValue } from "./format";

/** One field's values across ranks: a single value when they all agree, otherwise `a / b / c`. */
export function joinRanks(values: readonly string[]): string {
  return values.every((value) => value === values[0]) ? values[0]! : values.join(" / ");
}

export type OffenseStat = "ATK" | "MAG";

const percent = (rate: number) => formatNumber(rate * 100);

/**
 * One effect as it reads across ranks, e.g. `damage 10 / 13 / 16 + 100 / 105 / 110% ATK (fire)`.
 * `ranks` holds the same effect at rank 1, 2 and 3. A field this has no wording for is printed as
 * `name value`, never dropped, so a number added to the data shows up in the docs on its own.
 */
export function describeEffect(ranks: readonly SkillEffect[], offenseStat: OffenseStat): string {
  const first = ranks[0]!;
  if (ranks.some((effect) => effect.kind !== first.kind)) {
    throw new Error(`an effect changes kind between ranks (${ranks.map((effect) => effect.kind).join(", ")})`);
  }
  const used = new Set<string>(["kind"]);
  const across = (pick: (effect: SkillEffect) => string | undefined): string | undefined => {
    const values = ranks.map(pick);
    return values.every((value) => value === undefined) ? undefined : joinRanks(values.map((value) => value ?? "—"));
  };
  const field = <K extends keyof SkillEffect>(key: K, format: (value: NonNullable<SkillEffect[K]>) => string): string | undefined => {
    used.add(key);
    return across((effect) => (effect[key] === undefined ? undefined : format(effect[key] as NonNullable<SkillEffect[K]>)));
  };

  const rate = (key: "chance" | "critChance" | "extraHitChance", label: (joined: string) => string): string | undefined => {
    used.add(key);
    const joined = across((effect) => (effect[key] === undefined ? undefined : percent(effect[key])));
    return joined === undefined ? undefined : label(joined);
  };

  const amountOf = (key: "critMultiplierPercent" | "ignoreDefensePercent" | "lifestealPercent" | "maxHpPercent" | "minPercent", label: (joined: string) => string): string | undefined => {
    used.add(key);
    const joined = across((effect) => (effect[key] === undefined ? undefined : formatNumber(effect[key])));
    return joined === undefined ? undefined : label(joined);
  };

  const amount = () => field("amount", formatNumber) ?? "0";
  const multiplier = () => field("offenseMultiplierPercent", formatNumber) ?? "100";
  let head: string;
  switch (first.kind) {
    case "damage":
      head = `damage ${amount()} + ${multiplier()}% ${offenseStat}`;
      break;
    case "heal":
      head = `heal ${amount()} + ${multiplier()}% MAG`;
      break;
    case "applyStatusEffect": {
      used.add("statusEffectId").add("alsoApplyStatusEffectIds");
      const ids = across((effect) => [effect.statusEffectId, ...(effect.alsoApplyStatusEffectIds ?? [])].join(" + "));
      head = `status ${ids}`;
      break;
    }
    case "modifyStat":
      head = `${field("stat", String)} ${field("amount", formatNumber)}`;
      break;
    case "modifyCombatStat":
      head = `${field("combatStat", String)} ${field("amount", formatNumber)}`;
      break;
    case "removeStatusEffect":
      head = `remove ${field("statusEffectId", String) ?? "one harmful status"}`;
      break;
    case "summon":
      head = `summon ${field("summonCastId", String)}`;
      break;
    default:
      head = `${first.kind}${first.amount === undefined ? "" : ` ${amount()}`}`;
  }

  const duration = first.kind === "applyStatusEffect" ? (field("durationTurns", formatNumber) ?? "1") : undefined;
  const qualifiers: (string | undefined)[] = [
    duration === undefined ? undefined : duration === "1" ? "1 turn" : `${duration} turns`,
    field("appliesToRelation", (relation) => (relation === "ally" ? "on allies" : "on enemies")),
    field("target", (target) => `target ${target}`),
    field("damageType", String),
    rate("chance", (joined) => `${joined}% chance`),
    rate("critChance", (joined) => `crit ${joined}%`),
    amountOf("critMultiplierPercent", (joined) => `crit x${joined}%`),
    rate("extraHitChance", (joined) => `${joined}% extra hit`),
    field("hitCountRange", ({ min, max }) => `${min}–${max} hits`),
    field("scalesWithStatusStacks", ({ statusEffectId, percentPerStack }) => `+${formatNumber(percentPerStack)}% per ${statusEffectId} stack`),
    amountOf("ignoreDefensePercent", (joined) => `ignores ${joined}% defense`),
    amountOf("lifestealPercent", (joined) => `${joined}% lifesteal`),
    amountOf("maxHpPercent", (joined) => `${joined}% max HP`),
    amountOf("minPercent", (joined) => `min ${joined}%`),
    field("excludesSummonTargets", (value) => (value ? "not on summons" : "")),
    field("linksToCasterSummon", (value) => (value ? "lasts while the summon lives" : "")),
  ];
  const unknown = new Set(ranks.flatMap((effect) => Object.keys(effect)).filter((key) => !used.has(key)));
  for (const key of unknown) {
    const value = across((effect) => {
      const raw = (effect as unknown as Record<string, unknown>)[key];
      return raw === undefined ? undefined : showValue(raw);
    });
    qualifiers.push(`${key} ${value}`);
  }

  const shown = qualifiers.filter((part): part is string => part !== undefined && part !== "");
  return shown.length === 0 ? head : `${head} (${shown.join(", ")})`;
}

/** Every effect of a skill, one string per effect position; identical neighbours become `… ×N`. */
export function describeEffects(byRank: readonly (readonly SkillEffect[])[], offenseStat: OffenseStat): string[] {
  const count = Math.max(0, ...byRank.map((effects) => effects.length));
  const each = Array.from({ length: count }, (_, index) =>
    describeEffect(
      byRank.map((effects) => effects[index]).filter((effect): effect is SkillEffect => effect !== undefined),
      offenseStat,
    ),
  );
  const out: string[] = [];
  for (let i = 0; i < each.length; ) {
    let run = 1;
    while (each[i + run] === each[i]) run++;
    out.push(run === 1 ? each[i]! : `${each[i]!} ×${run}`);
    i += run;
  }
  return out;
}
