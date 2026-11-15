import type { Character, ReflectionAnswer, ReflectionEffect, ReflectionOption, ReflectionOutcome, ReflectionStance } from "../types";
import { BALANCE } from "./balanceConfig";

const EVENT_STANCES: readonly ReflectionStance[] = ["curious", "wary", "dismissive"];
const MIN_UNCONDITIONAL_ANSWERS = 3;
const MAX_FAITH_DIRECTION_SHARE = 0.6;

/** Points for Faith, Fear and Satiety; HP and MP are a fraction of the target's maximum, rounded, or the bare fraction without a target. */
export function effectAmount(e: ReflectionEffect, target?: Character): number {
  const size = BALANCE.reflection.effectSizes[e.stat][e.size];
  if (e.stat !== "hp" && e.stat !== "mp") return size;
  if (!target) return size;
  return Math.round(size * (e.stat === "hp" ? target.maxHp : target.maxMp));
}

function pairKey(e: ReflectionEffect): string {
  if (e.stat === "faith" || e.stat === "satiety" || !e.target) return `${e.stat}|party`;
  return `${e.stat}|${typeof e.target === "string" ? e.target : `religion:${e.target.religion}`}`;
}

/** Positive is better for the party: Fear counts the other way round. */
function goodness(e: ReflectionEffect): number {
  const value = e.sign * BALANCE.reflection.effectSizes[e.stat][e.size];
  return e.stat === "fear" ? -value : value;
}

function outcomeVector(outcome: ReflectionOutcome): Map<string, number> {
  const vector = new Map<string, number>();
  for (const e of outcome.effects) vector.set(pairKey(e), (vector.get(pairKey(e)) ?? 0) + goodness(e));
  return vector;
}

interface Range {
  worst: Map<string, number>;
  best: Map<string, number>;
}

function rangeOf(option: ReflectionAnswer): Range {
  const vectors = option.outcomes.map(outcomeVector);
  const keys = new Set(vectors.flatMap((v) => [...v.keys()]));
  const worst = new Map<string, number>();
  const best = new Map<string, number>();
  for (const key of keys) {
    const values = vectors.map((v) => v.get(key) ?? 0);
    worst.set(key, Math.min(...values));
    best.set(key, Math.max(...values));
  }
  return { worst, best };
}

const NOTHING: Range = { worst: new Map(), best: new Map() };

/** X beats Y when X's worst case is at least Y's best on every stat and target, and strictly better on one. */
function beats(x: Range, y: Range): boolean {
  let strictlyBetter = false;
  for (const key of new Set([...x.worst.keys(), ...y.best.keys()])) {
    const floor = x.worst.get(key) ?? 0;
    const ceiling = y.best.get(key) ?? 0;
    if (floor < ceiling) return false;
    if (floor > ceiling) strictlyBetter = true;
  }
  return strictlyBetter;
}

function allEffects(option: ReflectionAnswer): ReflectionEffect[] {
  return option.outcomes.flatMap((o) => o.effects);
}

function shapeErrors(label: string, option: ReflectionAnswer): string[] {
  const errors: string[] = [];
  if (option.outcomes.length === 0) return [`${label}: no outcomes`];
  const plain = option.outcomes.filter((o) => !o.when);
  if (plain.length === 0) errors.push(`${label}: needs an outcome without "when"`);
  if (plain.length > 1) {
    const total = plain.reduce((sum, o) => sum + (o.chance ?? 0), 0);
    if (plain.some((o) => o.chance === undefined) || Math.abs(total - 1) > 1e-9) errors.push(`${label}: the rolled outcomes' chances must sum to 1`);
  }
  for (const e of allEffects(option)) {
    if (!BALANCE.reflection.effectSizes[e.stat]?.[e.size]) errors.push(`${label}: no size "${e.size}" for ${e.stat}`);
    if ((e.stat === "faith" || e.stat === "satiety") && e.target !== undefined && e.target !== "party") errors.push(`${label}: ${e.stat} is party-wide and takes no target`);
  }
  return errors;
}

