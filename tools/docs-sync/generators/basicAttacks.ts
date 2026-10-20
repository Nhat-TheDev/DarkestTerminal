import type { GeneratorSpec } from "../types";

export const basicAttacks: GeneratorSpec = {
  source: "`data/classes.json`",
  args: [],
  generate: ({ classes }) => ({
    columns: ["Class", "Skill id", "Name", "Damage stat"],
    rows: classes.flatMap((found) =>
      found.skills
        .filter((skill) => skill.slot === 0)
        .map((skill) => [found.name, `\`${skill.id}\``, skill.name, skill.isMagic ? "magicPower" : "attack"]),
    ),
  }),
};
