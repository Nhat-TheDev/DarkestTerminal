import type { BoonStat } from "../../../src/types";
import type { GeneratorSpec } from "../types";

const EMPHASIS: Record<BoonStat, string> = { offense: "Attack and magic power", defense: "Defense", speed: "Speed" };

export const religions: GeneratorSpec = {
  source: "`data/religions.json` and `data/classes.json`",
  args: [],
  generate: ({ religions: all, classes }) => ({
    columns: ["Religion", "Classes", "Boon"],
    rows: all.map((religion) => {
      const followers = classes.filter((c) => c.religionId === religion.id).map((c) => c.name);
      const emphasis = religion.boon.emphasis ? `${EMPHASIS[religion.boon.emphasis]} raised more` : "All three raised evenly";
      return [religion.name, followers.join(", "), religion.boon.recoversHpMp ? `${emphasis}; HP and MP restored in every room` : emphasis];
    }),
  }),
};
