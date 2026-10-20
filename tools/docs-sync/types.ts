import type { BALANCE } from "../../src/data/balanceConfig";
import type { AbilityDefinition, ArtifactDefinition, CharacterClass, EventDefinition, GrowthWeightsData, MonsterArchetype, SkillDefinition, StatusEffectDefinition, SummonArchetype, SummonCast } from "../../src/types";

export interface DocTable {
  columns: string[];
  rows: (string | number)[][];
}

export interface DocsData {
  balance: typeof BALANCE;
  classes: readonly CharacterClass[];
  abilities: readonly AbilityDefinition[];
  events: readonly EventDefinition[];
  artifacts: readonly ArtifactDefinition[];
  statusEffects: readonly StatusEffectDefinition[];
  growthWeights: GrowthWeightsData;
  monsters: { archetypes: readonly MonsterArchetype[]; skills: readonly SkillDefinition[] };
  /** Each data value with the field names and entry ids that hold it; absent in tests that do not need it. */
  dataValues?: ReadonlyMap<number, ReadonlySet<string>>;
  summons: { archetypes: readonly SummonArchetype[]; skills: readonly SkillDefinition[]; casts: readonly SummonCast[] };
}

export type Generator = (data: DocsData, args: Record<string, string>) => DocTable;

export interface GeneratorSpec {
  source: string;
  args: readonly string[];
  generate: Generator;
}

export interface Finding {
  file: string;
  /** 1-based. */
  line: number;
  message: string;
  fixable: boolean;
}
