import type { Monster, MonsterBar } from "../types";
import { getArchetype } from "../data/monsters";

export function barsOf(monster: Monster): MonsterBar[] | undefined {
  return monster.tier === "boss" ? getArchetype(monster.archetypeId).bars : undefined;
}

/** A boss whose bar just emptied moves to the next bar at full HP with an empty meter, keeping its statuses; false when it is on its last bar (or has none). */
export function advanceBar(monster: Monster): boolean {
  const bars = barsOf(monster);
  const next = (monster.barIndex ?? 0) + 1;
  if (!bars || next >= bars.length || !monster.barBaseHp) return false;
  monster.barIndex = next;
  monster.maxHp = Math.round(monster.barBaseHp * bars[next]!.hpMultiplier);
  monster.hp = monster.maxHp;
  monster.telegraphMeter = 0;
  monster.barEntryPending = true;
  return true;
}
