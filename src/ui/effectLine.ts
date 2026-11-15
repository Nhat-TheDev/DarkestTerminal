import type { TextChunk } from "@opentui/core";
import type { GameState, ReflectionAnswer, ReflectionCondition, ReflectionEffect, ReflectionOutcome } from "../types";
import { effectAmount } from "../data/reflectionCatalog";
import { getReligion } from "../data/religions";
import { t } from "../data/strings";
import { conditionHolds } from "../engine/reflection";
import { PALETTE, colorChunk } from "./theme";

export const EFFECT_SEPARATOR = "   ·   ";
const STAT_LABEL_KEY = { faith: "ui.effectFaith", fear: "ui.effectFear", satiety: "ui.effectSatiety", hp: "ui.effectHp", mp: "ui.effectMp" } as const;
export const ANSWER_INDENT = "      ";

type EffectStat = keyof typeof STAT_LABEL_KEY;

/** One effect chip: stat label, signed amount, a `%` for HP/MP shares (`fraction` is 0-1 there). */
export function statEffectText(stat: EffectStat, sign: 1 | -1, amount: number): string {
  const size = stat === "hp" || stat === "mp" ? `${Math.round(amount * 100)}%` : String(amount);
  return `${t(STAT_LABEL_KEY[stat])} ${sign === 1 ? "+" : "−"}${size}`;
}

function targetLabel(e: ReflectionEffect): string | null {
  if (e.target === "mostAfraid") return t("ui.effectTargetMostAfraid");
  if (e.target === "mostHurt") return t("ui.effectTargetMostHurt");
  return typeof e.target === "object" ? getReligion(e.target.religion).name : null;
}

/** A Fear gain shows its declared size: the Faith factor and each member's resistance apply when it lands. */
function effectText(e: ReflectionEffect): string {
  const target = targetLabel(e);
  return `${statEffectText(e.stat, e.sign, effectAmount(e))}${target ? ` (${target})` : ""}`;
}

/** The outcome whose `when` holds stands alone; otherwise the plain ones, as a roll with their odds when there are several. */
export function formatEffectLine(state: GameState, outcomes: ReflectionOutcome[]): string {
  const conditional = outcomes.find((o) => o.when && o.when.every((c) => conditionHolds(state, c)));
  const shown = conditional ? [conditional] : outcomes.filter((o) => !o.when);
  if (shown.length === 1) return shown[0]!.effects.map(effectText).join(EFFECT_SEPARATOR);
  return shown
    .map((o) => t("ui.effectRoll", { percent: Math.round((o.chance ?? 0) * 100), effects: o.effects.map(effectText).join(", ") }))
    .join(EFFECT_SEPARATOR);
}

function conditionLabel(c: ReflectionCondition): { text: string; color: string } {
  if ("religionInParty" in c) {
    const religion = getReligion(c.religionInParty);
    return { text: religion.name, color: religion.style.color };
  }
  if ("counterAtLeast" in c) return { text: t(`ui.reflectionCondition.counter.${c.counterAtLeast.counter}`), color: PALETTE.dim };
  return { text: t(`ui.reflectionCondition.gamble.${c.lastGambleOutcome}`), color: PALETTE.dim };
}

/** Numbered answers: a conditional one leads with its label, and every answer shows its effect line underneath. */
export function answerLines(state: GameState, answers: ReflectionAnswer[]): TextChunk[][] {
  return answers.flatMap((answer, i) => {
    const label: TextChunk[] = (answer.requires ?? []).flatMap((c) => {
      const { text, color } = conditionLabel(c);
      return [colorChunk(text, color), colorChunk(" · ", PALETTE.dim)];
    });
    return [
      [colorChunk(`[${i + 1}] `, PALETTE.text), ...label, colorChunk(answer.text, PALETTE.text)],
      [colorChunk(`${ANSWER_INDENT}${formatEffectLine(state, answer.outcomes)}`, PALETTE.dim)],
    ];
  });
}
