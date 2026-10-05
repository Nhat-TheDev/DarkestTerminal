import { formatAbilityEffect } from "../../../src/data/abilities";
import { required } from "./args";
import type { GeneratorSpec } from "../types";

/** The abilities of one rarity, with the effect text the game itself shows. */
export const abilities: GeneratorSpec = {
  source: "`data/abilities.json`",
  args: ["rarity"],
  generate: ({ abilities: all }, args) => {
    const rarity = required(args, "rarity");
    const ofRarity = all.filter((ability) => ability.rarity === rarity);
    if (ofRarity.length === 0) throw new Error(`no ability has the rarity "${rarity}"`);
    return {
      columns: ["id", "Name", "Description", "Effect"],
      rows: ofRarity.map((ability) => [`\`${ability.id}\``, ability.name, ability.description, formatAbilityEffect(ability)]),
    };
  },
};