/** The per-reflection catalog rules (spec section 6.3, rules 1 to 4, 7 and 8). */
export function catalogRuleErrors(options: ReflectionAnswer[]): string[] {
  const errors: string[] = [];
  const shaped = new Set<ReflectionAnswer>();
  for (const option of options) {
    const label = `"${option.text}"`;
    const shape = shapeErrors(label, option);
    errors.push(...shape);
    if (shape.length > 0) continue;
    shaped.add(option);

    const effects = allEffects(option);
    for (const e of effects) {
      if (!e.readFrom || !option.text.includes(e.readFrom)) errors.push(`${label}: ${e.stat} effect reads from "${e.readFrom}", which is not in the text (rule 1)`);
      if (e.stat === "satiety" && e.sign === 1 && !option.feeds) errors.push(`${label}: raises Satiety without "feeds" (rule 7)`);
    }
    if (effects.length === 0) errors.push(`${label}: has no effect (rule 2)`);
    else if (!effects.some((e) => goodness(e) < 0) && effects.some((e) => e.size !== "small")) errors.push(`${label}: costs nothing but has a larger than small effect (rule 2)`);
  }

  const checked = options.filter((o) => shaped.has(o));
  if (options.filter((o) => !o.requires?.length).length < MIN_UNCONDITIONAL_ANSWERS) errors.push(`needs at least ${MIN_UNCONDITIONAL_ANSWERS} answers without a condition (rule 4)`);

  const ranges = new Map(checked.map((o) => [o, rangeOf(o)]));
  for (const y of checked) {
    const range = ranges.get(y)!;
    if (beats(NOTHING, range)) errors.push(`"${y.text}": leaving without a word beats it (rule 3)`);
    for (const x of checked) {
      if (x === y) continue;
      if (x.requires?.length && y.requires?.length && JSON.stringify(x.requires) !== JSON.stringify(y.requires)) continue;
      if (beats(ranges.get(x)!, range)) errors.push(`"${y.text}": "${x.text}" is simply better (rule 3)`);
    }
  }

  const signature = (o: ReflectionAnswer) =>
    JSON.stringify(
      o.outcomes.map((out) => ({ c: out.chance, w: out.when, e: out.effects.map((e) => [e.stat, e.size, e.sign, pairKey(e)]).sort() })),
    );
  const seen = new Map<string, ReflectionAnswer>();
  for (const o of checked) {
    const twin = seen.get(signature(o));
    if (twin) errors.push(`"${o.text}": same effects as "${twin.text}" (rule 8)`);
    else seen.set(signature(o), o);
  }
  return errors;
}

function faithDirection(option: ReflectionAnswer, sign: 1 | -1): boolean {
  return allEffects(option).some((e) => e.stat === "faith" && e.sign === sign);
}

/** The catalog-wide rules 5 and 6 for Faith: over every event answer by stance, and over the camp answers as one group. */
export function stanceSpreadErrors(events: ReflectionOption[], camp: ReflectionAnswer[] = []): string[] {
  const errors: string[] = [];
  const shareErrors = (group: ReflectionAnswer[], name: string, requireBothDirections: boolean) => {
    for (const [verb, sign] of [["raises", 1], ["lowers", -1]] as const) {
      const count = group.filter((o) => faithDirection(o, sign)).length;
      if (count === 0) {
        if (requireBothDirections) errors.push(`no ${name} answer ${verb} Faith (rule 5)`);
      } else if (count / group.length > MAX_FAITH_DIRECTION_SHARE) errors.push(`${count} of ${group.length} ${name} answers ${verb} Faith (rule 6)`);
    }
  };
  for (const stance of EVENT_STANCES) shareErrors(events.filter((o) => o.stance === stance), stance, true);
  if (camp.length > 0) shareErrors(camp, "camp", false);
  return errors;
}
