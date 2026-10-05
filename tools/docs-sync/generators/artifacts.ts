import { formatArtifactEffect } from "../../../src/data/artifacts";
import { capitalize } from "../format";
import { list } from "./args";
import type { GeneratorSpec } from "../types";

/** The artifacts named in `ids`, in that order: rarity, the effect text the game shows, and the story. */
export const artifacts: GeneratorSpec = {
  source: "`data/artifacts.json`",
  args: ["ids"],
  generate: ({ artifacts: all }, args) => ({
    columns: ["id", "Rarity", "Effect", "Story"],
    rows: list(args, "ids").map((id) => {
      const artifact = all.find((candidate) => candidate.id === id);
      if (!artifact) throw new Error(`no artifact "${id}" in data/artifacts.json`);
      return [`\`${id}\``, capitalize(artifact.rarity), formatArtifactEffect(artifact), `"${artifact.description}"`];
    }),
  }),
};
