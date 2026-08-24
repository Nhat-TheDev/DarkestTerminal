# Gameplay / Content — Decisions (index)

**Related**: `../design-doc.md` section 1, `../../dungeon-crawler-data-model.ts`

Each major topic gets its own file for easier reading/editing. Section numbers (§1, §6.9,
...) are used so files can cross-reference each other — e.g. "see `06-level-system.md` §6.9".

| File | Section | Content |
|---|---|---|
| [`01-class-skill.md`](./01-class-skill.md) | §1 | Class roster (6 classes, incl. Viking & Plague Doctor), skills per class, the 3-rank skill power-scaling system, status effects used by skills — `data/classes.json` |
| [`02-monster.md`](./02-monster.md) | §2 | Monster scaling formula by floor, aggro-based targeting, AI patterns (incl. the `aiPattern: "defensive"` low-HP logic), regular-monster skill kits, monster tiers (normal/Elite/Boss) — `data/monsters.json` |
| [`03-survival-stats.md`](./03-survival-stats.md) | §3 | Fear/hunger/thirst thresholds, fear tiers — `data/balance-config.json` |
| [`04-fear-combat.md`](./04-fear-combat.md) | §4 | How fear feeds back into combat, per-target AoE accuracy rolls, ultimates |
| [`05-character-stats.md`](./05-character-stats.md) | §5 | How HP/MP work, growth by level |
| [`06-level-system.md`](./06-level-system.md) | §6 | Level system, EXP, infinite dungeon-floor level, Elite/Boss, Elite/Boss-exclusive skills — `data/level-growth.json` |
| [`07-items-artifacts.md`](./07-items-artifacts.md) | §7 | Consumable items + Artifacts (permanent relics within a run), rarity, drop sources |
| [`08-events.md`](./08-events.md) | §8 | Event rooms: event types split by rarity tier |

Other files in `docs/` (`technical-decisions.md`, `minigame-decisions.md`) reference this document via the path `gameplay-decisions/<file>.md §N`.
