import { BALANCE, faithSourcesConfigError } from "../../src/data/balanceConfig";
import { EVENTS, assertEventDataConsistent } from "../../src/data/events";
import { CAMP_REFLECTIONS } from "../../src/data/loreExposure";
import { catalogRuleErrors } from "../../src/data/reflectionCatalog";

export const NESTED_BALANCE_SECTIONS = ["faith", "temple", "rest", "reflection"] as const;

/** Runs the game's own load-time checks against patched nested sections, so the editor never writes a config the game refuses to start with. */
export function nestedBalanceError(balance: Record<string, unknown>): string | null {
  const live = BALANCE as unknown as Record<string, unknown>;
  const saved = NESTED_BALANCE_SECTIONS.map((key) => live[key]);
  for (const key of NESTED_BALANCE_SECTIONS) live[key] = balance[key];
  try {
    const sourcesError = faithSourcesConfigError(BALANCE);
    if (sourcesError) return sourcesError;
    assertEventDataConsistent(EVENTS);
    for (const [tier, content] of Object.entries(CAMP_REFLECTIONS)) {
      const errors = catalogRuleErrors(content.options);
      if (errors.length > 0) return `Camp reflection tier ${tier} breaks the catalog rules: ${errors.join("; ")}`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    NESTED_BALANCE_SECTIONS.forEach((key, i) => { live[key] = saved[i]; });
  }
}
