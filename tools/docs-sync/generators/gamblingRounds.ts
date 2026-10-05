import { capitalize, formatNumber, formatPercent } from "../format";
import type { GeneratorSpec } from "../types";

/** The Wandering Gambling Den's rounds: the stake, the odds, and what a win pays. */
export const gamblingRounds: GeneratorSpec = {
  source: "`data/balance-config.json` (`events.gamblingDenRounds`)",
  args: [],
  generate: ({ balance }) => {
    const rounds = balance.events.gamblingDenRounds;
    return {
      columns: ["Round", "Stake (= the pot so far)", "Win chance", "On win"],
      rows: rounds.map((round, index) => {
        const next = rounds[index + 1];
        let onWin: string;
        if (round.jackpotArtifactCount !== undefined && round.jackpotRarity !== undefined) {
          const noun = round.jackpotArtifactCount === 1 ? "Artifact" : "Artifacts";
          onWin = `**${round.jackpotArtifactCount} ${capitalize(round.jackpotRarity)} ${noun}** — the pot converts into the jackpot reward instead of doubling again`;
        } else if (next) {
          onWin = `pot → ${formatNumber(next.stake)} coins`;
        } else {
          throw new Error(`round ${index + 1} has no next round and no jackpot`);
        }
        return [index + 1, `${formatNumber(round.stake)} coins`, formatPercent(round.winChance), onWin];
      }),
    };
  },
};
