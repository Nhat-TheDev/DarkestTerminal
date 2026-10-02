import type { BALANCE } from "../../src/data/balanceConfig";
import type { AbilityDefinition, ArtifactDefinition, CharacterClass, EventDefinition, GrowthWeightsData, MonsterArchetype, SkillDefinition, StatusEffectDefinition, SummonArchetype, SummonCast } from "../../src/types";

/** A table a generator produces; `renderMarkdown` turns it into text. */
export interface DocTable {
  columns: string[];
  rows: (string | number)[][];
}

/** What generators read. A generator that needs another catalog adds it here and to `loadDocsData`. */
export interface DocsData {
  balance: typeof BALANCE;
  classes: readonly CharacterClass[];
  abilities: readonly AbilityDefinition[];
  events: readonly EventDefinition[];
  artifacts: readonly ArtifactDefinition[];
  statusEffects: readonly StatusEffectDefinition[];
  growthWeights: GrowthWeightsData;
  monsters: { archetypes: readonly MonsterArchetype[]; skills: readonly SkillDefinition[] };
  /** Every number found in `data/*.json`, with the field name and entry id that hold it; the coverage check looks for them in the docs. Absent in tests that do not need it. */
  dataValues?: ReadonlyMap<number, ReadonlySet<string>>;
  summons: { archetypes: readonly SummonArchetype[]; skills: readonly SkillDefinition[]; casts: readonly SummonCast[] };
}

export type Generator = (data: DocsData, args: Record<string, string>) => DocTable;

export interface GeneratorSpec {
  /** Where the numbers come from; named in the notice line above the table. */
  source: string;
  /** The `key=value` arguments a marker may carry. Any other key is an error. */
  args: readonly string[];
  generate: Generator;
}

export interface Finding {
  file: string;
  /** 1-based. */
  line: number;
  message: string;
  /** `docs:sync` repairs it by rewriting; an unfixable finding needs a person. */
  fixable: boolean;
}
