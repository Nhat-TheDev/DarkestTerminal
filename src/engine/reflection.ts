import type { Character, GameState, ReflectionAnswer, ReflectionCondition, ReflectionEffect, ReflectionOutcome } from "../types";
import type { EngineContext } from "./combat";
import { escalationThreshold } from "../data/events";
import { religionOf } from "../data/religions";
import { effectAmount } from "../data/reflectionCatalog";
import { recomputeAllPartyStats } from "./party";
import { adjustFaith, adjustFear, drainSatiety, resistedFearGain } from "./survival";

export { catalogRuleErrors, effectAmount, stanceSpreadErrors } from "../data/reflectionCatalog";

export function conditionHolds(state: GameState, c: ReflectionCondition): boolean {
  if ("religionInParty" in c) return state.party.some((m) => m.isAlive && religionOf(m).id === c.religionInParty);
  if ("counterAtLeast" in c) return state.narrativeCounters[c.counterAtLeast.counter] >= escalationThreshold(c.counterAtLeast.threshold);
  return state.lastGamblingDenOutcome === c.lastGambleOutcome;
}

/** The answers whose `requires` all hold, in their declared order. */
export function shownOptions<T extends Pick<ReflectionAnswer, "requires">>(state: GameState, options: T[]): T[] {
  return options.filter((o) => (o.requires ?? []).every((c) => conditionHolds(state, c)));
}

/** The first outcome whose `when` holds; otherwise the plain outcomes, rolled only when there is more than one. */
export function resolveOutcome(state: GameState, ctx: EngineContext, option: Pick<ReflectionAnswer, "outcomes">): ReflectionOutcome {
  const conditional = option.outcomes.find((o) => o.when && o.when.every((c) => conditionHolds(state, c)));
  if (conditional) return conditional;
  const plain = option.outcomes.filter((o) => !o.when);
  if (plain.length === 1) return plain[0]!;
  let roll = ctx.rng.next();
  for (const outcome of plain) {
    roll -= outcome.chance ?? 0;
    if (roll < 0) return outcome;
  }
  return plain[plain.length - 1]!;
}

function targetsOf(state: GameState, e: ReflectionEffect): Character[] {
  const living = state.party.filter((c) => c.isAlive);
  if (e.target === "mostAfraid") {
    const afraid = living.reduce<Character | undefined>((best, c) => (!best || c.survival.fear > best.survival.fear ? c : best), undefined);
    return afraid ? [afraid] : [];
  }
  if (e.target === "mostHurt") {
    const hurt = living.reduce<Character | undefined>((best, c) => (!best || c.hp / c.maxHp < best.hp / best.maxHp ? c : best), undefined);
    return hurt ? [hurt] : [];
  }
  const target = e.target;
  if (typeof target === "object") return living.filter((c) => religionOf(c).id === target.religion);
  return living;
}

/** Fear gains use the Faith the party had when the answer was picked, whatever order the effects list in. */
export function applyReflectionEffects(state: GameState, effects: ReflectionEffect[]): void {
  const faithAtPick = state.faith;
  let satietyChanged = false;

  for (const e of effects) {
    const amount = effectAmount(e);
    if (e.stat === "faith") {
      adjustFaith(state, e.sign * amount);
    } else if (e.stat === "satiety") {
      const before = state.satiety;
      if (e.sign === 1) state.satiety = Math.min(100, state.satiety + amount);
      else drainSatiety(state, amount, []);
      satietyChanged ||= state.satiety !== before;
    } else {
      for (const c of targetsOf(state, e)) {
        if (e.stat === "fear") {
          adjustFear(c, e.sign === 1 ? resistedFearGain(c, amount, faithAtPick) : -amount);
          continue;
        }
        const points = effectAmount(e, c);
        const key = e.stat === "hp" ? "hp" : "mp";
        const max = key === "hp" ? c.maxHp : c.maxMp;
        c[key] = e.sign === 1 ? Math.min(max, c[key] + points) : Math.max(key === "hp" ? 1 : 0, c[key] - points);
      }
    }
  }
  if (satietyChanged) recomputeAllPartyStats(state);
}
