import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DARKEST_TERMINAL_SAVE_DIR = mkdtempSync(join(tmpdir(), "darkest-terminal-test-"));

import { BALANCE } from "../src/data/balanceConfig";

/** Most tests rely on a floor opening with its entrance fight, so temples are off unless a test turns them on. */
export const CONFIGURED_TEMPLE_CHANCE = BALANCE.temple.chance;
BALANCE.temple.chance = 0;

export function withTempleChance<T>(chance: number, fn: () => T): T {
  const saved = BALANCE.temple.chance;
  BALANCE.temple.chance = chance;
  try {
    return fn();
  } finally {
    BALANCE.temple.chance = saved;
  }
}
